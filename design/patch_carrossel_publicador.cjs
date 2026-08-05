// Carrossel variável — patch do PUBLICADOR (E27F7yVdsZRj).
// Troca "Create a carousel post".carouselChildren (6 filhos FIXOS) por uma
// EXPRESSÃO dinâmica: cover + todos os slides (conteúdo + CTA) que vierem em
// Selecionar READY (cover=urls[0], slides=urls.slice(1,6)). Cada child leva
// media_type:'IMAGE' EXPLÍCITO (a expressão não herda o default da collection).
// getNodeParameter resolve a expressão -> childrenData.child é o array. Versiona. --dry.
// ⚠️ untestável offline: exige Execute no publicador + IG real. Reverter = backup.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = process.env.CARROSSEL_DB || path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'E27F7yVdsZRj';
const NODE = 'Create a carousel post';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() { const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; }

const EXPR = "={{ { child: [{ media_type: 'IMAGE', image_url: $('Selecionar READY').item.json.cover }].concat(($('Selecionar READY').item.json.slides || []).map(u => ({ media_type: 'IMAGE', image_url: u }))) } }}";

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, name, active, activeVersionId FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('publicador não achado: ' + WF);
  const nodes = JSON.parse(row.nodes);
  const n = nodes.find(x => x.name === NODE);
  if (!n) throw new Error('nó não achado: ' + NODE);

  const antes = n.parameters.carouselChildren;
  const eraFixo = antes && Array.isArray(antes.child);
  console.log('carouselChildren atual:', eraFixo ? `fixedCollection com ${antes.child.length} filhos` : JSON.stringify(antes).slice(0, 120));
  n.parameters.carouselChildren = EXPR;
  console.log('novo carouselChildren:', EXPR);
  console.log('active:', row.active, '| activeVersionId:', row.activeVersionId);

  if (DRY) { console.log('\nDRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID(); const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, 'carrossel variavel: children dinamicos (cover + slides)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }
  fs.writeFileSync(path.join(__dirname, '..', 'newversion-carrossel-pub.txt'), V);
  console.log('\nOK gravado. versionId =', V);
  db.close();
})().catch(e => { console.error('FAIL', e.message); try { db.close(); } catch { } process.exit(1); });
