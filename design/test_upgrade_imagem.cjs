// Harness do upgrade de imagem. Offline (sem rede, sem VPS), roda o nó REAL de normalização.
//
// O que precisa provar:
//   1. URL sem parâmetro sai IGUAL — o patch não pode mexer em 105 das 140 URLs da base real.
//   2. URL assinada não é tocada (o caso preview.redd.it, que a medição pegou dando 403).
//   3. URL com instrução de redimensionar perde a instrução.
//   4. As variantes de zoom da mesma foto colapsam numa imagem só (hoje entram como várias).
//   5. O nó continua devolvendo a mesma FORMA de saída, rodando com um item de RSS de verdade.
//
//   node design/test_upgrade_imagem.cjs
const fs = require('fs');
const path = require('path');
const { trocar, BLOCO, NO } = require('./patch_upgrade_imagem.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');
const ARQ = 'normalizar-noticias-promoliso-ai.js';

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const exportado = fs.readFileSync(path.join(WFDIR, ARQ), 'utf8').split('\r\n').join('\n');
const APLICADO = exportado.includes('function semRedimensionar(');
console.log(APLICADO ? '# export JÁ tem o upgrade — verificando o que está no ar'
                     : '# export ainda não tem o upgrade — verificando a troca');

let novo = exportado;
if (APLICADO) {
  ok('no ar está exatamente o bloco versionado', exportado.includes(BLOCO));
  let reErro = null;
  try { trocar(exportado); } catch (e) { reErro = e.message; }
  ok('recusa reaplicação', /já aplicado/.test(String(reErro)), reErro);
} else {
  let erro = null, saida = null;
  try { saida = trocar(exportado); } catch (e) { erro = e.message; }
  ok('o patch aplica', Boolean(saida), erro);
  if (!saida) { console.log('\n1 FALHA(S)'); process.exit(1); }
  novo = saida;
  let reErro = null;
  try { trocar(saida); } catch (e) { reErro = e.message; }
  ok('recusa reaplicação', /já aplicado/.test(String(reErro)), reErro);
}

// pega a função de dentro do código do nó, e não uma cópia — o teste tem que medir o que roda
const semRedimensionar = new Function(novo.slice(novo.indexOf('const PARAMS_DE_TAMANHO'),
  novo.indexOf('function collectOfficialImages')) + '\nreturn semRedimensionar;')();

// ---- 1 a 3: a regra ----
const CASOS = [
  ['https://www.adrenaline.com.br/wp-content/uploads/2026/08/foto.jpg', 'igual', 'sem parâmetro nenhum'],
  ['https://blog.playstation.com/tachyon/2026/08/abc-scaled.jpg?fit=1024%2C1024', 'limpa', 'o caso que motivou tudo'],
  ['https://blog.playstation.com/tachyon/2026/08/abc-scaled.jpg?resize=2560%2C1440&zoom=1', 'limpa', 'resize+zoom'],
  ['https://preview.redd.it/foto.jpg?width=640&crop=smart&auto=webp&s=abc123', 'igual', 'URL ASSINADA — mexer dá 403'],
  ['https://exemplo.com/foto.jpg?token=xyz', 'igual', 'parâmetro desconhecido'],
  ['https://exemplo.com/foto.jpg?w=800&token=xyz', 'igual', 'um desconhecido entre conhecidos já basta'],
  ['https://exemplo.com/foto.jpg?', 'igual', 'query vazia'],
  ['', 'igual', 'string vazia'],
];
for (const [url, esperado, porque] of CASOS) {
  const saida = semRedimensionar(url);
  const limpou = saida !== url;
  const acertou = esperado === 'limpa' ? (limpou && !saida.includes('?')) : !limpou;
  ok(`${esperado === 'limpa' ? 'limpa ' : 'mantém'} ${porque}`, acertou, saida);
}

// ---- 4: variantes da mesma foto colapsam ----
{
  const base = 'https://blog.playstation.com/tachyon/2026/08/abc-scaled.jpg';
  const variantes = [`${base}?resize=2560%2C1440&zoom=1`, `${base}?resize=2560%2C1440&zoom=0.75`,
    `${base}?fit=1024%2C1024`, base];
  const distintas = new Set(variantes.map(semRedimensionar));
  ok('4 variantes da mesma foto viram 1', distintas.size === 1, [...distintas].join(' | '));
}

// ---- 4b: contra a base REAL (uma URL por combinação host+parâmetros vista em produção) ----
{
  const reais = fs.readFileSync(path.join(__dirname, 'urls_imagem_amostra.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('https://'));
  ok('a amostra real está no repo', reais.length > 5, reais.length + ' URLs');
  const mexidas = reais.filter((u) => semRedimensionar(u) !== u);
  const assinadas = reais.filter((u) => /[?&]s=/.test(u));
  ok('nenhuma URL assinada foi tocada', assinadas.every((u) => semRedimensionar(u) === u),
    assinadas.length + ' assinadas na amostra');
  ok('nenhuma URL sem query foi tocada', reais.filter((u) => !u.includes('?')).every((u) => semRedimensionar(u) === u));
  ok('o que sobrou mexido não tem mais query', mexidas.every((u) => !semRedimensionar(u).includes('?')),
    `${mexidas.length} de ${reais.length} formatos são melhoráveis`);
}

// ---- 5: o nó roda inteiro e mantém a forma da saída ----
{
  const item = {
    title: 'Sony anuncia atualização do PS5',
    link: 'https://blog.playstation.com/2026/08/12/ps5-update/',
    isoDate: new Date().toISOString(),
    contentSnippet: 'A Sony anunciou hoje uma atualização de sistema para o PS5 com novidades.',
    'content:encoded': '<p><img src="https://blog.playstation.com/tachyon/2026/08/abc-scaled.jpg?resize=1024%2C576&zoom=1" />'
      + '<img src="https://blog.playstation.com/tachyon/2026/08/abc-scaled.jpg?resize=2560%2C1440&zoom=0.75" />'
      + '<img src="https://blog.playstation.com/tachyon/2026/08/outra-scaled.jpg?fit=1024%2C1024" /></p>',
  };
  const rodar = (code) => {
    const $input = { all: () => [{ json: item }], first: () => ({ json: item }) };
    const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
    return new Function('$input', '$', '$json', 'require', 'items', code)($input, $, item, require, [{ json: item }]);
  };
  let antes = null, depois = null, erro = null;
  try { antes = rodar(exportado); depois = rodar(novo); } catch (e) { erro = e.message; }
  ok('o nó roda com um item de RSS de verdade', Boolean(antes && depois), erro);
  if (antes && depois) {
    const imgs = (r) => (r[0]?.json?.imagens_oficiais || r[0]?.json?.imagens || []);
    const a = imgs(antes), d = imgs(depois);
    ok('o nó continua devolvendo a mesma forma', Object.keys(antes[0].json).join() === Object.keys(depois[0].json).join());
    ok('nenhuma URL de imagem sai com parâmetro de tamanho', !d.some((u) => /[?&](fit|resize|zoom|w|width)=/i.test(String(u))),
      d.join(' | ').slice(0, 160));
    ok('as variantes da mesma foto deixam de contar como imagens diferentes', d.length <= a.length,
      `antes ${a.length} imagens, depois ${d.length}`);
  }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
