// PORTÃO DA FILA — o produtor encerra a rodada quando já há peça fresca suficiente esperando.
//
// O PROBLEMA, MEDIDO EM 20/08 sobre 14 dias de fila: 55 peças criadas, 30 publicadas, 22
// apodrecidas — 40% da produção jogada fora. Cada peça apodrecida custou curador (OpenAI),
// redator (Anthropic), de 6 a 8 renders no Chrome e o mesmo tanto de upload no Cloudinary.
//
// O desencontro é de VAZÃO, não de escolha. O cron do publicador (`0 30 12`, `0 30 20` e
// `0 30 16` nas ter/qua/sex) dá de 4 a 6 vagas em qualquer janela de 48 h, que é a validade de
// uma peça. O produtor roda 8 vezes por dia e entrega ~4. O excedente não tem onde caber.
//
// Antes deste patch a hipótese era que a ordem de escolha causava o apodrecimento. Foi medido e
// NÃO É: o ramo A (notícia do dia) já ordena por nota, e o portão de 12 h deixa nota melhor na mesa
// em apenas 4 de 14 slots, média 1,6 ponto — preço justo por publicar notícia do mesmo dia. Não há
// reordenação que crie vaga. Só produzir menos resolve.
//
// N = 3, E DE ONDE VEM: REPLAY dos 14 dias de fila, não teoria. A primeira derivação foi teórica —
// "o pior caso do cron são 4 vagas em 48 h, logo N=4" — e era conservadora demais, porque ignora que
// a produção CONTINUA dentro da janela: a fila se recompõe, então não é preciso estoque para 48 h.
// O replay (`test_portao_da_fila.cjs`, seção D) varreu N e mediu também o que cada N perde num
// apagão de produção como o de 13/08:
//
//   N    produção   apodrecidas   publicadas   apagão 24h   48h   72h   (slots sem post)
//   -      55           18            34           0         0     0
//   4      48           12            34           0         0     0
//   3      42            7            34           0         0     1
//   2      35            1            34           0         3     5
//
// N=3 domina N=4: corta o apodrecimento quase pela metade com a MESMA resiliência até 48 h de
// apagão, e as 34 publicações ficam intactas em qualquer N >= 2 — o veto do PRD ("não aumente a
// quantidade de publicações") continua respeitado, e nada de publicação é perdido. N=2 seria mais
// barato ainda, mas perde 3 posts num apagão de 48 h, e o incidente do token de 13/08 durou ~20 h.
// Errar para o lado de produzir de menos custa uma pauta não coberta; para o outro custa peça
// apodrecida, que é o que já acontece hoje 33% do tempo.
//
// ONDE ENTRA: entre o `Schedule Trigger` e os 13 feeds. É o ponto mais barato (não paga feed, não
// paga o `og` do enriquecimento, não paga curador, não paga redator, não paga render) e é UMA única
// saída para refiar num workflow de 123 nós — o que, pelo histórico deste projeto, é o critério que
// manda.
//
// O QUE SE PERDE POR GATEAR ANTES DA CURADORIA: a rodada gateada não grava registro em
// `promoliso_curadoria_ai`, então não fica o retrato de "que notícia existia às 14:00". Foi
// escolhido assim de propósito: o registro custa a chamada do curador, que é justamente parte do
// desperdício. Consequência conferida no watchdog (`avaliar-saude.js`): ele alerta em (a) registro
// de curadoria COM erro de cota no último run e (b) 26 h sem publicar. Rodada gateada não gera
// registro nenhum, então não dispara (a) por engano; e (b) não depende do produtor. Ponto cego
// aceito: se o curador quebrar enquanto a fila está cheia, o alerta só vem por (b), com atraso.
//
// SEM NÓ IF: um nó Code que retorna `[]` já corta o ramo. Dois nós novos em vez de três.
//
// FAIL-OPEN DE PROPÓSITO: se a leitura da fila vier vazia, truncada (o nó lê no máximo 500 rows) ou
// com data ilegível, o portão ABRE. O pior caso passa a ser o comportamento de hoje — produzir
// demais — e nunca "parar de produzir para sempre por causa de uma leitura ruim".
//
// ROLLBACK: `--reverter` remove os dois nós e devolve a fiação direta do trigger para os 13 feeds.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const TRIGGER = 'Schedule Trigger';
const NO_LER = 'Ler fila (portão)';
const NO_PORTAO = 'Portão da fila';
const TABELA_FILA = 'i2e8ZwnL9kwOV6OG';         // promoliso_fila

// Os dois números do portão. `FRESCOR_MAX_H` é a SEGUNDA cópia do 48 que já existe no publicador
// (`selecionar-ready.js`); n8n não compartilha código entre workflows, então a cópia é inevitável —
// o harness é que cobra que as duas concordem. Se divergirem, o portão passa a contar como fresca
// uma peça que o publicador já considera vencida, e a fila entope sem ninguém ver.
const FRESCOR_MAX_H = 48;
const N_MAX_FRESCAS = 3;

const CODIGO_PORTAO = `// PORTÃO DA FILA — encerra a rodada quando já há peça fresca suficiente esperando vaga.
//
// Medido em 20/08 (14 dias): 55 peças criadas, 30 publicadas, 22 apodrecidas = 40% do custo de
// produção no lixo. O publicador tem de 4 a 6 vagas por janela de 48 h; o produtor entrega ~4 por
// dia. Não é problema de escolha — é de vazão.
const FRESCOR_MAX_H = ${FRESCOR_MAX_H};   // MESMO valor do publicador ("Selecionar READY"). Divergir entope a fila.
const N_MAX_FRESCAS = ${N_MAX_FRESCAS};    // medido por replay dos 14 dias, não derivado do cron
const PUBLICAVEIS = ['READY', 'RETRY'];    // os mesmos estados que o publicador considera

const rows = $input.all().map((i) => i.json);
const idadeH = (row) => {
  const t = Date.parse(String(row.created_at || row.createdAt || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const frescas = rows.filter((r) => PUBLICAVEIS.includes(String(r.status || '').toUpperCase())
  && idadeH(r) <= FRESCOR_MAX_H);

// FAIL-OPEN: leitura vazia significa "não sei", não "fila vazia". O nó lê no máximo 500 rows e a
// tabela cresce; no dia em que truncar, o certo é produzir (comportamento de hoje) e não emudecer.
if (!rows.length) {
  return [{ json: { portao: 'aberto', motivo: 'fila veio vazia — fail-open', frescas: null, limite: N_MAX_FRESCAS, rows: 0 } }];
}

if (frescas.length >= N_MAX_FRESCAS) {
  // Retornar [] corta o ramo: os 13 feeds não rodam, o curador não é chamado, o redator não escreve
  // e o Chrome não renderiza. É o ponto todo do portão.
  return [];
}
return [{ json: {
  portao: 'aberto',
  motivo: frescas.length + ' fresca(s) na fila, limite ' + N_MAX_FRESCAS,
  frescas: frescas.length,
  limite: N_MAX_FRESCAS,
  rows: rows.length,
  idade_da_mais_nova_h: frescas.length ? Math.round(Math.min(...frescas.map(idadeH)) * 10) / 10 : null,
} }];
`;

// Config copiada do nó `Ler fila` do watchdog (MJly91QFGKep), que lê esta mesma tabela em produção
// desde 25/07 — forma provada, não inventada aqui.
const noLer = (position) => ({
  id: crypto.randomUUID(),
  name: NO_LER,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  position,
  parameters: {
    operation: 'get',
    dataTableId: { __rl: true, value: TABELA_FILA, mode: 'id', cachedResultName: 'promoliso_fila' },
    limit: 500,
    orderBy: true,
  },
});

const noPortao = (position) => ({
  id: crypto.randomUUID(),
  name: NO_PORTAO,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
  parameters: { jsCode: CODIGO_PORTAO },
});

// ---------------------------------------------------------------- a cirurgia, em memória
function aplicar(nodes, connections) {
  if (nodes.some((n) => n.name === NO_LER || n.name === NO_PORTAO)) {
    throw new Error('portão já existe — patch já aplicado?');
  }
  const trig = nodes.find((n) => n.name === TRIGGER);
  if (!trig) throw new Error('nó não achado: ' + TRIGGER);
  const saida = ((connections[TRIGGER] || {}).main || [])[0];
  if (!Array.isArray(saida) || !saida.length) throw new Error(`${TRIGGER}: saída 0 vazia — abortando`);
  const feeds = saida.map((l) => l.node);
  if (feeds.length < 10) throw new Error(`${TRIGGER}: esperava os 13 feeds e achei ${feeds.length} — alguém mexeu na fiação; revisar antes`);
  for (const f of feeds) {
    if (!nodes.some((n) => n.name === f)) throw new Error('destino do trigger não existe: ' + f);
  }

  const [x, y] = trig.position;
  nodes.push(noLer([x - 192, y - 160]));
  nodes.push(noPortao([x - 384, y - 160]));

  // trigger -> Ler fila -> Portão -> os 13 feeds (a lista original, na ordem original)
  connections[TRIGGER] = { ...(connections[TRIGGER] || {}), main: [[{ node: NO_LER, type: 'main', index: 0 }]] };
  connections[NO_LER] = { main: [[{ node: NO_PORTAO, type: 'main', index: 0 }]] };
  connections[NO_PORTAO] = { main: [saida.map((l) => ({ ...l }))] };
  return feeds;
}

function reverter(nodes, connections) {
  const portao = (connections[NO_PORTAO] || {}).main;
  if (!portao || !Array.isArray(portao[0])) throw new Error('portão não está fiado — nada a reverter');
  const feeds = portao[0].map((l) => ({ ...l }));
  const fora = new Set([NO_LER, NO_PORTAO]);
  const restantes = nodes.filter((n) => !fora.has(n.name));
  if (restantes.length !== nodes.length - 2) throw new Error('esperava remover exatamente 2 nós');
  delete connections[NO_LER];
  delete connections[NO_PORTAO];
  connections[TRIGGER] = { ...(connections[TRIGGER] || {}), main: [feeds] };
  return { nodes: restantes, feeds: feeds.map((l) => l.node) };
}

module.exports = {
  WF, TRIGGER, NO_LER, NO_PORTAO, TABELA_FILA,
  FRESCOR_MAX_H, N_MAX_FRESCAS, CODIGO_PORTAO,
  noLer, noPortao, aplicar, reverter,
};

if (require.main !== module) return;

const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
  process.exit(1);
}
const sqlite3 = require('sqlite3');
const DRY = process.argv.includes('--dry');
const REVERTER = process.argv.includes('--reverter');
const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function agora() {
  const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
    + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  let nodes = JSON.parse(row.nodes);
  const connections = JSON.parse(row.connections);
  const antes = nodes.length;

  if (REVERTER) {
    const r = reverter(nodes, connections);
    nodes = r.nodes;
    console.log(`OK  portão removido; ${TRIGGER} volta a alimentar os ${r.feeds.length} feeds direto`);
    console.log(`OK  nós: ${antes} -> ${nodes.length}`);
  } else {
    const feeds = aplicar(nodes, connections);
    new Function(CODIGO_PORTAO);
    console.log(`OK  ${NO_LER}  (get em promoliso_fila, limite 500)`);
    console.log(`OK  ${NO_PORTAO}  (encerra a rodada com ${N_MAX_FRESCAS}+ frescas em ${FRESCOR_MAX_H} h)`);
    console.log(`OK  fiação: ${TRIGGER} -> ${NO_LER} -> ${NO_PORTAO} -> ${feeds.length} feeds`);
    console.log(`OK  nós: ${antes} -> ${nodes.length}`);
  }

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const connStr = JSON.stringify(connections);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte o portao da fila (produtor volta a produzir sempre)'
    : `Portao da fila: produtor encerra a rodada com ${N_MAX_FRESCAS}+ pecas frescas esperando`;
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, connStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, connStr, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-portao-fila.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
