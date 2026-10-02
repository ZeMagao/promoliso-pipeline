// Harness do patch "story ganha retry e peça sem imagem para de travar a fila". Offline, rodando o
// jsCode do `Selecionar READY` de verdade, nos dois estados (patch no ar ou não).
//
// O que precisa provar:
//   1. Com a fila de HOJE (toda peça com 2+ imagens) a escolha é IDÊNTICA — mesma row, mesmos
//      campos, mesmas URLs. O patch é porta fechada, não mudança de comportamento.
//   2. A peça envenenada (melhor nota, sem imagem) deixava de publicar TODOS os slots; agora ela
//      fica de fora e a próxima publica.
//   3. Fila só com peças sem imagem não derruba a execução (antes: erro em todo slot).
//   4. JSON quebrado e URL não-https não entram.
//   5. O retry da story entra sem mexer no onError, e não aplica duas vezes.
//   6. As âncoras do patch do host próprio continuam intactas — o test_cdn_publicador reverte o
//      dele, e se este patch pisasse nelas aquele harness ficaria vermelho sem nada quebrado.
//   7. `--reverter` volta byte a byte, nos dois nós.
//
//   node design/test_publicador_robustez.cjs
const fs = require('fs');
const path = require('path');
const { aplicarCodigo, aplicarStory, aplicarTudo, MARCA, RETRY, NO_STORY, NO_SELECIONAR, lf } = require('./patch_publicador_robustez.cjs');
const cdn = require('./patch_cdn_publicador.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows', 'promoliso-publicador-fila--E27F7yVdsZRj');
const AMOSTRA = path.join(__dirname, 'fila_amostra_20260820.json');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
}

const noAr = lf(fs.readFileSync(path.join(WFDIR, 'selecionar-ready.js'), 'utf8'));
const APLICADO = noAr.includes(MARCA);
console.log(APLICADO ? '# o export JÁ tem o patch — conferindo o que está no ar'
                     : '# o export ainda não tem o patch — conferindo a troca');
const antigo = APLICADO ? aplicarCodigo(noAr, true) : noAr;
const novo = APLICADO ? noAr : aplicarCodigo(noAr, false);

function rodar(codigo, rows) {
  const $input = { all: () => rows.map((json) => ({ json })) };
  try { return { saida: new Function('$input', codigo)($input) }; }
  catch (e) { return { erro: e.message }; }
}

const rowsAmostra = JSON.parse(fs.readFileSync(AMOSTRA, 'utf8'));
const agoraIso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const peca = (i, h, score, extra) => Object.assign({}, rowsAmostra[i], { created_at: agoraIso(h), score, status: 'READY' }, extra || {});

// 1. a fila de hoje: nada muda
const CENARIOS = [
  { nome: 'amostra crua (ramo C, tudo vencido)', rows: rowsAmostra },
  { nome: 'peça fresca ganha (ramo A)', rows: [peca(0, 30, 90), peca(1, 2, 70)] },
  { nome: 'entre 12 h e 48 h, nota decide (ramo B)', rows: [peca(2, 20, 70), peca(3, 40, 88)] },
  { nome: 'uma peça só', rows: [peca(4, 3, 75)] },
  { nome: 'RETRY concorre igual', rows: [peca(5, 5, 80, { status: 'RETRY' }), peca(6, 4, 79)] },
  { nome: 'fila sem publicável', rows: rowsAmostra.map((r) => Object.assign({}, r, { status: 'PUBLISHED' })) },
];
for (const cen of CENARIOS) {
  const a = rodar(antigo, cen.rows);
  const d = rodar(novo, cen.rows);
  ok(`${cen.nome}: saída idêntica`, JSON.stringify(a) === JSON.stringify(d),
    (JSON.stringify(a) || '').slice(0, 120) + ' VS ' + (JSON.stringify(d) || '').slice(0, 120));
}
const imagensNaAmostra = rowsAmostra.map((r) => { try { return JSON.parse(r.carousel_urls || '[]').length; } catch (e) { return -1; } });
ok(`amostra real: nenhuma peça com menos de 2 imagens (min ${Math.min(...imagensNaAmostra)})`,
  Math.min(...imagensNaAmostra.filter((n) => n >= 0)) >= 2);

// 2. a peça envenenada
const SEM_IMAGEM = { carousel_urls: JSON.stringify(['https://x/a.jpg']) };
const envenenada = [peca(0, 2, 95, SEM_IMAGEM), peca(1, 3, 70)];
const antesV = rodar(antigo, envenenada);
const depoisV = rodar(novo, envenenada);
ok('ANTES: peça envenenada derruba a execução (o defeito)', /insuficiente/.test(antesV.erro || ''), JSON.stringify(antesV).slice(0, 120));
ok('DEPOIS: a próxima publica', depoisV.saida && depoisV.saida.length === 1
  && depoisV.saida[0].json.content_key === String(envenenada[1].content_key), JSON.stringify(depoisV).slice(0, 160));
// mesmo resultado que a fila teria SEM a envenenada — ela some, não muda a regra
ok('DEPOIS: escolha igual à da fila sem a envenenada',
  JSON.stringify(depoisV) === JSON.stringify(rodar(antigo, [envenenada[1]])));
// envenenada no ramo A não pode empurrar a escolha para o ramo B por engano: se só ela era do dia,
// o ramo A fica vazio e a melhor de 12–48 h ganha
const soElaDoDia = [peca(0, 2, 95, SEM_IMAGEM), peca(1, 20, 70), peca(2, 30, 85)];
ok('envenenada única do dia: ramo B escolhe por nota',
  (rodar(novo, soElaDoDia).saida || [{ json: {} }])[0].json.content_key === String(soElaDoDia[2].content_key));

// 3. fila só com peças sem imagem
const soRuins = [peca(0, 2, 95, SEM_IMAGEM), peca(1, 3, 70, { carousel_urls: '[]' })];
ok('ANTES: fila só de peças ruins derruba a execução', !!rodar(antigo, soRuins).erro);
const dR = rodar(novo, soRuins);
ok('DEPOIS: devolve vazio, sem erro (o slot passa e o vigia avisa)', !dR.erro && Array.isArray(dR.saida) && dR.saida.length === 0,
  JSON.stringify(dR).slice(0, 120));

// 4. entradas tortas
const torta = [peca(0, 2, 95, { carousel_urls: '{quebrado' }), peca(1, 2, 94, { carousel_urls: JSON.stringify({ a: 1 }) }),
  peca(2, 2, 93, { carousel_urls: JSON.stringify(['http://inseguro/a.jpg', 'ftp://b', 7, null]) }), peca(3, 2, 60)];
const dT = rodar(novo, torta);
ok('JSON quebrado, objeto e URL não-https ficam de fora', dT.saida && dT.saida[0]
  && dT.saida[0].json.content_key === String(torta[3].content_key), JSON.stringify(dT).slice(0, 160));
// peça com mistura: as https contam, as outras somem (regra antiga, preservada)
const mistura = [peca(0, 2, 90, { carousel_urls: JSON.stringify([
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1/aaaa.jpg', 'http://x/b.jpg', 'https://res.cloudinary.com/fy2n2qvr/image/upload/v1/cccc.jpg']) })];
const aM = rodar(antigo, mistura); const dM = rodar(novo, mistura);
ok('peça com URL mista: mesma saída de antes (2 imagens https)', JSON.stringify(aM) === JSON.stringify(dM)
  && dM.saida[0].json.n_imagens === 2);

// 5. retry da story
const molde = () => [
  { name: NO_SELECIONAR, type: 'n8n-nodes-base.code', parameters: { jsCode: antigo } },
  { id: 'x', name: NO_STORY, type: 'n8n-nodes-instagram-integrations.instagram', typeVersion: 1, position: [0, 0],
    parameters: { resource: 'story' }, credentials: { a: 1 }, onError: 'continueRegularOutput' },
];
const nos = aplicarTudo(molde(), false);
const st = nos.find((n) => n.name === NO_STORY);
ok('story ganha retry 3× com 5 s', st.retryOnFail === true && st.maxTries === 3 && st.waitBetweenTries === 5000);
ok('story continua em continueRegularOutput (falha não derruba o post que já saiu)', st.onError === 'continueRegularOutput');
// o motor limita: maxTries ≤ 5, wait ≤ 5000 ms. Pedir mais seria cortado em silêncio.
ok('retry dentro do teto do motor do n8n (5 tentativas, 5000 ms)', RETRY.maxTries <= 5 && RETRY.waitBetweenTries <= 5000);
let doeu = false; try { aplicarStory(nos, false); } catch (e) { doeu = true; }
ok('aplicar a story duas vezes é erro', doeu);
let doeuCodigo = false; try { aplicarCodigo(novo, false); } catch (e) { doeuCodigo = true; }
ok('aplicar o código duas vezes é erro', doeuCodigo);
const outroOnError = molde(); outroOnError[1].onError = 'stopWorkflow';
let recusou = false; try { aplicarTudo(outroOnError, false); } catch (e) { recusou = /continueRegularOutput/.test(e.message); }
ok('story com onError inesperado: aborta em vez de presumir', recusou);

// 6. as âncoras do patch do host próprio
for (const e of cdn.EDICOES) {
  ok(`âncora do host próprio intacta: "${e.nome}"`, novo.split(lf(e.para)).length - 1 === 1);
}
let cdnRevertido = '';
try { cdnRevertido = cdn.aplicarTodas(novo, true); } catch (e) { cdnRevertido = 'ERRO: ' + e.message; }
ok('o patch do host próprio ainda reverte e reaplica em cima deste', cdn.aplicarTodas(cdnRevertido, false) === novo,
  cdnRevertido.slice(0, 100));

// 7. ida e volta
ok('reverter o código volta byte a byte', aplicarCodigo(novo, true) === antigo);
const volta = aplicarTudo(JSON.parse(JSON.stringify(nos)), true);
ok('reverter tudo devolve os dois nós byte a byte', JSON.stringify(volta) === JSON.stringify(molde()));

let compila = true; try { new Function('$input', novo); } catch (e) { compila = false; }
ok('jsCode resultante compila', compila);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
