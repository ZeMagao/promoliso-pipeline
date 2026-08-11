// Harness do detector de cota do watchdog. Roda o jsCode REAL do nó "Avaliar saude", antes e
// depois do patch, contra registros de curadoria montados à mão.
//
// O caso central usa a STRING DE VERDADE que disparou o alarme falso de 11/08: um pedaço de path
// de SVG que veio no HTML do PlayStation Blog, dentro do registro 257:6:1dr2qt1, que estava
// CURADO_APROVAVEL.
//
//   node design/test_watchdog_ruido.cjs
const fs = require('fs');
const path = require('path');
const { trocar, DE, PARA } = require('./patch_watchdog_ruido.cjs');

const ARQ = path.join(__dirname, '..', 'workflows',
  'promoliso-monitor-de-saude-watchdog--MJly91QFGKep', 'avaliar-saude.js');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

// trecho literal de resultados_dos_agentes do registro 257:6:1dr2qt1 (exec 257, 11/08 12:00 BRT)
const SVG_REAL = '7c0 .547-.022.976-.067 1.286-.045.311-.12.532-.227.662a.524.524 0 0 1-.429.197'
  + '.783.783 0 0 1-.386-.099.738.738 0 0 1-.288-.294V5.3';

const agora = new Date();
const iso = (minAtras) => new Date(agora.getTime() - minAtras * 60000).toISOString();

const registro = (over) => Object.assign({
  item_id: 'x', status_processamento: 'CURADO_APROVAVEL', erro_processamento: '',
  motivo: 'Justificativa editorial normal.', alertas: '[]',
  resposta_bruta_ia: '', resultados_dos_agentes: '',
  data_avaliacao: iso(5),
}, over);

// fila com um post recente: isola o detector de cota do alerta de "sem publicacao ha Xh"
const FILA = [{ status: 'PUBLISHED', published_at: iso(60) }];

function rodarNo(code, curadoria, fila) {
  const stub = (linhas) => ({
    all: () => linhas.map((json) => ({ json })),
    first: () => ({ json: linhas[0] || {} }),
    item: { json: linhas[0] || {} },
  });
  const $ = (nome) => {
    if (nome === 'Ler curadoria') return stub(curadoria);
    if (nome === 'Ler fila') return stub(fila || FILA);
    throw new Error('nó inesperado: ' + nome);
  };
  const $input = { first: () => ({ json: {} }), all: () => [{ json: {} }] };
  return new Function('$input', '$', '$json', 'require', code)($input, $, {}, require);
}
const alertou = (saida) => Array.isArray(saida) && saida.length > 0;
const corpoDe = (saida) => (saida[0] && saida[0].json && saida[0].json.corpo) || '';

const exportado = fs.readFileSync(ARQ, 'utf8');
const APLICADO = exportado.includes('const re429');
console.log(APLICADO
  ? '# export JÁ tem o detector novo — verificando o que está no ar'
  : '# export ainda tem o detector antigo — verificando a aplicação');

let antes, depois;
if (APLICADO) {
  depois = exportado;
  const vezes = exportado.split(PARA).length - 1;
  ok('consigo reconstruir o detector antigo', vezes === 1, `achei ${vezes} trechos`);
  antes = exportado.split(PARA).join(DE);
} else {
  antes = exportado;
  let erro = null;
  try { depois = trocar(antes); } catch (e) { erro = e.message; }
  ok('patch aplica no código exportado', Boolean(depois), erro);
}
if (!antes || !depois) { console.log('\n1 FALHA(S)'); process.exit(1); }

let reErro = null;
try { trocar(depois); } catch (e) { reErro = e.message; }
ok('recusa reaplicação', /já aplicado/.test(String(reErro)), reErro);

// ---- 1. O CASO REAL: SVG no payload de um registro APROVADO ----
{
  const caso = [registro({
    item_id: '257:6:1dr2qt1',
    status_processamento: 'CURADO_APROVAVEL',
    resultados_dos_agentes: '{"coletor_normalizador":{"status":"sucesso","html":"<path d=\\"' + SVG_REAL + '\\"/>"}}',
  })];
  ok('[regressão] o detector ANTIGO alarma com o path de SVG', alertou(rodarNo(antes, caso)));
  const novo = rodarNo(depois, caso);
  ok('[corrigido] não alarma mais', !alertou(novo), corpoDe(novo).slice(0, 120));
}

// ---- 2. quota de verdade CONTINUA sendo pega ----
{
  const mensagens = {
    'insufficient_quota': 'OpenAI: 429 - {"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}',
    'rate limit': 'Rate limit reached for gpt-4o-mini in organization org-x on tokens per min',
    'too many requests': '429 Too Many Requests',
    '429 seco em campo de erro': '429',
  };
  for (const [rotulo, msg] of Object.entries(mensagens)) {
    const caso = [registro({ status_processamento: 'ERRO_CURADORIA', erro_processamento: msg })];
    const saida = rodarNo(depois, caso);
    ok(`[cota real] pega "${rotulo}"`, alertou(saida), 'nao alarmou');
    if (alertou(saida)) ok(`[cota real] "${rotulo}" cita cota no corpo`, /cota\/limite/.test(corpoDe(saida)));
  }
}

// ---- 3. quota citada no payload cru de um registro EM ERRO também é pega ----
{
  const caso = [registro({
    status_processamento: 'ERRO_CURADORIA',
    erro_processamento: 'falhou',
    resposta_bruta_ia: 'Error: insufficient_quota — You exceeded your current quota',
  })];
  ok('[cota real] payload cru de registro em erro ainda é varrido', alertou(rodarNo(depois, caso)));
}

// ---- 4. ruído que o detector antigo pegava e o novo ignora ----
{
  const ruidos = {
    'notícia sobre cota de armazenamento': registro({ motivo: 'A materia fala de quota de armazenamento no PS Plus.' }),
    'preço 429 no HTML raspado': registro({ resultados_dos_agentes: '{"preco":"R$ 429,90","status":"sucesso"}' }),
    'dimensão 429px no payload': registro({ resposta_bruta_ia: '<img width="429" height="241">' }),
  };
  for (const [rotulo, r] of Object.entries(ruidos)) {
    ok(`[ruído] não alarma: ${rotulo}`, !alertou(rodarNo(depois, [r])));
  }
}

// ---- 5. o outro alerta (sem publicação) não pode ter sido afetado ----
{
  const saudavel = [registro({})];
  const filaVelha = [{ status: 'PUBLISHED', published_at: iso(40 * 60) }]; // ~40h
  const saida = rodarNo(depois, saudavel, filaVelha);
  ok('[sem publicação] ainda alarma com 40h', alertou(saida) && /Sem publicacao/.test(corpoDe(saida)));
  ok('[sem publicação] não menciona cota', !/cota\/limite/.test(corpoDe(saida)));

  const filaOk = [{ status: 'PUBLISHED', published_at: iso(60) }];
  ok('[saudável] silêncio total', !alertou(rodarNo(depois, saudavel, filaOk)));
}

// ---- 6. registro fora da janela do último run não conta ----
{
  const caso = [
    registro({ data_avaliacao: iso(5) }),
    registro({ status_processamento: 'ERRO_CURADORIA', erro_processamento: 'insufficient_quota', data_avaliacao: iso(300) }),
  ];
  ok('erro de 5h atrás não alarma (só o último run conta)', !alertou(rodarNo(depois, caso)));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
