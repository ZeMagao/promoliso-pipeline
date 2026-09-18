// Harness das fotos oficiais do jogo. Offline: não fala com a Steam nem com o n8n.
//
// O que precisa provar:
//   1. `Enriquecer: separar` continua entregando os alvos de og que já entregava — e agora soma
//      os alvos de foto de jogo, com o `__idx` certo (o zip do "aplicar" é POR POSIÇÃO; errar o
//      índice mistura a foto de uma pauta com o texto de outra).
//   2. `Enriquecer: aplicar` guarda as fotos quando o serviço responde, e NÃO quebra quando ele
//      devolve lixo, erro ou nada — pauta sem foto extra tem que seguir como antes.
//   3. `Normalizar notícias` passa a contar as fotos do jogo no acervo.
//   4. Logo de loja deixa de contar como foto. É o caso REAL do Gears: `xpalogo_black.png` era
//      uma das 2 "imagens distintas" da peça.
//   5. Sem fotos do jogo, a saída é a MESMA de antes do patch, item a item.
//
//   node design/test_fotos_do_jogo.cjs
const fs = require('fs');
const path = require('path');
const { aplicarNo, lf, ALVOS_JOGO } = require('./patch_fotos_do_jogo.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');
const ARQUIVOS = {
  'Enriquecer: separar': 'enriquecer-separar.js',
  'Enriquecer: aplicar': 'enriquecer-aplicar.js',
  'Normalizar notícias PromoLiso AI': 'normalizar-noticias-promoliso-ai.js',
};

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
}

// A marca de "já aplicado" é POR NÓ: `fotos_do_jogo` só aparece em dois dos três. Procurar a
// mesma palavra nos três fez o harness tentar reaplicar num nó que já estava no ar — é a segunda
// vez que este projeto tropeça nisso, então aqui fica explícito.
const MARCA_DO_NO = {
  'Enriquecer: separar': 'SERVICO_JOGO',
  'Enriquecer: aplicar': 'fotos_do_jogo',
  'Normalizar notícias PromoLiso AI': 'fotosDoJogo',
};
const antigo = {};
const novo = {};
let aplicados = 0;
for (const [no, arquivo] of Object.entries(ARQUIVOS)) {
  const texto = lf(fs.readFileSync(path.join(WFDIR, arquivo), 'utf8'));
  const jaTem = texto.includes(MARCA_DO_NO[no]);
  if (jaTem) aplicados += 1;
  novo[no] = jaTem ? texto : aplicarNo(texto, no, false);
  antigo[no] = jaTem ? aplicarNo(texto, no, true) : texto;
}
console.log(aplicados === 3 ? '# os três nós JÁ estão com as fotos do jogo — conferindo o que está no ar'
  : (aplicados === 0 ? '# o export ainda não tem — conferindo a troca'
    : 'AVISO: ' + aplicados + ' de 3 nós aplicados — patch pela metade?'));

function rodar(codigo, { entrada = [], nos = {}, json = null } = {}) {
  const env = (nome) => {
    if (!(nome in nos)) throw new Error('nó não disponível: ' + nome);
    const itens = nos[nome].map((j) => ({ json: j }));
    return { all: () => itens, first: () => itens[0], item: itens[0] };
  };
  const f = new Function('$input', '$', '$json', '$execution', codigo);
  return f({ all: () => entrada.map((j) => ({ json: j })) }, env, json || entrada[0] || {}, { id: '1' });
}

// ── candidatas de mentira, no formato que "Preparar candidatos" entrega ──────
const cand = (titulo, host, tipo, comImagem) => ({
  titulo,
  url: 'https://' + host + '/' + encodeURIComponent(titulo.slice(0, 12)),
  conteudo: 'texto da materia',
  publicado_em: new Date(Date.now() - 3600000).toISOString(),
  tipo_fonte: tipo,
  imagem_principal: comImagem ? 'https://' + host + '/foto-da-materia.jpg' : '',
  dados_brutos: {},
});
const POOL = [
  cand('Gears of War: E-Day vai ouro e detalha PC', 'news.xbox.com', 'primaria', true),
  cand('Silent Hill: Townfall detalha recursos do PS5', 'blog.playstation.com', 'primaria', false),
  cand('Monitor LG UltraGear com desconto', 'adrenaline.com.br', 'editorial', false),
];

// ── 1. separar ──────────────────────────────────────────────────────────────
const sepAntes = rodar(antigo['Enriquecer: separar'], { json: { candidatos: POOL } });
const sepDepois = rodar(novo['Enriquecer: separar'], { json: { candidatos: POOL } });

const ogAntes = sepAntes.map((i) => i.json.url);
const ogDepois = sepDepois.filter((i) => i.json.__tipo !== 'jogo').map((i) => i.json.url);
ok('os alvos de og não mudam', JSON.stringify(ogAntes) === JSON.stringify(ogDepois),
  JSON.stringify(ogAntes) + ' != ' + JSON.stringify(ogDepois));

const jogoAlvos = sepDepois.filter((i) => i.json.__tipo === 'jogo');
ok(`pede foto de jogo para até ${ALVOS_JOGO} candidatas`, jogoAlvos.length === Math.min(ALVOS_JOGO, POOL.length),
  String(jogoAlvos.length));
ok('a URL do serviço leva o título da candidata',
  jogoAlvos.every((i) => i.json.url.includes('/jogo/fotos?titulo=')));
ok('primária vem antes de portal na fila de consulta',
  decodeURIComponent(jogoAlvos[0].json.url).includes('Gears') || decodeURIComponent(jogoAlvos[0].json.url).includes('Silent'));
ok('o __idx aponta para a candidata certa',
  jogoAlvos.every((i) => {
    const idx = i.json.__idx;
    return POOL[idx] && decodeURIComponent(i.json.url).includes(POOL[idx].titulo.slice(0, 10));
  }));

// ── 2. aplicar ──────────────────────────────────────────────────────────────
const FOTOS = ['https://shared.akamai.steamstatic.com/a.jpg', 'https://shared.akamai.steamstatic.com/b.jpg'];
const respostaJogo = JSON.stringify({ jogo: 'Gears of War: E-Day', appid: 3010850, fotos: FOTOS });
function aplicarCom(respostas) {
  return rodar(novo['Enriquecer: aplicar'], {
    entrada: respostas,
    nos: {
      'Preparar candidatos': [{ candidatos: JSON.parse(JSON.stringify(POOL)) }],
      'Enriquecer: separar': sepDepois.map((i) => i.json),
    },
  })[0].json.candidatos;
}
const respostasBoas = sepDepois.map((i) => (i.json.__tipo === 'jogo'
  ? { data: i.json.__idx === 0 ? respostaJogo : JSON.stringify({ jogo: null, fotos: [] }) }
  : { data: '<meta property="og:image" content="https://blog.playstation.com/og.jpg">' }));
const poolBom = aplicarCom(respostasBoas);
ok('as fotos do jogo entram na candidata certa',
  JSON.stringify(poolBom[0].fotos_do_jogo) === JSON.stringify(FOTOS), JSON.stringify(poolBom[0].fotos_do_jogo));
ok('candidata sem jogo confirmado fica sem fotos extras', !poolBom[2].fotos_do_jogo);
ok('o og continua sendo aplicado como antes',
  poolBom[1].imagem_principal === 'https://blog.playstation.com/og.jpg', poolBom[1].imagem_principal);

const poolLixo = aplicarCom(sepDepois.map((i) => ({ data: i.json.__tipo === 'jogo' ? 'isto nao e json' : '' })));
ok('resposta inválida do serviço não quebra a rodada', Array.isArray(poolLixo) && poolLixo.length === 3);
ok('resposta inválida não inventa foto', !poolLixo.some((c) => c.fotos_do_jogo));
const poolVazio = aplicarCom(sepDepois.map(() => ({})));
ok('serviço fora do ar não quebra a rodada', Array.isArray(poolVazio) && poolVazio.length === 3);

// ── 3 e 4. normalizar ───────────────────────────────────────────────────────
const GRANDE = 'https://news.xbox.com/foto-grande.jpg';
const LOGO = 'https://assets.onestore.ms/cdnfiles/store/common/images/xpalogo_black.png';
function normalizarCom(item) {
  const saida = rodar(novo['Normalizar notícias PromoLiso AI'], {
    entrada: [{ candidatos: [item], promo_liso_ai: {} }],
  });
  return (saida[0].json.noticias || [])[0] || {};
}
function normalizarAntes(item) {
  const saida = rodar(antigo['Normalizar notícias PromoLiso AI'], {
    entrada: [{ candidatos: [item], promo_liso_ai: {} }],
  });
  return (saida[0].json.noticias || [])[0] || {};
}
// SEM `dados_brutos` de propósito: o "Normalizar" chama `collectOfficialImages(item.dados_brutos
// ?? item, ...)`, então um dados_brutos vazio faz o acervo voltar VAZIO e o teste mediria a
// bancada, não o patch. Foi assim que este harness pegou o erro de passar as fotos pelo objeto.
const base = {
  titulo: 'Gears of War: E-Day vai ouro',
  url: 'https://news.xbox.com/en-us/2026/09/17/gears',
  conteudo: 'materia',
  publicado_em: new Date().toISOString(),
  tipo_fonte: 'primaria',
  imagem_principal: GRANDE,
};

const comJogo = normalizarCom(Object.assign({}, base, { fotos_do_jogo: FOTOS }));
ok('as fotos do jogo aparecem no acervo da notícia',
  FOTOS.every((u) => (comJogo.imagens_oficiais || []).includes(u)), JSON.stringify(comJogo.imagens_oficiais));
ok('a foto da matéria continua na frente',
  (comJogo.imagens_oficiais || [])[0] === GRANDE, JSON.stringify((comJogo.imagens_oficiais || [])[0]));

const comLogoAntes = normalizarAntes(Object.assign({}, base, { imagem_principal: '', description: `<img src="${GRANDE}"><img src="${LOGO}">` }));
const comLogoDepois = normalizarCom(Object.assign({}, base, { imagem_principal: '', description: `<img src="${GRANDE}"><img src="${LOGO}">` }));
ok('antes do patch o logo contava como imagem',
  (comLogoAntes.imagens_oficiais || []).includes(LOGO));
ok('agora o logo NÃO conta como imagem',
  !(comLogoDepois.imagens_oficiais || []).includes(LOGO), JSON.stringify(comLogoDepois.imagens_oficiais));
ok('a foto de verdade sobrevive ao filtro',
  (comLogoDepois.imagens_oficiais || []).includes(GRANDE));

// ── 5. pauta sem foto de jogo sai igual ao de antes ─────────────────────────
const semExtra = Object.assign({}, base);
ok('sem fotos do jogo, o acervo é idêntico ao de antes',
  JSON.stringify(normalizarAntes(semExtra).imagens_oficiais) === JSON.stringify(normalizarCom(semExtra).imagens_oficiais));

// ── ida e volta ─────────────────────────────────────────────────────────────
for (const no of Object.keys(ARQUIVOS)) {
  const revertido = aplicarNo(novo[no], no, true);
  ok(`${no}: --reverter tira as fotos do jogo`, !/fotos_do_jogo/.test(revertido));
  ok(`${no}: reverter e reaplicar volta byte a byte`, aplicarNo(revertido, no, false) === lf(novo[no]));
  let compila = true;
  try { new Function(novo[no]); } catch (e) { compila = false; }
  ok(`${no}: jsCode resultante compila`, compila);
}

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
