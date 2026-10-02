// Harness da foto do WordPress sem sufixo de miniatura (02/10/2026). Offline.
//
// A função é RECORTADA do código patchado do "Normalizar notícias" e executada — não
// reimplementada. O que precisa provar:
//   1. Miniatura abaixo do piso da capa (1000×675) perde o sufixo; acima, fica como está.
//   2. Nada fora de /wp-content/uploads/ é tocado; query e fragmento sobrevivem; aplicar duas
//      vezes não muda nada.
//   3. Bancada do validador (58 validações reais), simulando o acervo com a regra nova: mudam
//      EXATAMENTE as 6 reprovações por miniatura, todas para aprovado.
//   4. Ida e volta byte a byte.
//
//   node design/test_wordpress_original.cjs
const fs = require('fs');
const path = require('path');
const wp = require('./patch_wordpress_original.cjs');
const proc = require('./patch_validador_procedencia.cjs');
const cit = require('./patch_dominios_citaveis.cjs');
const bancada = require('./bancada_validador.cjs');

const DIR = path.join(__dirname, '..', 'workflows', 'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');
const normalizador = wp.lf(fs.readFileSync(path.join(DIR, 'normalizar-noticias-promolis.js'), 'utf8'));
const validador = proc.normalizar(cit.normalizar(wp.lf(fs.readFileSync(path.join(DIR, 'validar-antes-de-publicar.js'), 'utf8'))));

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};
console.log(normalizador.includes(wp.MARCA) ? '# o export JÁ tem a mudança — conferindo o que está no ar' : '# o export ainda não tem — conferindo a troca');
const novo = wp.normalizar(normalizador);
const f = wp.funcaoDoCodigo(novo);

// 1 e 2. a regra
const A = 'https://www.adrenaline.com.br/wp-content/uploads/';
const CASOS = [
  [A + '2025/08/persona-3-reload-768x480.webp', A + '2025/08/persona-3-reload.webp', 'miniatura 768x480 (caso real 745)'],
  [A + '2026/09/castlevania-40-anos-promocoes-jogo-gratis-mobile-768x480.jpg', A + '2026/09/castlevania-40-anos-promocoes-jogo-gratis-mobile.jpg', 'miniatura (caso real 758)'],
  [A + '2026/06/silent-hill-townfall-912x569.webp', A + '2026/06/silent-hill-townfall.webp', '912x569 fica abaixo do piso da capa: sai'],
  [A + '2026/09/the-witcher-2-1200x675.jpg', A + '2026/09/the-witcher-2-1200x675.jpg', '1200x675 já serve de capa: fica'],
  [A + '2026/09/foto-2048x1152.jpg', A + '2026/09/foto-2048x1152.jpg', 'grande: fica'],
  [A + '2026/09/foto-768x480.jpg?ver=2', A + '2026/09/foto.jpg?ver=2', 'query sobrevive'],
  ['https://files.tecnoblog.net/wp-content/uploads/2026/09/rtx-5090-1060x600.png', 'https://files.tecnoblog.net/wp-content/uploads/2026/09/rtx-5090.png', 'outro host de WordPress (1060x600: altura abaixo de 675)'],
  ['https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_ab.1920x1080.jpg', null, 'Steam (não é WordPress): intacta'],
  ['https://blog.playstation.com/tachyon/2026/09/x-768x480.jpg', null, 'sem /wp-content/uploads/: intacta'],
  ['https://www.adrenaline.com.br/wp-content/uploads/2026/09/sem-sufixo.jpg', null, 'sem sufixo: intacta'],
  ['https://www.adrenaline.com.br/wp-content/uploads/2026/09/RTX-4090x2.jpg', null, 'nome que só parece tamanho (4090x2 não casa extensão logo após): intacta'],
];
for (const [de, para, nome] of CASOS) {
  const r = f(de);
  ok(nome, r === (para === null ? de : para), r);
}
const { casos } = { casos: bancada.carregarCasos() };
const todas = new Set();
for (const c of casos) for (const m of JSON.stringify([c.entrada, c.contexto]).matchAll(/https:\/\/[^"\s\\]+\.(?:jpe?g|png|webp)(?:\?[^"\s\\]*)?/gi)) todas.add(m[0]);
const mudaram = [...todas].filter((u) => f(u) !== u);
ok(`só URL de /wp-content/uploads/ muda (${mudaram.length} de ${todas.size} URLs reais)`, mudaram.every((u) => /\/wp-content\/uploads\//.test(u)));
ok('aplicar duas vezes não muda nada', [...todas].every((u) => f(f(u)) === f(u)));

// 3. bancada
const RE = /https:\/\/[^"\s\\]+\/wp-content\/uploads\/[^"\s\\]+\.(?:jpe?g|png|webp)(?:\?[^"\s\\]*)?/gi;
const transformar = (s) => s.replace(RE, (u) => f(u));
const mudou = casos.filter((c) => !bancada.igual(bancada.rodar(validador, c), bancada.rodar(validador, c, { transformar })));
const ESPERADO = ['745/1', '745/2', '758/1', '758/2', '786/1', '786/2'];
ok(`na bancada, mudam exatamente as 6 reprovações por miniatura: ${ESPERADO.join(' ')}`,
  JSON.stringify(mudou.map(bancada.chave).sort()) === JSON.stringify(ESPERADO), mudou.map(bancada.chave).join(' '));
ok('todas de reprovado para aprovado',
  mudou.every((c) => bancada.rodar(validador, c).pauta_validada === false && bancada.rodar(validador, c, { transformar }).pauta_validada === true));

// 4. ida e volta
ok('reverter e reaplicar volta byte a byte', wp.aplicar(wp.aplicar(novo, true), false) === novo);
let doeu = false; try { wp.aplicar(novo, false); } catch (e) { doeu = true; }
ok('aplicar duas vezes é erro', doeu);
let compila = true; try { new Function('$', '$input', '$json', novo); } catch (e) { compila = false; }
ok('código do nó compila', compila);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
