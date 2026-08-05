// Renders a node's jsCode against a supplied $input.first().json, POSTs to :5680, saves JPEG.
const fs = require('fs');
const path = require('path');
const http = require('http');
const OUT = __dirname;

function runNode(codeFile, inputJson) {
  let code = fs.readFileSync(path.join(OUT, codeFile), 'utf8');
  // strip the header comment lines we added
  code = code.replace(/^\/\/[^\n]*\n(\/\/[^\n]*\n)*\n?/, '');
  const $input = { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] };
  const $ = (name) => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  const fn = new Function('$input', '$', '$json', 'require', code + '\n;return (typeof html!=="undefined")?html:(typeof $return!=="undefined"?$return:null);');
  // Many nodes `return [{json:{html}}]`. Capture via wrapping: easier to eval and grab return value.
  const fn2 = new Function('$input', '$', '$json', 'require', code);
  const ret = fn2($input, $, inputJson, require);
  if (Array.isArray(ret) && ret[0] && ret[0].json && ret[0].json.html) return ret[0].json.html;
  throw new Error('node did not return html for ' + codeFile);
}

function render(html, width, height, outFile) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ html, width, height, quality: 90 });
    const req = http.request({ host: '127.0.0.1', port: 5680, path: '/render', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' ' + buf.toString().slice(0,300))); return; }
        fs.writeFileSync(path.join(OUT, outFile), buf);
        console.log('WROTE', outFile, buf.length, 'bytes', 'render-ms=' + res.headers['x-render-time-ms']);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

module.exports = { runNode, render };

// If run directly: render current templates for exec output json arg
if (require.main === module) {
  (async () => {
    const output = JSON.parse(fs.readFileSync(path.join(OUT, process.argv[2] || 'exec87_output.json'), 'utf8'));
    const prefix = process.argv[3] || 'before';

    // CAPA
    const capaHtml = runNode('node__Code_in_JavaScript1.txt', { output });
    await render(capaHtml, 1080, 1350, `${prefix}_1_capa.jpg`);

    // CONTENT SLIDE (slide[1] contexto) — synthesize the intermediate fields
    const s = { ...output.slides[1], selo: output.categoria || 'NOTÍCIA', pagina: 2, total: 6, capaFallback: output.capa };
    const slideHtml = runNode('node__Code_in_JavaScript.txt', { slides: s });
    await render(slideHtml, 1080, 1350, `${prefix}_2_slide.jpg`);

    // CTA SLIDE
    const cta = { tipo: 'cta', selo: 'PROMOLISO', pagina: 6, total: 6 };
    const ctaHtml = runNode('node__Code_in_JavaScript.txt', { slides: cta });
    await render(ctaHtml, 1080, 1350, `${prefix}_6_cta.jpg`);

    console.log('done');
  })().catch(e => { console.error('ERR', e); process.exit(1); });
}
