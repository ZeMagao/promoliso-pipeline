// Exporta o código que está DENTRO do banco do n8n para arquivos versionáveis em workflows/.
//
// POR QUE ISSO EXISTE
// O código que roda em produção (validador de ~900 linhas, builders de slide, publicador) vive
// num blob JSON em `workflow_entity.nodes`. Não há diff, histórico legível nem review possível —
// e foi isso que permitiu os dois bugs de 2026-08-05/06, os dois do mesmo tipo: uma regra escrita
// em dois lugares que precisam concordar, divergindo sem ninguém ver.
//   caps:     42/38/300 em limitar(), no check do validador e no prompt do agente
//   fallback: construção da URL do Cloudinary no builder e no nó de fallback
// Com o snapshot no git, drift desses vira diff visível.
//
// O QUE EXPORTA
//   workflows/<slug>/<no>.js          -> jsCode dos Code nodes, byte a byte igual ao banco
//   workflows/<slug>/<no>.prompt.md   -> options.systemMessage dos agentes de IA
//   workflows/<slug>/_manifest.json   -> nós (nome/tipo/versão), conexões e o activeVersionId
//
// O QUE NÃO EXPORTA (de propósito)
// `parameters` cru. Ali moram headers, query de ferramenta, referências de credencial e caminhos —
// nada disso precisa virar arquivo, e dump cego de parâmetros é como segredo vaza pro git.
//
// ESTÁVEL POR CONSTRUÇÃO: sem timestamp de geração e tudo ordenado por nome, então rodar duas vezes
// sem deploy no meio não produz diff. O que muda o manifest é deploy de verdade (activeVersionId).
//
// Uso (no VPS):  cd /opt/promoliso && sudo -u promo node export-workflows.cjs
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, 'data', '.n8n', 'database.sqlite');
const SAIDA = path.join(__dirname, 'workflows');

const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
const all = (q, p) => new Promise((r, j) => db.all(q, p || [], (e, x) => (e ? j(e) : r(x))));

// nome de nó -> nome de arquivo seguro, sem perder legibilidade
function slug(nome) {
  return String(nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'sem-nome';
}

(async () => {
  const wfs = await all('SELECT id, name, active, versionId, activeVersionId, nodes, connections FROM workflow_entity ORDER BY name');
  if (!wfs.length) throw new Error('nenhum workflow no banco: ' + DB);

  fs.mkdirSync(SAIDA, { recursive: true });
  // limpa a saída pra nó removido não ficar como arquivo fantasma no repo
  for (const dir of fs.readdirSync(SAIDA, { withFileTypes: true })) {
    if (dir.isDirectory()) fs.rmSync(path.join(SAIDA, dir.name), { recursive: true, force: true });
  }

  const resumo = [];
  for (const wf of wfs) {
    const dir = path.join(SAIDA, slug(wf.name) + '--' + wf.id);
    fs.mkdirSync(dir, { recursive: true });

    let nodes;
    try { nodes = JSON.parse(wf.nodes); } catch { throw new Error('nodes ilegível em ' + wf.id); }
    nodes.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const manifest = {
      id: wf.id,
      name: wf.name,
      active: Boolean(wf.active),
      versionId: wf.versionId,
      activeVersionId: wf.activeVersionId,
      draft_igual_publicado: wf.versionId === wf.activeVersionId,
      total_nos: nodes.length,
      nos: [],
      conexoes: {},
    };

    let comCodigo = 0, comPrompt = 0;
    for (const n of nodes) {
      const p = n.parameters || {};
      const info = {
        nome: n.name,
        tipo: n.type,
        typeVersion: n.typeVersion,
      };
      if (n.disabled) info.desabilitado = true;
      // onError!=stopWorkflow engole erro: é a fonte das falhas silenciosas do projeto,
      // então fica registrado no manifest pra dar pra auditar de fora.
      if (n.onError) info.onError = n.onError;
      if (n.continueOnFail) info.continueOnFail = true;
      if (n.alwaysOutputData) info.alwaysOutputData = true;

      if (typeof p.jsCode === 'string') {
        const arq = slug(n.name) + '.js';
        fs.writeFileSync(path.join(dir, arq), p.jsCode);
        info.codigo = arq;
        info.linhas = p.jsCode.split('\n').length;
        comCodigo++;
      }
      const prompt = p.options && p.options.systemMessage;
      if (typeof prompt === 'string') {
        const arq = slug(n.name) + '.prompt.md';
        fs.writeFileSync(path.join(dir, arq), prompt);
        info.prompt = arq;
        info.prompt_chars = prompt.length;
        comPrompt++;
      }
      // cron fica no manifest: agendamento é regra de negócio e já nos morderam nele
      // (publicador e produtor com slot no MESMO minuto às 20:00)
      const crons = (((p.rule || {}).interval) || [])
        .map((i) => i.cronExpression)
        .filter(Boolean);
      if (crons.length) info.cron = crons;

      manifest.nos.push(info);
    }

    let conns;
    try { conns = JSON.parse(wf.connections || '{}'); } catch { conns = {}; }
    for (const origem of Object.keys(conns).sort()) {
      const saidas = (conns[origem] || {}).main || [];
      manifest.conexoes[origem] = saidas.map((br) => (br || []).map((c) => c.node));
    }

    fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    resumo.push({ wf: wf.name, id: wf.id, nos: nodes.length, codigo: comCodigo, prompt: comPrompt, dir: path.basename(dir) });
  }

  console.log('exportado para ' + SAIDA);
  for (const r of resumo) {
    console.log(`  ${r.dir}`);
    console.log(`     ${r.nos} nós | ${r.codigo} com jsCode | ${r.prompt} com systemMessage`);
  }
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
