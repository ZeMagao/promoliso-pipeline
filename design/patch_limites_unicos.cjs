// BUG #5 da lista de 2026-08-06: os limites de texto dos slides existem em TRÊS lugares.
//
// Foi essa duplicação que deixou o projeto semanas quase sem publicar: em 05/08 um rollback amplo
// reverteu UMA das cópias, e o validador passou a truncar em 42/38 e reprovar acima de 34/30 —
// então quase toda pauta estourava e ninguém sabia por quê.
//
//   1) limitar(slide.titulo, 42)          <- trunca            (validador)
//   2) slide.titulo.length > 42           <- reprova           (validador)
//   3) "titulo: ... até 42 caracteres"    <- instrui o agente  (prompt do "AI Agent")
//
// MUDANÇA: 1 e 2 passam a ler de um único `LIMITES` no topo do validador. Não muda comportamento —
// os números são exatamente os mesmos (selo 22, titulo 42, destaque 38, texto 300, legenda 1800).
//
// A cópia 3 é texto estático de OUTRO nó, então não há como derivá-la em runtime. Para ela existe
// `design/verifica_limites.cjs`, que compara o LIMITES do validador com os números escritos no
// prompt e falha se divergirem — vira checagem de deploy em vez de bomba silenciosa.
//
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

// trocas por string EXATA — são todas curtas e únicas
const TROCAS = [
  ['declara LIMITES', 'function limitar(value, maximo) {',
`// Limites de texto dos slides em UM lugar. Estavam em três: aqui no limitar(), na checagem de
// estrutura, e no prompt do agente. Em 2026-08-05 um rollback reverteu só uma cópia — o validador
// truncava em 42/38 e reprovava acima de 34/30, e quase nenhuma pauta passou por semanas.
// A cópia do prompt é texto estático de outro nó; \`design/verifica_limites.cjs\` compara os dois.
const LIMITES = { selo: 22, titulo: 42, destaque: 38, texto: 300, legenda: 1800 };

function limitar(value, maximo) {`],

  ['limitar usa LIMITES',
`    selo: limitar(slide.selo, 22),
    titulo: limitar(slide.titulo, 42),
    destaque: limitar(slide.destaque, 38),
    texto: limitar(slide.texto, 300),`,
`    selo: limitar(slide.selo, LIMITES.selo),
    titulo: limitar(slide.titulo, LIMITES.titulo),
    destaque: limitar(slide.destaque, LIMITES.destaque),
    texto: limitar(slide.texto, LIMITES.texto),`],

  ['check do titulo',
`    } else if (slide.titulo.length > 42) {
      problemasSlides.push(onde + ': titulo com ' + slide.titulo.length + ' chars (max 42)');`,
`    } else if (slide.titulo.length > LIMITES.titulo) {
      problemasSlides.push(onde + ': titulo com ' + slide.titulo.length + ' chars (max ' + LIMITES.titulo + ')');`],

  ['check do destaque',
`    } else if (slide.destaque.length > 38) {
      problemasSlides.push(onde + ': destaque com ' + slide.destaque.length + ' chars (max 38)');`,
`    } else if (slide.destaque.length > LIMITES.destaque) {
      problemasSlides.push(onde + ': destaque com ' + slide.destaque.length + ' chars (max ' + LIMITES.destaque + ')');`],

  ['check do texto',
`    } else if (slide.texto.length > 300) {
      problemasSlides.push(onde + ': texto com ' + slide.texto.length + ' chars (max 300)');`,
`    } else if (slide.texto.length > LIMITES.texto) {
      problemasSlides.push(onde + ': texto com ' + slide.texto.length + ' chars (max ' + LIMITES.texto + ')');`],

  ['check da legenda', 'output.legenda.length > 1800', 'output.legenda.length > LIMITES.legenda'],
];

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
  let code = n.parameters.jsCode;
  const antes = code;

  for (const [nome, de, para] of TROCAS) {
    const vezes = code.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${nome}: esperava 1 trecho e achei ${vezes} — abortando (já aplicado?)`);
    code = code.split(de).join(para);
    console.log('OK  ' + nome);
  }

  // refactor puro: nenhum número solto pode ter sobrado nos pontos que unificamos
  for (const sobra of ['limitar(slide.titulo, 42)', 'limitar(slide.destaque, 38)', 'limitar(slide.texto, 300)',
    'limitar(slide.selo, 22)', 'length > 42', 'length > 38', 'length > 300', 'length > 1800']) {
    if (code.includes(sobra)) throw new Error('sobrou número solto: ' + sobra);
  }
  if ((code.match(/const LIMITES =/g) || []).length !== 1) throw new Error('LIMITES declarado mais de uma vez');
  // e os valores têm que ser EXATAMENTE os que estavam no ar
  const decl = code.match(/const LIMITES = \{([^}]*)\}/);
  const valores = Function('return {' + decl[1] + '}')();
  const esperado = { selo: 22, titulo: 42, destaque: 38, texto: 300, legenda: 1800 };
  for (const k of Object.keys(esperado)) {
    if (valores[k] !== esperado[k]) throw new Error(`LIMITES.${k} = ${valores[k]}, esperava ${esperado[k]} — este patch NÃO deve mudar comportamento`);
  }
  console.log('OK  valores idênticos aos que estavam no ar: ' + JSON.stringify(valores));
  new Function(code);

  n.parameters.jsCode = code;
  console.log('diff de chars:', code.length - antes.length, '| mudou:', code !== antes);
  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
  if (code === antes) { console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'limites de texto dos slides passam a vir de um unico LIMITES (truncagem e checagem liam numeros duplicados)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-limites.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
