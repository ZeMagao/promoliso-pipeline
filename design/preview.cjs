// Standalone preview: loads node_capa.js / node_slide.js, feeds exec87 sample data,
// writes a single self-contained preview.html (no puppeteer/:5680 needed).
const fs = require('fs');
const path = require('path');
const OUT = __dirname;

function runNode(codeFile, inputJson) {
  const code = fs.readFileSync(path.join(OUT, codeFile), 'utf8');
  const $input = {
    first: () => ({ json: inputJson }),
    all: () => [{ json: inputJson }],
  };
  const $ = (name) => ({ item: { json: { url: (inputJson.output && inputJson.output.capa) || '' } }, first: () => ({ json: {} }), all: () => [] });
  const fn = new Function('$input', '$', '$json', 'require', code);
  const ret = fn($input, $, inputJson, require);
  if (Array.isArray(ret) && ret[0] && ret[0].json && ret[0].json.html) return ret[0].json.html;
  throw new Error('node did not return html for ' + codeFile);
}

const output = JSON.parse(fs.readFileSync(path.join(OUT, process.argv[2] || 'exec87_output.json'), 'utf8'));

// CAPA (node_capa.js returns buildCapa)
const capaHtml = runNode('node_capa.js', { output });

// CONTENT SLIDE — synthesize intermediate fields like the real pipeline
const s = { ...output.slides[1], selo: output.categoria || 'NOTÍCIA', pagina: 2, total: 6, capaFallback: output.capa };
const slideHtml = runNode('node_slide.js', { slides: s });

// CTA
const cta = { tipo: 'cta', selo: 'PROMOLISO', pagina: 6, total: 6 };
const ctaHtml = runNode('node_slide.js', { slides: cta });

const page = `<!doctype html><html><head><meta charset="utf-8">
<title>PromoLiso — preview</title>
<style>
  body{margin:0;background:#1a1c20;font-family:Arial,sans-serif;padding:32px;}
  .row{display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start;justify-content:center;}
  .card{display:flex;flex-direction:column;align-items:center;}
  .card > .label{color:#9BFF25;font-weight:700;letter-spacing:2px;margin-bottom:10px;font-size:14px;}
  .frame{transform-origin:top left;transform:scale(var(--s));width:1080px;height:1350px;box-shadow:0 20px 60px rgba(0,0,0,.7);}
  .slot{--s:.34;width:calc(1080px * var(--s));height:calc(1350px * var(--s));overflow:hidden;}
  @media(max-width:1200px){.slot{--s:.24;}}
</style></head><body>
<div class="row">
  <div class="card"><div class="label">CAPA</div><div class="slot"><div class="frame">${capaHtml}</div></div></div>
  <div class="card"><div class="label">SLIDE</div><div class="slot"><div class="frame">${slideHtml}</div></div></div>
  <div class="card"><div class="label">CTA</div><div class="slot"><div class="frame">${ctaHtml}</div></div></div>
</div>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'preview.html'), page);
console.log('WROTE preview.html', page.length, 'bytes');
