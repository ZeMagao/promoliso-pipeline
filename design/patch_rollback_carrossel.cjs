// ROLLBACK do carrossel variável — restaura PRODUTOR + PUBLICADOR ao estado comprovado
// (pré-variável), lendo os nós dos backups. NÃO restaura o DB inteiro (preserva monitor
// PRMLERR + watchdog + settings.errorWorkflow). Versiona cada workflow (novo versionId +
// activeVersionId + history). Causa raiz: expressão top-level em fixedCollection não resolve
// → children vazio → IG code 1. Publicador volta pra 6 children fixos (id 5 publicou assim). --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const LIVE = process.env.CARROSSEL_DB || path.join(ROOT, 'data', '.n8n', 'database.sqlite');
const BK_PROD = path.join(ROOT, 'backups', 'database.sqlite.pre-carrossel');
const BK_PUB = path.join(ROOT, 'backups', 'database.sqlite.pre-carrossel-pub');
const DRY = process.argv.includes('--dry');

const openRO = (p) => new sqlite3.Database(p, sqlite3.OPEN_READONLY);
const get = (db, q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
function now() { const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; }

(async () => {
  // ler estados bons dos backups
  const pdb = openRO(BK_PROD);
  const prod = await get(pdb, 'SELECT nodes, connections FROM workflow_entity WHERE id=?', ['NL8eVLKErgnIXBQq']);
  pdb.close();
  const udb = openRO(BK_PUB);
  const pub = await get(udb, 'SELECT nodes, connections FROM workflow_entity WHERE id=?', ['E27F7yVdsZRj']);
  udb.close();

  // sanidade: produtor pré-variável (validador length===5), publicador children fixos
  const prodOk = /output\.slides\.length === 5/.test(prod.nodes);
  const pubCC = JSON.parse(pub.nodes).find(n => n.name === 'Create a carousel post').parameters.carouselChildren;
  const pubOk = pubCC && Array.isArray(pubCC.child) && pubCC.child.length === 6;
  console.log('produtor backup pré-variável:', prodOk, '| publicador backup 6 children fixos:', pubOk);
  if (!prodOk || !pubOk) { console.log('>>> ABORTA: backup não bate com o esperado.'); process.exit(1); }

  if (DRY) { console.log('DRY — nada gravado. Vai restaurar PRODUTOR+PUBLICADOR dos backups.'); return; }

  const db = new sqlite3.Database(LIVE, sqlite3.OPEN_READWRITE);
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
  const get2 = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));

  async function restore(wf, nodes, connections, name, desc) {
    const cur = await get2('SELECT versionCounter FROM workflow_entity WHERE id=?', [wf]);
    const V = crypto.randomUUID(); const t = now();
    await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodes, connections, V, V, (cur.versionCounter || 0) + 1, t, wf]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, wf, 'Promo Liso', t, t, nodes, connections, name, 1, desc, '[]']);
    return V;
  }

  await run('BEGIN');
  try {
    const v1 = await restore('NL8eVLKErgnIXBQq', prod.nodes, prod.connections,
      'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4', 'rollback carrossel variavel: produtor 5 slides fixos');
    const v2 = await restore('E27F7yVdsZRj', pub.nodes, pub.connections,
      'PromoLiso - Publicador (fila)', 'rollback carrossel variavel: publicador 6 children fixos');
    await run('COMMIT');
    fs.writeFileSync(path.join(ROOT, 'newversion-rollback.txt'), 'produtor ' + v1 + '\npublicador ' + v2);
    console.log('OK. produtor versionId =', v1, '| publicador versionId =', v2);
  } catch (e) { await run('ROLLBACK'); throw e; }
  db.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
