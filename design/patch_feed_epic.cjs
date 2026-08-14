// Fonte de OFERTA: o jogo grátis da Epic entra na esteira, junto com as notícias.
//
// Ver design/epic_gratis.src.js para o porquê e o formato. Resumo medido em 14/08/2026: a fila
// tinha 36 NOTICIA para 8 OFERTA numa conta chamada "Ofertas Gamer", e o motivo é o insumo — 11
// dos 12 feeds são de notícia, e não existe feed de promoção em português vivo. A oferta está na
// loja, não em blog.
//
// NÃO substitui notícia: acrescenta. O curador continua escolhendo entre tudo; notícia de games
// segue disputando em pé de igualdade. O que muda é que agora existe oferta para disputar.
//
// A CIRURGIA (2 nós novos, mesmo padrão dos 4 feeds de 12/08):
//   "Epic: jogos grátis"  httpRequest, com o mesmo retry/onError dos feeds — fonte que cai não
//                         pode derrubar a rodada nem travar o merge.
//   "Normalizar Epic"     code, converte o JSON da Epic em itens de feed.
//   Ligações: os dois gatilhos disparam o HTTP; HTTP -> Normalizar -> "Unir feeds oficiais" no
//   próximo índice livre, e o merge sobe de 12 para 13 entradas.
//
// Índice repetido no merge faz uma fonte engolir a outra em silêncio — por isso o patch calcula o
// próximo índice livre e confere no fim, em vez de confiar num número escrito à mão.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const MERGE = 'Unir feeds oficiais';
const MODELO_FEED = 'Feed Adrenaline';           // de onde herdamos retry/onError
const GATILHOS = ['Schedule Trigger', 'When clicking ‘Execute workflow’'];
const NO_HTTP = 'Epic: jogos grátis';
const NO_CODE = 'Normalizar Epic';
const URL_EPIC = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR&allowCountries=BR';

const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .split('\r\n').join('\n')
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n|\n)*/, '')
  .trim();

const CODIGO = semCabecalho('epic_gratis.src.js');

function aplicar(nodes, connections, novoId) {
  novoId = novoId || (() => crypto.randomUUID());

  const modelo = nodes.find((n) => n.name === MODELO_FEED);
  if (!modelo) throw new Error('nó modelo não achado: ' + MODELO_FEED);
  const merge = nodes.find((n) => n.name === MERGE);
  if (!merge) throw new Error('nó não achado: ' + MERGE);
  for (const g of GATILHOS) if (!nodes.some((n) => n.name === g)) throw new Error('gatilho não achado: ' + g);
  for (const nome of [NO_HTTP, NO_CODE]) {
    if (nodes.some((n) => n.name === nome)) throw new Error(`${nome} já existe — patch já aplicado?`);
  }

  // quantas entradas do merge já estão ocupadas, e por quem
  const usados = new Set();
  for (const saidas of Object.values(connections)) {
    for (const grupo of (saidas.main || [])) {
      for (const c of (grupo || [])) if (c.node === MERGE) usados.add(c.index);
    }
  }
  if (merge.parameters.numberInputs !== usados.size) {
    throw new Error(`o merge diz ${merge.parameters.numberInputs} entradas e ${usados.size} estão ligadas — revisar antes`);
  }
  const indiceLivre = merge.parameters.numberInputs;

  const yBase = Math.max(...nodes.filter((n) => String(n.type).includes('rssFeedRead')).map((n) => n.position[1]));

  nodes.push({
    parameters: { url: URL_EPIC, options: {} },
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [modelo.position[0], yBase + 128],
    id: novoId(),
    name: NO_HTTP,
    retryOnFail: modelo.retryOnFail,
    maxTries: modelo.maxTries,
    waitBetweenTries: modelo.waitBetweenTries,
    onError: modelo.onError,
  });
  nodes.push({
    parameters: { jsCode: CODIGO },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [modelo.position[0] + 210, yBase + 128],
    id: novoId(),
    name: NO_CODE,
    onError: modelo.onError,
  });

  connections[NO_HTTP] = { main: [[{ node: NO_CODE, type: 'main', index: 0 }]] };
  connections[NO_CODE] = { main: [[{ node: MERGE, type: 'main', index: indiceLivre }]] };
  for (const g of GATILHOS) {
    connections[g] = connections[g] || { main: [[]] };
    connections[g].main[0] = connections[g].main[0] || [];
    connections[g].main[0].push({ node: NO_HTTP, type: 'main', index: 0 });
  }
  merge.parameters.numberInputs = indiceLivre + 1;

  // ---- conferências: é aqui que a cirurgia para se algo saiu do lugar ----
  if (new Set(nodes.map((n) => n.name)).size !== nodes.length) throw new Error('nome de nó duplicado');
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new Error('id de nó duplicado');
  const idx = [];
  for (const saidas of Object.values(connections)) {
    for (const grupo of (saidas.main || [])) for (const c of (grupo || [])) if (c.node === MERGE) idx.push(c.index);
  }
  if (new Set(idx).size !== idx.length) throw new Error('duas fontes no mesmo índice do merge');
  if (Math.max(...idx) !== merge.parameters.numberInputs - 1) throw new Error('índice fora do tamanho do merge');
  new Function(CODIGO);
  return { nodes, connections, indice: indiceLivre };
}

module.exports = { WF, MERGE, NO_HTTP, NO_CODE, URL_EPIC, GATILHOS, MODELO_FEED, CODIGO, aplicar };

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
  const antes = nodes.length;
  const { indice } = aplicar(nodes, connections);
  console.log(`OK  ${NO_HTTP} + ${NO_CODE}  (${antes} -> ${nodes.length} nós; merge na entrada ${indice})`);

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
       'fonte de oferta: jogo gratis da Epic entra na esteira junto com as noticias', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-feed-epic.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
