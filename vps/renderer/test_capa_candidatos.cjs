#!/usr/bin/env node
// Harness dos candidatos de imagem do renderizador. Offline: não baixa nada.
//
// POR QUE EXISTE: em 24/09 uma URL do `news.xbox.com` que redireciona para si mesma (50 saltos,
// zero byte) derrubou a rodada inteira do produtor — a capa é obrigatória e o render abortava na
// primeira imagem que falhasse. A pauta se perdeu, porque já estava marcada como processada na
// curadoria. Os slides tinham fallback no fluxo do n8n; a capa não tinha nenhum.
//
// O que precisa provar:
//   1. Quando a primária responde, é ela que entra — fallback não pode "melhorar" nada sozinho.
//   2. Quando a primária falha, entra o primeiro candidato que responder.
//   3. Quando TODAS falham, o erro sai com a lista do que foi tentado — senão o diagnóstico vira
//      adivinhação, que é exatamente o que custou caro em 24/09.
//   4. Imagem sem `data-fallback` continua se comportando como antes.
//   5. O limite de 10 imagens por peça continua valendo.
//
//   node vps/renderer/test_capa_candidatos.cjs
const { candidatosDaTag, primeiraQueResponde, alvosDoHtml } = require('./candidatos.cjs');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

const A = 'https://res.cloudinary.com/fy2n2qvr/image/fetch/f_auto/aaa.jpg';
const B = 'https://res.cloudinary.com/fy2n2qvr/image/fetch/f_auto/bbb.jpg';
const C = 'https://res.cloudinary.com/fy2n2qvr/image/fetch/f_auto/ccc.jpg';

// ── leitura da tag ──────────────────────────────────────────────────────────
const comFallback = candidatosDaTag(`<img class="capa" src="${A}" data-fallback="${B} ${C}" alt="x">`);
ok('lê a primária', comFallback && comFallback.primaria === A);
ok('lê os candidatos na ordem', JSON.stringify(comFallback.candidatos) === JSON.stringify([A, B, C]));

const semFallback = candidatosDaTag(`<img src="${A}">`);
ok('sem data-fallback, só a primária', JSON.stringify(semFallback.candidatos) === JSON.stringify([A]));

const repetida = candidatosDaTag(`<img src="${A}" data-fallback="${A} ${B}">`);
ok('candidato repetido não duplica', JSON.stringify(repetida.candidatos) === JSON.stringify([A, B]));

const semSrc = candidatosDaTag('<img data-fallback="' + B + '" alt="sem src">');
ok('tag sem src é ignorada', semSrc === null);

const naoHttps = candidatosDaTag('<img src="http://inseguro.test/x.jpg">');
ok('src http:// não é aceito', naoHttps === null);

const fallbackSujo = candidatosDaTag(`<img src="${A}" data-fallback="javascript:alert(1) ${B}">`);
ok('candidato que não é https é descartado',
  JSON.stringify(fallbackSujo.candidatos) === JSON.stringify([A, B]), JSON.stringify(fallbackSujo.candidatos));

// ── escolha entre candidatos, com um buscador falso ─────────────────────────
// `primeiraQueResponde` fala com a rede de verdade; aqui a lógica é exercitada com um fetcher
// injetado, para o teste medir a REGRA e não a internet.
const escolher = (candidatos, quemResponde) => primeiraQueResponde(candidatos, async (url) => {
  if (!quemResponde.includes(url)) throw new Error('origem nao respondeu');
  return 'data:image/jpeg;base64,' + url.slice(-7);
});

(async () => {
  const primariaOk = await escolher([A, B, C], [A, B, C]);
  ok('primária respondendo é a escolhida', primariaOk.url === A);

  const caiuPraB = await escolher([A, B, C], [B, C]);
  ok('primária morta cai para o próximo candidato', caiuPraB.url === B);

  const caiuPraC = await escolher([A, B, C], [C]);
  ok('cai até o último candidato se preciso', caiuPraC.url === C);

  let erro = null;
  try { await escolher([A, B, C], []); } catch (e) { erro = e.message; }
  ok('todas falhando vira erro', !!erro);
  ok('o erro diz o que foi tentado', erro.includes('aaa') && erro.includes('bbb') && erro.includes('ccc'), erro);

  // ── varredura do HTML ──────────────────────────────────────────────────────
  const html = `<div><img src="${A}" data-fallback="${B}"><img src="https://outro.cdn/x.jpg"></div>`;
  const alvos = alvosDoHtml(html);
  ok('só imagem do nosso Cloudinary entra na inlinagem', alvos.length === 1 && alvos[0].primaria === A);
  ok('e ela leva o candidato junto', JSON.stringify(alvos[0].candidatos) === JSON.stringify([A, B]));
  const muitas = alvosDoHtml(Array.from({ length: 11 }, (_, i) => `<img src="${A}${i}">`).join(''));
  ok('HTML com 11 imagens é detectado (o teto de 10 é do chamador)', muitas.length === 11);

  console.log('');
  console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
  process.exit(falhas ? 1 : 0);
})();
