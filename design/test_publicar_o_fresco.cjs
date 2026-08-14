// Harness da escolha por frescor. Offline, rodando o nó de verdade — inclusive contra a FILA REAL
// de 14/08, para responder a pergunta que motivou a mudança: "o que sairia agora?".
//
//   node design/test_publicar_o_fresco.cjs
const fs = require('fs');
const path = require('path');
const { trocar, NOVO, NO } = require('./patch_publicar_o_fresco.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows', 'promoliso-publicador-fila--E27F7yVdsZRj');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const lf = (s) => String(s).split('\r\n').join('\n');
const antigo = lf(fs.readFileSync(path.join(WFDIR, 'selecionar-ready.js'), 'utf8'));
const APLICADO = antigo.includes('JANELA_DO_DIA_H');
console.log(APLICADO ? '# export JÁ publica o fresco — verificando o que está no ar'
                     : '# export ainda publica o mais velho — verificando a troca');

let novo;
if (APLICADO) {
  novo = antigo;
  ok('no ar está o bloco versionado', novo.includes(NOVO));
  let re = null;
  try { trocar(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já publica o fresco/.test(String(re)), re);
} else {
  let e1 = null;
  try { novo = trocar(antigo); } catch (e) { e1 = e.message; }
  ok('o patch aplica (sha bate)', Boolean(novo), e1);
  if (!novo) { console.log('\nFALHA'); process.exit(1); }
}

const horasAtras = (h) => new Date(Date.now() - h * 3600000).toISOString();
const row = (over) => ({
  content_key: 'ck', topic: 'Pauta', status: 'READY', created_at: horasAtras(2), score: 70,
  carousel_urls: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => 'https://c/' + x + '.jpg')),
  caption: 'l', story_url: 'https://c/s.jpg', primary_url: 'https://x/y', ...over,
});
const escolher = (code, rows) => {
  const $input = { all: () => rows.map((json) => ({ json })) };
  const saida = new Function('$input', '$', '$json', code)($input, () => ({ item: { json: {} } }), {});
  return saida.length ? saida[0].json : null;
};

// ---- o caso que motivou tudo ----
{
  const fila = [
    row({ content_key: 'de-hoje', created_at: horasAtras(3), score: 60 }),
    row({ content_key: 'de-anteontem', created_at: horasAtras(46), score: 95 }),
  ];
  ok('ANTES publicava a de anteontem', escolher(antigo, fila).content_key === (APLICADO ? 'de-hoje' : 'de-anteontem'));
  ok('AGORA publica a de hoje', escolher(novo, fila).content_key === 'de-hoje');
  ok('e a idade vai na saída, para o alerta e o log', typeof escolher(novo, fila).idade_h === 'number');
}

// ---- entre as de hoje, ganha a de melhor nota ----
{
  const fila = [
    row({ content_key: 'hoje-fraca', created_at: horasAtras(1), score: 55 }),
    row({ content_key: 'hoje-forte', created_at: horasAtras(6), score: 92 }),
    row({ content_key: 'ontem-fortissima', created_at: horasAtras(30), score: 99 }),
  ];
  ok('entre as do dia, a melhor nota ganha', escolher(novo, fila).content_key === 'hoje-forte');
  ok('e nota alta de ontem NÃO ganha da de hoje', escolher(novo, fila).content_key !== 'ontem-fortissima');
}

// ---- degraus 2 e 3 ----
{
  const semHoje = [
    row({ content_key: 'ontem', created_at: horasAtras(20), score: 50 }),
    row({ content_key: 'anteontem', created_at: horasAtras(44), score: 99 }),
  ];
  ok('sem peça do dia, publica a mais nova dentro das 48 h', escolher(novo, semHoje).content_key === 'ontem');

  const soVelhas = [
    row({ content_key: 'velha', created_at: horasAtras(60) }),
    row({ content_key: 'muito-velha', created_at: horasAtras(120) }),
  ];
  ok('sem nada fresco, ainda publica (slot vazio é pior)', escolher(novo, soVelhas).content_key === 'velha');
  ok('fila vazia devolve nada', escolher(novo, []) === null);
}

// ---- o que veio antes não pode ter se perdido ----
{
  const r = escolher(novo, [row({ content_key: 'x', status: 'RETRY', created_at: horasAtras(2) })]);
  ok('RETRY continua publicável', r && r.content_key === 'x');
  ok('status_anterior continua saindo', r.status_anterior === 'RETRY');
  ok('a saída para o publicador segue completa',
    ['content_key', 'topic', 'cover', 'slides', 'caption', 'story_url', 'primary_url'].every((k) => r[k] !== undefined));
  ok('PUBLISHED/FAILED seguem fora',
    escolher(novo, [row({ status: 'PUBLISHED' }), row({ status: 'FAILED' })]) === null);
  let erro = null;
  try { escolher(novo, [row({ carousel_urls: '["so-uma"]' })]); } catch (e) { erro = e.message; }
  ok('carrossel curto continua estourando', /carousel_urls insuficiente/.test(String(erro)), erro);
}

// ---- contra a FILA REAL de 14/08 ----
{
  const reais = [
    [48, 0.7, 'Whisper of the House abre pré-venda'], [47, 4.7, 'Atualização de agosto do Xbox'],
    [46, 6.7, 'No More Room in Hell 2'], [45, 8.7, 'Total War Franchise Sale'],
    [44, 18.7, 'Caravan SandWitch grátis'], [41, 52.7, 'Ghost of Yotei'],
    [40, 54.7, 'Helldivers 2'], [39, 56.7, 'Promoção Xbox Store'],
    [37, 68.7, 'Overwatch Temporada 4'], [32, 100.7, 'Falha no GeForce NOW'],
    [20, 166.7, 'THQ Nordic Showcase'],
  ].map(([id, idade, tema]) => row({ content_key: 'row-' + id, topic: tema, created_at: horasAtras(idade), score: 70 }));
  const antes = escolher(antigo, reais);
  const depois = escolher(novo, reais);
  console.log('\n   fila real de 14/08 -> antes sairia: ' + antes.content_key + ' (' + antes.topic + ')');
  console.log('                          agora sai:   ' + depois.content_key + ' (' + depois.topic + ')');
  ok('na fila real, agora sai peça de menos de 12 h', depois.idade_h <= 12, depois.idade_h + ' h');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
