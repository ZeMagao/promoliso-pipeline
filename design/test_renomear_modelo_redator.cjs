// Harness do renome do modelo do redator (02/10/2026). Offline, sobre a topologia REAL do produtor
// já limpa (a de 02/10 com os 30 inalcançáveis tirados pelo mesmo código que foi para produção).
//   node design/test_renomear_modelo_redator.cjs
const fs = require('fs');
const path = require('path');
const R = require('./patch_renomear_modelo_redator.cjs');
const L = require('./patch_limpeza_nos_mortos.cjs');
const TOPO = require('./produtor_topologia_20261002.json');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};
const limpo = () => {
  const nodes = TOPO.nos.map((n) => ({ name: n.name, type: n.type, disabled: n.disabled, parameters: {} }));
  const r = L.aplicar(nodes, JSON.parse(JSON.stringify(TOPO.connections)));
  return { nodes: r.nodes, connections: r.connections };
};
const arestas = (c) => {
  const r = [];
  for (const [o, tipos] of Object.entries(c)) for (const [t, ss] of Object.entries(tipos || {})) for (const s of ss || []) for (const l of s || []) r.push(`${o} -[${t}]-> ${l.node}`);
  return r.sort();
};

const antes = limpo();
const depois = R.aplicar(antes.nodes, antes.connections, false);
ok('o nó passa a se chamar "Modelo do Redator PromoLiso AI"', depois.nodes.some((n) => n.name === R.NOVO) && !depois.nodes.some((n) => n.name === R.ANTIGO));
ok('continua ligado ao AI Agent como modelo', arestas(depois.connections).includes(`${R.NOVO} -[ai_languageModel]-> AI Agent`));
ok('as outras ligações são exatamente as de antes',
  JSON.stringify(arestas(depois.connections)) === JSON.stringify(arestas(antes.connections).map((a) => a.split(R.ANTIGO).join(R.NOVO)).sort()));
ok('mesma quantidade de nós', depois.nodes.length === antes.nodes.length);
ok('os mesmos nós seguem alcançáveis', L.alcancaveis(depois.nodes, depois.connections).size === L.alcancaveis(antes.nodes, antes.connections).size);
ok('o "GPT auxiliar de estruturacao" (OpenAI de verdade) fica como está', depois.nodes.some((n) => n.name === 'GPT auxiliar de estruturacao'));
const volta = R.aplicar(depois.nodes, depois.connections, true);
ok('reverter volta byte a byte', JSON.stringify(volta) === JSON.stringify(antes));
let doeu = false; try { R.aplicar(depois.nodes, depois.connections, false); } catch (e) { doeu = true; }
ok('aplicar duas vezes é erro', doeu);
const citando = limpo(); citando.nodes.find((n) => n.name === 'Validar antes de publicar').parameters = { jsCode: "$('GPT 5.4 mini')" };
let recusou = false; try { R.aplicar(citando.nodes, citando.connections, false); } catch (e) { recusou = /cita/.test(e.message); }
ok('nó citando o nome antigo: aborta', recusou);
const coletor = fs.readFileSync(path.join(__dirname, '..', 'analytics', 'coletor-publicacoes.cjs'), 'utf8');
ok('o analytics reconhece os dois nomes (execução antiga e nova)', coletor.includes(`'${R.ANTIGO}'`) && coletor.includes(`'${R.NOVO}'`));

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
