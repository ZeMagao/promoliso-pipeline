// Harness da allowlist de link no texto publicado. Offline.
//
// O que precisa provar — e a ordem importa, porque a regra é uma trava de segurança que roda em
// TODA peça: primeiro que ela não estorva o conteúdo legítimo, depois que ela pega o ataque.
//
//   1. FALSO POSITIVO ZERO contra as peças reais da amostra versionada. Uma trava que reprova
//      pauta boa é pior que a falha que ela fecha: a conta para de publicar e alguém desliga a
//      trava no susto.
//   2. Link explícito de host não permitido reprova.
//   3. Domínio solto, sem esquema, também reprova — é assim que alguém escapa de um filtro que só
//      procura `https://`.
//   4. Número ("1.999,00") e versão ("v1.5.0") NÃO viram domínio.
//   5. Host de fonte já validada da própria pauta passa; loja conhecida passa.
//
// A regra não é reimplementada aqui: o bloco é FATIADO do código patchado e executado. As
// dependências dele (`hostIn`, `dominiosPrimarios`, `dominiosLojas`) também são fatiadas do
// validador real — reimplementar qualquer uma delas faria o teste medir a si mesmo.
//
//   node design/test_link_allowlist.cjs
const fs = require('fs');
const path = require('path');
const { aplicar, lf, extrairBloco, MARCA } = require('./patch_link_allowlist.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows', 'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');
const VALIDADOR = path.join(WFDIR, 'validar-antes-de-publicar.js');
const AMOSTRA = path.join(__dirname, 'fila_amostra_20260820.json');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

const original = lf(fs.readFileSync(VALIDADOR, 'utf8'));
const jaTem = original.includes(MARCA);
const patchado = jaTem ? original : aplicar(original, false);
console.log(jaTem ? '# o validador exportado JÁ tem a allowlist — conferindo o que está no ar'
                  : '# o validador ainda não tem — conferindo a troca');

// Fatia uma declaração inteira do validador real, balanceando chaves/colchetes.
function fatiar(codigo, inicio, abre, fecha) {
  const i = codigo.indexOf(inicio);
  if (i < 0) throw new Error('não achei no validador: ' + inicio);
  let nivel = 0;
  for (let k = codigo.indexOf(abre, i); k < codigo.length; k += 1) {
    if (codigo[k] === abre) nivel += 1;
    else if (codigo[k] === fecha) {
      nivel -= 1;
      if (nivel === 0) return codigo.slice(i, k + 1) + (fecha === ']' ? ';' : '');
    }
  }
  throw new Error('declaração não fecha: ' + inicio);
}

const DEPENDENCIAS = [
  fatiar(original, 'function hostIn(', '{', '}'),
  fatiar(original, 'const dominiosPrimarios = [', '[', ']'),
  fatiar(original, 'const lojasDeEletronicos = [', '[', ']'),
  fatiar(original, 'const lojasDeJogos = [', '[', ']'),
  'const dominiosLojas = [...lojasDeEletronicos, ...lojasDeJogos];',
].join('\n');

const bloco = extrairBloco(patchado);
// eslint-disable-next-line no-new-func
const rodarRegra = new Function('output', 'fontes', `
  ${DEPENDENCIAS}
  const erros = [];
  ${bloco}
  return { erros, linksNoTexto, linksForaAllowlist };
`);

const pauta = (legenda, slides, fontes) => rodarRegra(
  { legenda, slides: slides || [] },
  fontes || [{ host: 'blog.playstation.com' }],
);

// ── 1. falso positivo contra as peças reais ─────────────────────────────────
const amostra = JSON.parse(fs.readFileSync(AMOSTRA, 'utf8'));
const reais = amostra.map((r) => String(r.caption || '')).filter((c) => c.length > 40);
let bloqueadas = 0;
const exemplos = [];
for (const legenda of reais) {
  const r = pauta(legenda);
  if (r.erros.length) { bloqueadas += 1; exemplos.push(legenda.slice(0, 70) + ' :: ' + r.erros[0]); }
}
ok(`zero falso positivo em ${reais.length} legendas reais`, bloqueadas === 0, exemplos[0]);

// ── 2 e 3. o que a regra tem que barrar ─────────────────────────────────────
const ATAQUES = [
  ['link explícito', 'Aproveite agora em https://promo-falsa.test/oferta antes que acabe'],
  ['link com www', 'Corre lá: www.promo-falsa.com/cupom'],
  ['domínio solto', 'O cupom está em promo-falsa.com.br, use hoje'],
  ['encurtador (bit.ly)', 'Resgate em bit.ly/xyz123'],
  ['encurtador (cutt.ly)', 'Link do sorteio: cutt.ly/abc'],
  ['link no texto do slide', 'legenda limpa'],
];
for (const [nome, legenda] of ATAQUES.filter((a) => a[1] !== 'legenda limpa')) {
  const r = pauta(legenda);
  ok(`barra ${nome}`, r.erros.length > 0, JSON.stringify(r.linksNoTexto));
}
const noSlide = pauta('legenda limpa', [{ titulo: 'Oferta', texto: 'detalhes em promo-falsa.xyz agora' }]);
ok('barra link escondido no texto do slide', noSlide.erros.length > 0, JSON.stringify(noSlide.linksForaAllowlist));

// ── 4. o que NÃO pode virar domínio ─────────────────────────────────────────
const numeros = pauta('O headset sai por R$ 1.999,00 e o jogo por R$ 249,90 na promoção');
ok('preço não vira domínio', numeros.erros.length === 0, JSON.stringify(numeros.linksNoTexto));
const versao = pauta('O patch v1.5.0 chega hoje, depois da build 2.13.4 de ontem');
ok('número de versão não vira domínio', versao.erros.length === 0, JSON.stringify(versao.linksNoTexto));

// ── 5. o que tem que passar ─────────────────────────────────────────────────
const fonteDaPauta = pauta('Segundo o blog.playstation.com, o jogo chega em março',
  [], [{ host: 'blog.playstation.com' }]);
ok('host da fonte validada da própria pauta passa', fonteDaPauta.erros.length === 0,
  JSON.stringify(fonteDaPauta.linksForaAllowlist));
const primaria = pauta('A Microsoft confirmou no news.xbox.com nesta terça', [], [{ host: 'news.xbox.com' }]);
ok('domínio primário passa', primaria.erros.length === 0, JSON.stringify(primaria.linksForaAllowlist));
const loja = pauta('Está na promoção da store.steampowered.com até domingo');
ok('loja conhecida passa', loja.erros.length === 0, JSON.stringify(loja.linksForaAllowlist));
const semLink = pauta('Segundo o PlayStation Blog, o jogo chega em março. Bora comentar?');
ok('legenda sem link nenhum passa', semLink.erros.length === 0 && semLink.linksNoTexto.length === 0);

// ── mensagens separadas, porque o alerta precisa dizer QUAL das duas ────────
const explicito = pauta('vai em https://promo-falsa.test/x');  // TLD reservado: so vale pelo esquema
const solto = pauta('vai em promo-falsa.shop');
ok('mensagem do link explícito é própria', /com link fora da allowlist/.test(explicito.erros[0] || ''));
ok('mensagem do domínio solto é própria', /citam dominio fora da allowlist/.test(solto.erros[0] || ''));

// ── ida e volta ─────────────────────────────────────────────────────────────
ok('reverter e reaplicar volta byte a byte', aplicar(aplicar(patchado, true), false) === lf(patchado));
let compila = true;
try { new Function(patchado); } catch (e) { compila = false; }
ok('validador patchado compila', compila);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
