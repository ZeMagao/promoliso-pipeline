// A publicação passa a escolher a notícia de HOJE em vez da que está morrendo.
//
// Ver design/selecionar_ready_frescor.src.js para a regra e o porquê. Resumo medido em 14/08/2026:
// as quatro últimas publicações saíram com 46,5 h de atraso cada — não por acaso, mas porque a
// regra anterior mandava publicar a peça mais perto do teto de 48 h. No dia 14 o post das 16:30
// era do dia 12, com cinco peças daquele mesmo dia esperando na fila.
//
// UM NÓ SÓ: "Selecionar READY" do publicador. Nada mais muda — nem o retry, nem a devolução para a
// fila (RETRY), nem a janela de 48 h como teto.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const NO = 'Selecionar READY';
// sha do código que está no ar hoje (já com a devolução RETRY, versionId 3ff3ec69)
const SHA_ANTIGO = 'a3c1f038f3f3d5b44a8aff4e0ce74279cefd6c5c5367dff30e29ca37cc7b7692';

const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .split('\r\n').join('\n')
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n|\n)*/, '')
  .trim();

const NOVO = semCabecalho('selecionar_ready_frescor.src.js');

function trocar(code) {
  const lf = String(code).split('\r\n').join('\n');
  if (lf.includes('JANELA_DO_DIA_H')) throw new Error(`${NO}: já publica o fresco — patch já aplicado?`);
  const sha = crypto.createHash('sha256').update(lf).digest('hex');
  if (sha !== SHA_ANTIGO) {
    throw new Error(`${NO}: código em produção não é o esperado (sha ${sha}) — alguém mexeu; revisar antes`);
  }
  // o que veio antes não pode se perder na troca
  for (const marca of ['RETRY', 'FRESCOR_MAX_H = 48', 'status_anterior', 'created_at', 'carousel_urls insuficiente']) {
    if (!NOVO.includes(marca)) throw new Error(`${NO}: o bloco novo perdeu "${marca}" — abortando`);
  }
  new Function(NOVO);
  return NOVO;
}

module.exports = { WF, NO, NOVO, SHA_ANTIGO, trocar };

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
  const n = nodes.find((x) => x.name === NO);
  if (!n) throw new Error('nó não achado: ' + NO);
  n.parameters.jsCode = trocar(n.parameters.jsCode);
  console.log(`OK  ${NO}  (publica a notícia do dia; a mais velha deixa de ter prioridade)`);

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
       'publicador escolhe a noticia do dia (antes publicava sempre a mais perto de vencer: 46,5 h de atraso)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-publicar-fresco.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
