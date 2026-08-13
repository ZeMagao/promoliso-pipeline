// Harness do "agente anuncia e não entrega". Offline.
//
// LEIA ISTO ANTES DE CONFIAR NO VERDE: este harness NÃO prova que o problema acabou. Comportamento
// de modelo não se prova offline. Ele prova que a mudança entrou, que nada mais mudou e que o
// prompt continua coerente. A prova de verdade é contar "JSON editorial malformado" nas próximas
// execuções e comparar com as 7 de hoje.
//
//   node design/test_agente_entrega.cjs
const fs = require('fs');
const path = require('path');
const { trocarPrompt, trocarOpcoes, DE_ITER, PARA_ITER, ANCORA, REGRA } = require('./patch_agente_entrega.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const prompt = fs.readFileSync(path.join(WFDIR, 'ai-agent.prompt.md'), 'utf8').split('\r\n').join('\n');
const APLICADO = prompt.includes('P0.15');
console.log(APLICADO ? '# export JÁ tem o orçamento de pesquisa — verificando o que está no ar'
                     : '# export ainda não tem — verificando a troca');

let novo;
if (APLICADO) {
  novo = prompt;
  let re = null;
  try { trocarPrompt(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação no prompt', /já aplicado/.test(String(re)), re);
} else {
  let erro = null;
  try { novo = trocarPrompt(prompt); } catch (e) { erro = e.message; }
  ok('a regra entra no prompt', Boolean(novo), erro);
  if (!novo) { console.log('\n1 FALHA(S)'); process.exit(1); }
  let re = null;
  try { trocarPrompt(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação no prompt', /já aplicado/.test(String(re)), re);
}

// ---- a regra diz o que precisa dizer ----
ok('proíbe terminar anunciando', /NUNCA termine anunciando o que vai fazer/.test(novo));
ok('cita as frases exatas que apareceram na falha real',
  /vou escrever agora/i.test(novo) && /agora vou estruturar os slides/i.test(novo));
ok('manda a última mensagem ser o JSON', /última mensagem tem de ser o objeto JSON/.test(novo));
ok('dá saída honesta quando o orçamento acaba', /aprovado_para_publicar false e o motivo/.test(novo));
ok('avisa que a resposta final consome um passo', /resposta final consome um deles/.test(novo));
ok('o número do prompt bate com o maxIterations do nó',
  new RegExp('máximo de ' + ({ 10: 'dez' }[PARA_ITER] || PARA_ITER) + ' passos').test(novo)
  || new RegExp('máximo ' + ({ 10: 'dez' }[PARA_ITER] || PARA_ITER) + ' passos').test(novo),
  'o prompt precisa citar o mesmo teto do nó, senão viram duas cópias divergindo');

// ---- o resto do prompt não pode ter sido tocado ----
{
  // remove exatamente o que foi inserido — regex aqui erra por um \n e o teste vira ruído
  const semRegra = novo.split(REGRA + '\n').join('');
  ok('fora a regra nova, o prompt é o mesmo', semRegra === prompt || APLICADO,
    'tamanho antes ' + prompt.length + ', depois de remover a regra ' + semRegra.length);
  ok('a âncora continua existindo uma vez só', novo.split(ANCORA).length - 1 === 1);
  for (const secao of ['## Formato JSON obrigatório', '## Categorias', '## Legenda',
    '## Frequência e janela extraordinária PromoLiso P0.12', '## Duas formas de OFERTA PromoLiso P0.14']) {
    ok(`seção preservada: ${secao}`, novo.includes(secao));
  }
}

// ---- as opções do nó ----
{
  const antes = { maxIterations: DE_ITER, batching: { batchSize: 1, delayBetweenBatches: 3000 } };
  const depois = trocarOpcoes(antes);
  ok(`maxIterations vai de ${DE_ITER} para ${PARA_ITER}`, depois.maxIterations === PARA_ITER);
  ok('o batching não é tocado', JSON.stringify(depois.batching) === JSON.stringify(antes.batching));
  ok('o objeto original não é mutado', antes.maxIterations === DE_ITER);

  let re = null;
  try { trocarOpcoes(depois); } catch (e) { re = e.message; }
  ok('recusa reaplicação nas opções', /já está em/.test(String(re)), re);

  let outro = null;
  try { trocarOpcoes({ maxIterations: 3 }); } catch (e) { outro = e.message; }
  ok('aborta se produção não tiver o valor esperado', /alguém mexeu/.test(String(outro)), outro);
}

console.log('\nLEMBRETE: verde aqui NÃO quer dizer problema resolvido.');
console.log('A prova é contar "JSON editorial malformado" nas proximas execucoes (hoje: 7 em 40).');
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
