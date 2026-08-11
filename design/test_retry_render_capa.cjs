// Harness do retry da capa. Este patch mexe em propriedades do NÓ, não em jsCode — então o que
// se cobra é: mexeu no nó certo, com os valores certos, e em NADA além disso.
//
//   node design/test_retry_render_capa.cjs
const { aplicar, NO, RETRY } = require('./patch_retry_render_capa.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}
const tenta = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e.message }; } };

// Réplica da forma que os nós têm em produção (conferida contra o banco do VPS em 11/08).
const nodesBase = () => [
  { name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} },
  { name: 'Code in JavaScript1', type: 'n8n-nodes-base.code', parameters: { jsCode: '// capa' } },
  {
    name: 'Convert HTML to JPEG image',
    type: 'n8n-nodes-base.httpRequest',
    onError: 'continueRegularOutput',
    parameters: { url: 'http://127.0.0.1:5680/render', options: { timeout: 30000 } },
  },
  {
    name: 'Convert HTML to JPEG image1',
    type: 'n8n-nodes-base.httpRequest',
    parameters: { url: 'http://127.0.0.1:5680/render', options: { timeout: 30000 } },
  },
];

// ---- 1. caminho feliz ----
{
  const nodes = nodesBase();
  const antesTudo = JSON.stringify(nodes);
  const r = tenta(() => aplicar(nodes));
  ok('aplica sem erro', Boolean(r.ok), r.erro);

  const alvo = nodes.find((n) => n.name === NO);
  ok('liga retryOnFail', alvo.retryOnFail === true);
  ok('maxTries = 3', alvo.maxTries === 3, String(alvo.maxTries));
  ok('waitBetweenTries = 5000', alvo.waitBetweenTries === 5000, String(alvo.waitBetweenTries));
  ok('NÃO adiciona onError (sem fallback, capa quebrada é pior)', alvo.onError === undefined, alvo.onError);
  ok('não toca na url nem no timeout',
    alvo.parameters.url === 'http://127.0.0.1:5680/render' && alvo.parameters.options.timeout === 30000);
  ok('relata o antes/depois', r.ok && r.ok.antes.retryOnFail === undefined && r.ok.depois.retryOnFail === true);

  // nenhum outro nó pode ter mudado
  const antes = JSON.parse(antesTudo);
  const outrosIguais = antes.every((n, i) => n.name === NO || JSON.stringify(n) === JSON.stringify(nodes[i]));
  ok('nenhum outro nó muda', outrosIguais);
  const slide = nodes.find((n) => n.name === 'Convert HTML to JPEG image');
  ok('o renderizador do slide fica intacto',
    slide.onError === 'continueRegularOutput' && slide.retryOnFail === undefined);
}

// ---- 2. reaplicação ----
{
  const nodes = nodesBase();
  aplicar(nodes);
  const r = tenta(() => aplicar(nodes));
  ok('recusa reaplicação', /já ligado/.test(String(r.erro)), r.erro);
  const alvo = nodes.find((n) => n.name === NO);
  ok('reaplicação não duplica nem altera valores', alvo.maxTries === 3 && alvo.waitBetweenTries === 5000);
}

// ---- 3. guardas: o patch tem que abortar se o alvo não for o que se espera ----
{
  const semNo = nodesBase().filter((n) => n.name !== NO);
  ok('aborta se o nó sumiu', /não achado/.test(String(tenta(() => aplicar(semNo)).erro)));

  const tipoErrado = nodesBase();
  tipoErrado.find((n) => n.name === NO).type = 'n8n-nodes-base.code';
  ok('aborta se o tipo mudou', /esperava httpRequest/.test(String(tenta(() => aplicar(tipoErrado)).erro)));

  const urlErrada = nodesBase();
  urlErrada.find((n) => n.name === NO).parameters.url = 'https://api.externa.com/render';
  ok('aborta se a url não é a do renderizador', /não aponta pro renderizador/.test(String(tenta(() => aplicar(urlErrada)).erro)));

  const semUrl = nodesBase();
  delete semUrl.find((n) => n.name === NO).parameters.url;
  ok('aborta se a url sumiu', /não aponta pro renderizador/.test(String(tenta(() => aplicar(semUrl)).erro)));
}

// ---- 4. os valores escolhidos cabem no orçamento da execução ----
{
  const ABORT_RENDERER = 12000;   // IMAGE_FETCH_TIMEOUT_MS do renderer
  const TIMEOUT_NO = 30000;       // options.timeout do nó HTTP
  ok('cada tentativa cabe no timeout do nó', ABORT_RENDERER < TIMEOUT_NO);
  const pior = RETRY.maxTries * ABORT_RENDERER + (RETRY.maxTries - 1) * RETRY.waitBetweenTries;
  ok('pior caso abaixo de 60s (rodada do produtor leva 2-3 min)', pior < 60000, pior + 'ms');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
