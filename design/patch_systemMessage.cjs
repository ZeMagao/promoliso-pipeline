// Grava design/new_systemMessage.txt no options.systemMessage do nó "AI Agent"
// do workflow NL8eVLKErgnIXBQq. Espelha o padrão de versionamento do writer_claude_editorial.cjs
// (versionId=activeVersionId=novo UUID, bump versionCounter, insere workflow_history).
// --dry: só mostra o plano, não grava.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE = 'AI Agent';
const SRC = path.join(__dirname, 'new_systemMessage.txt');
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now(){const d=new Date();const p=(n,l=2)=>String(n).padStart(l,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}

(async () => {
  const sm = fs.readFileSync(SRC, 'utf8');
  if (!sm.startsWith('=')) throw new Error('new_systemMessage.txt precisa começar com "=" (expressão n8n).');
  const row = await get("SELECT nodes, connections, versionCounter FROM workflow_entity WHERE id=?", [WF]);
  const nodes = JSON.parse(row.nodes);
  const n = nodes.find(x => x.name === NODE);
  if (!n) throw new Error('nó não encontrado: ' + NODE);
  n.parameters = n.parameters || {};
  n.parameters.options = n.parameters.options || {};
  const oldLen = (n.parameters.options.systemMessage || '').length;
  n.parameters.options.systemMessage = sm;

  console.log(`nó "${NODE}" systemMessage: ${oldLen} -> ${sm.length} chars`);
  console.log('caps novos:', /titulo:.*42/.test(sm) ? 'OK titulo 42' : 'FALTA', /180 a 300/.test(sm) ? '| OK texto 300' : '| FALTA texto');
  console.log('exemplo rico:', /Exemplo de qualidade/.test(sm) ? 'OK' : 'FALTA');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID(); const t = now();
  await run("BEGIN");
  try {
    await run("UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?",
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run("INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, 'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4', 1, 'copy editorial enriquecido (caps + craft + exemplo rico)', '[]']);
    await run("COMMIT");
  } catch (e) { await run("ROLLBACK"); throw e; }
  fs.writeFileSync(path.join(__dirname, '..', 'newversion-systemmessage.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch(e => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
