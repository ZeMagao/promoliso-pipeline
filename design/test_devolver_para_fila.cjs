// Harness do "devolve para a fila". Offline, rodando os DOIS nós de código de verdade.
//
// O que precisa provar:
//   1. Falhou e está fresca -> volta como RETRY (o caso da row 38, que morreu com conteúdo bom).
//   2. Falhou vindo de RETRY -> FAILED. Sem isso uma peça quebrada seria escolhida em todo slot,
//      porque ela é sempre a mais velha — trocaríamos "perde uma pauta" por "perde o dia".
//   3. Falhou fora das 48 h -> FAILED.
//   4. O "Selecionar READY" enxerga RETRY e continua escolhendo do mesmo jeito de antes para o
//      resto (mais perto de vencer primeiro, mesma saída, mesmos campos).
//   5. O 48 h dos dois arquivos é o mesmo número.
//
//   node design/test_devolver_para_fila.cjs
const fs = require('fs');
const path = require('path');
const { trocar, conferirFrescor, ALVOS, semCabecalho } = require('./patch_devolver_para_fila.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows', 'promoliso-publicador-fila--E27F7yVdsZRj');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const lf = (s) => String(s).split('\r\n').join('\n');
const antigoSel = lf(fs.readFileSync(path.join(WFDIR, 'selecionar-ready.js'), 'utf8'));
const antigoFal = lf(fs.readFileSync(path.join(WFDIR, 'preparar-falha.js'), 'utf8'));
const APLICADO = antigoSel.includes('RETRY');
console.log(APLICADO ? '# export JÁ tem a devolução — verificando o que está no ar'
                     : '# export ainda não tem — verificando a troca');

let novoSel, novoFal;
if (APLICADO) {
  novoSel = antigoSel; novoFal = lf(fs.readFileSync(path.join(WFDIR, 'preparar-falha.js'), 'utf8'));
  ok('no ar está o bloco versionado (selecionar)', novoSel.includes(semCabecalho(ALVOS['Selecionar READY'].arquivo)));
  ok('no ar está o bloco versionado (falha)', novoFal.includes(semCabecalho(ALVOS['Preparar FALHA'].arquivo)));
} else {
  let e1 = null, e2 = null;
  try { novoSel = trocar(antigoSel, 'Selecionar READY'); } catch (e) { e1 = e.message; }
  try { novoFal = trocar(antigoFal, 'Preparar FALHA'); } catch (e) { e2 = e.message; }
  ok('o patch aplica no Selecionar READY (sha bate)', Boolean(novoSel), e1);
  ok('o patch aplica no Preparar FALHA (sha bate)', Boolean(novoFal), e2);
  if (!novoSel || !novoFal) { console.log('\nFALHA'); process.exit(1); }
  let re = null;
  try { trocar(novoSel, 'Selecionar READY'); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já fala de RETRY/.test(String(re)), re);
}

ok('o frescor é o mesmo número nos dois arquivos', conferirFrescor() === 48);

// ---- rodar os nós de verdade ----
const horasAtras = (h) => new Date(Date.now() - h * 3600000).toISOString();
const row = (over) => ({
  content_key: 'ck-1', topic: 'Pauta', status: 'READY', created_at: horasAtras(2), score: 70,
  carousel_urls: JSON.stringify(['https://c/0.jpg', 'https://c/1.jpg', 'https://c/2.jpg', 'https://c/3.jpg', 'https://c/4.jpg', 'https://c/5.jpg']),
  caption: 'legenda', story_url: 'https://c/s.jpg', primary_url: 'https://x/y', ...over,
});

function selecionar(code, rows) {
  const $input = { all: () => rows.map((json) => ({ json })) };
  return new Function('$input', '$', '$json', code)($input, () => ({ item: { json: {} } }), {});
}
function preparar(code, selecionado) {
  const $ = (nome) => {
    if (nome !== 'Selecionar READY') throw new Error('nó inesperado: ' + nome);
    return { item: { json: selecionado } };
  };
  return new Function('$', '$json', '$input', code)($, {}, { first: () => ({ json: {} }) })[0].json;
}

// ---- 1 a 3: a decisão ----
{
  const casos = [
    ['falhou fresca e de primeira', { status: 'READY', created_at: horasAtras(2) }, 'RETRY'],
    ['falhou fresca já vinda de RETRY', { status: 'RETRY', created_at: horasAtras(2) }, 'FAILED'],
    ['falhou já fora das 48h', { status: 'READY', created_at: horasAtras(60) }, 'FAILED'],
    ['falhou bem na borda (47h)', { status: 'READY', created_at: horasAtras(47) }, 'RETRY'],
    ['sem data legível', { status: 'READY', created_at: '' }, 'FAILED'],
  ];
  for (const [nome, over, esperado] of casos) {
    const sel = selecionar(novoSel, [row(over)])[0].json;
    const saida = preparar(novoFal, sel);
    ok(`${nome} -> ${esperado}`, saida.status === esperado, saida.status + ' | ' + saida.desfecho);
    ok(`  ...e o content_key vai junto`, saida.content_key === 'ck-1');
  }
}

// ---- 4. o Selecionar READY não pode ter mudado de comportamento ----
{
  const rows = [
    row({ content_key: 'nova', created_at: horasAtras(1) }),
    row({ content_key: 'quase-vencendo', created_at: horasAtras(40) }),
    row({ content_key: 'podre', created_at: horasAtras(70) }),
  ];
  const depois = selecionar(novoSel, rows)[0].json;
  ok('escolhe a que está mais perto de vencer', depois.content_key === 'quase-vencendo', depois.content_key);
  ok('a saída antiga continua completa',
    ['content_key', 'topic', 'cover', 'slides', 'caption', 'story_url', 'primary_url']
      .every((k) => depois[k] !== undefined));
  ok('e ganhou os dois campos novos', 'status_anterior' in depois && 'created_at' in depois);

  // comparação com o código anterior só faz sentido antes do deploy: depois dele o export JÁ é o
  // código novo, e comparar o novo consigo mesmo não prova nada
  if (!APLICADO) {
    const antes = selecionar(antigoSel, rows)[0].json;
    ok('escolhe a mesma peça que o código antigo escolhia', antes.content_key === depois.content_key,
      antes.content_key + ' vs ' + depois.content_key);
    ok('a saída antiga foi preservada campo a campo',
      ['content_key', 'topic', 'cover', 'slides', 'caption', 'story_url', 'primary_url']
        .every((k) => JSON.stringify(antes[k]) === JSON.stringify(depois[k])));
    const soRetry0 = [row({ content_key: 'devolvida', status: 'RETRY', created_at: horasAtras(3) })];
    ok('antes o RETRY era invisível', selecionar(antigoSel, soRetry0).length === 0);
  } else {
    console.log('(pulei as comparações com o código antigo: o export já é o novo)');
  }

  const soRetry = [row({ content_key: 'devolvida', status: 'RETRY', created_at: horasAtras(3) })];
  ok('RETRY é publicável', selecionar(novoSel, soRetry)[0].json.content_key === 'devolvida');

  // e status desconhecido continua fora
  const lixo = [row({ status: 'PUBLISHING' }), row({ status: 'FAILED' }), row({ status: 'PUBLISHED' })];
  ok('PUBLISHING/FAILED/PUBLISHED seguem fora', selecionar(novoSel, lixo).length === 0);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
