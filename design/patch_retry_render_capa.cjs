// Retry na renderização da CAPA.
//
// O nó "Convert HTML to JPEG image1" chama o renderizador local (127.0.0.1:5680) e não tem nem
// `onError` nem retry. O renderizador busca as imagens ele mesmo, com AbortController e
// IMAGE_FETCH_TIMEOUT_MS = 12000: se uma imagem demora mais que isso, ele responde
// `400 {"error":"This operation was aborted"}` e a execução INTEIRA do produtor morre. Foi o que
// aconteceu em 11/08 08:00 (exec 254) — e 4 vezes em 7 dias (05/08 x2, 06/08, 11/08), cada uma
// custando um slot de pauta.
//
// O irmão dele, "Convert HTML to JPEG image" (slide), tem `onError: continueRegularOutput` e um
// caminho de fallback. A capa não tem nenhum dos dois. A assimetria não é intencional — é o slide
// que foi endurecido em 06/08 e a capa que ficou pra trás.
//
// POR QUE RETRY RESOLVE: a falha é timeout de BUSCA, não erro determinístico. Quando o Cloudinary
// demora, é porque está derivando a imagem pela primeira vez; terminada a derivação ela fica em
// cache. A segunda tentativa pega o resultado pronto. Medido do VPS, derivação a frio leva 2,3–3,3 s
// e a quente é servida direto — ou seja, o retry ataca exatamente a janela que falha.
//
// NÃO usamos `onError` aqui de propósito: sem um caminho de fallback pra capa, continuar sem
// imagem publicaria um carrossel quebrado. Falhar alto depois de tentar 3x é melhor que isso.
//
// Este patch mexe em propriedades do NÓ (retryOnFail/maxTries/waitBetweenTries), não em jsCode.
// Versiona igual aos outros (draft + workflow_history + activeVersionId). Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Convert HTML to JPEG image1';

// 3 tentativas com 5 s entre elas. Pior caso ~50 s (3 x ~12 s de abort + 2 x 5 s), contra uma
// rodada de produtor que leva 2–3 min. O timeout do próprio nó HTTP é 30 s por tentativa, e o
// renderizador devolve o 400 em ~12 s, então cada tentativa cabe folgada.
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// Aplica sobre o array de nós. Devolve {antes, depois} do nó alvo. Lança se algo não bater.
function aplicar(nodes) {
  const n = nodes.find((x) => x && x.name === NO);
  if (!n) throw new Error('nó não achado: ' + NO);
  if (n.type !== 'n8n-nodes-base.httpRequest') {
    throw new Error(`${NO}: esperava httpRequest e achei ${n.type} — abortando`);
  }
  const url = String((n.parameters && n.parameters.url) || '');
  if (!url.includes('5680')) {
    throw new Error(`${NO}: url não aponta pro renderizador (${url || 'vazia'}) — abortando`);
  }
  if (n.retryOnFail) throw new Error(`${NO}: retryOnFail já ligado — patch já aplicado?`);

  const antes = { retryOnFail: n.retryOnFail, maxTries: n.maxTries, waitBetweenTries: n.waitBetweenTries };
  Object.assign(n, RETRY);
  // a capa não ganha onError: sem caminho de fallback, seguir sem imagem publicaria carrossel quebrado
  if (n.onError) throw new Error(`${NO}: apareceu um onError inesperado (${n.onError}) — revisar`);
  return { antes, depois: { retryOnFail: n.retryOnFail, maxTries: n.maxTries, waitBetweenTries: n.waitBetweenTries } };
}

module.exports = { WF, NO, RETRY, aplicar };

if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
// Sem isto o erro é um SQLITE_CANTOPEN cru, que não diz o principal: rodar patch fora do VPS
// valida contra um snapshot de 04/08 e responde com confiança sobre código que não existe mais.
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Esta máquina não é mais fonte de verdade (n8n do Windows aposentado em 05/08).'
    + '\n      Ver data/.n8n/LEIA-ANTES-DE-RODAR-PATCH.md.'
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
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const antesTudo = JSON.stringify(nodes);
  const r = aplicar(nodes);

  // nenhum outro nó pode ter mudado
  const depoisTudo = JSON.parse(JSON.stringify(nodes));
  const soAlvo = JSON.parse(antesTudo).every((n, i) => n.name === NO || JSON.stringify(n) === JSON.stringify(depoisTudo[i]));
  if (!soAlvo) throw new Error('algum nó além do alvo mudou — abortando');

  console.log(`OK  ${NO}`);
  console.log('    antes :', JSON.stringify(r.antes));
  console.log('    depois:', JSON.stringify(r.depois));

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
       'render da capa ganha retry: timeout de busca de imagem parava a execucao inteira', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-retry-render-capa.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
