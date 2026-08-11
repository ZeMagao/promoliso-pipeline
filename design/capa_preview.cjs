// Preview da capa: renderiza o jsCode REAL do nó, antes e depois do patch.
//
// Não existe cópia do layout aqui — o "depois" sai de trocar() (design/patch_capa_fullbleed.cjs),
// exatamente o que vai pro banco. Preview e produção não têm como divergir.
//
//   node design/capa_preview.cjs [amostra.json] [sufixo]
//   node design/shot.cjs nova_sh atual_sh        (vira PNG, precisa de Edge/Chrome)
const fs = require('fs');
const path = require('path');
const { trocar } = require('./patch_capa_fullbleed.cjs');

const OUT = __dirname;
const NO = path.join(OUT, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq',
  'code-in-javascript1.js');

const antes = fs.readFileSync(NO, 'utf8');
const depois = trocar(antes, 'Code in JavaScript1');

function rodar(code, output) {
  const $input = { first: () => ({ json: { output } }), all: () => [{ json: { output } }] };
  const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  return new Function('$input', '$', '$json', 'require', code)($input, $, { output }, require)[0].json.html;
}

const arquivo = process.argv[2] || 'exec87_output.json';
const tag = process.argv[3] || '';
const bruto = JSON.parse(fs.readFileSync(path.join(OUT, arquivo), 'utf8'));
const output = bruto.output || bruto;

const html = { atual: rodar(antes, output), nova: rodar(depois, output) };
for (const [k, v] of Object.entries(html)) {
  fs.writeFileSync(path.join(OUT, `capa_${k}${tag}.html`), `<!doctype html><meta charset="utf-8">${v}`);
}

const card = (rotulo, corpo) =>
  `<div class="card"><div class="label">${rotulo}</div><div class="slot"><div class="frame">${corpo}</div></div></div>`;

fs.writeFileSync(path.join(OUT, `capa_preview${tag}.html`), `<!doctype html><html><head><meta charset="utf-8">
<title>Capa — antes e depois (${arquivo})</title>
<style>
  body{margin:0;background:#1a1c20;font-family:Arial,sans-serif;padding:32px;}
  .row{display:flex;gap:36px;flex-wrap:wrap;align-items:flex-start;justify-content:center;}
  .card{display:flex;flex-direction:column;align-items:center;}
  .label{color:#9BFF25;font-weight:700;letter-spacing:2px;margin-bottom:10px;font-size:14px;}
  .frame{transform-origin:top left;transform:scale(var(--s));width:1080px;height:1350px;box-shadow:0 20px 60px rgba(0,0,0,.7);}
  .slot{--s:.4;width:calc(1080px * var(--s));height:calc(1350px * var(--s));overflow:hidden;}
</style></head><body><div class="row">
${card('ATUAL', html.atual)}
${card('NOVA — FOTO INTEIRA', html.nova)}
</div></body></html>`);

console.log(`WROTE capa_preview${tag}.html + capa_{atual,nova}${tag}.html`);
