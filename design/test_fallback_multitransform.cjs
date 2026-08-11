// Harness da guarda do fallback. Roda o jsCode REAL do nó "Usar capa como fallback", antes e
// depois do patch, contra HTML de slide de uma e de várias componentes de transformação.
//
//   node design/test_fallback_multitransform.cjs
const fs = require('fs');
const path = require('path');
const { trocar, DE, PARA } = require('./patch_fallback_multitransform.cjs');

const ARQ = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq',
  'usar-capa-como-fallback.js');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const FETCH = 'https://res.cloudinary.com/fy2n2qvr/image/fetch/';
const ORIGINAL = 'https://site-original.com/foto-que-falhou.jpg';
const FALLBACK = 'https://site-oficial.com/capa-boa.jpg';
const UMA = 'c_fill,g_auto,w_1498,h_723,f_auto,q_auto:best,e_sharpen:60';
const VARIAS = 'if_iw_gte_1000_and_ih_gte_800/e_trim:10/c_fill,g_auto,w_1728,h_2160/if_else/'
  + 'e_trim:10/c_pad,g_north,w_1728,h_2160,b_rgb:05060A/if_end/f_auto,q_auto:best,e_sharpen:60';

const htmlCom = (transformacao, origem) =>
  `<div><img src="${FETCH}${transformacao}/${encodeURIComponent(origem)}" />`
  + `<div>FOTO · IMAGEM OFICIAL / ADRENALINE</div></div>`;

// Executa o nó como o n8n executaria: `$('Code in JavaScript')` devolve o HTML do slide.
function rodarNo(code, { html, imagem, capaFallback }) {
  const jsonDoSlide = { html, slide: { imagem, capaFallback, titulo: 'Teste' } };
  const $ = (nome) => {
    if (nome !== 'Code in JavaScript') throw new Error('nó inesperado: ' + nome);
    return { item: { json: jsonDoSlide }, first: () => ({ json: jsonDoSlide }), all: () => [{ json: jsonDoSlide }] };
  };
  const $input = { first: () => ({ json: {} }), all: () => [{ json: {} }] };
  return new Function('$input', '$', '$json', 'require', code)($input, $, {}, require);
}

const urlDo = (html) => (html.match(/<img src="([^"]+)"/) || [])[1] || '';
const origemDe = (url) => {
  const i = url.lastIndexOf('/');
  try { return decodeURIComponent(url.slice(i + 1)); } catch (e) { return url.slice(i + 1); }
};
const transformacaoDe = (url) => url.slice(FETCH.length, url.lastIndexOf('/'));

// O export muda de estado com o deploy. Antes dele, aplicamos o patch pra obter o "depois";
// depois dele, o export JÁ é o "depois" e o "antes" é reconstruído invertendo a troca. Assim as
// asserções dos dois lados continuam valendo em qualquer momento — inclusive a que prova a
// regressão, que é a razão do patch existir.
const exportado = fs.readFileSync(ARQ, 'utf8');
const APLICADO = exportado.includes('https?%3A%2F%2F');
console.log(APLICADO
  ? '# export JÁ tem a guarda — verificando o que está no ar'
  : '# export ainda tem a regex antiga — verificando a aplicação');

let antes, depois, erroPatch = null;
if (APLICADO) {
  depois = exportado;
  const vezes = exportado.split(PARA).length - 1;
  ok('consigo reconstruir o código antigo (inverter a troca)', vezes === 1, `achei ${vezes} trechos`);
  antes = exportado.split(PARA).join(DE);
  ok('reconstrução volta pra regex antiga', antes.includes('image\\/fetch\\/[^/]+\\/') && !antes.includes('https?%3A%2F%2F'));
} else {
  antes = exportado;
  try { depois = trocar(antes); } catch (e) { erroPatch = e.message; }
  ok('patch aplica no código exportado', Boolean(depois), erroPatch);
}
if (!depois || !antes) { console.log('\n1 FALHA(S)'); process.exit(1); }

let reErro = null;
try { trocar(depois); } catch (e) { reErro = e.message; }
ok('recusa reaplicação', /já aplicado/.test(String(reErro)), reErro);

// ---- 1. o caso de hoje (uma componente) não pode mudar de comportamento ----
for (const [rotulo, code] of [['antes', antes], ['depois', depois]]) {
  const saida = rodarNo(code, { html: htmlCom(UMA, ORIGINAL), imagem: ORIGINAL, capaFallback: FALLBACK });
  const url = urlDo(saida[0].json.html);
  ok(`[uma componente/${rotulo}] troca a origem pelo fallback`, origemDe(url) === FALLBACK, origemDe(url));
  ok(`[uma componente/${rotulo}] preserva a transformação`, transformacaoDe(url) === UMA, transformacaoDe(url));
  ok(`[uma componente/${rotulo}] marca fallback_aplicado`, saida[0].json.fallback_aplicado === true);
  ok(`[uma componente/${rotulo}] atualiza o crédito`, /IMAGEM OFICIAL \/ CAPA CONFIRMADA/.test(saida[0].json.html));
}

// ---- 2. várias componentes: é aqui que o código antigo corrompe em silêncio ----
{
  const entrada = { html: htmlCom(VARIAS, ORIGINAL), imagem: ORIGINAL, capaFallback: FALLBACK };

  const velho = rodarNo(antes, entrada);
  const urlVelha = urlDo(velho[0].json.html);
  // prova da regressão: o código antigo NÃO estoura, ele devolve uma URL quebrada
  ok('[várias/antes] o código antigo se diz bem-sucedido', velho[0].json.fallback_aplicado === true);
  ok('[várias/antes] mas a transformação foi mutilada', transformacaoDe(urlVelha) !== VARIAS,
    transformacaoDe(urlVelha).slice(0, 60));
  ok('[várias/antes] sobra um if_ sem ramo', /if_iw_gte/.test(urlVelha) && !/if_end/.test(urlVelha));

  const novo = rodarNo(depois, entrada);
  const urlNova = urlDo(novo[0].json.html);
  ok('[várias/depois] troca a origem pelo fallback', origemDe(urlNova) === FALLBACK, origemDe(urlNova));
  ok('[várias/depois] preserva a transformação inteira', transformacaoDe(urlNova) === VARIAS,
    transformacaoDe(urlNova).slice(0, 80));
  ok('[várias/depois] condicional continua fechado',
    /if_iw_gte/.test(urlNova) && /if_else/.test(urlNova) && /if_end/.test(urlNova));
}

// ---- 3. bypass do mux (URL crua no HTML, sem fetch do Cloudinary) ----
{
  const mux = 'https://image.mux.com/abc/thumbnail.jpg?token=xyz';
  const html = `<div><img src="${mux}" /></div>`;
  const saida = rodarNo(depois, { html, imagem: mux, capaFallback: FALLBACK });
  const url = urlDo(saida[0].json.html);
  ok('[mux] troca a URL crua', url.includes('site-oficial.com') || url.startsWith(FETCH), url.slice(0, 70));
  ok('[mux] marca fallback_aplicado', saida[0].json.fallback_aplicado === true);
}

// ---- 4. sem imagem pra trocar tem que ESTOURAR, não passar batido ----
{
  let erro = null;
  try { rodarNo(depois, { html: '<div>sem imagem</div>', imagem: ORIGINAL, capaFallback: FALLBACK }); }
  catch (e) { erro = e.message; }
  ok('sem URL no HTML, estoura', /não achei URL de imagem/.test(String(erro)), erro);

  let erro2 = null;
  try { rodarNo(depois, { html: htmlCom(UMA, ORIGINAL), imagem: ORIGINAL, capaFallback: '' }); }
  catch (e) { erro2 = e.message; }
  ok('sem capa de fallback, estoura', /não existe capa de fallback/.test(String(erro2)), erro2);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
