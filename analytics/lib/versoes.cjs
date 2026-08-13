// RF-05 — versionamento de prompts, templates e regras editoriais.
//
// O PROBLEMA REAL DESTE PROJETO
// Prompt e template vivem dentro de `workflow_entity.nodes`, um blob JSON. "Versão" aqui não pode
// ser um número que alguém digita: já aconteceu de um rollback reverter só UMA das cópias de uma
// regra e ninguém ver por semanas (ver workflows/README.md). Então a versão é DERIVADA do conteúdo:
//
//   versão = sha256 do que está no banco  ->  rótulo humano vindo de versoes/registry.json
//
// Consequências úteis:
//  - impossível a versão registrada divergir do que roda: ela É o hash do que roda
//  - conteúdo que ninguém registrou aparece como `NAO-REGISTRADA` e vira alerta (drift detectado)
//  - rollback = deployar o conteúdo antigo; o hash volta a bater com o rótulo antigo sozinho
//
// HASH DE LÓGICA vs HASH DE CONTEÚDO
// Os builders de slide/capa têm a fonte e o mascote embutidos em base64 (~387 KB). Trocar a fonte
// mudaria o hash sem que o layout mudasse. Por isso o rótulo é ancorado no `hash_logica`, que é o
// código com os literais gigantes substituídos por um marcador; o `hash` completo fica gravado
// junto para auditoria.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REGISTRY = path.join(__dirname, '..', 'versoes', 'registry.json');

// Onde cada artefato mora. Mudou de nó? Mude AQUI, num lugar só.
const ARTEFATOS = [
  { chave: 'prompt_redator',   workflow: 'produtor',   no: 'AI Agent',                            campo: 'systemMessage' },
  { chave: 'prompt_curador',   workflow: 'produtor',   no: 'Agente Curador PromoLiso AI',         campo: 'systemMessage' },
  { chave: 'prompt_verificador', workflow: 'produtor', no: 'Agente Verificador de Confiabilidade', campo: 'systemMessage' },
  { chave: 'template_slide',   workflow: 'produtor',   no: 'Code in JavaScript',                  campo: 'jsCode' },
  { chave: 'template_capa',    workflow: 'produtor',   no: 'Code in JavaScript1',                 campo: 'jsCode' },
  { chave: 'regras_validador', workflow: 'produtor',   no: 'Validar antes de publicar',           campo: 'jsCode' },
  { chave: 'regras_legenda',   workflow: 'produtor',   no: 'Formatar legenda',                    campo: 'jsCode' },
  { chave: 'regras_fila',      workflow: 'publicador', no: 'Selecionar READY',                    campo: 'jsCode' },
];

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

// Substitui literais gigantes (base64 de fonte/mascote) por um marcador com o tamanho, para o
// hash de lógica não se mexer quando só o asset muda.
function semAssets(codigo) {
  return String(codigo).replace(/(['"`])([A-Za-z0-9+/=]{1000,})\1/g,
    (m, q, b) => `${q}<ASSET:${b.length}>${q}`);
}

// Onde o texto do prompt mora depende do TIPO do nó — e os dois tipos convivem neste workflow:
//
//   @n8n/n8n-nodes-langchain.agent     -> parameters.options.systemMessage
//   @n8n/n8n-nodes-langchain.chainLlm  -> parameters.messages.messageValues[].message
//                                         (o item com type 'SystemMessagePromptTemplate')
//
// Descoberto ao instalar no VPS em 2026-08-07: o Curador e o Verificador apareceram como
// AUSENTE ("campo systemMessage vazio no nó") porque só o primeiro formato era lido. Dois dos
// oito artefatos ficariam sem versão — justamente os que decidem QUAL pauta entra.
function extrairConteudo(no, campo) {
  const p = (no && no.parameters) || {};
  if (campo === 'jsCode') return typeof p.jsCode === 'string' && p.jsCode.length ? p.jsCode : null;
  if (campo !== 'systemMessage') return null;

  const direto = p.options && p.options.systemMessage;
  if (typeof direto === 'string' && direto.length) return direto;

  const vals = p.messages && p.messages.messageValues;
  if (Array.isArray(vals)) {
    // sem `type` declarado o n8n trata como system; por isso o filtro aceita ausência
    const sistema = vals.filter((v) => v && typeof v.message === 'string' && v.message.length &&
      (!v.type || /system/i.test(String(v.type))));
    if (sistema.length) return sistema.map((v) => v.message).join('\n---\n');
  }
  return null;
}

function lerRegistry() {
  if (!fs.existsSync(REGISTRY)) return { artefatos: {} };
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch (e) {
    throw new Error(`versoes/registry.json ilegível: ${e.message}`);
  }
}

// Lê o conteúdo vivo de cada artefato direto do banco (fonte de verdade), calcula os hashes e
// resolve o rótulo. Não grava nada — quem grava é registrar-versoes.cjs.
async function inspecionar(w, workflows) {
  const registry = lerRegistry();
  const porWorkflow = new Map();
  for (const chave of Object.keys(workflows)) {
    const row = await w.get('SELECT id, name, nodes, versionId, activeVersionId FROM workflow_entity WHERE id=?', [workflows[chave]]);
    if (row) {
      let nodes = [];
      try { nodes = JSON.parse(row.nodes || '[]'); } catch { nodes = []; }
      porWorkflow.set(chave, { row, nodes });
    }
  }

  const saida = [];
  for (const a of ARTEFATOS) {
    const wf = porWorkflow.get(a.workflow);
    if (!wf) { saida.push({ ...a, presente: false, motivo: `workflow "${a.workflow}" não está no banco` }); continue; }
    const no = wf.nodes.find((x) => x.name === a.no);
    if (!no) { saida.push({ ...a, presente: false, motivo: `nó "${a.no}" não existe` }); continue; }

    const conteudo = extrairConteudo(no, a.campo);
    if (typeof conteudo !== 'string' || !conteudo.length) {
      saida.push({ ...a, presente: false, motivo: `campo "${a.campo}" vazio no nó "${a.no}" (tipo ${no.type})` });
      continue;
    }

    const hash = sha(conteudo);
    const hashLogica = sha(semAssets(conteudo));
    const conhecidas = (registry.artefatos && registry.artefatos[a.chave]) || {};
    const rotulo = conhecidas[hashLogica.slice(0, 12)] || 'NAO-REGISTRADA';

    saida.push({
      ...a,
      presente: true,
      workflow_id: wf.row.id,
      hash,
      hash_logica: hashLogica,
      curto: hashLogica.slice(0, 12),
      rotulo,
      tamanho: conteudo.length,
      publicado: wf.row.versionId === wf.row.activeVersionId,
    });
  }
  return saida;
}

// "Qual versão saiu neste post" é uma pergunta sobre o passado. Como o conteúdo de um nó pode ter
// mudado desde então, o valor gravado na publicação é o rótulo VIGENTE no momento da coleta —
// que é o mais próximo da verdade que dá para saber sem instrumentar o workflow por dentro.
// A precisão real vem de `promoliso_versoes.primeira_vez_em/ultima_vez_em`.
function resumoParaPublicacao(inspecao) {
  const por = (chave) => inspecao.find((i) => i.chave === chave && i.presente);
  const rot = (chave) => { const x = por(chave); return x ? `${chave}=${x.rotulo}@${x.curto}` : `${chave}=?`; };
  return {
    prompt_versao: rot('prompt_redator'),
    template_versao: [rot('template_slide'), rot('template_capa')].join(' '),
    regras_versao: [rot('regras_validador'), rot('regras_legenda'), rot('regras_fila')].join(' '),
  };
}

module.exports = { ARTEFATOS, inspecionar, resumoParaPublicacao, lerRegistry, semAssets, sha, extrairConteudo, REGISTRY };
