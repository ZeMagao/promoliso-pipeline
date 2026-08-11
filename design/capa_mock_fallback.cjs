// MOCK: como a capa da row 36 ficaria com cada tratamento de imagem sub-piso.
//
// Usa o jsCode REAL que está no ar (modelo B) e a MESMA foto de origem da row 36
// (1200x675, que reprova no piso atual de ih>=800). Só o capaImg() é trocado.
//
//   node design/capa_mock_fallback.cjs
//   node design/shot.cjs mock_pad mock_borrado mock_piso675
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const NO = path.join(OUT, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq',
  'code-in-javascript1.js');

// tira a cauda de entrada do nó pra poder injetar a variante e devolver o que eu quiser
const base = fs.readFileSync(NO, 'utf8').replace(/\nconst data = \$input[\s\S]*$/, '\n');

// Cada variante redefine capaImg. Declaração de função sobrescreve a anterior por hoisting.
const VARIANTES = {
  // 1. O QUE ESTÁ NO AR: reprova no piso e cai em c_pad — foto contida sobre a cor da marca
  pad: `
function capaImg(source){
  const cheia = 'e_trim:10/c_fill,g_auto,w_1728,h_2160';
  const contida = 'e_trim:10/c_pad,g_north,w_1728,h_2160,b_rgb:05060A';
  const t = 'if_iw_gte_1000_and_ih_gte_800/' + cheia + '/if_else/' + contida + '/if_end/' + QUAL;
  return '<img src="' + cloud(source, t) + '" style="position:absolute;inset:0;width:1080px;height:1350px;object-fit:cover;filter:contrast(1.06) saturate(1.06);" />';
}`,

  // 2. PROPOSTA: quem reprova ganha fundo borrado da propria foto atras da foto contida.
  //    Mesmo tratamento que o 'contain' do heroBoxTitan ja usa nos slides.
  borrado: `
function capaImg(source){
  const cheia = 'e_trim:10/c_fill,g_auto,w_1728,h_2160';
  const t = 'if_iw_gte_1000_and_ih_gte_800/' + cheia + '/if_end/' + QUAL;
  const fundo = cloud(source, 'e_trim:10/c_fill,g_auto,w_480,h_600/f_auto,q_auto:eco');
  const frente = cloud(source, 'e_trim:10/c_fit,w_1728,h_2160/' + QUAL);
  // o borrado cobre a tela toda; a foto nitida fica contida por cima, puxada pro alto
  return '<img src="' + fundo + '" style="position:absolute;left:-40px;top:-40px;width:1160px;height:1430px;object-fit:cover;filter:blur(42px) brightness(.42) saturate(1.35);" />'
    + '<img src="' + frente + '" style="position:absolute;inset:0;width:1080px;height:1350px;object-fit:contain;object-position:center 26%;filter:contrast(1.06) saturate(1.06);" />';
}`,

  // 3. PROPOSTA: piso de altura cai pra 675, entao 1200x675 entra em TELA CHEIA (ampliacao 2,00x)
  piso675: `
function capaImg(source){
  const cheia = 'e_trim:10/c_fill,g_auto,w_1728,h_2160';
  const contida = 'e_trim:10/c_pad,g_north,w_1728,h_2160,b_rgb:05060A';
  const t = 'if_iw_gte_1000_and_ih_gte_675/' + cheia + '/if_else/' + contida + '/if_end/' + QUAL;
  return '<img src="' + cloud(source, t) + '" style="position:absolute;inset:0;width:1080px;height:1350px;object-fit:cover;filter:contrast(1.06) saturate(1.06);" />';
}`,
};

const output = JSON.parse(fs.readFileSync(path.join(OUT, 'row36_output.json'), 'utf8'));

function render(variante) {
  const code = base + VARIANTES[variante] + '\nreturn buildCapa($input.first().json.output);';
  const $input = { first: () => ({ json: { output } }), all: () => [{ json: { output } }] };
  const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  return new Function('$input', '$', '$json', 'require', code)($input, $, { output }, require)[0].json.html;
}

for (const v of Object.keys(VARIANTES)) {
  fs.writeFileSync(path.join(OUT, `capa_mock_${v}.html`), `<!doctype html><meta charset="utf-8">${render(v)}`);
  console.log('WROTE capa_mock_' + v + '.html');
}
console.log('shot: node design/shot.cjs ' + Object.keys(VARIANTES).map((v) => 'mock_' + v).join(' '));
