// O agente para de anunciar e não entregar.
//
// O SINTOMA (medido em 40 execuções, 12/08/2026): "JSON editorial malformado" é a MAIOR causa de
// reprovação do sistema — 7 das 19, 37%. Não é conteúdo ruim nem fonte ruim: lendo a saída crua, a
// última fala do agente foi "Isso dá material rico pros 5 slides. Vou escrever agora." e "Agora vou
// estruturar os 5 slides...". Ele anunciou o trabalho e parou. Dos 7, 4 temas voltaram numa rodada
// seguinte e passaram; 3 pautas se perderam de vez.
//
// O MECANISMO: o nó tem `maxIterations: 6` e DUAS ferramentas ("Busca detalhada" e "Pensar"). Cada
// chamada de ferramenta gasta uma iteração. Quando a pesquisa come as 6, o laço termina e o n8n
// devolve a última mensagem do modelo — que é justamente o preâmbulo. O nó NÃO falha: ele entrega
// texto. Por isso `retryOnFail` não resolveria nada aqui, e por isso as duas tentativas do
// "Preparar 2 tentativas" também não salvam: as duas esbarram no mesmo teto.
//
// A CORREÇÃO, em duas frentes que se cobrem:
//   A) teto de 6 para 10 iterações (o default do n8n). Custa mais chamada de ferramenta só nas
//      pautas difíceis, e é o modelo mini.
//   B) regra no prompt: pesquisa tem orçamento, a última palavra é o JSON, e nunca terminar
//      anunciando o que vai fazer. Sem custo nenhum.
//
// O QUE ESTE PATCH NÃO PODE PROVAR. Comportamento de modelo não se prova offline: o harness cobre
// que a mudança entrou e que nada mais mudou. A prova é a produção — contar "JSON editorial
// malformado" nas próximas 40 execuções e comparar com as 7 de hoje. Está escrito assim de
// propósito, para ninguém confundir teste verde com problema resolvido.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'AI Agent';
const DE_ITER = 6;
const PARA_ITER = 10;

const REGRA = '\n## Orçamento de pesquisa PromoLiso P0.15\n'
  + '- Você tem no máximo dez passos de ferramenta por tentativa, e a resposta final consome um deles.\n'
  + '- Pare de pesquisar assim que tiver fato, fonte e números suficientes para os cinco slides. Pesquisa a mais não melhora o carrossel; ela consome o passo que faltava para escrever.\n'
  + '- NUNCA termine anunciando o que vai fazer. Frases como "vou escrever agora" ou "agora vou estruturar os slides" são resposta perdida: o fluxo recebe esse texto no lugar do JSON e reprova a pauta inteira.\n'
  + '- Sua última mensagem tem de ser o objeto JSON completo, sem texto antes nem depois.\n'
  + '- Se o orçamento estiver acabando e faltar confirmação, escolha entre duas saídas honestas: escreva o JSON com o que está confirmado, ou devolva o JSON com aprovado_para_publicar false e o motivo. As duas são melhores que parar no meio.\n';

// entra logo antes do bloco de decisão por categoria, junto das outras regras P0
const ANCORA = '## Decisão editorial por categoria PromoLiso P0.11';

function trocarPrompt(texto) {
  if (texto.includes('P0.15')) throw new Error(`${NO}: prompt já tem o orçamento de pesquisa — patch já aplicado?`);
  const vezes = texto.split(ANCORA).length - 1;
  if (vezes !== 1) throw new Error(`${NO}: âncora do prompt apareceu ${vezes} vezes — abortando`);
  return texto.split(ANCORA).join(REGRA + '\n' + ANCORA);
}

function trocarOpcoes(options) {
  const o = JSON.parse(JSON.stringify(options || {}));
  if (o.maxIterations === PARA_ITER) throw new Error(`${NO}: maxIterations já está em ${PARA_ITER} — patch já aplicado?`);
  if (o.maxIterations !== DE_ITER) {
    throw new Error(`${NO}: esperava maxIterations=${DE_ITER} e achei ${o.maxIterations} — alguém mexeu; revisar antes`);
  }
  o.maxIterations = PARA_ITER;
  return o;
}

module.exports = { WF, NO, DE_ITER, PARA_ITER, REGRA, ANCORA, trocarPrompt, trocarOpcoes };

if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node ' + path.posix.join('design', path.basename(__filename)) + ' --dry');
  process.exit(1);
}
const DRY = process.argv.includes('--dry');
const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const ag = nodes.find((x) => x.name === NO);
  if (!ag) throw new Error('nó não achado: ' + NO);

  const opcoes = trocarOpcoes(ag.parameters.options);
  const prompt = trocarPrompt(String(ag.parameters.options.systemMessage || ''));
  if (!prompt) throw new Error(`${NO}: systemMessage vazio`);
  opcoes.systemMessage = prompt;
  ag.parameters.options = opcoes;
  console.log(`OK  ${NO}  (maxIterations ${DE_ITER} -> ${PARA_ITER} e regra de orçamento no prompt)`);

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'agente para de anunciar sem entregar: maxIterations 6->10 e orcamento de pesquisa no prompt', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-agente-entrega.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
