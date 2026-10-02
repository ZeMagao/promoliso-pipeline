// Harness da limpeza dos nós inalcançáveis do produtor (02/10/2026). Offline.
//
// Usa a topologia REAL do produtor (design/produtor_topologia_20261002.json: nomes, tipos,
// desabilitados e todas as conexões, inclusive as de sub-nó de IA — sem parâmetros). Prova:
//   1. Os inalcançáveis são exatamente os 30 esperados (a conta atravessa desabilitados).
//   2. Depois: os 95 vivos continuam, com as mesmas ligações; nenhum morto sobra em nó ou conexão;
//      o modelo do redator (sub-nó) continua ligado ao AI Agent.
//   3. Cada trava aborta: nó solto novo, morto religado, vivo citando morto, renomear duas vezes.
//
//   node design/test_limpeza_nos_mortos.cjs
const L = require('./patch_limpeza_nos_mortos.cjs');
const TOPO = require('./produtor_topologia_20261002.json');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};
const copia = () => ({
  nodes: TOPO.nos.map((n) => ({ name: n.name, type: n.type, disabled: n.disabled, parameters: {} })),
  connections: JSON.parse(JSON.stringify(TOPO.connections)),
});
const arestas = (connections) => {
  const r = [];
  for (const [o, tipos] of Object.entries(connections)) for (const [t, ss] of Object.entries(tipos || {})) for (const s of ss || []) for (const l of s || []) r.push(o + ' -[' + t + ']-> ' + l.node);
  return r.sort();
};

// 1. a conta
const { nodes, connections } = copia();
const vivo = L.alcancaveis(nodes, connections);
const mortos = nodes.filter((n) => !vivo.has(n.name) && n.type !== 'n8n-nodes-base.stickyNote').map((n) => n.name).sort();
ok(`topologia real: ${nodes.length} nós, ${mortos.length} inalcançáveis`, nodes.length === 125 && mortos.length === 30);
ok('os inalcançáveis são exatamente a lista do patch', JSON.stringify(mortos) === JSON.stringify(L.MORTOS_ESPERADOS),
  mortos.filter((m) => !L.MORTOS_ESPERADOS.includes(m)).join(','));
ok('o modelo do redator é sub-nó vivo (via ai_languageModel)', vivo.has('GPT 5.4 mini'));

// 2. o resultado
const r = L.aplicar(nodes, connections);
ok(`ficam ${r.nodes.length} nós (125 - 30)`, r.nodes.length === 95);
const morto = new Set(L.MORTOS_ESPERADOS);
ok('nenhum morto sobra entre os nós', !r.nodes.some((n) => morto.has(n.name)));
ok('nenhum morto sobra nas conexões (origem ou destino)', !arestas(r.connections).some((a) => L.MORTOS_ESPERADOS.some((m) => a.startsWith(m + ' -[') || a.endsWith('-> ' + m))));
const esperadas = arestas(connections)
  .filter((a) => !L.MORTOS_ESPERADOS.some((m) => a.startsWith(m + ' -[') || a.endsWith('-> ' + m)))
  .sort();
ok('as ligações entre vivos são exatamente as de antes', JSON.stringify(arestas(r.connections)) === JSON.stringify(esperadas));
ok('o modelo continua ligado ao AI Agent (nome não muda: o analytics lê esse nome)',
  arestas(r.connections).includes('GPT 5.4 mini -[ai_languageModel]-> AI Agent'));
const vivoDepois = L.alcancaveis(r.nodes, r.connections);
ok('os mesmos nós continuam alcançáveis', JSON.stringify([...vivoDepois].sort()) === JSON.stringify([...vivo].sort()));
ok('os dois gatilhos continuam', r.nodes.filter((n) => /trigger/i.test(n.type)).length === 2);

// 3. as travas
const tenta = (mutar, padrao) => {
  const c = copia(); mutar(c);
  try { L.aplicar(c.nodes, c.connections); return false; } catch (e) { return padrao.test(e.message); }
};
ok('nó solto novo aborta', tenta((c) => c.nodes.push({ name: 'Nó novo esquecido', type: 'n8n-nodes-base.code', parameters: {} }), /mudou/));
ok('morto religado a um vivo aborta', tenta((c) => { c.connections['Salvar na fila'] = { main: [[{ node: 'Publish a post', type: 'main', index: 0 }]] }; }, /mudou/));
ok('vivo citando morto pelo nome aborta', tenta((c) => { c.nodes.find((n) => n.name === 'Validar antes de publicar').parameters = { jsCode: "$('Publish a post').item" }; }, /cita/));
let doeu = false; try { L.aplicar(r.nodes, r.connections); } catch (e) { doeu = true; }
ok('aplicar duas vezes é erro', doeu);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
