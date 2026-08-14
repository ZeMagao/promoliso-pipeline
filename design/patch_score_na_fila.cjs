// A nota da curadoria passa a chegar na fila.
//
// O DEFEITO (medido em 14/08/2026): TODAS as peças publicadas têm `score` 0.0. O `Fila: montar row`
// gravava `score: 0` cravado, enquanto o curador calcula nota de verdade — 54, 66, 78, 89 — e o
// `Selecionar melhor pauta` já usa essa nota para escolher a pauta (pontuacao_total + 10 se a fonte
// for primária + 8 se houver 2 imagens distintas, com barra de 70 pontos).
//
// Ou seja: a nota existia, decidia a pauta, e era jogada fora na hora de enfileirar.
//
// POR QUE ISSO IMPORTA AGORA. O publicador passou a escolher, entre as peças do dia, a de MELHOR
// NOTA (versionId 550cc0cb). Com todo score em 0 esse desempate nunca dispara — o critério de
// qualidade estava lá, inerte. Este patch é o que faz aquele funcionar.
//
// De quebra, a nota fica gravada em cada peça publicada: dá para medir depois se post de nota alta
// rende mais que post de nota baixa. Hoje não dá, porque a coluna inteira é zero.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Fila: montar row';
const SHA_ANTIGO = 'f1db7c0191f8c1fffc0f516b016bb61de5ee447756f34852a0c3cd5e1fe98174';

// A nota vem do mesmo nó que escolheu a pauta. `.first()` porque é nó de execução única — mesma
// convenção que o resto deste arquivo já usa e explica no cabeçalho.
const DE = `const primary = String(prep.primary_url || '');`;
const PARA = `const primary = String(prep.primary_url || '');
// Nota da curadoria: mesma fonte que o "Selecionar melhor pauta" usou para escolher esta pauta.
// Antes aqui ia 0 cravado, e o desempate por qualidade do publicador nascia morto.
const pauta = ($('Selecionar melhor pauta').first().json) || {};
const nota = Number(pauta.registro && pauta.registro.pontuacao_total);`;

const DE_SCORE = `    score: 0,`;
const PARA_SCORE = `    score: Number.isFinite(nota) ? nota : 0,`;

function trocar(code) {
  const lf = String(code).split('\r\n').join('\n');
  if (lf.includes('pontuacao_total')) throw new Error(`${NO}: já lê a nota — patch já aplicado?`);
  const sha = crypto.createHash('sha256').update(lf).digest('hex');
  if (sha !== SHA_ANTIGO) throw new Error(`${NO}: código em produção não é o esperado (sha ${sha}) — alguém mexeu; revisar antes`);
  for (const [de, quem] of [[DE, 'âncora do primary_url'], [DE_SCORE, 'score: 0']]) {
    const vezes = lf.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: ${quem} apareceu ${vezes} vezes — abortando`);
  }
  const novo = lf.split(DE).join(PARA).split(DE_SCORE).join(PARA_SCORE);
  // o resto da row não pode ter sido tocado
  for (const campo of ['content_key', 'topic', 'category', 'caption', 'carousel_urls', 'story_url',
    'primary_url', 'sources', 'status', 'created_at', 'published_at', 'execution_id']) {
    if (!novo.includes(campo + ':')) throw new Error(`${NO}: perdi o campo ${campo} — abortando`);
  }
  new Function(novo);
  return novo;
}

module.exports = { WF, NO, SHA_ANTIGO, DE, PARA, DE_SCORE, PARA_SCORE, trocar };

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
  if (!nodes.some((x) => x.name === 'Selecionar melhor pauta')) throw new Error('nó "Selecionar melhor pauta" não existe — a nota viria de onde?');
  n.parameters.jsCode = trocar(n.parameters.jsCode);
  console.log(`OK  ${NO}  (a nota da curadoria passa a ser gravada na fila)`);

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
       'a nota da curadoria passa a ser gravada na fila (era score: 0 cravado)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-score-fila.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
