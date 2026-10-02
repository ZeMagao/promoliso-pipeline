// A FOTO DO WORDPRESS DEIXA DE VIR COMO MINIATURA (02/10/2026).
//
// O QUE FOI MEDIDO. As 6 reprovações por "miniatura de baixa resolução" da semana (Persona/Atlus ×2,
// Castlevania ×2, Festival de Primavera ×2) são o mesmo padrão: foto do WordPress do Adrenaline
// com o sufixo de tamanho que o próprio WordPress gera — `persona-3-reload-768x480.webp`. O
// WordPress guarda o original sem o sufixo. Medido em 50 URLs reais com sufixo, dos 5 hosts de
// WordPress do acervo (Adrenaline, Tecnoblog, GameVício, GamingBolt, AreaJugones): o original
// existe em 50/50 e é maior em 49. Maior original da amostra: 6,1 MB (o renderizador aceita 12).
//
// O `semRedimensionar` (12/08) já tirava o redimensionamento da QUERY (`?w=640`); o do NOME do
// arquivo ficava. Aqui ele passa a tirar também o `-LxA` do WordPress — só quando a miniatura é
// menor que o piso da capa (1000×675, o mesmo do gate do Cloudinary). `-1200x675` fica como está.
//
// BANCADA (design/test_validador_procedencia.cjs, as 58 validações reais): com o original no
// acervo, mudam exatamente as 6 reprovações por miniatura, todas para aprovado. Nada mais muda.
//
// ONDE MEXE: só o `Normalizar notícias PromoLiso AI`, onde o acervo de imagens da pauta é montado.
// Como a limpeza é antes da deduplicação, a miniatura e o original da mesma foto colapsam em uma.
// ROLLBACK: `--reverter`. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Normalizar notícias PromoLiso AI';

const EDICOES = [
  {
    nome: 'função que tira o sufixo de tamanho do WordPress',
    de: `function semRedimensionar(url) {
  const u = String(url || '');`,
    para: `// MINIATURA DO WORDPRESS (02/10/2026): \`foto-768x480.jpg\` e a copia reduzida que o WordPress gera
// de \`foto.jpg\`. Medido em 50 URLs reais de 5 hosts: o original existe em 50/50. So sai o sufixo
// abaixo do piso da capa (1000x675); acima disso a foto ja serve e fica como esta.
const RE_SUFIXO_WORDPRESS = /(\\/wp-content\\/uploads\\/[^?#]*?)-(\\d{2,4})x(\\d{2,4})(\\.(?:jpe?g|png|webp))(?=$|[?#])/i;
function semSufixoDoWordPress(url) {
  const u = String(url || '');
  const m = RE_SUFIXO_WORDPRESS.exec(u);
  if (!m) return u;
  if (Number(m[2]) >= 1000 && Number(m[3]) >= 675) return u;
  return u.replace(RE_SUFIXO_WORDPRESS, '$1$4');
}

function semRedimensionar(url) {
  const u = semSufixoDoWordPress(String(url || ''));`,
  },
];
const MARCA = 'function semSufixoDoWordPress(';
const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, reverter) {
  return EDICOES.reduce((acc, e) => {
    const de = lf(reverter ? e.para : e.de);
    const para = lf(reverter ? e.de : e.para);
    const vezes = acc.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${e.nome}" apareceu ${vezes} vezes (esperava 1) — patch já aplicado, ou o nó mudou`);
    return acc.split(de).join(para);
  }, lf(texto));
}
const normalizar = (texto) => (lf(texto).includes(MARCA) ? lf(texto) : aplicar(texto, false));

// Recorta a função do código patchado e a devolve executável: o harness testa o que vai rodar.
function funcaoDoCodigo(codigo) {
  const ini = codigo.indexOf('const RE_SUFIXO_WORDPRESS');
  const fim = codigo.indexOf('function semRedimensionar(url) {');
  if (ini < 0 || fim < 0) throw new Error('função não encontrada no código');
  // eslint-disable-next-line no-new-func
  return new Function(codigo.slice(ini, fim) + '\nreturn semSufixoDoWordPress;')();
}

module.exports = { WF, NO, EDICOES, MARCA, lf, aplicar, normalizar, funcaoDoCodigo };

if (require.main === module) {
  const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
  if (!fs.existsSync(DB)) {
    console.error('FAIL  rode no VPS: cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
    process.exit(1);
  }
  const sqlite3 = require('sqlite3');
  const DRY = process.argv.includes('--dry');
  const REVERTER = process.argv.includes('--reverter');
  const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
  const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
  function agora() {
    const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
      + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }
  (async () => {
    const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
    if (!row) throw new Error('workflow não achado: ' + WF);
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');
    const nodes = JSON.parse(row.nodes);
    const no = nodes.find((n) => n.name === NO);
    if (!no || typeof no.parameters.jsCode !== 'string') throw new Error('nó não achado ou sem jsCode: ' + NO);
    const depois = aplicar(no.parameters.jsCode, REVERTER);
    try { new Function('$', '$input', '$json', depois); } catch (e) { throw new Error(NO + ': jsCode resultante não compila: ' + e.message); }
    for (const e of EDICOES) console.log(`OK  ${NO}: ${e.nome}`);
    if (!REVERTER) {
      const f = funcaoDoCodigo(depois);
      const exemplo = 'https://www.adrenaline.com.br/wp-content/uploads/2025/08/persona-3-reload-768x480.webp';
      console.log('OK  exemplo: ' + exemplo.split('/').pop() + ' -> ' + f(exemplo).split('/').pop());
    }
    console.log('OK  conexões intocadas');
    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
    no.parameters.jsCode = depois;
    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER ? 'Reverte: foto do WordPress volta a entrar com sufixo de miniatura'
      : 'Foto do WordPress entra como original, sem o sufixo -LxA de miniatura';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    fs.writeFileSync(path.join(__dirname, '..', 'newversion-wordpress-original.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
