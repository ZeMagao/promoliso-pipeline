// O FEED DA INTEL VOLTA A TRAZER NOTÍCIA (02/10/2026).
//
// O QUE FOI MEDIDO. `https://newsroom.intel.com/feed/` respondeu 403 ao n8n em 43 de 43 rodadas da
// semana (em 15/09 já era 200 com HTML e zero item). Não derrubava nada — o nó está em
// `continueRegularOutput` — mas contribuía zero e jogava um item de erro no `Unir feeds oficiais`.
//
// O SUBSTITUTO, medido no VPS: `https://game.intel.com/us/feed/` (Intel Gaming Access), RSS válido,
// 10 itens com imagem em 10, 200 para qualquer user-agent (inclusive "n8n"), tudo de jogo:
// lançamento, Gamer Days com promoção, brinde. Publica pouco (~1 por semana), mas é fonte PRIMÁRIA:
// todas as regras do produtor reconhecem a Intel por sufixo `intel.com`, então `game.intel.com`
// entra igual ao newsroom, sem tocar em mais nada.
//
// O QUE MUDA: só `parameters.url` do nó "Feed oficial Intel". Nome, conexão, retry e onError iguais.
// ROLLBACK: `--reverter`. Aceita --dry (que também busca o feed novo e conta os itens).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Feed oficial Intel';
const ANTIGA = 'https://newsroom.intel.com/feed/';
const NOVA = 'https://game.intel.com/us/feed/';

function aplicar(nodes, reverter) {
  const no = nodes.find((n) => n.name === NO);
  if (!no) throw new Error('nó não achado: ' + NO);
  if (no.type !== 'n8n-nodes-base.rssFeedRead') throw new Error(`${NO}: não é RSS (${no.type}) — abortando`);
  const de = reverter ? NOVA : ANTIGA;
  const para = reverter ? ANTIGA : NOVA;
  if (no.parameters.url !== de) throw new Error(`${NO}: url é "${no.parameters.url}", esperava "${de}" — patch já aplicado, ou alguém mexeu`);
  const semUrl = () => JSON.stringify(Object.assign({}, no, { parameters: Object.assign({}, no.parameters, { url: null }) }));
  const antes = semUrl();
  no.parameters.url = para;
  if (semUrl() !== antes) throw new Error(`${NO}: algo além da url mudou — abortando`);
  return no;
}

module.exports = { WF, NO, ANTIGA, NOVA, aplicar };

if (require.main === module) {
  const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
  if (!fs.existsSync(DB)) {
    console.error('FAIL  rode no VPS: cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
    process.exit(1);
  }
  const sqlite3 = require('sqlite3');
  const DRY = process.argv.includes('--dry');
  const REVERTER = process.argv.includes('--reverter');
  const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
  const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
  function agora() {
    const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
      + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }
  (async () => {
    const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
    if (!row) throw new Error('workflow não achado: ' + WF);
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');
    const nodes = JSON.parse(row.nodes);
    const no = aplicar(nodes, REVERTER);
    console.log(`OK  ${NO}: url -> ${no.parameters.url}`);
    if (!REVERTER) {
      const r = await fetch(NOVA, { headers: { 'user-agent': 'n8n' } });
      const t = await r.text();
      const itens = (t.match(/<item[\s>]/g) || []).length;
      if (!r.ok || itens < 1) throw new Error(`feed novo não responde como RSS: HTTP ${r.status}, ${itens} itens`);
      console.log(`OK  feed novo responde: HTTP ${r.status}, ${itens} itens`);
    }
    console.log('OK  conexões intocadas');
    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER ? 'Reverte: feed da Intel volta ao newsroom' : 'Feed da Intel: newsroom (403) -> game.intel.com';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    fs.writeFileSync(path.join(__dirname, '..', 'newversion-feed-intel.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
