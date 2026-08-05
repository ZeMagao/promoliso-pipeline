// Conserta a autocontradição do nó "Validar antes de publicar":
// ele TRUNCA titulo/destaque em 42/38 (limitar()) e logo depois REPROVA acima de 34/30,
// então título de 35-42 chars ou destaque de 31-38 chars dava sempre
// "Estrutura dos cinco slides inválida". Causa do "quase nunca publica".
// Fix: alinha a checagem com o limitar() e com o prompt -> 42/38.
// (O fix já existiu no patch do carrossel variável e o rollback de 05/08 reverteu junto.)
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE = 'Validar antes de publicar';
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

  // trava de segurança: só deploya se o draft for exatamente o que está publicado
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const n = nodes.find((x) => x.name === NODE);
  if (!n) throw new Error('nó não achado: ' + NODE);
  let code = n.parameters.jsCode;
  const before = code;

  const edits = [
    { re: /slide\.titulo\.length\s*<=\s*34/g,   to: 'slide.titulo.length <= 42',   esperado: 1 },
    { re: /slide\.destaque\.length\s*<=\s*30/g, to: 'slide.destaque.length <= 38', esperado: 1 },
  ];
  for (const e of edits) {
    const achou = (code.match(e.re) || []).length;
    if (achou !== e.esperado) {
      throw new Error(`esperava ${e.esperado} ocorrência(s) de ${e.re} e achei ${achou} — abortando`);
    }
    code = code.replace(e.re, e.to);
    console.log(`OK  ${e.to}`);
  }

  // sanidade: o limitar() tem que continuar em 42/38 (é com ele que estamos alinhando)
  for (const p of ['limitar(slide.titulo, 42)', 'limitar(slide.destaque, 38)']) {
    if (!code.includes(p)) throw new Error('esperava encontrar ' + p + ' — o nó não está no estado previsto');
    console.log('OK  (mantido) ' + p);
  }
  // e nenhum cap velho pode sobrar
  for (const p of ['titulo.length <= 34', 'destaque.length <= 30']) {
    if (code.includes(p)) throw new Error('sobrou cap velho: ' + p);
  }

  n.parameters.jsCode = code;
  const changed = code !== before;
  console.log('diff de chars:', code.length - before.length, '| mudou:', changed);
  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
  if (!changed) { console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run(
      'UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]
    );
    await run(
      'INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'validador: caps de checagem 34/30 -> 42/38 (alinha com limitar() e com o prompt)', '[]']
    );
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-caps.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
