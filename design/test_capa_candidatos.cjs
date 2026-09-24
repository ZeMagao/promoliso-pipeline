// Harness dos candidatos de capa. Offline.
//
// O que precisa provar:
//   1. A FOTO ESCOLHIDA NÃO MUDA. Isto entra no caminho de toda peça; se o `src` mudasse, a capa
//      publicada mudaria — e o pedido era não perder a rodada, não trocar a arte.
//   2. Os candidatos são as outras fotos DA MESMA peça, na ordem, sem repetir a primária.
//   3. Todos os candidatos saem como URL do nosso Cloudinary — é o único formato que o
//      renderizador inlina.
//   4. As duas metades se entendem: a tag que o produtor escreve é lida pelo módulo do
//      renderizador (`vps/renderer/candidatos.cjs`). Duas metades provadas em separado e nunca
//      juntas é como este projeto já quebrou publicação por 3 dias.
//   5. Peça sem alternativa nenhuma sai igual ao de antes, sem atributo sobrando.
//
//   node design/test_capa_candidatos.cjs
const fs = require('fs');
const path = require('path');
const { aplicar, lf, MARCA, MAX_ALTERNATIVAS } = require('./patch_capa_candidatos.cjs');
// O módulo do renderizador mora em `vps/renderer/` no repositório e em `renderer/` no servidor.
// Tentar os dois deixa o harness rodar nos dois lugares — e ele PRECISA rodar no servidor, porque
// é lá que o dry-run do patch confere se as duas metades combinam.
const candidatosMod = (() => {
  for (const caminho of ['../vps/renderer/candidatos.cjs', '../renderer/candidatos.cjs']) {
    try { return require(caminho); } catch (e) { /* tenta o próximo */ }
  }
  throw new Error('não achei candidatos.cjs nem em vps/renderer nem em renderer');
})();
const { candidatosDaTag, alvosDoHtml } = candidatosMod;

const ARQ = path.join(__dirname, '..', 'workflows', 'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq',
  'code-in-javascript1.js');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

const texto = lf(fs.readFileSync(ARQ, 'utf8'));
const jaTem = texto.includes(MARCA);
const novo = jaTem ? texto : aplicar(texto, false);
const antigo = jaTem ? aplicar(texto, true) : texto;
console.log(jaTem ? '# o nó exportado JÁ tem candidatos de capa — conferindo o que está no ar'
                  : '# o nó ainda não tem — conferindo a troca');

// Fatia funções do nó real e as executa juntas, com as dependências que elas usam.
function montar(codigo, ...nomes) {
  const pedacos = [];
  for (const nome of ['urlAttr', 'cloud', 'capaAlternativas', 'capaImg']) {
    const i = codigo.indexOf('function ' + nome + '(');
    if (i < 0) continue;
    let nivel = 0;
    for (let k = codigo.indexOf('{', i); k < codigo.length; k += 1) {
      if (codigo[k] === '{') nivel += 1;
      else if (codigo[k] === '}') { nivel -= 1; if (nivel === 0) { pedacos.push(codigo.slice(i, k + 1)); break; } }
    }
  }
  // As constantes que essas funções usam também vêm do nó, não inventadas aqui.
  const consts = ['QUAL', 'CAPA_MIN_W', 'CAPA_MIN_H']
    .map((nome) => (codigo.match(new RegExp('const ' + nome + ' = [^;\\n]+')) || [])[0])
    .filter(Boolean)
    .join(';\n');
  // eslint-disable-next-line no-new-func
  return new Function([consts + ';', ...pedacos, `return { ${nomes.join(', ')} };`].join('\n'))();
}

const nova = montar(novo, 'capaImg', 'capaAlternativas', 'cloud');
const velha = montar(antigo, 'capaImg', 'cloud');

const CAPA = 'https://news.xbox.com/foto-capa.jpg';
const S1 = 'https://news.xbox.com/foto-slide-1.jpg';
const S2 = 'https://blog.playstation.com/foto-slide-2.jpg';
const output = { capa: CAPA, slides: [{ imagem: CAPA }, { imagem: S1 }, { imagem: S2 }] };

// ── 1. a foto escolhida não muda ────────────────────────────────────────────
const tagNova = nova.capaImg(CAPA, nova.capaAlternativas(output));
const tagVelha = velha.capaImg(CAPA);
const src = (t) => (/\bsrc="([^"]+)"/.exec(t) || [])[1];
ok('o src da capa é idêntico ao de antes', src(tagNova) === src(tagVelha), src(tagNova));
ok('o estilo da tag não muda', tagNova.includes('object-fit:cover;filter:contrast(1.06) saturate(1.06);'));

// ── 2 e 3. os candidatos ────────────────────────────────────────────────────
const lido = candidatosDaTag(tagNova);
ok('a tag tem candidatos', !!lido && lido.candidatos.length > 1, JSON.stringify(lido && lido.candidatos.length));
ok('a primária é a primeira', lido.candidatos[0] === src(tagNova));
ok('a primária não se repete nos fallbacks', new Set(lido.candidatos).size === lido.candidatos.length);
ok('todo candidato é URL do nosso Cloudinary',
  lido.candidatos.every((u) => /^https:\/\/res\.cloudinary\.com\/fy2n2qvr\//.test(u)), lido.candidatos[1]);
ok('a origem de cada candidato é uma foto da peça',
  lido.candidatos.slice(1).every((u) => [CAPA, S1, S2].some((o) => decodeURIComponent(u).includes(o))));

const muitas = { capa: CAPA, slides: Array.from({ length: 9 }, (_, i) => ({ imagem: 'https://x.test/' + i + '.jpg' })) };
const tagMuitas = nova.capaImg(CAPA, nova.capaAlternativas(muitas));
ok(`no máximo ${MAX_ALTERNATIVAS} alternativas`,
  candidatosDaTag(tagMuitas).candidatos.length <= MAX_ALTERNATIVAS + 1,
  String(candidatosDaTag(tagMuitas).candidatos.length));

// ── 4. as duas metades se entendem ──────────────────────────────────────────
const html = `<div>${tagNova}</div>`;
const alvos = alvosDoHtml(html);
ok('o renderizador enxerga a capa como alvo', alvos.length === 1);
ok('e recebe a mesma lista de candidatos',
  JSON.stringify(alvos[0].candidatos) === JSON.stringify(lido.candidatos));

// ── 5. peça sem alternativa ─────────────────────────────────────────────────
const soUma = nova.capaImg(CAPA, nova.capaAlternativas({ capa: CAPA, slides: [{ imagem: CAPA }] }));
ok('sem outra foto, não sobra atributo vazio', !soUma.includes('data-fallback'), soUma.slice(0, 90));
ok('e a tag fica idêntica à de antes', soUma === tagVelha);

const semNada = nova.capaImg(CAPA, undefined);
ok('alternativas ausentes não quebram', semNada === tagVelha);

// ── ida e volta ─────────────────────────────────────────────────────────────
if (!jaTem) ok('reverter e reaplicar volta byte a byte', aplicar(aplicar(novo, true), false) === lf(novo));
let compila = true;
try { new Function(novo); } catch (e) { compila = false; }
ok('jsCode resultante compila', compila);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
