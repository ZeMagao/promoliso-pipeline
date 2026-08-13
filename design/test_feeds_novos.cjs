// Harness dos feeds novos. Offline, sem VPS.
//
// Esta é a primeira CIRURGIA DE NÓ do projeto desde o carrossel variável, que derrubou a publicação
// por 3 dias em 05/08. Então o harness testa a topologia, que é onde aquilo quebrou: índice do
// merge, gatilho ligado, contagem batendo, e o nó de configuração ainda compilando.
//
// A topologia usada aqui é SINTÉTICA e imita a de produção (2 gatilhos -> 8 feeds -> merge de 8
// entradas, mais o nó de configuração). Testar contra o export não daria: o exportador só grava
// jsCode, e nó de RSS e merge não têm jsCode nenhum. Contra produção quem confere é o --dry, que
// aborta sozinho se a topologia lá não for esta.
//
//   node design/test_feeds_novos.cjs
const { aplicar, NOVOS, MERGE, MODELO, GATILHOS, CONFIG } = require('./patch_feeds_novos.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const FEEDS_HOJE = ['Feed oficial PlayStation', 'Feed oficial Xbox', 'Feed oficial Nintendo',
  'Feed oficial NVIDIA Gaming', 'Feed oficial Intel', 'Feed Adrenaline', 'Feed Flow Games', 'Feed GameVicio'];

function mundo() {
  const nodes = [
    { name: GATILHOS[0], type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-2560, 400], id: 'g1', parameters: {} },
    { name: GATILHOS[1], type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-2560, 200], id: 'g2', parameters: {} },
    { name: MERGE, type: 'n8n-nodes-base.merge', typeVersion: 3.2, position: [-2064, 384], id: 'm1', parameters: { numberInputs: FEEDS_HOJE.length } },
    { name: CONFIG, type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1800, 384], id: 'c1',
      parameters: { jsCode: 'return [{ json: { config: { dominios_editoriais: ["adrenaline.com.br","flowgames.gg","gamevicio.com"] } } }];' } },
  ];
  const connections = { [GATILHOS[0]]: { main: [[]] }, [GATILHOS[1]]: { main: [[]] } };
  FEEDS_HOJE.forEach((nome, i) => {
    nodes.push({
      parameters: { url: `https://exemplo${i}.com/feed/`, options: {} },
      type: 'n8n-nodes-base.rssFeedRead', typeVersion: 1.2, position: [-2320, 128 * (i + 1)],
      id: 'f' + i, name: nome === MODELO ? MODELO : nome,
      retryOnFail: true, maxTries: 2, waitBetweenTries: 1500, onError: 'continueRegularOutput',
    });
    connections[nome] = { main: [[{ node: MERGE, type: 'main', index: i }]] };
    for (const g of GATILHOS) connections[g].main[0].push({ node: nome, type: 'main', index: 0 });
  });
  return { nodes, connections };
}

// ---- aplica ----
const m = mundo();
const antesNos = m.nodes.length;
let erro = null;
let seq = 0;
try { aplicar(m.nodes, m.connections, () => 'novo-' + (++seq)); } catch (e) { erro = e.message; }
ok('o patch aplica na topologia de produção', !erro, erro);
if (erro) { console.log('\n1 FALHA(S)'); process.exit(1); }

ok('4 nós novos entraram', m.nodes.length === antesNos + 4, `${antesNos} -> ${m.nodes.length}`);
ok('o merge subiu de 8 para 12 entradas',
  m.nodes.find((n) => n.name === MERGE).parameters.numberInputs === 12);

for (const novo of NOVOS) {
  const n = m.nodes.find((x) => x.name === novo.name);
  ok(`[${novo.name}] existe com a URL certa`, Boolean(n) && n.parameters.url === novo.url);
  if (!n) continue;
  // feed que cai não pode travar o merge — mesmo retry/onError do modelo
  ok(`[${novo.name}] herdou retry e onError do modelo`,
    n.retryOnFail === true && n.maxTries === 2 && n.onError === 'continueRegularOutput');
  ok(`[${novo.name}] recebe dos dois gatilhos`,
    GATILHOS.every((g) => m.connections[g].main[0].some((c) => c.node === novo.name)));
  ok(`[${novo.name}] entra no merge`,
    m.connections[novo.name].main[0][0].node === MERGE);
}

// ---- topologia: é aqui que a cirurgia quebra em silêncio ----
{
  const idx = [];
  for (const saidas of Object.values(m.connections)) {
    for (const grupo of saidas.main || []) for (const c of grupo || []) if (c.node === MERGE) idx.push(c.index);
  }
  ok('12 ligações no merge, uma por feed', idx.length === 12, String(idx.length));
  ok('nenhum índice repetido (repetido = um feed engole o outro)', new Set(idx).size === idx.length);
  ok('índices são 0..11 sem buraco', [...idx].sort((a, b) => a - b).join() === [...Array(12).keys()].join());
  ok('nenhum nome de nó duplicado', new Set(m.nodes.map((n) => n.name)).size === m.nodes.length);
  ok('nenhum id de nó duplicado', new Set(m.nodes.map((n) => n.id)).size === m.nodes.length);
  ok('nenhum nó ficou em cima do outro',
    new Set(m.nodes.map((n) => n.position.join(','))).size === m.nodes.length);
}

// ---- os feeds antigos não podem ter sido tocados ----
{
  const intactos = FEEDS_HOJE.every((nome, i) =>
    m.connections[nome].main[0].length === 1 && m.connections[nome].main[0][0].index === i);
  ok('os 8 feeds de hoje continuam nos mesmos índices', intactos);
}

// ---- configuração ----
{
  const cfg = m.nodes.find((n) => n.name === CONFIG).parameters.jsCode;
  ok('o nó de configuração ainda compila', (() => { try { new Function(cfg); return true; } catch { return false; } })());
  const saida = new Function(cfg + '')();
  const dominios = saida[0].json.config.dominios_editoriais;
  ok('os 3 domínios antigos continuam lá',
    ['adrenaline.com.br', 'flowgames.gg', 'gamevicio.com'].every((d) => dominios.includes(d)), dominios.join(','));
  ok('os 4 domínios novos entraram', NOVOS.every((n) => dominios.includes(n.dominio)), dominios.join(','));
}

// ---- reaplicação ----
{
  let reErro = null;
  try { aplicar(m.nodes, m.connections, () => 'x'); } catch (e) { reErro = e.message; }
  ok('recusa reaplicação', /já existe/.test(String(reErro)), reErro);
}

// ---- topologia diferente da esperada tem que abortar, não adivinhar ----
{
  const torto = mundo();
  torto.nodes.find((n) => n.name === MERGE).parameters.numberInputs = 6;   // merge fora de sincronia
  let e2 = null;
  try { aplicar(torto.nodes, torto.connections, () => 'y'); } catch (e) { e2 = e.message; }
  ok('aborta se o merge não bate com a quantidade de feeds', /entradas e existem/.test(String(e2)), e2);

  const semModelo = mundo();
  semModelo.nodes = semModelo.nodes.filter((n) => n.name !== MODELO);
  let e3 = null;
  try { aplicar(semModelo.nodes, semModelo.connections, () => 'z'); } catch (e) { e3 = e.message; }
  ok('aborta se o nó modelo sumiu', /modelo não achado/.test(String(e3)), e3);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
