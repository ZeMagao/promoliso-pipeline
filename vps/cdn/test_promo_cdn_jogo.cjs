#!/usr/bin/env node
// Harness da identificação de jogo do promo-cdn. Offline: não fala com a Steam.
//
// O que precisa provar — a assimetria aqui é de propósito. Errar para MENOS custa uma peça com
// menos slides; errar para MAIS coloca foto de outro jogo numa notícia, que é mentira publicada.
//   1. Manchete de jogo confirma o nome que a Steam devolveu.
//   2. Manchete que NÃO é sobre um jogo único (leva de Game Pass, promoção de loja, hardware)
//      recusa, mesmo quando a Steam devolve algum jogo.
//   3. A escada de prefixos gera termos do maior para o menor, começando pela cabeça da manchete
//      — foi mandar a manchete inteira que devolveu vazio em 39 de 40 pautas reais.
//
//   node vps/cdn/test_promo_cdn_jogo.cjs
const { confirmaNome, termosDaManchete, normal } = require('./promo-cdn.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
}

// ── confirmações que TÊM que passar (manchetes reais, nomes reais da Steam) ──
const DEVE_CONFIRMAR = [
  ['Gears of War: E-Day', 'Gears of War: E-Day vai ouro, libera pré-instalação em 29/09 e detalha PC'],
  ['SILENT HILL: Townfall', 'Silent Hill: Townfall detalha recursos exclusivos do PS5 antes do lançamento'],
  ['Wo Long 2: Wings of Ember', 'Wo Long 2: Wings of Ember confirma data de lançamento e libera demo'],
  ['RuneScape: Dragonwilds', 'RuneScape: Dragonwilds chega ao Xbox Game Pass em 15 de setembro'],
  ['ELDEN RING', 'Elden Ring Tarnished Edition chega ao Nintendo Switch 2 em 28 de agosto'],
  ["No Man's Sky", "No Man's Sky completa 10 anos e Hello Games anuncia atualização"],
  ['KINGDOM HEARTS IV', 'Kingdom Hearts 4 confirmado para 2027, sem atraso segundo Nomura'],
];
for (const [steam, manchete] of DEVE_CONFIRMAR) {
  ok(`confirma "${steam.slice(0, 26)}"`, confirmaNome(steam, manchete));
}

// ── recusas que TÊM que acontecer ────────────────────────────────────────────
// Estas são o ponto do harness: a Steam devolve ALGUMA coisa para quase qualquer busca.
const DEVE_RECUSAR = [
  ['Cyberpunk 2077', 'Game Pass: confira os jogos que estão chegando e saindo na segunda leva'],
  ['Helldivers 2', 'PlayStation Plus Game Catalog de agosto traz Kingdom Come: Deliverance II e mais'],
  ['Counter-Strike 2', 'Monitor LG UltraGear 24G411A-B com preço reduzido na loja oficial'],
  ['Steam Deck', 'Promoção Preparar, Apontar, Jogar na PS Store com mais de 4.500 ofertas'],
  ['GTA V', 'Vazamento de gameplay e mapa de GTA 6 leva Take-Two a emitir DMCA'],
  ['Halo', 'Xbox Wire libera intel antecipado de Modern Warfare 4 antes da Call of Duty Next'],
  ['Forza', 'AMD Ryzen 9 9950X3D com 15% de desconto na Amazon Brasil'],
];
for (const [steam, manchete] of DEVE_RECUSAR) {
  ok(`recusa "${steam}" em "${manchete.slice(0, 34)}..."`, !confirmaNome(steam, manchete));
}

// Casos de fronteira do confirmador
ok('nome curto demais não confirma', !confirmaNome('GTA', 'GTA 6 ganha trailer'));
ok('um token só não confirma por token', !confirmaNome('Control', 'Controle do PS5 ganha nova cor'));
ok('acento não atrapalha', confirmaNome('Pokemon Legends', 'Pokémon Legends chega em março'));
ok('marca registrada não atrapalha', confirmaNome('HELLDIVERS™ 2', 'Helldivers 2 recebe atualização'));

// ── escada de prefixos ───────────────────────────────────────────────────────
const termos = termosDaManchete('Gears of War: E-Day vai ouro, libera pré-instalação em 29/09');
ok('a escada começa pela manchete inteira (até 8 palavras)', termos[0].split(' ').length === 8, termos[0]);
ok('a escada desce até 2 palavras', termos[termos.length - 1].split(' ').length === 2, termos[termos.length - 1]);
ok('a escada contém o nome exato do jogo',
  termos.some((t) => normal(t) === normal('Gears of War: E-Day')), termos.join(' | '));
ok('corta no travessão', termosDaManchete('Elden Ring — novo DLC')[0] === 'Elden Ring');
ok('corta na barra vertical', termosDaManchete('RuneScape: Dragonwilds | 15 September')[0] === 'RuneScape: Dragonwilds');
ok('não corta em dois-pontos de subtítulo com maiúscula',
  termosDaManchete('Gears of War: E-Day vai ouro')[0].includes('E-Day'));

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
