#!/usr/bin/env node
// Harness da repescagem. Offline: nem banco, nem Telegram.
//
// Cada caso aqui é um que aconteceu na semana de 25/09 a 02/10, ou o espelho dele que NÃO pode
// disparar. Uma repescagem errada é pior que nenhuma: devolveria à disputa pauta que o validador
// reprovou de propósito, ou ressuscitaria a mesma pauta quebrada rodada após rodada.
//
//   node vps/bin/test_promo_repescagem.cjs
const { decidir, montarMensagem, SUFIXO } = require('./promo-repescagem.cjs');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

const H = 3600 * 1000;
const agora = Date.parse('2026-10-02T21:00:00Z');
const HADES = 'https://gameblast.com.br/2026/09/hades-ballads-of-underworld-concerto-orquestrado-e-disponibilizado-gratuitamente-no-youtube.html';
const exec = (id, extra) => Object.assign({ id: String(id), status: 'error', parou_em: agora - 1 * H, validou: true, ultimo_no: 'Convert HTML to JPEG image1' }, extra || {});
const linha = (id, idExec, chave, extra) => Object.assign({ id, id_execucao: String(idExec), status_aprovacao: 'APROVADO', curation_key: chave, titulo: 'Hades: Ballads of the Underworld' }, extra || {});
const rodar = (execs, linhas, chaves, janelaH, vistos) => decidir(execs, linhas, new Set(chaves || linhas.map((l) => l.curation_key)), agora, janelaH || 6, vistos);

// 1. o caso real: exec 763, capa morreu depois de validar
const r1 = rodar([exec(763)], [linha(1893, 763, HADES)]);
ok('capa morreu depois de validar: repesca', r1.repescar.length === 1 && r1.desistir.length === 0);
ok('a chave nova é a antiga + sufixo + exec', r1.repescar[0] && r1.repescar[0].chave_nova === HADES + SUFIXO + '763');
ok('a chave antiga deixa de existir na tabela (é isso que faz a dedup soltar)', r1.repescar[0] && r1.repescar[0].chave_nova !== HADES);

// 2. o que NÃO pode repescar
ok('rodada que deu certo: nada', rodar([exec(800, { status: 'success' })], [linha(1, 800, 'k1')]).repescar.length === 0);
ok('morreu ANTES de validar (validador nem aprovou): nada',
  rodar([exec(752, { validou: false, ultimo_no: 'AI Agent' })], [linha(2, 752, 'k2')]).repescar.length === 0);
ok('pauta que só não foi escolhida (CANDIDATO): nada',
  rodar([exec(763)], [linha(3, 763, 'k3', { status_aprovacao: 'CANDIDATO' })]).repescar.length === 0);
ok('linha de outra execução: nada', rodar([exec(763)], [linha(4, 999, 'k4')]).repescar.length === 0);
ok('fora da janela de 6 h (notícia já saiu do feed): nada',
  rodar([exec(763, { parou_em: agora - 7 * H })], [linha(5, 763, 'k5')]).repescar.length === 0);
ok('a mesma janela alargada alcança (é o que o --janela-h da prova usa)',
  rodar([exec(763, { parou_em: agora - 7 * H })], [linha(5, 763, 'k5')], null, 200).repescar.length === 1);
ok('execução já vista numa passada anterior: nada (sem aviso repetido)',
  rodar([exec(763)], [linha(6, 763, 'k6')], null, 6, new Set(['763'])).repescar.length === 0);
ok('linha que já é a repescada (chave com sufixo): nada',
  rodar([exec(900)], [linha(7, 900, HADES + SUFIXO + '763')]).repescar.length === 0);
ok('linha sem chave: nada', rodar([exec(763)], [linha(8, 763, '')]).repescar.length === 0);

// 3. uma vez só: morreu de novo depois de repescada
const segunda = rodar([exec(780)], [linha(9, 780, HADES)], [HADES, HADES + SUFIXO + '763']);
ok('repescada que morre de novo: não volta', segunda.repescar.length === 0 && segunda.desistir.length === 1);
// o prefixo tem que ser a chave INTEIRA: uma URL que começa igual não conta como repescada
const parecida = rodar([exec(781)], [linha(10, 781, 'https://x.com/a')], ['https://x.com/a', 'https://x.com/ab' + SUFIXO + '1']);
ok('chave que só começa parecido não bloqueia', parecida.repescar.length === 1);

// 4. várias mortes na mesma passada (796 e 799 morreram com 2 h de diferença)
const duas = rodar([exec(796, { parou_em: agora - 3 * H }), exec(799, { parou_em: agora - 1 * H })],
  [linha(1974, 796, 'k-grave'), linha(1980, 799, 'k-cod')]);
ok('duas mortes na mesma passada: as duas voltam', duas.repescar.length === 2);

// 5. a mensagem
const msg = montarMensagem(r1);
ok('mensagem diz qual rodada, onde morreu e qual pauta volta',
  /763/.test(msg) && /Convert HTML to JPEG image1/.test(msg) && /Hades/.test(msg) && /volta/.test(msg));
ok('mensagem do "morreu de novo" é outra, e diz que não volta', /não volta/.test(montarMensagem(segunda)));
ok('nada a fazer: mensagem vazia (não manda push à toa)', montarMensagem({ repescar: [], desistir: [] }) === '');

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
