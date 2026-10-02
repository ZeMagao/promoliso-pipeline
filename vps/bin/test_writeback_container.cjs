#!/usr/bin/env node
// Harness do contêiner do carrossel no writeback (02/10/2026). Offline.
//
// A função é RECORTADA do promo-fila-writeback.cjs e executada (o script abre o banco ao carregar,
// então não dá para dar require nele aqui). O que precisa provar:
//   1. Acha o id nos nós de hoje ("Carrossel 02".."Carrossel 10") e no nome antigo.
//   2. Só a saída de sucesso conta: item de erro (main[1]) ou sem id não vira contêiner.
//   3. Nós de outro tipo com nome parecido não contam.
//
//   node vps/bin/test_writeback_container.cjs
const fs = require('fs');
const path = require('path');

const codigo = fs.readFileSync(path.join(__dirname, '..', '..', 'promo-fila-writeback.cjs'), 'utf8');
const ini = codigo.indexOf('const NO_CARROSSEL');
const fim = codigo.indexOf('\n}\n', codigo.indexOf('function containerDoCarrossel'));
if (ini < 0 || fim < 0) { console.log('FALHA função containerDoCarrossel não encontrada'); process.exit(1); }
// eslint-disable-next-line no-new-func
const containerDoCarrossel = new Function(codigo.slice(ini, fim + 2) + '\nreturn containerDoCarrossel;')();

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};
const sucesso = (json) => [{ data: { main: [[{ json }], []] } }];
const erro = (json) => [{ data: { main: [[], [{ json }]] } }];

ok('Carrossel 06 (forma de hoje)', containerDoCarrossel({ 'Selecionar READY': sucesso({}), 'Carrossel 06': sucesso({ id: '18109290101183918' }) }) === '18109290101183918');
ok('Carrossel 04 (outro tamanho)', containerDoCarrossel({ 'Carrossel 04': sucesso({ id: '111' }) }) === '111');
ok('Carrossel 10', containerDoCarrossel({ 'Carrossel 10': sucesso({ id: '222' }) }) === '222');
ok('nome antigo (execuções até 17/08)', containerDoCarrossel({ 'Create a carousel post': sucesso({ id: '333' }) }) === '333');
ok('saída de erro não vira contêiner', containerDoCarrossel({ 'Carrossel 06': erro({ error: 'Bad request' }) }) === undefined);
ok('item sem id não vira contêiner', containerDoCarrossel({ 'Carrossel 06': sucesso({ error: 'x' }) }) === undefined);
ok('retry: vale a última passada', containerDoCarrossel({ 'Carrossel 06': [{ data: { main: [[{ json: { id: 'velho' } }]] } }, { data: { main: [[{ json: { id: 'novo' } }]] } }] }) === 'novo');
ok('"Carrossel pronto 1?" não conta', containerDoCarrossel({ 'Carrossel pronto 1?': sucesso({ id: 'x' }) }) === undefined);
ok('"Consultar status 1" não conta', containerDoCarrossel({ 'Consultar status 1': sucesso({ id: 'x' }) }) === undefined);
ok('sem runData: nada', containerDoCarrossel(undefined) === undefined);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
