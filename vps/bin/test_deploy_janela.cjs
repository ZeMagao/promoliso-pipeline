#!/usr/bin/env node
// Harness da trava de janela do deploy-vps.sh. Offline. Roda a funcao REAL `janela_bloqueada`,
// recortada do script, com o relogio simulado. Os casos sao os tres deploys que comeram rodada e o
// espelho de cada um que precisa passar.
//   node vps/bin/test_deploy_janela.cjs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const script = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy-vps.sh'), 'utf8').split('\r\n').join('\n');
const ini = script.indexOf('janela_bloqueada() {');
const fim = script.indexOf('\n}\n', ini);
if (ini < 0 || fim < 0) { console.log('FALHA função janela_bloqueada não encontrada no deploy-vps.sh'); process.exit(1); }
const funcao = script.slice(ini, fim + 2);

let falhas = 0;
function caso(nome, h, m, d, esperado) {
  let r;
  try { execFileSync('bash', ['-c', funcao + `\njanela_bloqueada ${h} ${m} ${d} >/dev/null`]); r = 'bloqueia'; }
  catch (e) { r = 'libera'; }
  const bom = r === esperado;
  console.log((bom ? 'PASS  ' : 'FALHA ') + nome + (bom ? '' : `  -> deu ${r}`));
  if (!bom) falhas += 1;
}
caso('02/10 18:00 sex (comeu o produtor das 18:00)', 18, 0, 5, 'bloqueia');
caso('17/09 22:00 qua (comeu o produtor das 22:00)', 22, 0, 3, 'bloqueia');
caso('agosto 12:30 (comeu o slot do publicador)', 12, 30, 4, 'bloqueia');
caso('17:55: o produtor das 18:00 está chegando', 17, 55, 5, 'bloqueia');
caso('18:09: o produtor ainda pode estar rodando', 18, 9, 5, 'bloqueia');
caso('16:30 de sexta (publicador)', 16, 30, 5, 'bloqueia');
caso('16:30 de segunda (sem slot): libera', 16, 30, 1, 'libera');
caso('18:15: livre', 18, 15, 5, 'libera');
caso('13:10: livre (a janela usada hoje)', 13, 10, 5, 'libera');
caso('17:49: ainda livre', 17, 49, 5, 'libera');
caso('07:55: o produtor começa às 08:00', 7, 55, 1, 'bloqueia');
caso('23:55: o produtor não roda à meia-noite', 23, 55, 1, 'libera');
caso('00:05: madrugada livre', 0, 5, 1, 'libera');
caso('20:25: publicador das 20:30', 20, 25, 6, 'bloqueia');

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
