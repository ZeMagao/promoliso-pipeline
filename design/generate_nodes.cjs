// Transforma redesignB.cjs em 2 jsCode de nó n8n (capa + slide/cta), inlinando FONT+MASCOT.
const fs = require('fs');
const path = require('path');
const OUT = __dirname;

const src = fs.readFileSync(path.join(OUT, 'redesignB.cjs'), 'utf8');
const FONT = fs.readFileSync(path.join(OUT, 'asset_font.txt'), 'utf8');
const MASCOT = fs.readFileSync(path.join(OUT, 'asset_mascot.txt'), 'utf8');

// fatia a biblioteca: de "// ---- tokens ----" até antes de "// ---------- runner ----------"
const start = src.indexOf('// ---- tokens ----');
const end = src.indexOf('// ---------- runner ----------');
if (start < 0 || end < 0) throw new Error('marcadores não encontrados');
const lib = src.slice(start, end).trim();

const head = `const FONT = ${JSON.stringify(FONT)};\nconst MASCOT = ${JSON.stringify(MASCOT)};\n\n`;

const slideNode = head + lib + `

// --- entrada/saída do nó (contrato preservado) ---
const slide = $input.first().json.slides || {};
return buildSlide(slide);
`;

const capaNode = head + lib + `

// --- entrada/saída do nó (contrato preservado) ---
const data = $input.first().json.output;
if (!data || !Array.isArray(data.slides) || data.slides.length < 2 || data.slides.length > 5) {
  throw new Error('Saída editorial incompleta');
}
return buildCapa(data);
`;

fs.writeFileSync(path.join(OUT, 'node_slide.js'), slideNode);
fs.writeFileSync(path.join(OUT, 'node_capa.js'), capaNode);
console.log('node_slide.js', slideNode.length, 'chars');
console.log('node_capa.js', capaNode.length, 'chars');
