// Harness do ramo B por nota. Offline, rodando o nó de verdade — e contra a FILA REAL de 20/08,
// para responder a pergunta que motivou a mudança: "qual peça sai agora, antes e depois?".
//
//   node design/test_ramo_b_por_nota.cjs
const fs = require('fs');
const path = require('path');
const { trocar, destrocar, MARCA, NO, lf } = require('./patch_ramo_b_por_nota.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows', 'promoliso-publicador-fila--E27F7yVdsZRj');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const antigo = lf(fs.readFileSync(path.join(WFDIR, 'selecionar-ready.js'), 'utf8'));
const APLICADO = antigo.includes(MARCA);
console.log(APLICADO ? '# export JÁ ordena o ramo B por nota — verificando o que está no ar'
                     : '# export ainda ordena o ramo B por idade — verificando a troca');

let novo;
console.log('\n# A. o patch');
if (APLICADO) {
  novo = antigo;
  let re = null;
  try { trocar(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já ordena por nota/.test(String(re)), re);
} else {
  let e1 = null;
  try { novo = trocar(antigo); } catch (e) { e1 = e.message; }
  ok('o patch aplica', Boolean(novo), e1);
  if (!novo) { console.log('\nFALHA'); process.exit(1); }
  ok('reverter devolve byte a byte', destrocar(novo) === antigo);
  let e2 = null;
  try { destrocar(antigo); } catch (e) { e2 = e.message; }
  ok('recusa reverter o que não foi aplicado', /não está por nota/.test(String(e2)), e2);
}
ok('o ramo C continua por mais nova', novo.includes('ready.slice().sort(maisNovaPrimeiro)'));
ok('o ramo A continua por nota', novo.includes('doDia.slice().sort(porNota)'));

// ---------------------------------------------------------------- rodar o nó
const horasAtras = (h) => new Date(Date.now() - h * 3600000).toISOString();
const seisUrls = JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => 'https://c/' + x + '.jpg'));
const row = (over) => ({
  content_key: 'ck', topic: 'Pauta', status: 'READY', created_at: horasAtras(2), score: 70,
  carousel_urls: seisUrls, caption: 'l', story_url: 'https://c/s.jpg', primary_url: 'https://x/y',
  ...over,
});
const escolher = (code, rows) => {
  const $input = { all: () => rows.map((json) => ({ json })) };
  const saida = new Function('$input', '$', '$json', code)($input, () => ({ item: { json: {} } }), {});
  return saida.length ? saida[0].json : null;
};

console.log('\n# B. comportamento por ramo');

// ramo B: nada com menos de 12 h. A mais nova tem nota pior.
const ramoB = [
  row({ topic: 'nova e fraca', created_at: horasAtras(13), score: 71 }),
  row({ topic: 'velha e forte', created_at: horasAtras(44), score: 88 }),
];
ok('ramo B: antes saía a mais nova', escolher(antigo, ramoB).topic === 'nova e fraca',
  escolher(antigo, ramoB).topic);
ok('ramo B: agora sai a de melhor nota', escolher(novo, ramoB).topic === 'velha e forte',
  escolher(novo, ramoB).topic);

// desempate de nota igual: a mais nova ganha
const empate = [
  row({ topic: 'empate velha', created_at: horasAtras(40), score: 80 }),
  row({ topic: 'empate nova', created_at: horasAtras(20), score: 80 }),
];
ok('ramo B: nota igual desempata pela mais nova', escolher(novo, empate).topic === 'empate nova',
  escolher(novo, empate).topic);

// ramo A tem prioridade absoluta: peça de hoje ganha de peça velha com nota melhor
const ramoA = [
  row({ topic: 'de hoje', created_at: horasAtras(3), score: 70 }),
  row({ topic: 'de ontem, nota melhor', created_at: horasAtras(40), score: 95 }),
];
ok('ramo A ainda tem prioridade sobre o ramo B', escolher(novo, ramoA).topic === 'de hoje',
  escolher(novo, ramoA).topic);
ok('e a troca não mexeu nisso', escolher(antigo, ramoA).topic === escolher(novo, ramoA).topic);

// dentro do ramo A a nota já decidia — não deve ter mudado
const soHoje = [
  row({ topic: 'hoje fraca', created_at: horasAtras(1), score: 70 }),
  row({ topic: 'hoje forte', created_at: horasAtras(9), score: 90 }),
];
ok('ramo A: nota decide, igual a antes',
  escolher(antigo, soHoje).topic === 'hoje forte' && escolher(novo, soHoje).topic === 'hoje forte');

// ramo C: só peças vencidas. Continua a mais nova, mesmo com nota pior.
const ramoC = [
  row({ topic: 'vencida nova', created_at: horasAtras(60), score: 60 }),
  row({ topic: 'vencida velha', created_at: horasAtras(200), score: 99 }),
];
ok('ramo C: continua a mais nova, nota não salva notícia vencida',
  escolher(antigo, ramoC).topic === 'vencida nova' && escolher(novo, ramoC).topic === 'vencida nova');

// RETRY participa igual
const comRetry = [
  row({ topic: 'ready fraca', created_at: horasAtras(20), score: 70, status: 'READY' }),
  row({ topic: 'retry forte', created_at: horasAtras(30), score: 85, status: 'RETRY' }),
];
ok('RETRY concorre pela nota como qualquer outra', escolher(novo, comRetry).topic === 'retry forte',
  escolher(novo, comRetry).topic);

// contrato de saída preservado
const saida = escolher(novo, [row({ score: 80, created_at: horasAtras(20) })]);
ok('contrato de saída intacto (n_imagens, saida_carrossel, idade_h)',
  saida.n_imagens === 6 && saida.saida_carrossel === 4 && typeof saida.idade_h === 'number',
  JSON.stringify({ n: saida.n_imagens, s: saida.saida_carrossel, i: saida.idade_h }));

// ---------------------------------------------------------------- contra a fila real
// A prova que importa: RECONSTRUIR o estado da fila em cada instante de publicação real e ver o que
// o nó escolheria ali, antes e depois. Uma row estava disponível no instante T se nasceu antes de T
// e (não foi publicada, ou foi publicada depois de T). Isso não simula nada — é o estado que existiu.
//
// O nó lê o relógio (`Date.now()`), então para avaliar o instante T deslocamos TODAS as datas em
// (agora - T). As idades relativas ficam idênticas às que o nó viu de verdade naquele slot.
console.log('\n# C. reconstrução dos slots reais de publicação (fila de 20/08)');
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fila_amostra_20260820.json'), 'utf8'));
ok('a amostra tem as 68 rows da fila', real.length === 68, String(real.length));

const publicadas = real
  .filter((r) => r.published_at && String(r.status).toUpperCase() === 'PUBLISHED')
  .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));

const disponiveisEm = (T) => real.filter((r) => {
  if (Date.parse(r.created_at) > T) return false;
  // no instante T a row ainda não tinha sido publicada
  if (r.published_at && Date.parse(r.published_at) <= T) return false;
  // FAILED nunca volta pra fila; RETRY e READY concorrem
  return ['READY', 'RETRY', 'PUBLISHED'].includes(String(r.status).toUpperCase());
});

const escolherEm = (code, T) => {
  const desloc = Date.now() - T;
  const rows = disponiveisEm(T).map((r) => ({
    ...r, created_at: new Date(Date.parse(r.created_at) + desloc).toISOString(),
  }));
  if (!rows.length) return null;
  try { return escolher(code, rows); } catch (e) { return { topic: 'ERRO: ' + e.message, score: null }; }
};

const notaDe = (t) => {
  const r = real.find((x) => x.topic === t);
  return r ? Number(r.score || 0) : null;
};

// SÓ OS SLOTS DE 14/08 EM DIANTE. Antes disso o nó era outro código: a janela do dia (o ramo A)
// entrou em 14/08 com `a3b37bc` — "publicador escolhe a notícia do DIA"; até 13/08 o publicador
// pegava a mais perto de vencer. Classificar as 23 publicações antigas nos ramos A/B/C dá número
// bonito e sem sentido, porque os ramos não existiam. É o erro que este comentário existe para
// impedir de repetir: 08-07T15:31 tinha peça de 12 h disponível e publicou uma de 40,5 h, o que o
// código de hoje nunca faria.
//
// No regime atual (3 slots/dia, ~4 peças/dia) quase sempre existe peça de hoje, então o ramo A
// decide: medido, A=11 e B=3 nas 14 publicações desde 14/08.
//
// Logo: ESTA TROCA É QUASE INERTE NO REGIME DE HOJE, e o harness registra isso em vez de fingir
// efeito. Ela vale como seguro: se a produção cair (feed morto, token fora, dia sem pauta), o ramo B
// volta a decidir e aí a nota volta a importar. O que o harness cobra é o INVARIANTE — sempre que o
// ramo B decidir, sai a melhor nota entre as frescas.
const CORTE_REGIME = Date.parse('2026-08-14T00:00:00Z');   // a3b37bc: quando o ramo A passou a existir
const slots = { antigo: [], atual: [] };
for (const p of publicadas.filter((x) => Date.parse(x.published_at) >= CORTE_REGIME)) {
  const T = Date.parse(p.published_at) - 1000;   // 1 s antes do slot: o estado que o nó viu
  const d = disponiveisEm(T);
  const idade = (r) => (T - Date.parse(r.created_at)) / 3600000;
  const doDia = d.filter((r) => idade(r) <= 12);
  const frescas = d.filter((r) => idade(r) <= 48);
  if (doDia.length || frescas.length < 2) continue;   // só slots que o ramo B decidiu, com escolha real
  (Date.parse(p.published_at) < CORTE_REGIME ? slots.antigo : slots.atual).push({ p, T, frescas });
}
console.log('  slots decididos pelo ramo B (14/08 em diante, com 2+ frescas): ' + slots.atual.length
  + ' de ' + publicadas.filter((x) => Date.parse(x.published_at) >= CORTE_REGIME).length);
ok('o ramo B é minoria no regime atual — esta troca é seguro, não conserto',
  slots.atual.length <= 4, String(slots.atual.length));

let mudou = 0, ganho = 0;
const invariante = [];
for (const s of [...slots.antigo, ...slots.atual]) {
  const a = escolherEm(antigo, s.T);
  const b = escolherEm(novo, s.T);
  if (!a || !b) continue;
  const melhor = Math.max(...s.frescas.map((r) => Number(r.score || 0)));
  invariante.push({ quando: s.p.published_at.slice(5, 16), escolhida: Number(notaDe(b.topic)), melhor });
  if (a.topic !== b.topic) {
    mudou++;
    ganho += Number(notaDe(b.topic)) - Number(notaDe(a.topic));
    console.log('    ' + s.p.published_at.slice(5, 16) + '  nota ' + notaDe(a.topic)
      + ' -> ' + notaDe(b.topic) + '   ' + String(b.topic).slice(0, 40));
  }
}
ok('INVARIANTE: quando o ramo B decide, sai a melhor nota entre as frescas',
  invariante.every((x) => x.escolhida === x.melhor),
  JSON.stringify(invariante.filter((x) => x.escolhida !== x.melhor)));
ok('a escolha nunca piora de nota', ganho >= 0, 'soma ' + ganho);
console.log('  escolhas alteradas: ' + mudou + (mudou ? '  (+' + (ganho / mudou).toFixed(1) + ' de nota em média)' : ''));

// O que o ramo A custa, medido: ele tem prioridade absoluta, então peça de ontem com nota melhor
// perde de peça de hoje com nota pior. Isto NÃO é consertado por este patch — é registrado aqui
// porque foi a medição que impediu a gente de "consertar" o portão de 12 h por engano.
let slotsA = 0, deixou = 0, vezes = 0;
for (const p of publicadas.filter((x) => Date.parse(x.published_at) >= CORTE_REGIME)) {
  const T = Date.parse(p.published_at) - 1000;
  const frescas = disponiveisEm(T).filter((r) => (T - Date.parse(r.created_at)) / 3600000 <= 48);
  if (frescas.length < 2) continue;
  slotsA++;
  const melhor = Math.max(...frescas.map((r) => Number(r.score || 0)));
  const dif = melhor - Number(p.score || 0);
  if (dif > 0) { vezes++; deixou += dif; }
}
console.log('  [contexto] portão de 12 h: em ' + slotsA + ' slots desde 15/08 deixou nota melhor na'
  + ' mesa ' + vezes + ' vezes, média ' + (deixou / slotsA).toFixed(1) + ' ponto por slot');
ok('o custo do portão de 12 h continua pequeno (< 5 pontos por slot) — se subir, revisar a decisão',
  deixou / slotsA < 5, (deixou / slotsA).toFixed(1));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
