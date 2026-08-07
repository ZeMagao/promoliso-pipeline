// BUG #6 da lista de 2026-08-06: publicador e produtor têm slot no MESMO minuto às 20:00.
//
// Medido ao vivo em 06/08:
//   exec 201  Publicador  20:01:38   <- leu a fila ANTES da pauta nova existir
//   exec 202  Produtor     20:00:00 -> terminou 20:04:15
// O publicador sempre lê a fila ~3 min antes de a pauta das 20:00 ser gravada. Resultado: o slot
// das 20:00 nunca publica a pauta produzida às 20:00 — só estoque anterior. Com fila vazia (como
// era até 05/08) isso significava slot perdido.
//
// MUDANÇA: cron do slot noturno do publicador de `0 0 20 * * *` para `0 30 20 * * *`.
// 20:30 está livre: produtor roda 20:00 e 22:00, watchdog 21:30.
//
// NÃO muda a QUANTIDADE de slots — segue 12:30 + 20:30 todo dia, e 16:30 em ter/qua/sex. A decisão
// de ter 3 slots todo dia é do usuário e está pendente à parte.
//
// Este patch mexe em `parameters` (não em jsCode), então opera no objeto parseado em vez de regex.
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'E27F7yVdsZRj';
const NODE = 'Slots de publicação';
const DE = '0 0 20 * * *';
const PARA = '0 30 20 * * *';
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
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const n = nodes.find((x) => x.name === NODE);
  if (!n) throw new Error('nó não achado: ' + NODE);
  const intervalos = n.parameters?.rule?.interval;
  if (!Array.isArray(intervalos)) throw new Error('rule.interval não é lista — estrutura inesperada');

  // a estrutura do n8n é {field:'cronExpression', expression:'0 0 20 * * *'} — o cron mora em
  // `expression`, não em `cronExpression` (essa confusão também deixou o cron vazio no manifest
  // do export-workflows.cjs, corrigido junto)
  const cronDe = (i) => (i.field === 'cronExpression' ? i.expression : undefined);
  const antes = intervalos.map(cronDe);
  console.log('crons antes: ' + JSON.stringify(antes));

  const alvos = intervalos.filter((i) => cronDe(i) === DE);
  if (alvos.length !== 1) throw new Error(`esperava 1 cron "${DE}" e achei ${alvos.length} — abortando (já aplicado?)`);
  alvos[0].expression = PARA;

  const depois = intervalos.map(cronDe);
  console.log('crons depois: ' + JSON.stringify(depois));

  // invariantes: mesma quantidade de slots, e os outros dois intactos
  if (depois.length !== antes.length) throw new Error('a quantidade de slots mudou — abortando');
  for (const manter of ['0 30 12 * * *', '0 30 16 * * 2,3,5']) {
    if (!depois.includes(manter)) throw new Error('slot que deveria continuar sumiu: ' + manter);
  }
  if (depois.includes(DE)) throw new Error('o cron antigo continua presente — a troca não pegou');
  if (!depois.includes(PARA)) throw new Error('o cron novo não entrou');
  // nenhum slot do publicador pode coincidir com o produtor (0 0 8-22/2 = minuto 0 das horas pares)
  for (const c of depois) {
    const [, min, hora] = c.split(' ');
    const h = Number(hora);
    if (min === '0' && Number.isFinite(h) && h >= 8 && h <= 22 && h % 2 === 0) {
      throw new Error(`slot ${c} colide com o produtor (minuto 0 de hora par) — abortando`);
    }
  }
  console.log('OK  nenhum slot colide com o produtor');

  const nodesStr = JSON.stringify(nodes);
  const mudou = nodesStr !== row.nodes;
  console.log('mudou:', mudou);
  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
  if (!mudou) { console.log('nada a gravar.'); db.close(); return; }

  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'slot noturno do publicador 20:00 -> 20:30 (colidia com o produtor das 20:00 e nunca pegava a pauta nova)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-slot.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
