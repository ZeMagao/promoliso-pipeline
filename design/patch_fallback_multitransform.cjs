// GUARDA no nó "Usar capa como fallback": a URL de origem é achada por âncora, não por contagem
// de barras.
//
// O nó troca a imagem dentro do HTML já renderizado quando a imagem do slide falha. Pra isso ele
// acha o fetch do Cloudinary com:
//
//   /(https:\/\/res\.cloudinary\.com\/fy2n2qvr\/image\/fetch\/[^/]+\/)([^"'\s)]+)/
//                                                          ^^^^^^^^ UMA componente de transformação
//
// Isso só funciona porque toda transformação de hoje cabe em uma componente
// (`c_fill,g_auto,w_1498,h_723,f_auto,q_auto:best,e_sharpen:60`). A capa full-bleed introduziu
// transformação CONDICIONAL, que tem seis:
//
//   if_iw_gte_1000_and_ih_gte_800/e_trim:10/c_fill,.../if_else/e_trim:10/c_pad,.../if_end/f_auto
//
// Contra uma dessas, o grupo 2 captura `e_trim:10/c_fill,...` achando que é a origem. E aí não
// para: `eADoSlide` é `cru === imagemOriginal || fetches.length === 1`, e como o HTML tem uma
// imagem só, o segundo termo força `true`. O nó troca em cima do lixo, marca `trocou = true` e
// NÃO levanta erro — sai uma URL com `if_` sem ramo nenhum, que o Cloudinary responde 400.
// Imagem quebrada, execução verde.
//
// HOJE ISSO ESTÁ DORMENTE: este nó só trata slide (`$('Code in JavaScript')`), e slide não usa
// condicional. O patch fecha a porta antes de alguém levar o gate pros slides e descobrir do
// jeito ruim.
//
// A CORREÇÃO: ancorar no que a origem de fato é — uma URL percent-encoded, que sempre começa em
// `https%3A%2F%2F`. `encodeURIComponent` transforma toda barra em `%2F`, então a origem nunca
// contém `/` cru: a última barra antes dela é sempre o fim da transformação, tenha ela uma
// componente ou vinte. Some o palpite sobre quantas barras existem.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Usar capa como fallback';

// String.raw pra não ter que escapar as contrabarras da regex duas vezes — foi assim que este
// tipo de patch já quase virou erro silencioso antes.
const DE = String.raw`const RE_FETCH = /(https:\/\/res\.cloudinary\.com\/fy2n2qvr\/image\/fetch\/[^/]+\/)([^"'\s)]+)/;`;

const PARA = String.raw`// A transformação pode ter QUALQUER número de componentes (a capa usa condicional: if_/if_else/
// if_end). Ancorar a origem em https%3A%2F%2F em vez de contar barras: encodeURIComponent troca
// toda barra por %2F, então a última barra do casamento é sempre o fim da transformação. Com o
// [^/]+ antigo, uma transformação de várias componentes fazia o grupo 2 capturar pedaço de
// transformação como se fosse a origem — e, com uma imagem só no HTML, o nó trocava em cima
// disso e marcava sucesso.
const RE_FETCH = /(https:\/\/res\.cloudinary\.com\/fy2n2qvr\/image\/fetch\/(?:[^"'\s)]+\/)?)(https?%3A%2F%2F[^"'\s)]+)/i;`;

function trocar(code) {
  if (code.includes('https?%3A%2F%2F')) throw new Error(`${NO}: patch já aplicado?`);
  const vezes = code.split(DE).length - 1;
  if (vezes !== 1) throw new Error(`${NO}: esperava 1 RE_FETCH e achei ${vezes} — abortando`);
  const novo = code.split(DE).join(PARA);
  if ((novo.match(/const RE_FETCH =/g) || []).length !== 1) throw new Error(`${NO}: RE_FETCH declarado != 1 vez`);
  new Function(novo); // não grava código que nem parseia
  return novo;
}

module.exports = { NO, WF, DE, PARA, trocar };

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
  const n = nodes.find((x) => x.name === NO);
  if (!n) throw new Error('nó não achado: ' + NO);
  const antes = n.parameters.jsCode;
  const depois = trocar(antes);
  n.parameters.jsCode = depois;
  console.log(`OK  ${NO}  (${depois.length - antes.length} chars)`);

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
       'fallback acha a origem por ancora, nao por contagem de barras (transformacao condicional)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-fallback-multitransform.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
