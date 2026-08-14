// Harness do retry na publicação. Offline.
//
//   node design/test_publish_retry.cjs
const { aplicar, ALVOS, RETRY } = require('./patch_publish_retry.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const mundo = () => [
  { name: 'Selecionar READY', type: 'n8n-nodes-base.code', parameters: {} },
  { name: 'Create a carousel post', type: 'n8n-nodes-instagram-integrations.instagram', parameters: {}, onError: 'continueErrorOutput' },
  { name: 'Consultar status 1', type: 'n8n-nodes-instagram-integrations.instagram', parameters: {} },
  { name: 'Publish a post', type: 'n8n-nodes-instagram-integrations.instagram', parameters: {}, onError: 'continueErrorOutput' },
  { name: 'Create a story', type: 'n8n-nodes-instagram-integrations.instagram', parameters: {}, onError: 'continueRegularOutput' },
];

const nodes = mundo();
let erro = null;
try { aplicar(nodes); } catch (e) { erro = e.message; }
ok('o patch aplica', !erro, erro);
if (erro) { console.log('\n1 FALHA(S)'); process.exit(1); }

for (const nome of ALVOS) {
  const n = nodes.find((x) => x.name === nome);
  ok(`[${nome}] ganhou 3 tentativas com 5 s`,
    n.retryOnFail === true && n.maxTries === 3 && n.waitBetweenTries === 5000);
  ok(`[${nome}] mantém o ramo de erro (o alerta tem que continuar existindo)`,
    n.onError === 'continueErrorOutput');
}

// o que NÃO pode ter sido tocado
{
  const consulta = nodes.find((x) => x.name === 'Consultar status 1');
  ok('nós de consulta não foram tocados', consulta.retryOnFail === undefined);
  const story = nodes.find((x) => x.name === 'Create a story');
  ok('o story não foi tocado', story.retryOnFail === undefined && story.onError === 'continueRegularOutput');
}

// reaplicação e guardas
{
  let re = null;
  try { aplicar(nodes); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já tem retry/.test(String(re)), re);

  const trocado = mundo();
  trocado.find((n) => n.name === 'Create a carousel post').type = 'n8n-nodes-base.httpRequest';
  let e2 = null;
  try { aplicar(trocado); } catch (e) { e2 = e.message; }
  ok('aborta se o nó não for do Instagram', /não é nó do Instagram/.test(String(e2)), e2);

  const semNo = mundo().filter((n) => n.name !== 'Publish a post');
  let e3 = null;
  try { aplicar(semNo); } catch (e) { e3 = e.message; }
  ok('aborta se um dos nós sumiu', /nó não achado/.test(String(e3)), e3);
}

console.log('\nNOTA: retry cobre o tropeço, não a falha real. Quando as 3 tentativas falharem, a peça');
console.log('ainda vai para FAILED e o alerta sai — devolver para READY e uma decisao a parte.');
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
