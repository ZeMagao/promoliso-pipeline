// Quatro feeds novos: IGN Brasil, GameBlast, Tecnoblog e GG.deals.
//
// POR QUE ESTES QUATRO, e não os doze que passaram no teste. Cada feed é execução gasta e ruído a
// mais para o curador escolher. Estes cobrem o que falta e não o que já temos:
//   IGN Brasil  volume e foco em games (40 itens, 100% com imagem)
//   GameBlast   cena BR, 100% com imagem
//   Tecnoblog   hardware, que é metade da pauta e hoje só vem do Adrenaline
//   GG.deals    o ÚNICO eixo de promoção que sobreviveu ao teste — a conta se chama PromoLiso e
//               não tinha nenhuma fonte de desconto. Pelando 404, Hardmob 403, Promobit parado há
//               892 h, Steam News com 5% de imagem. Ressalva escrita: gg.deals é em inglês e só PC.
// Canaltech e Olhar Digital ficaram FORA de propósito: tecnologia geral, trariam muita notícia
// fora do tema. A medição de todos está em design/feeds_candidatos.json.
//
// POR QUE ISTO AJUDA, e não é só volume: o validador exige "fonte primária relevante OU duas
// confirmações independentes". Os feeds de hoje quase nunca cobrem a mesma notícia (medido: 0 em 2
// sites em 28 execuções), então o segundo caminho praticamente nunca dispara. Mais fontes
// editoriais é exatamente o que faz ele existir.
//
// O QUE MUDA NA ESTRUTURA (é cirurgia de nó, então vai devagar e conferindo):
//   1. 4 nós rssFeedRead novos, clonados do "Feed Adrenaline" — mesmo retry (2x, 1,5 s) e mesmo
//      onError (continueRegularOutput). Feed que cai não pode travar o merge.
//   2. Schedule Trigger e o botão de execução manual passam a disparar os 4 também.
//   3. Cada um entra no "Unir feeds oficiais" num índice próprio (8 a 11), e o merge sobe de 8
//      para 12 entradas. Índice repetido faria um feed sobrescrever o outro em silêncio.
//   4. Os domínios entram em `dominios_editoriais` da "Configuração PromoLiso AI", que é o que o
//      curador lê. Não entram em `dominiosPrimarios`: primária é fabricante/publisher, e nenhum
//      destes é.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const MERGE = 'Unir feeds oficiais';
const CONFIG = 'Configuração PromoLiso AI';
const MODELO = 'Feed Adrenaline';
const GATILHOS = ['Schedule Trigger', 'When clicking ‘Execute workflow’'];

const NOVOS = [
  { name: 'Feed IGN Brasil', url: 'https://br.ign.com/feed.xml', dominio: 'ign.com' },
  { name: 'Feed GameBlast', url: 'https://www.gameblast.com.br/feeds/posts/default?alt=rss', dominio: 'gameblast.com.br' },
  { name: 'Feed Tecnoblog', url: 'https://tecnoblog.net/feed/', dominio: 'tecnoblog.net' },
  { name: 'Feed GG.deals', url: 'https://gg.deals/news/feed/', dominio: 'gg.deals' },
];

// Aplica sobre nodes+connections já parseados. Fica separado do banco pro harness poder rodar isto
// contra uma topologia sintética, sem VPS.
function aplicar(nodes, connections, novoId) {
  novoId = novoId || (() => crypto.randomUUID());

  const modelo = nodes.find((n) => n.name === MODELO);
  if (!modelo) throw new Error('nó modelo não achado: ' + MODELO);
  const merge = nodes.find((n) => n.name === MERGE);
  if (!merge) throw new Error('nó não achado: ' + MERGE);
  const config = nodes.find((n) => n.name === CONFIG);
  if (!config) throw new Error('nó não achado: ' + CONFIG);
  for (const g of GATILHOS) {
    if (!nodes.some((n) => n.name === g)) throw new Error('gatilho não achado: ' + g);
  }

  const feedsAtuais = nodes.filter((n) => String(n.type).includes('rssFeedRead'));
  if (merge.parameters.numberInputs !== feedsAtuais.length) {
    throw new Error(`o merge diz ${merge.parameters.numberInputs} entradas e existem ${feedsAtuais.length} feeds — revisar antes`);
  }
  for (const novo of NOVOS) {
    if (nodes.some((n) => n.name === novo.name)) throw new Error(`${novo.name} já existe — patch já aplicado?`);
    if (feedsAtuais.some((n) => n.parameters.url === novo.url)) throw new Error(`URL já cadastrada: ${novo.url}`);
  }

  // os índices livres do merge começam onde os atuais terminam
  const usados = new Set();
  for (const saidas of Object.values(connections)) {
    for (const grupo of saidas.main || []) {
      for (const c of grupo || []) if (c.node === MERGE) usados.add(c.index);
    }
  }
  if (usados.size !== feedsAtuais.length) {
    throw new Error(`${usados.size} índices ligados no merge para ${feedsAtuais.length} feeds — topologia inesperada`);
  }

  const baseY = Math.max(...feedsAtuais.map((n) => n.position[1]));
  let indice = feedsAtuais.length;
  for (const [i, novo] of NOVOS.entries()) {
    nodes.push({
      parameters: { url: novo.url, options: {} },
      type: modelo.type,
      typeVersion: modelo.typeVersion,
      position: [modelo.position[0], baseY + 128 * (i + 1)],
      id: novoId(),
      name: novo.name,
      retryOnFail: modelo.retryOnFail,
      maxTries: modelo.maxTries,
      waitBetweenTries: modelo.waitBetweenTries,
      onError: modelo.onError,
    });
    connections[novo.name] = { main: [[{ node: MERGE, type: 'main', index: indice }]] };
    for (const g of GATILHOS) {
      connections[g] = connections[g] || { main: [[]] };
      connections[g].main[0] = connections[g].main[0] || [];
      connections[g].main[0].push({ node: novo.name, type: 'main', index: 0 });
    }
    indice++;
  }
  merge.parameters.numberInputs = indice;

  // domínios no que o curador lê
  const antes = config.parameters.jsCode;
  const m = antes.match(/dominios_editoriais: \[([^\]]*)\]/);
  if (!m) throw new Error('não achei dominios_editoriais na Configuração PromoLiso AI');
  const lista = m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const novo of NOVOS) if (!lista.includes(novo.dominio)) lista.push(novo.dominio);
  config.parameters.jsCode = antes.replace(m[0], 'dominios_editoriais: [' + lista.map((d) => `"${d}"`).join(',') + ']');
  new Function(config.parameters.jsCode);

  // ---- conferências finais: é aqui que a cirurgia de nó para se algo saiu do lugar ----
  const feedsDepois = nodes.filter((n) => String(n.type).includes('rssFeedRead'));
  if (feedsDepois.length !== feedsAtuais.length + NOVOS.length) throw new Error('contagem de feeds não fechou');
  if (new Set(nodes.map((n) => n.name)).size !== nodes.length) throw new Error('nome de nó duplicado');
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new Error('id de nó duplicado');
  const idx = [];
  for (const saidas of Object.values(connections)) {
    for (const grupo of saidas.main || []) for (const c of grupo || []) if (c.node === MERGE) idx.push(c.index);
  }
  if (new Set(idx).size !== idx.length) throw new Error('dois feeds no mesmo índice do merge');
  if (Math.max(...idx) !== merge.parameters.numberInputs - 1) throw new Error('índice fora do tamanho do merge');
  for (const novo of NOVOS) {
    for (const g of GATILHOS) {
      if (!connections[g].main[0].some((c) => c.node === novo.name)) throw new Error(`${novo.name} não recebe do ${g}`);
    }
  }
  return { nodes, connections };
}

module.exports = { WF, MERGE, CONFIG, MODELO, GATILHOS, NOVOS, aplicar };

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
  const connections = JSON.parse(row.connections);
  const antesNos = nodes.length;
  aplicar(nodes, connections);
  console.log(`OK  ${NOVOS.length} feeds adicionados (${antesNos} -> ${nodes.length} nós)`);
  for (const n of NOVOS) console.log('    + ' + n.name + '  ' + n.url);

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const conStr = JSON.stringify(connections);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, conStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, conStr, row.name, 1,
       'feeds novos: IGN Brasil, GameBlast, Tecnoblog e GG.deals (testados: 100% dos itens com imagem)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-feeds-novos.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
