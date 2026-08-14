// A publicação passa a insistir antes de desistir.
//
// O QUE ACONTECEU (13/08/2026, slot das 20:30). A criação do carrossel voltou HTTP 400 e a peça
// foi marcada FAILED. Investigado logo depois, com o token novo já no ar: refiz a chamada inteira
// à mão — os 6 filhos, a legenda de 1535 chars, o carrossel pai, no mesmo endpoint e na mesma forma
// que o nó usa (corpo JSON, v23.0) — e o Meta respondeu **200 em tudo**. As 6 imagens também estão
// dentro das regras (1080x1350, exatamente 4:5, JPEG, ~270 KB cada).
//
// Ou seja: os dados estavam bons e a chamada era válida. Foi falha transitória do lado do Meta.
//
// O DEFEITO REAL não é o 400 — é o que o fluxo faz com ele. `Create a carousel post` estava com
// `retryOnFail: false`: uma resposta ruim, uma vez, e o post está perdido. Pior, a peça vai para
// FAILED e **nunca volta** — não é só o slot que se perde, é a pauta inteira. Foi assim que a row
// 38 morreu com conteúdo perfeito.
//
// O QUE MUDA: retry nos dois passos que gastam a vaga — criar o carrossel e publicar. 3 tentativas
// com 5 s entre elas. É o mesmo remédio que o render da capa recebeu em 11/08 pelo mesmo motivo
// (aborta em 12 s, matava o produtor inteiro), e o mesmo padrão dos feeds RSS.
//
// O QUE NÃO MUDA: `onError: continueErrorOutput` continua igual. O retry acontece ANTES de o erro
// chegar no ramo de falha, então o caminho de alerta e o `Marcar FALHA` seguem existindo para
// quando a falha for real, e não passageira.
//
// DE FORA, de propósito: devolver a peça para READY em vez de FAILED quando ela ainda está fresca.
// É a próxima melhoria óbvia — hoje conteúdo bom morre por um tropeço de rede — mas muda regra de
// negócio (quantas vezes tentar de novo, e a partir de quando desistir), então é decisão do dono,
// não default técnico.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';                    // publicador
const ALVOS = ['Create a carousel post', 'Publish a post'];
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

function aplicar(nodes) {
  const tocados = [];
  for (const nome of ALVOS) {
    const n = nodes.find((x) => x.name === nome);
    if (!n) throw new Error('nó não achado: ' + nome);
    if (!/instagram/i.test(String(n.type))) throw new Error(`${nome}: não é nó do Instagram (${n.type}) — abortando`);
    if (n.retryOnFail === true) throw new Error(`${nome}: já tem retry — patch já aplicado?`);
    const onErrorAntes = n.onError;
    Object.assign(n, RETRY);
    // o ramo de falha tem que continuar existindo: o retry cobre o tropeço, não a falha real
    if (n.onError !== onErrorAntes) throw new Error(`${nome}: onError mudou — abortando`);
    tocados.push(nome);
  }
  return tocados;
}

module.exports = { WF, ALVOS, RETRY, aplicar };

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
  const tocados = aplicar(nodes);
  for (const t of tocados) console.log(`OK  ${t}  (3 tentativas, 5 s entre elas)`);

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
       'publicacao ganha retry 3x5s: um 400 transitorio nao pode custar a pauta inteira', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-publish-retry.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
