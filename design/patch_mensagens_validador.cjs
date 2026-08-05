// Melhora as MENSAGENS de reprovação do nó "Validar antes de publicar".
// NÃO muda o que passa ou reprova — só troca mensagens genéricas por mensagens que
// dizem qual slide / qual campo / qual número. Motivo: 'Estrutura dos cinco slides
// inválida' cobria 5 falhas diferentes e foi o que escondeu por semanas o bug dos
// caps (ver design/patch_caps_validador.cjs). Essas mensagens vão parar no e-mail
// do Monitor de erros e do watchdog, então mensagem boa = alerta útil.
//
// MUDANÇA A: erro de estrutura passa a listar slide + campo + tamanho.
// MUDANÇA B: separa "capa ausente" de "contagem de imagens != 6" — hoje os dois
//            disparam a mensagem de HTTPS, que mente sobre a causa.
//
// NÃO INCLUÍDO de propósito (muda comportamento, decidir à parte): aceitar os tipos
// de slide fora de ordem. Hoje L573 exige a sequência exata capa/contexto/evidencia/
// impacto/acao; se o agente inverter dois, reprova.
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

// ---------- MUDANÇA A ----------
const A_RE = /const slidesValidos =[\s\S]*?erros\.push\('Estrutura dos cinco slides inválida'\);\s*\}/;
const A_NOVO = `const problemasSlides = [];
if (!Array.isArray(output.slides)) {
  problemasSlides.push('slides não veio como lista');
} else if (output.slides.length !== 5) {
  problemasSlides.push('esperava 5 slides e vieram ' + output.slides.length);
} else {
  output.slides.forEach((slide, index) => {
    const onde = 'slide ' + (index + 1) + ' (' + tipos[index] + ')';
    if (slide?.tipo !== tipos[index]) {
      problemasSlides.push(onde + ': tipo veio "' + (slide?.tipo ?? 'ausente') + '"');
    }
    if (typeof slide?.titulo !== 'string' || slide.titulo.length === 0) {
      problemasSlides.push(onde + ': titulo vazio');
    } else if (slide.titulo.length > 42) {
      problemasSlides.push(onde + ': titulo com ' + slide.titulo.length + ' chars (max 42)');
    }
    if (typeof slide?.destaque !== 'string' || slide.destaque.length === 0) {
      problemasSlides.push(onde + ': destaque vazio');
    } else if (slide.destaque.length > 38) {
      problemasSlides.push(onde + ': destaque com ' + slide.destaque.length + ' chars (max 38)');
    }
    if (typeof slide?.texto !== 'string') {
      problemasSlides.push(onde + ': texto ausente');
    } else if (slide.texto.length > 300) {
      problemasSlides.push(onde + ': texto com ' + slide.texto.length + ' chars (max 300)');
    }
  });
}
const slidesValidos = problemasSlides.length === 0;
if (!slidesValidos) {
  erros.push('Estrutura dos cinco slides inválida -> ' + problemasSlides.join('; '));
}`;

// ---------- MUDANÇA B ----------
const B_RE = /if \(!imagemCapa \|\| imagensValidas\.length !== 6\) \{\s*erros\.push\('Uma ou mais imagens não usam URL HTTPS direta e segura'\);\s*\}/;
const B_NOVO = `if (!imagemCapa) {
  erros.push('Imagem de capa ausente ou sem URL HTTPS direta e segura');
}
if (imagensValidas.length !== 6) {
  erros.push(
    'Esperava 6 imagens válidas (capa + 5 slides) e passaram ' + imagensValidas.length,
  );
}`;

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
  const before = code;

  // pré-condição: os caps já têm que estar em 42/38 (patch_caps_validador.cjs)
  for (const p of ['slide.titulo.length <= 42', 'slide.destaque.length <= 38']) {
    if (!code.includes(p)) throw new Error('pré-requisito faltando: ' + p + ' — rode patch_caps_validador.cjs antes');
  }

  for (const [nome, re, novo] of [['A (estrutura detalhada)', A_RE, A_NOVO], ['B (imagens: capa x contagem)', B_RE, B_NOVO]]) {
    const achou = (code.match(new RegExp(re.source, re.flags + 'g')) || []).length;
    if (achou !== 1) throw new Error(`mudança ${nome}: esperava 1 trecho e achei ${achou} — abortando (já aplicado?)`);
    code = code.replace(re, novo);
    console.log('OK  mudança ' + nome);
  }

  // o comportamento não pode mudar: as condições de reprovação seguem as mesmas
  for (const p of ['slidesValidos', 'imagensValidas.length !== 6', "erros.push('Nenhuma imagem válida')"]) {
    if (!code.includes(p)) throw new Error('sumiu algo que deveria continuar: ' + p);
  }
  new Function(code); // não grava código que nem compila

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
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'validador: mensagens de reprovacao detalhadas (slide/campo/tamanho) + separa capa de contagem de imagens', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-mensagens.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
