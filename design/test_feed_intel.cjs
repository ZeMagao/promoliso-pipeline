// Harness da troca do feed da Intel. Offline: prova que SÓ a url muda e que o patch não aplica em
// cima de estado desconhecido.
//   node design/test_feed_intel.cjs
const { aplicar, NO, ANTIGA, NOVA } = require('./patch_feed_intel.cjs');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};
// a forma exata do nó em produção (lida do banco em 02/10)
const molde = () => [
  { id: 'x', name: NO, type: 'n8n-nodes-base.rssFeedRead', typeVersion: 1.2, position: [0, 0],
    parameters: { url: ANTIGA, options: {} }, onError: 'continueRegularOutput', retryOnFail: true },
  { name: 'Feed oficial NVIDIA Gaming', type: 'n8n-nodes-base.rssFeedRead', parameters: { url: 'https://x/feed' } },
];
const semUrl = (n) => JSON.stringify(Object.assign({}, n, { parameters: Object.assign({}, n.parameters, { url: null }) }));

const nos = molde();
aplicar(nos, false);
ok('url vira a do game.intel.com', nos[0].parameters.url === NOVA);
ok('nada além da url muda no nó (nome, retry, onError, typeVersion)', semUrl(nos[0]) === semUrl(molde()[0]));
ok('os outros feeds não são tocados', JSON.stringify(nos[1]) === JSON.stringify(molde()[1]));
let doeu = false; try { aplicar(nos, false); } catch (e) { doeu = true; }
ok('aplicar duas vezes é erro', doeu);
const mexido = molde(); mexido[0].parameters.url = 'https://outra.coisa/feed';
let recusou = false; try { aplicar(mexido, false); } catch (e) { recusou = /esperava/.test(e.message); }
ok('url desconhecida no nó: aborta em vez de sobrescrever', recusou);
aplicar(nos, true);
ok('reverter volta byte a byte', JSON.stringify(nos) === JSON.stringify(molde()));
ok('o host novo continua reconhecido como Intel (sufixo intel.com)', /(^|\.)intel\.com$/.test(new URL(NOVA).hostname));

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
