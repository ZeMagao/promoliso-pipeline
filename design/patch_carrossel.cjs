// Carrossel de tamanho variável — patch do workflow PRINCIPAL (NL8eVLKErgnIXBQq).
// Numa única transação/versionId edita 6 nós:
//   1. AI Agent            -> options.systemMessage = design/new_systemMessage.txt (2-5 slides)
//   2. Validar antes...    -> slides.length===5 (x2) => >=2&&<=5; tipo por indice => includes+capa[0];
//                             titulo<=34=>42; destaque<=30=>38; imagensValidas!==6 => !==slides.length+1
//   3. Edit Fields         -> total fixo 6 => slides.length+1 (CTA na ultima pagina)
//   4. Code in JavaScript1 -> guard capa !==5 => <2||>5
//   5. Fila: montar row    -> [cover,agg0..4] => [cover,...agg]
//   6. Estruturar Saída    -> exemplo do parser 5 => 3 slides (reduz vies do modelo)
// Versiona igual ao patch_frases (novo versionId em workflow_entity + INSERT workflow_history). --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = process.env.CARROSSEL_DB || path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const SYSMSG_FILE = path.join(__dirname, 'new_systemMessage.txt');
const WF = 'NL8eVLKErgnIXBQq';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() { const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; }

let FAIL = false;
const report = [];
function edit(label, code, re, rep, opts = {}) {
  const matches = (code.match(re) || []).length;
  const need = opts.count || 1;
  if (matches < need) { report.push(`FALTA [${label}] esperava ${need}, achou ${matches}`); FAIL = true; return code; }
  if (opts.exact && matches !== need) { report.push(`FALTA [${label}] esperava EXATO ${need}, achou ${matches}`); FAIL = true; return code; }
  report.push(`OK    [${label}] ${matches}x`);
  return code.replace(re, rep);
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(row.nodes);
  const byName = (n) => nodes.find(x => x.name === n);

  // ---- 1. AI Agent systemMessage ----
  const sysmsg = fs.readFileSync(SYSMSG_FILE, 'utf8');
  const ai = byName('AI Agent');
  if (!ai) { report.push('FALTA [AI Agent] nó não achado'); FAIL = true; }
  else {
    ai.parameters.options = ai.parameters.options || {};
    const antes = ai.parameters.options.systemMessage || '';
    ai.parameters.options.systemMessage = sysmsg;
    report.push(`OK    [AI Agent.systemMessage] ${antes.length} -> ${sysmsg.length} chars`);
    if (!/1 a 4 slides de conteúdo/.test(sysmsg)) { report.push('FALTA [systemMessage] não contém marca "1 a 4 slides de conteúdo" — arquivo não editado?'); FAIL = true; }
  }

  // ---- 2. Validador ----
  const val = byName('Validar antes de publicar');
  if (!val) { report.push('FALTA [Validar] nó não achado'); FAIL = true; }
  else {
    let c = val.parameters.jsCode;
    // 2 ocorrências de slides.length===5
    c = edit('val.length===5 (x2)', c, /output\.slides\.length === 5 &&/g, 'output.slides.length >= 2 && output.slides.length <= 5 &&', { count: 2, exact: true });
    // tipo por índice -> includes
    c = edit('val.tipo===tipos[index]', c, /slide\?\.tipo === tipos\[index\] &&/, 'tipos.includes(slide?.tipo) &&');
    // exigir slides[0] = capa: inserir antes do .every do slidesValidos.
    // âncora: a linha "output.slides.length >= 2 && output.slides.length <= 5 &&\n    output.slides.every(\n      (slide, index) =>\n        tipos.includes"
    c = edit('val.slides[0]=capa', c,
      /(const slidesValidos =\n  Array\.isArray\(output\.slides\) &&\n  output\.slides\.length >= 2 && output\.slides\.length <= 5 &&\n)(  output\.slides\.every\(\n    \(slide, index\) =>\n      tipos\.includes)/,
      '$1  output.slides[0]?.tipo === \'capa\' &&\n$2');
    // caps de validação titulo/destaque (bug latente: limitar corta 42/38, validador exigia 34/30)
    c = edit('val.titulo<=34', c, /slide\.titulo\.length <= 34 &&/, 'slide.titulo.length <= 42 &&');
    c = edit('val.destaque<=30', c, /slide\.destaque\.length <= 30 &&/, 'slide.destaque.length <= 38 &&');
    // contagem de imagens dinâmica
    c = edit('val.imagens!==6', c, /imagensValidas\.length !== 6/, 'imagensValidas.length !== output.slides.length + 1');
    val.parameters.jsCode = c;
  }

  // ---- 3. Edit Fields ----
  const ef = byName('Edit Fields');
  if (!ef) { report.push('FALTA [Edit Fields] nó não achado'); FAIL = true; }
  else {
    const assigns = ef.parameters.assignments.assignments;
    const a = assigns.find(x => x.name === 'slides');
    if (!a) { report.push('FALTA [Edit Fields] assignment "slides" não achado'); FAIL = true; }
    else {
      const NEW = "={{ (() => { const o=$('Validar antes de publicar').item.json.output; const T=o.slides.length+1; return [...o.slides.slice(1).map((s,i)=>({...s,pagina:i+2,total:T,capaFallback:o.capa})), {tipo:'cta',selo:'FIQUE DE OLHO',titulo:'NÃO PERCA A PRÓXIMA.',destaque:'SIGA @PROMOLISO0.',texto:'Notícias, promoções e alertas para comprar melhor e pagar menos.',imagem:'',fonte_imagem:'PROMOLISO',pagina:T,total:T,capaFallback:o.capa}]; })() }}";
      if (!/total: 6/.test(a.value)) { report.push('AVISO [Edit Fields] valor atual não tem "total: 6" — confira se já foi patchado'); }
      a.value = NEW;
      report.push('OK    [Edit Fields.slides] valor trocado por expressão dinâmica (T=slides.length+1)');
    }
  }

  // ---- 4. Code in JavaScript1 (capa guard) ----
  const capa = byName('Code in JavaScript1');
  if (!capa) { report.push('FALTA [Code in JavaScript1] nó não achado'); FAIL = true; }
  else {
    capa.parameters.jsCode = edit('capa.guard', capa.parameters.jsCode,
      /data\.slides\.length !== 5/, 'data.slides.length < 2 || data.slides.length > 5');
  }

  // ---- 5. Fila: montar row ----
  const fila = byName('Fila: montar row');
  if (!fila) { report.push('FALTA [Fila: montar row] nó não achado'); FAIL = true; }
  else {
    fila.parameters.jsCode = edit('fila.carousel', fila.parameters.jsCode,
      /\[cover, agg\[0\], agg\[1\], agg\[2\], agg\[3\], agg\[4\]\]\.filter\(Boolean\)/,
      '[cover, ...agg].filter(Boolean)');
  }

  // ---- 6. Estruturar Saída (parser example 5 -> 3) ----
  const parser = byName('Estruturar Saída');
  if (!parser) { report.push('FALTA [Estruturar Saída] nó não achado'); FAIL = true; }
  else {
    try {
      const ex = JSON.parse(parser.parameters.jsonSchemaExample);
      if (Array.isArray(ex.slides) && ex.slides.length === 5) {
        ex.slides = ex.slides.slice(0, 3); // capa, contexto, evidencia
        parser.parameters.jsonSchemaExample = JSON.stringify(ex, null, 2);
        report.push('OK    [Estruturar Saída] exemplo 5 -> 3 slides');
      } else {
        report.push(`AVISO [Estruturar Saída] exemplo tem ${ex.slides ? ex.slides.length : '?'} slides — não mexi`);
      }
    } catch (e) { report.push('FALTA [Estruturar Saída] exemplo não é JSON parseável: ' + e.message); FAIL = true; }
  }

  console.log(report.join('\n'));
  if (FAIL) { console.log('\n>>> ABORTADO: alguma edição falhou. Nada gravado.'); db.close(); process.exit(1); }
  if (DRY) { console.log('\nDRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID(); const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, 'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4', 1, 'carrossel variavel: slides 2-5 (prompt+capa+editfields+validador+fila+parser)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }
  fs.writeFileSync(path.join(__dirname, '..', 'newversion-carrossel.txt'), V);
  console.log('\nOK gravado. versionId =', V);
  db.close();
})().catch(e => { console.error('FAIL', e.message); try { db.close(); } catch { } process.exit(1); });
