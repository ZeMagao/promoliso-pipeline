// A foto da capa deixa de vir encolhida pelo próprio CDN do site.
//
// Ver design/upgrade_imagem.src.js (o porquê e a medição) e design/upgrade_imagem.json (os números).
// Resumo: 29 de 31 URLs com parâmetro ficaram maiores tirando a instrução de redimensionar, 27
// delas passam a servir de capa, nenhuma quebrou.
//
// ONDE MEXE. Um lugar só: o `normalizar-noticias-promoliso-ai` do produtor, na hora em que a URL
// da imagem é aceita (`directImageUrl`). Como a limpeza acontece ANTES do `seen`, as variantes de
// zoom da mesma foto colapsam sozinhas — hoje elas entram como imagens diferentes.
//
// O QUE NÃO MUDA: nenhuma regra de seleção, nota, ordem ou quantidade. Uma URL sem parâmetro sai
// exatamente como entrou, e é isso que o harness prova contra a base real de produção.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Normalizar notícias PromoLiso AI';

const ANCORA_FUNCAO = 'function collectOfficialImages(item, sourceDomain) {';
const DE = '    const direct = directImageUrl(value);';
const PARA = '    const direct = semRedimensionar(directImageUrl(value));';

const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .split('\r\n').join('\n')
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n|\n)*/, '')
  .trim();

const BLOCO = semCabecalho('upgrade_imagem.src.js');

function trocar(code) {
  if (code.includes('function semRedimensionar(')) throw new Error(`${NO}: semRedimensionar já existe — patch já aplicado?`);
  const vezesAncora = code.split(ANCORA_FUNCAO).length - 1;
  if (vezesAncora !== 1) throw new Error(`${NO}: esperava 1 collectOfficialImages e achei ${vezesAncora} — abortando`);
  const vezesChamada = code.split(DE).length - 1;
  if (vezesChamada !== 1) throw new Error(`${NO}: esperava 1 chamada de directImageUrl no laço e achei ${vezesChamada} — abortando`);

  let novo = code.split(DE).join(PARA);
  novo = novo.split(ANCORA_FUNCAO).join(BLOCO + '\n\n' + ANCORA_FUNCAO);

  // a limpeza tem que acontecer ANTES do dedup, senão as variantes da mesma foto continuam
  // entrando como imagens diferentes — metade do ganho está aí
  const iLimpeza = novo.indexOf(PARA);
  const iSeen = novo.indexOf('seen.has(direct)');
  if (iSeen < 0 || iLimpeza > iSeen) throw new Error(`${NO}: a limpeza caiu depois do dedup — abortando`);
  if (!novo.includes('function directImageUrl(')) throw new Error(`${NO}: directImageUrl sumiu — abortando`);
  new Function(novo);
  return novo;
}

module.exports = { WF, NO, DE, PARA, BLOCO, trocar };

if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Esta máquina não é mais fonte de verdade (n8n do Windows aposentado em 05/08).'
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
  console.log(`OK  ${NO}  (imagem deixa de vir encolhida pelo CDN da fonte)`);

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
       'imagem: tira o parametro de redimensionamento do CDN da fonte (medido: 27 fotos passam a servir de capa)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-upgrade-imagem.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
