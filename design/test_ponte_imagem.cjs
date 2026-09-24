// Harness da ponte de imagem nos nós de render. Offline: não fala com Cloudinary nem com portal.
//
// O que precisa provar:
//   1. As TRÊS cópias da montagem da URL passam a desviar os hosts bloqueados. Consertar uma só
//      deixa o bug vivo nas outras duas — a duplicação já está registrada na auditoria.
//   2. Host que o Cloudinary ALCANÇA continua direto, sem hop extra: Xbox Wire, PlayStation,
//      Steam, gamevicio, tecnoblog. Passar tudo pela ponte seria trocar um gargalo por outro.
//   3. A URL final é uma URL de fetch do Cloudinary apontando para a ponte, com a original
//      inteira dentro — inclusive quando ela tem acento, espaço ou querystring.
//   4. O bypass do Mux, que já existia, continua valendo.
//
//   node design/test_ponte_imagem.cjs
const fs = require('fs');
const path = require('path');
const { aplicarNo, lf, EDICOES, PONTE } = require('./patch_ponte_imagem.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');
const ARQUIVOS = {
  'Code in JavaScript1': 'code-in-javascript1.js',
  'Code in JavaScript': 'code-in-javascript.js',
  'Usar capa como fallback': 'usar-capa-como-fallback.js',
};

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

// Extrai a função de montagem do nó e a executa isolada — é o jeito de provar o comportamento
// sem rodar 700 KB de código com fonte embutida.
// Fatia a definição de urlAttr, se ela existir no nó.
function depoisDeUrlAttr(texto) {
  const i = texto.indexOf('function urlAttr(u){');
  if (i < 0) return '';
  let nivel = 0;
  for (let k = texto.indexOf('{', i); k < texto.length; k += 1) {
    if (texto[k] === '{') nivel += 1;
    else if (texto[k] === '}') { nivel -= 1; if (nivel === 0) return texto.slice(i, k + 1); }
  }
  return '';
}

function extrair(texto, nome) {
  const inicio = texto.indexOf(nome === 'safeImage' ? 'function safeImage' : 'function cloud');
  if (inicio < 0) return null;
  let i = texto.indexOf('{', inicio);
  let nivel = 0;
  for (let k = i; k < texto.length; k += 1) {
    if (texto[k] === '{') nivel += 1;
    else if (texto[k] === '}') { nivel -= 1; if (nivel === 0) { i = k; break; } }
  }
  const corpo = texto.slice(inicio, i + 1);
  // A função fatiada chama `urlAttr` desde o patch de segurança de 24/09 — sem trazer a
  // dependência junto, o teste quebra por falta de contexto e não por defeito no código.
  const dep = depoisDeUrlAttr(texto);
  // eslint-disable-next-line no-new-func
  return new Function([dep, corpo, 'return ' + (nome === 'safeImage' ? 'safeImage' : 'cloud') + ';'].join('\n'))();
}

const BLOQUEADOS = [
  'https://www.adrenaline.com.br/wp-content/uploads/2026/09/Physint.jpeg',
  'https://adrenaline.com.br/img/x.jpg',
  'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AAA/s1920/capa.png',
];
const ALCANCAVEIS = [
  'https://xboxwire.thesourcemediaassets.com/sites/2/2026/09/x-scaled.jpg',
  'https://blog.playstation.com/uploads/2026/09/x.jpg',
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_x.1920x1080.jpg?t=123',
  'https://www.gamevicio.com/i/n/x.jpg',
  'https://files.tecnoblog.net/wp-content/uploads/2026/08/x.jpg',
];

// ⚠️ ESTE HARNESS MUDOU DE FORMA EM 24/09, e a razão é a lição: ele reconstruía o "antes"
// revertendo o próprio patch da ponte. Quando o patch de segurança (urlAttr) tocou as MESMAS
// linhas, a reversão parou de casar e o teste ficou vermelho sem nada estar quebrado em produção.
// Um teste de regressão não pode depender de conseguir desfazer um patch histórico: agora ele
// afirma o COMPORTAMENTO do código que está no ar. Só quando a ponte ainda não foi aplicada é
// que ele compara antes × depois.
for (const [no, arquivo] of Object.entries(ARQUIVOS)) {
  const texto = lf(fs.readFileSync(path.join(WFDIR, arquivo), 'utf8'));
  const jaTem = texto.includes(PONTE);
  const novo = jaTem ? texto : aplicarNo(texto, no, false);
  const antigo = jaTem ? null : texto;

  const ehFallback = no === 'Usar capa como fallback';
  const fnNova = extrair(novo, ehFallback ? 'safeImage' : 'cloud');
  const fnVelha = antigo === null ? null : extrair(antigo, ehFallback ? 'safeImage' : 'cloud');
  ok(`${no}: a função foi encontrada`, typeof fnNova === 'function');
  if (typeof fnNova !== 'function') continue;
  const chamar = (fn, u) => (ehFallback ? fn(u) : fn(u, 'f_auto'));

  for (const u of BLOQUEADOS) {
    const depois = chamar(fnNova, u);
    if (fnVelha) {
      ok(`${no}: antes ia direto ao portal — ${u.slice(8, 40)}`,
        chamar(fnVelha, u).includes(encodeURIComponent(u)));
    }
    // A transformação da capa tem barras (c_fill,g_auto/if_else/...), então separar por '/' para
    // achar a fonte não funciona. O que importa: a URL é fetch do Cloudinary e a fonte, depois de
    // decodificada uma vez, é a nossa ponte.
    ok(`${no}: agora vai pela ponte — ${u.slice(8, 40)}`,
      depois.startsWith('https://res.cloudinary.com/fy2n2qvr/image/fetch/')
      && decodeURIComponent(depois).includes(PONTE),
      depois.slice(0, 120));
    ok(`${no}: a URL original sobrevive inteira dentro da ponte — ${u.slice(8, 30)}`,
      decodeURIComponent(decodeURIComponent(depois)).includes(u));
  }

  for (const u of ALCANCAVEIS) {
    const depois = chamar(fnNova, u);
    ok(`${no}: host alcançável continua direto — ${u.slice(8, 38)}`, !depois.includes('/img?u='), depois.slice(0, 100));
    // a URL entregue tem que continuar sendo a do Cloudinary com a origem dentro, intacta
    ok(`${no}: e a origem chega inteira ao Cloudinary — ${u.slice(8, 30)}`,
      depois.startsWith('https://res.cloudinary.com/fy2n2qvr/image/fetch/')
      && decodeURIComponent(depois).includes(u));
    if (fnVelha) ok(`${no}: e igual ao de antes — ${u.slice(8, 30)}`, depois === chamar(fnVelha, u));
  }

  if (!ehFallback) {
    const mux = 'https://image.mux.com/abc/thumbnail.jpg?token=x';
    ok(`${no}: bypass do Mux preservado`, chamar(fnNova, mux).startsWith('https://image.mux.com/'));
    ok(`${no}: URL que não é https vira vazio`, chamar(fnNova, 'http://x.com/a.jpg') === '');
  }

  if (!jaTem) {
    ok(`${no}: reverter e reaplicar volta byte a byte`, aplicarNo(aplicarNo(novo, no, true), no, false) === lf(novo));
  }
}

ok('o patch cobre os três nós', new Set(EDICOES.map((e) => e.no)).size === 3);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
