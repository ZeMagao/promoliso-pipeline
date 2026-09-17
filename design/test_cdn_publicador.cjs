// Harness do "carrossel sai pelo host nosso". Offline, rodando o nó de código de verdade.
//
// O que precisa provar:
//   1. A ESCOLHA da peça não muda — mesma row, mesma nota, mesma idade, mesma saída do Switch,
//      mesma legenda. O patch é sobre de ONDE a imagem é servida, não sobre o que publica.
//   2. Toda URL de imagem entregue ao Instagram passa a ser do nosso host — inclusive a do story,
//      que usa o mesmo buscador do Meta e falharia do mesmo jeito.
//   3. A conversão é 1:1 e reversível: mesma versão, mesmo id, mesmo .jpg.
//   4. URL que não é do nosso cloud passa INTACTA (hoje não existe; a porta fica fechada).
//   5. Aplicar duas vezes é erro, e o `--reverter` devolve o texto original byte a byte.
//
//   node design/test_cdn_publicador.cjs
const fs = require('fs');
const path = require('path');
const { aplicarTodas, lf, paraCdn, CDN_BASE } = require('./patch_cdn_publicador.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows', 'promoliso-publicador-fila--E27F7yVdsZRj');
const AMOSTRA = path.join(__dirname, 'fila_amostra_20260820.json');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
}

const antigo = lf(fs.readFileSync(path.join(WFDIR, 'selecionar-ready.js'), 'utf8'));
const APLICADO = antigo.includes('paraCdn');
console.log(APLICADO ? '# o export JÁ tem o host nosso — conferindo o que está no ar'
                     : '# o export ainda aponta para o Cloudinary — conferindo a troca');
const novo = APLICADO ? antigo : aplicarTodas(antigo, false);

// Roda o jsCode do nó como o n8n roda: $input.all() devolve [{json: row}, ...].
function rodar(codigo, rows) {
  const $input = { all: () => rows.map((json) => ({ json })) };
  const f = new Function('$input', codigo);
  return f($input);
}

const rowsAmostra = JSON.parse(fs.readFileSync(AMOSTRA, 'utf8'));
const publicaveis = rowsAmostra.filter((r) => ['READY', 'RETRY'].includes(String(r.status || '').toUpperCase()));

// Cenários: a amostra crua (tudo velho -> ramo C), uma peça fresca (ramo A) e um empate de nota
// entre 12 h e 48 h (ramo B). Os dois lados rodam com o mesmo relógio, então dá para comparar.
const agoraIso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const comIdade = (row, h, score) => Object.assign({}, row, { created_at: agoraIso(h), score, status: 'READY' });
const base = publicaveis.length ? publicaveis : rowsAmostra;

const CENARIOS = [
  { nome: 'amostra crua (ramo C, tudo vencido)', rows: rowsAmostra },
  { nome: 'peça fresca ganha (ramo A)', rows: [comIdade(rowsAmostra[0], 30, 90), comIdade(rowsAmostra[1], 2, 70)] },
  { nome: 'entre 12 h e 48 h, nota decide (ramo B)', rows: [comIdade(rowsAmostra[2], 20, 70), comIdade(rowsAmostra[3], 40, 88)] },
  { nome: 'uma peça só', rows: [comIdade(rowsAmostra[4], 3, 75)] },
];

const CAMPOS_IGUAIS = ['content_key', 'topic', 'caption', 'primary_url', 'status_anterior',
  'created_at', 'idade_h', 'n_imagens', 'saida_carrossel', 'imagens_ignoradas'];

for (const cen of CENARIOS) {
  const antes = rodar(antigo, cen.rows);
  const depois = rodar(novo, cen.rows);
  ok(`${cen.nome}: mesma quantidade de saídas`, antes.length === depois.length);
  if (!antes.length || !depois.length) continue;
  const a = antes[0].json;
  const d = depois[0].json;
  const diferentes = CAMPOS_IGUAIS.filter((c) => JSON.stringify(a[c]) !== JSON.stringify(d[c]));
  ok(`${cen.nome}: escolha e campos idênticos`, diferentes.length === 0, 'mudaram: ' + diferentes.join(', '));

  const urlsAntes = [a.cover, ...a.slides, a.story_url].filter(Boolean);
  const urlsDepois = [d.cover, ...d.slides, d.story_url].filter(Boolean);
  ok(`${cen.nome}: mesma quantidade de imagens`, urlsAntes.length === urlsDepois.length,
    `${urlsAntes.length} -> ${urlsDepois.length}`);
  const sobrouCloudinary = urlsDepois.filter((u) => u.includes('res.cloudinary.com'));
  ok(`${cen.nome}: nenhuma URL sobra no Cloudinary`, sobrouCloudinary.length === 0, sobrouCloudinary[0]);
  const conversaoCerta = urlsAntes.every((u, i) => paraCdn(u) === urlsDepois[i]);
  ok(`${cen.nome}: conversão 1:1 na mesma ordem`, conversaoCerta);
}

// Cobertura sobre a amostra inteira: toda URL gravada na fila converte?
const todas = [];
for (const r of rowsAmostra) {
  try { todas.push(...JSON.parse(r.carousel_urls || '[]')); } catch (e) { /* row sem carrossel */ }
  if (r.story_url) todas.push(r.story_url);
}
const convertidas = todas.filter((u) => paraCdn(u).startsWith(CDN_BASE + '/cdn/'));
ok(`amostra: ${convertidas.length}/${todas.length} URLs convertem`, convertidas.length === todas.length,
  'ficaram de fora: ' + todas.filter((u) => !paraCdn(u).startsWith(CDN_BASE)).slice(0, 3).join(' '));

// Formato da URL nova: mesma versão, mesmo id, mesmo .jpg.
const exemplo = 'https://res.cloudinary.com/fy2n2qvr/image/upload/v1789570897/ijg9phpzidoymtkkwe0n.jpg';
ok('URL nova preserva versão e id',
  paraCdn(exemplo) === CDN_BASE + '/cdn/v1789570897/ijg9phpzidoymtkkwe0n.jpg', paraCdn(exemplo));

// URL de fora do nosso cloud passa intacta — inclusive dentro de um carrossel misto.
const FORA = 'https://blog.playstation.com/imagem.jpg';
ok('URL de fora do nosso cloud passa intacta', paraCdn(FORA) === FORA, paraCdn(FORA));
const misto = [Object.assign({}, rowsAmostra[0], {
  status: 'READY',
  created_at: agoraIso(1),
  carousel_urls: JSON.stringify([exemplo, FORA, exemplo, exemplo, exemplo, exemplo]),
  story_url: FORA,
})];
const saidaMista = rodar(novo, misto)[0].json;
ok('carrossel misto: converte o nosso e preserva o de fora',
  saidaMista.cover.startsWith(CDN_BASE) && saidaMista.slides[0] === FORA && saidaMista.story_url === FORA);

// Um outro cloud name não pode ser convertido (senão viraria proxy do que não é nosso).
ok('cloud alheio não é convertido',
  paraCdn('https://res.cloudinary.com/OUTRO/image/upload/v1/abcd.jpg')
    === 'https://res.cloudinary.com/OUTRO/image/upload/v1/abcd.jpg');

// Aplicar duas vezes tem que doer, e reverter tem que fechar o círculo.
let doeu = false;
try { aplicarTodas(novo, false); } catch (e) { doeu = true; }
ok('aplicar duas vezes é erro', doeu);
// Com o patch já no ar, `antigo` é o texto NOVO — comparar com ele acusaria falha à toa. O que
// vale nos dois estados é o ida-e-volta: reverter e reaplicar tem que devolver o mesmo byte.
const revertido = aplicarTodas(novo, true);
ok('--reverter tira o host nosso', !revertido.includes('paraCdn'));
ok('reverter e reaplicar volta byte a byte', aplicarTodas(revertido, false) === lf(novo));

// O código resultante compila (o patch também confere, mas aqui é de graça).
let compila = true;
try { new Function(novo); } catch (e) { compila = false; }
ok('jsCode resultante compila', compila);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
