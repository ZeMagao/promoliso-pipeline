// Harness do portão da fila. Roda o código do portão de verdade, faz a cirurgia contra o grafo real
// exportado, e — a parte que importa — REPLAY sequencial dos 14 dias de fila com e sem portão.
//
// Por que replay e não contagem estática: com portão a fila muda a cada decisão, e a decisão
// seguinte depende dessa mudança. Contar "quantas rodadas tinham 4+ frescas" no histórico responde
// a pergunta errada, porque aquele histórico foi produzido SEM portão.
//
//   node design/test_portao_da_fila.cjs
const fs = require('fs');
const path = require('path');
const P = require('./patch_portao_da_fila.cjs');

const WFDIR_PROD = path.join(__dirname, '..', 'workflows', 'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');
const WFDIR_PUB = path.join(__dirname, '..', 'workflows', 'promoliso-publicador-fila--E27F7yVdsZRj');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

// ---------------------------------------------------------------- A. o número duplicado
console.log('# A. o 48 que vive em dois workflows');
const codPub = fs.readFileSync(path.join(WFDIR_PUB, 'selecionar-ready.js'), 'utf8');
const mPub = codPub.match(/const FRESCOR_MAX_H = (\d+);/);
ok('o publicador declara FRESCOR_MAX_H', Boolean(mPub), 'não achei no selecionar-ready.js');
ok('o portão usa o MESMO valor do publicador',
  mPub && Number(mPub[1]) === P.FRESCOR_MAX_H,
  'publicador=' + (mPub && mPub[1]) + ' portão=' + P.FRESCOR_MAX_H);
ok('e o código gravado no nó fala o mesmo número',
  P.CODIGO_PORTAO.includes('const FRESCOR_MAX_H = ' + P.FRESCOR_MAX_H + ';'));
ok('o portão e o publicador consideram os mesmos estados publicáveis',
  /PUBLICAVEIS = \['READY', ?'RETRY'\]/.test(P.CODIGO_PORTAO)
  && /PUBLICAVEIS ?= ?\['READY', ?'RETRY'\]/.test(codPub));
ok('N está declarado no código do nó', P.CODIGO_PORTAO.includes('const N_MAX_FRESCAS = ' + P.N_MAX_FRESCAS + ';'));

// ---------------------------------------------------------------- B. comportamento do portão
console.log('\n# B. o portão decidindo');
const horasAtras = (h) => new Date(Date.now() - h * 3600000).toISOString();
const rodarPortao = (rows) => {
  const $input = { all: () => rows.map((json) => ({ json })) };
  return new Function('$input', P.CODIGO_PORTAO)($input);
};
const fresca = (h, over) => ({ status: 'READY', created_at: horasAtras(h), score: 80, ...over });

// Tudo relativo a N: com o número cravado, estes testes passam a mentir na próxima vez que o N
// mudar — foi o que aconteceu quando ele saiu de 4 para 3.
const N = P.N_MAX_FRESCAS;
const nFrescas = (k, h) => Array.from({ length: Math.max(0, k) }, (_, i) => fresca((h || 1) + i));
ok('abre com N-1 frescas (' + (N - 1) + ')', rodarPortao(nFrescas(N - 1)).length === 1);
ok('FECHA com N frescas (' + N + ')', rodarPortao(nFrescas(N)).length === 0);
ok('FECHA com N+1 frescas', rodarPortao(nFrescas(N + 1)).length === 0);
ok('peça vencida (>48 h) não conta como fresca',
  rodarPortao([...nFrescas(N - 1), fresca(60), fresca(300)]).length === 1);
const cheiaDe = (st) => [...nFrescas(N - 1), ...Array.from({ length: 3 }, (_, i) => fresca(20 + i, { status: st }))];
ok('PUBLISHED não conta', rodarPortao(cheiaDe('PUBLISHED')).length === 1);
ok('FAILED não conta', rodarPortao(cheiaDe('FAILED')).length === 1);
ok('RETRY CONTA (o publicador também a considera)',
  rodarPortao([...nFrescas(N - 1), fresca(30, { status: 'RETRY' })]).length === 0);
ok('status em minúscula conta igual',
  rodarPortao([...nFrescas(N - 1).map((r) => ({ ...r, status: 'ready' })),
    fresca(30, { status: 'retry' })]).length === 0);
ok('data ilegível não conta como fresca (Infinity, não NaN)',
  rodarPortao([...nFrescas(N - 1), fresca(9, { created_at: 'ontem de tarde' })]).length === 1);
ok('usa createdAt quando created_at falta',
  rodarPortao([...nFrescas(N - 1), { status: 'READY', createdAt: horasAtras(5) }]).length === 0);
const aberto = rodarPortao(nFrescas(N - 1))[0].json;
ok('quando abre, diz por que e quantas viu',
  aberto.portao === 'aberto' && aberto.frescas === N - 1 && aberto.limite === N
  && aberto.idade_da_mais_nova_h !== null, JSON.stringify(aberto));

console.log('\n# B2. fail-open');
const vazio = rodarPortao([]);
ok('fila vazia ABRE o portão (fail-open)', vazio.length === 1 && vazio[0].json.frescas === null,
  JSON.stringify(vazio));
ok('e o motivo diz que foi fail-open', /fail-open/.test(vazio[0].json.motivo));

// ---------------------------------------------------------------- C. a cirurgia
console.log('\n# C. cirurgia contra o grafo real');
const manifest = JSON.parse(fs.readFileSync(path.join(WFDIR_PROD, '_manifest.json'), 'utf8'));
// O export não guarda connections; o grafo do trigger é reconstruído do manifest + a lista de feeds
// que o próprio patch exige encontrar. Para a cirurgia basta um grafo fiel NESSE ponto.
const feedsDoManifest = manifest.nos
  .filter((n) => /^(Feed |Epic: )/.test(n.nome))
  .map((n) => n.nome);
ok('o manifest tem os 13 feeds', feedsDoManifest.length === 13, String(feedsDoManifest.length));

const grafo = () => ({
  nodes: [
    { name: P.TRIGGER, type: 'n8n-nodes-base.scheduleTrigger', position: [-1712, 384], parameters: {} },
    ...feedsDoManifest.map((f, i) => ({ name: f, type: 'n8n-nodes-base.rssFeedRead', position: [-2320, 256 + i * 128], parameters: {} })),
    { name: 'Unir feeds oficiais', type: 'n8n-nodes-base.merge', position: [-2100, 800], parameters: {} },
  ],
  connections: {
    [P.TRIGGER]: { main: [feedsDoManifest.map((f) => ({ node: f, type: 'main', index: 0 }))] },
    ...Object.fromEntries(feedsDoManifest.map((f) => [f, { main: [[{ node: 'Unir feeds oficiais', type: 'main', index: 0 }]] }])),
  },
});

const g = grafo();
const original = JSON.stringify(g);
const feeds = P.aplicar(g.nodes, g.connections);
ok('a cirurgia achou os 13 feeds', feeds.length === 13, String(feeds.length));
ok('dois nós novos, nada removido', g.nodes.length === grafo().nodes.length + 2, String(g.nodes.length));
ok('trigger passa a apontar SÓ para o Ler fila',
  g.connections[P.TRIGGER].main[0].length === 1
  && g.connections[P.TRIGGER].main[0][0].node === P.NO_LER);
ok('Ler fila -> Portão', g.connections[P.NO_LER].main[0][0].node === P.NO_PORTAO);
ok('Portão -> os 13 feeds, na ordem original',
  JSON.stringify(g.connections[P.NO_PORTAO].main[0].map((l) => l.node)) === JSON.stringify(feedsDoManifest));
ok('nenhum feed perdeu a saída para o Unir',
  feedsDoManifest.every((f) => g.connections[f].main[0][0].node === 'Unir feeds oficiais'));
ok('o nó do portão tem jsCode válido', (() => {
  const n = g.nodes.find((x) => x.name === P.NO_PORTAO);
  try { new Function(n.parameters.jsCode); return true; } catch (e) { return false; }
})());
ok('o nó de leitura aponta para promoliso_fila',
  g.nodes.find((x) => x.name === P.NO_LER).parameters.dataTableId.value === P.TABELA_FILA);

let e2 = null;
try { P.aplicar(g.nodes, g.connections); } catch (e) { e2 = e.message; }
ok('recusa aplicar duas vezes', /já existe/.test(String(e2)), e2);

const rev = P.reverter(g.nodes, g.connections);
ok('reverter devolve o grafo byte a byte',
  JSON.stringify({ nodes: rev.nodes, connections: g.connections }) === original,
  'diferente');
let e3 = null;
try { P.reverter(rev.nodes, g.connections); } catch (e) { e3 = e.message; }
ok('recusa reverter o que não está fiado', /não está fiado/.test(String(e3)), e3);

// guarda: fiação inesperada aborta em vez de improvisar
const gRuim = grafo();
gRuim.connections[P.TRIGGER] = { main: [[{ node: 'Feed oficial Xbox', type: 'main', index: 0 }]] };
let e4 = null;
try { P.aplicar(gRuim.nodes, gRuim.connections); } catch (e) { e4 = e.message; }
ok('aborta se o trigger não alimenta os 13 feeds', /esperava os 13 feeds/.test(String(e4)), e4);

// ---------------------------------------------------------------- D. replay dos 14 dias
console.log('\n# D. replay sequencial da fila real (com portão x sem portão)');
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fila_amostra_20260820.json'), 'utf8'));
const codSel = fs.readFileSync(path.join(WFDIR_PUB, 'selecionar-ready.js'), 'utf8');

// Slots do cron do publicador, gerados do cron de verdade: 12:30 e 20:30 todo dia, 16:30 em
// ter/qua/sex. Em BRT (UTC-3), que é o fuso da instância.
const slotsEntre = (ini, fim) => {
  const out = [];
  for (let d = new Date(ini); d <= fim; d = new Date(d.getTime() + 86400000)) {
    const dia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = new Date(dia.getTime() - 3 * 3600000).getUTCDay();   // dia da semana em BRT
    for (const [h, m] of [[12, 30], [16, 30], [20, 30]]) {
      if (h === 16 && ![2, 3, 5].includes(dow)) continue;
      const t = dia.getTime() + (h + 3) * 3600000 + m * 60000;       // BRT -> UTC
      if (t >= ini.getTime() && t <= fim.getTime()) out.push(t);
    }
  }
  return out.sort((a, b) => a - b);
};

const INI = new Date('2026-08-06T00:00:00Z');
const FIM = new Date('2026-08-20T00:00:00Z');
const slots = slotsEntre(INI, FIM);
ok('os slots do cron saíram (2/dia + ter,qua,sex)', slots.length >= 28 && slots.length <= 40, String(slots.length));

const nascimentos = real
  .filter((r) => Date.parse(r.created_at) >= INI.getTime() && Date.parse(r.created_at) <= FIM.getTime())
  .map((r) => ({ t: Date.parse(r.created_at), row: r }))
  .sort((a, b) => a.t - b.t);
ok('o replay tem as peças criadas na janela', nascimentos.length >= 50, String(nascimentos.length));

// O selecionar-ready lê o relógio; para avaliar o instante T deslocamos as datas.
const escolherEm = (fila, T) => {
  if (!fila.length) return null;
  const desloc = Date.now() - T;
  const rows = fila.map((r) => ({ ...r, created_at: new Date(Date.parse(r.created_at) + desloc).toISOString() }));
  const $input = { all: () => rows.map((json) => ({ json })) };
  let saida;
  try { saida = new Function('$input', '$', '$json', codSel)($input, () => ({ item: { json: {} } }), {}); }
  catch (e) { return null; }
  if (!saida || !saida.length) return null;
  return fila.find((r) => r.content_key === saida[0].json.content_key) || null;
};

function replay(comPortao) {
  const eventos = [
    ...nascimentos.map((n) => ({ t: n.t, tipo: 'nasce', row: n.row })),
    ...slots.map((t) => ({ t, tipo: 'slot' })),
  ].sort((a, b) => a.t - b.t || (a.tipo === 'nasce' ? -1 : 1));

  let fila = [];
  let criadas = 0, publicadas = 0, gateadas = 0;
  for (const ev of eventos) {
    if (ev.tipo === 'nasce') {
      if (comPortao) {
        const frescas = fila.filter((r) => ['READY', 'RETRY'].includes(String(r.status).toUpperCase())
          && (ev.t - Date.parse(r.created_at)) / 3600000 <= P.FRESCOR_MAX_H);
        if (frescas.length >= P.N_MAX_FRESCAS) { gateadas++; continue; }
      }
      criadas++;
      fila.push({ ...ev.row, status: 'READY' });
    } else {
      const escolhida = escolherEm(fila.filter((r) => r.status === 'READY'), ev.t);
      if (escolhida) {
        escolhida.status = 'PUBLISHED';
        escolhida.publicada_em = ev.t;
        publicadas++;
      }
    }
  }
  const apodrecidas = fila.filter((r) => r.status === 'READY'
    && (FIM.getTime() - Date.parse(r.created_at)) / 3600000 > P.FRESCOR_MAX_H).length;
  return { criadas, publicadas, gateadas, apodrecidas };
}

const sem = replay(false);
const com = replay(true);
const linha = (t, r) => '  ' + t.padEnd(12) + 'criadas ' + String(r.criadas).padStart(3)
  + ' | publicadas ' + String(r.publicadas).padStart(3)
  + ' | apodrecidas ' + String(r.apodrecidas).padStart(3)
  + ' | não produzidas ' + String(r.gateadas).padStart(3);
console.log(linha('sem portão', sem));
console.log(linha('com portão', com));

ok('o portão NÃO reduz publicação (é o veto do PRD)', com.publicadas >= sem.publicadas,
  sem.publicadas + ' -> ' + com.publicadas);
ok('o portão corta produção de verdade', com.gateadas >= 5, String(com.gateadas));
ok('e derruba o apodrecimento', com.apodrecidas < sem.apodrecidas,
  sem.apodrecidas + ' -> ' + com.apodrecidas);
const antes = sem.criadas ? (sem.apodrecidas / sem.criadas) : 0;
const depois = com.criadas ? (com.apodrecidas / com.criadas) : 0;
console.log('  desperdício: ' + (antes * 100).toFixed(0) + '% -> ' + (depois * 100).toFixed(0) + '%'
  + '   |  peças não produzidas: ' + com.gateadas
  + '  (curador + redator + ' + (com.gateadas * 6) + '~' + (com.gateadas * 8) + ' renders poupados)');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
