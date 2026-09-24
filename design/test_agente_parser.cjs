// Harness de ligar o output parser ao agente. Offline.
//
// O que precisa provar:
//   1. O parser passa a sair para o agente como ai_outputParser, e o agente aceita.
//   2. O esquema do parser deixa de ser a terceira cópia divergente: ganha tipo/validade/desconto
//      e continua sendo JSON válido.
//   3. O esquema e o PROMPT falam dos mesmos campos de oferta — foi a divergência entre cópias que
//      custou semanas em 05/08, e o esquema é a cópia que ninguém estava olhando.
//   4. O que já existia no agente (modelo, ferramentas, saída principal) não é tocado.
//   5. Topologia inesperada ABORTA em vez de adivinhar.
//
//   node design/test_agente_parser.cjs
const fs = require('fs');
const path = require('path');
const { aplicar, trocarEsquema, AGENTE, PARSER } = require('./patch_agente_parser.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

// esquema como está em produção hoje (sem os campos de evento)
const ESQUEMA_HOJE = JSON.stringify({
  aprovado_para_publicar: true,
  motivo_reprovacao: '',
  tema: 'Nome objetivo do assunto',
  categoria: 'NOTICIA',
  oferta: {
    produto: '', variante: '', loja: '', preco_atual: '', preco_referencia: '',
    condicao_pagamento: '', cupom: '', disponibilidade: '', url: '',
  },
  capa: 'https://exemplo.com/imagem-oficial.jpg',
  slides: [{ tipo: 'capa', selo: 'BREAK NEWS', titulo: 'T', destaque: 'D', texto: 't', subtitulo: 's', imagem: 'https://exemplo.com/1.jpg', fonte_imagem: 'OFICIAL' }],
  legenda: 'Legenda',
}, null, 2);

function mundo() {
  const nodes = [
    { name: AGENTE, type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3, position: [0, 0], id: 'a1',
      parameters: { promptType: 'define', text: '=Pesquise e produza', options: { maxIterations: 10, systemMessage: '# prompt' } },
      onError: 'continueRegularOutput' },
    { name: PARSER, type: '@n8n/n8n-nodes-langchain.outputParserStructured', typeVersion: 1.3, position: [200, 200], id: 'p1',
      parameters: { jsonSchemaExample: ESQUEMA_HOJE } },
    { name: 'GPT 5.4 mini', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', typeVersion: 1.3, position: [0, 200], id: 'm1', parameters: {} },
    { name: 'Pensar', type: '@n8n/n8n-nodes-langchain.toolThink', typeVersion: 1, position: [100, 200], id: 't1', parameters: {} },
  ];
  const connections = {
    'GPT 5.4 mini': { ai_languageModel: [[{ node: AGENTE, type: 'ai_languageModel', index: 0 }]] },
    Pensar: { ai_tool: [[{ node: AGENTE, type: 'ai_tool', index: 0 }]] },
    [AGENTE]: { main: [[{ node: 'Validar antes de publicar', type: 'main', index: 0 }]] },
  };
  return { nodes, connections };
}

// ---- 1 e 4 ----
const m = mundo();
let erro = null;
try { aplicar(m.nodes, m.connections); } catch (e) { erro = e.message; }
ok('o patch aplica', !erro, erro);
if (erro) { console.log('\n1 FALHA(S)'); process.exit(1); }

ok('o agente passa a ter output parser', m.nodes.find((n) => n.name === AGENTE).parameters.hasOutputParser === true);
ok('o parser sai como ai_outputParser para o agente',
  m.connections[PARSER].ai_outputParser[0][0].node === AGENTE
  && m.connections[PARSER].ai_outputParser[0][0].type === 'ai_outputParser');
ok('a saída principal do agente continua', Boolean(m.connections[AGENTE].main[0][0]));
ok('o modelo continua ligado', Boolean(m.connections['GPT 5.4 mini'].ai_languageModel));
ok('a ferramenta continua ligada', Boolean(m.connections.Pensar.ai_tool));
{
  const ag = m.nodes.find((n) => n.name === AGENTE);
  ok('prompt e maxIterations intactos',
    ag.parameters.options.maxIterations === 10 && ag.parameters.options.systemMessage === '# prompt');
}

// ---- 2. o esquema ----
{
  const esquema = m.nodes.find((n) => n.name === PARSER).parameters.jsonSchemaExample;
  let obj = null, e2 = null;
  try { obj = JSON.parse(esquema); } catch (x) { e2 = x.message; }
  ok('o esquema continua sendo JSON válido', Boolean(obj), e2);
  if (obj) {
    for (const campo of ['tipo', 'validade', 'desconto']) {
      ok(`o esquema ganhou "${campo}"`, campo in obj.oferta);
    }
    for (const campo of ['produto', 'variante', 'loja', 'preco_atual', 'preco_referencia',
      'condicao_pagamento', 'cupom', 'disponibilidade', 'url']) {
      ok(`o esquema manteve "${campo}"`, campo in obj.oferta);
    }
    ok('nada fora de oferta mudou',
      JSON.stringify({ ...obj, oferta: null }) === JSON.stringify({ ...JSON.parse(ESQUEMA_HOJE), oferta: null }));
  }
}

// ---- 3. esquema x prompt: as duas cópias têm que dizer a mesma coisa ----
{
  const prompt = fs.readFileSync(path.join(WFDIR, 'ai-agent.prompt.md'), 'utf8');
  const bloco = (prompt.match(/"oferta": \{([\s\S]*?)\}/) || [])[1] || '';
  const camposDoPrompt = [...bloco.matchAll(/"([a-z_]+)":/g)].map((x) => x[1]).sort();
  const esquema = JSON.parse(m.nodes.find((n) => n.name === PARSER).parameters.jsonSchemaExample);
  const camposDoEsquema = Object.keys(esquema.oferta).sort();
  ok('os campos de oferta do prompt e do esquema são os mesmos',
    JSON.stringify(camposDoPrompt) === JSON.stringify(camposDoEsquema),
    'prompt[' + camposDoPrompt + '] esquema[' + camposDoEsquema + ']');
}

// ---- reaplicação e topologia torta ----
{
  let re = null;
  try { aplicar(m.nodes, m.connections); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já tem output parser|já sai para/.test(String(re)), re);

  const semParser = mundo();
  semParser.nodes = semParser.nodes.filter((n) => n.name !== PARSER);
  let e3 = null;
  try { aplicar(semParser.nodes, semParser.connections); } catch (e) { e3 = e.message; }
  ok('aborta se o parser não existir', /nó não achado/.test(String(e3)), e3);

  const semModelo = mundo();
  delete semModelo.connections['GPT 5.4 mini'];
  let e4 = null;
  try { aplicar(semModelo.nodes, semModelo.connections); } catch (e) { e4 = e.message; }
  ok('aborta se o modelo não estiver ligado', /não achei o modelo/.test(String(e4)), e4);

  let e5 = null;
  try { trocarEsquema('{"oferta":{"produto":""}}'); } catch (e) { e5 = e.message; }
  ok('aborta se o esquema não tiver a forma esperada', /âncora/.test(String(e5)), e5);
}

console.log('\nLEMBRETE: isto liga o parser e alinha o esquema. Se o modelo AINDA devolver plano em');
console.log('vez de JSON, a saída passa a ser ERRO explícito, e o proximo passo e o parser autofixing.');
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
