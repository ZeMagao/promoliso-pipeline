// Harness do patch no nó do Instagram (retry por filho, mensagem do Meta, filho sem id). Offline.
//
// Roda o CÓDIGO REAL do nó — `vps/instagram-node/`, cópia byte a byte do que está no VPS — antes e
// depois do patch, com um `this` do n8n falso e um Instagram falso que responde o que o cenário
// mandar. O relógio também é falso: as esperas de 15/30/60 s passam na hora, mas contam no prazo.
// Com o `n8n-workflow` instalado (npm install) os erros são os de verdade; sem ele, um substituto
// com a mesma regra de mensagem — o harness avisa qual usou.
//
// O que precisa provar:
//   1. Caminho feliz: MESMAS chamadas, na mesma ordem, com os mesmos corpos, e a mesma saída.
//   2. Um filho que falha uma vez (o 9004 de 16/09) não derruba mais o carrossel.
//   3. Erro que não é passageiro NÃO é repetido (repetir 400 de parâmetro só gasta tempo).
//   4. A mensagem que chega no `json.error` é a do Meta, não "Bad request".
//   5. Filho sem id deixa de ser descartado calado.
//   6. O teto de tempo segura: o n8n roda uma execução por vez.
//   7. Outras operações (publicar, story) fazem as mesmas chamadas de antes.
//   8. Aplicar 2× é erro; reverter volta byte a byte; o patch do token continua lá.
//
//   node design/test_dist_instagram.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { patchNo, patchGF, lf, compila, MARCA_TOKEN, MARCA_NO, MARCA_GF } = require('./patch_dist_instagram.cjs');

const BASE = path.join(__dirname, '..', 'vps', 'instagram-node');
const ORIG_NO = lf(fs.readFileSync(path.join(BASE, 'Instagram.node.js'), 'utf8'));
const ORIG_GF = lf(fs.readFileSync(path.join(BASE, 'GenericFunctions.js'), 'utf8'));

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
}

// ── n8n-workflow: o de verdade se houver, senão um substituto fiel à regra da mensagem ──────────
let wf;
try {
  if (process.env.PROMO_SEM_N8N) throw new Error('forçado');   // simula a CI, que não instala nada
  wf = require('n8n-workflow');
  console.log('# n8n-workflow real (' + require('n8n-workflow/package.json').version + ')');
} catch (e) {
  const STATUS = { 400: 'Bad request - please check your parameters', 500: 'The service was not able to process your request' };
  class NodeApiError extends Error {
    constructor(node, err, opts) {
      super((opts && opts.message) || STATUS[err && err.statusCode] || (err && err.message) || 'erro');
      this.httpCode = err && err.statusCode ? String(err.statusCode) : null;
    }
  }
  class NodeOperationError extends Error { constructor(node, msg) { super(typeof msg === 'string' ? msg : String(msg && msg.message)); } }
  wf = { NodeApiError, NodeOperationError };
  console.log('# n8n-workflow ausente: usando substituto (rode `npm install` para a prova com o real)');
}

// ── relógio falso ──────────────────────────────────────────────────────────────────────────────
const relogio = { agora: Date.parse('2026-10-02T15:30:00Z'), esperas: [] };
class DataFalsa extends Date {
  constructor(...a) { super(...(a.length ? a : [relogio.agora])); }
  static now() { return relogio.agora; }
}
const setTimeoutFalso = (fn, ms) => { relogio.esperas.push(ms); relogio.agora += ms; setImmediate(fn); return 0; };

// ── carregar o nó a partir do texto, com require controlado ────────────────────────────────────
const CASA = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-harness-'));
// token "válido por 50 dias" no lugar onde o patch do token procura: nenhuma troca de token acontece
fs.writeFileSync(path.join(CASA, 'ig-token.json'), JSON.stringify({ token: 'TOKEN', expiresAt: Math.floor(relogio.agora / 1000) + 50 * 86400 }));
const osFalso = Object.assign({}, os, { homedir: () => CASA });

function modulo(texto, nome, req) {
  const m = { exports: {} };
  const f = vm.runInThisContext('(function (exports, require, module, __filename, __dirname, setTimeout, Date) {' + texto + '\n})', { filename: nome });
  f(m.exports, req, m, nome, BASE, setTimeoutFalso, DataFalsa);
  return m.exports;
}
function carregar(textoNo, textoGF) {
  const gf = modulo(textoGF, 'GenericFunctions.js', (n) => (n === 'n8n-workflow' ? wf : n === 'os' ? osFalso : require(n)));
  return modulo(textoNo, 'Instagram.node.js', (n) => (n === 'n8n-workflow' ? wf : n === './GenericFunctions' ? gf : n === 'os' ? osFalso : require(n))).Instagram;
}
const ANTES = carregar(ORIG_NO, ORIG_GF);
const NOVO_NO = patchNo(ORIG_NO, false);
const NOVO_GF = patchGF(ORIG_GF, false);
const DEPOIS = carregar(NOVO_NO, NOVO_GF);

// ── Instagram falso ────────────────────────────────────────────────────────────────────────────
const erroMeta = (status, error) => Object.assign(new Error(status + ' - ' + JSON.stringify({ error })),
  { statusCode: status, status, error: { error }, response: { status, headers: {} } });
const E9004 = () => erroMeta(400, { message: 'Only photo or video can be accepted as media type.', type: 'OAuthException',
  code: 9004, error_subcode: 2207052, is_transient: false, error_user_msg: 'Media download has failed. The media URI doesn\'t meet our requirements.' });
const E100 = () => erroMeta(400, { message: 'Invalid parameter', type: 'OAuthException', code: 100, error_subcode: 2207067 });
const E500 = () => erroMeta(500, { message: 'An unexpected error has occurred.', code: 2, is_transient: true });
const EREDE = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

const URLS = Array.from({ length: 6 }, (_, i) => `https://n8n.promoliso.com.br/cdn/v1/img${i}.jpg`);
const PARAMS_CARROSSEL = {
  resource: 'post', operation: 'createCarouselPost',
  carouselChildren: { child: URLS.map((u) => ({ media_type: 'IMAGE', image_url: u })) },
  carouselCaption: 'legenda', carouselAdditionalOptions: {},
};
const NO = { name: 'Carrossel 06', type: 'n8n-nodes-instagram-integrations.instagram', typeVersion: 1, parameters: {} };

// `roteiro(opts, nFilho, tentativaDoFilho)` decide a resposta de cada POST de filho.
async function rodar(Classe, params, roteiro) {
  const chamadas = [];
  const porImagem = {};
  relogio.esperas = [];
  const inicio = relogio.agora;
  const ctx = {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (n, i, d) => (n in params ? JSON.parse(JSON.stringify(params[n])) : d),
    getNode: () => NO,
    continueOnFail: () => true,
    getCredentials: async () => ({}),
    helpers: {
      request: async (o) => {
        chamadas.push({ method: o.method, url: o.url, body: o.body, qs: Object.assign({}, o.qs) });
        if (/\/me$/.test(o.url)) return { id: 'IGID' };
        if (o.body && o.body.is_carousel_item) {
          const k = o.body.image_url;
          porImagem[k] = (porImagem[k] || 0) + 1;
          const r = roteiro ? roteiro(o, URLS.indexOf(k), porImagem[k]) : null;
          if (r instanceof Error) throw r;
          return r || { id: 'F' + URLS.indexOf(k) };
        }
        if (o.body && o.body.media_type === 'CAROUSEL') return { id: 'CARROSSEL', filhos: o.body.children };
        if (/media_publish$/.test(o.url)) return roteiro && roteiro(o, -1, 1) instanceof Error ? (() => { throw roteiro(o, -1, 1); })() : { id: 'POST' };
        return { id: 'X' };
      },
    },
  };
  const out = await new Classe().execute.call(ctx);
  return { json: out[0][0].json, chamadas, esperas: relogio.esperas.slice(), duracao: relogio.agora - inicio };
}

(async () => {
  // 1. caminho feliz
  const a1 = await rodar(ANTES, PARAMS_CARROSSEL);
  const d1 = await rodar(DEPOIS, PARAMS_CARROSSEL);
  ok('feliz: mesmas chamadas, mesma ordem, mesmos corpos', JSON.stringify(a1.chamadas) === JSON.stringify(d1.chamadas),
    a1.chamadas.length + ' vs ' + d1.chamadas.length);
  ok('feliz: mesma saída', JSON.stringify(a1.json) === JSON.stringify(d1.json), JSON.stringify(d1.json));
  ok('feliz: 1 GET /me + 6 filhos + 1 carrossel, sem espera', d1.chamadas.length === 8 && d1.esperas.length === 0);

  // 2. o 9004 de 16/09, uma vez no 3º filho
  const umaVez = (o, n, t) => (n === 2 && t === 1 ? E9004() : null);
  const a2 = await rodar(ANTES, PARAMS_CARROSSEL, umaVez);
  const d2 = await rodar(DEPOIS, PARAMS_CARROSSEL, umaVez);
  ok('ANTES: um filho com 9004 derruba o carrossel (o defeito)', !!a2.json.error, JSON.stringify(a2.json));
  ok('DEPOIS: o carrossel sai, com os 6 filhos na ordem', d2.json.id === 'CARROSSEL' && d2.json.filhos === 'F0,F1,F2,F3,F4,F5', JSON.stringify(d2.json));
  ok('DEPOIS: repetiu SÓ o filho que falhou, depois de 15 s', d2.chamadas.length === 9 && JSON.stringify(d2.esperas) === '[15000]',
    d2.chamadas.length + ' chamadas, esperas ' + JSON.stringify(d2.esperas));

  // 4. a mensagem
  ok('ANTES: a mensagem é o genérico "Bad request" (o defeito)', /Bad request/i.test(a2.json.error || ''), a2.json.error);
  const sempre9004 = (o, n) => (n === 2 ? E9004() : null);
  const d4 = await rodar(DEPOIS, PARAMS_CARROSSEL, sempre9004);
  ok('DEPOIS: falha persistente vira erro com o texto do Meta',
    /9004\/2207052/.test(d4.json.error || '') && /Media download has failed/.test(d4.json.error || ''), d4.json.error);
  ok('DEPOIS: falha persistente tenta 4× (15, 30, 60 s) e desiste', JSON.stringify(d4.esperas) === '[15000,30000,60000]',
    JSON.stringify(d4.esperas));
  ok('DEPOIS: não cria o carrossel pai com filho faltando', !d4.chamadas.some((c) => c.body && c.body.media_type === 'CAROUSEL'));

  // 3. erro que não é passageiro
  const d3 = await rodar(DEPOIS, PARAMS_CARROSSEL, (o, n) => (n === 0 ? E100() : null));
  ok('parâmetro inválido (code 100) NÃO é repetido', d3.esperas.length === 0 && /code 100/.test(d3.json.error || ''), d3.json.error);

  // passageiros que não são 9004
  const d5 = await rodar(DEPOIS, PARAMS_CARROSSEL, (o, n, t) => (n === 1 && t === 1 ? E500() : null));
  ok('HTTP 500 / is_transient é repetido', d5.json.id === 'CARROSSEL' && d5.esperas.length === 1, JSON.stringify(d5.json));
  const d6 = await rodar(DEPOIS, PARAMS_CARROSSEL, (o, n, t) => (n === 4 && t <= 2 ? EREDE() : null));
  ok('erro de rede (sem status) é repetido', d6.json.id === 'CARROSSEL' && JSON.stringify(d6.esperas) === '[15000,30000]',
    JSON.stringify(d6.esperas) + ' ' + JSON.stringify(d6.json));

  // 5. filho sem id
  const semId = (o, n, t) => (n === 3 && t === 1 ? {} : null);
  const a7 = await rodar(ANTES, PARAMS_CARROSSEL, semId);
  const d7 = await rodar(DEPOIS, PARAMS_CARROSSEL, semId);
  ok('ANTES: filho sem id some calado e o carrossel sai com 5 (o defeito)', a7.json.filhos === 'F0,F1,F2,F4,F5', JSON.stringify(a7.json));
  ok('DEPOIS: filho sem id é repetido e o carrossel sai com 6', d7.json.filhos === 'F0,F1,F2,F3,F4,F5', JSON.stringify(d7.json));
  const d8 = await rodar(DEPOIS, PARAMS_CARROSSEL, (o, n) => (n === 3 ? {} : null));
  ok('DEPOIS: sem id para sempre vira erro claro', /respondeu sem id/.test(d8.json.error || ''), d8.json.error);

  // 6. o teto de tempo: todo filho falha 2× antes de passar (45 s cada) — o prazo de 180 s estoura
  const d9 = await rodar(DEPOIS, PARAMS_CARROSSEL, (o, n, t) => (t <= 2 ? E9004() : null));
  ok('teto: espera somada nunca passa de 180 s', d9.esperas.reduce((s, x) => s + x, 0) <= 180000, JSON.stringify(d9.esperas));
  ok('teto: estourou, o erro sobe (e o retry do n8n decide o resto)', !!d9.json.error, JSON.stringify(d9.json));
  // pior caso do n8n: 3 passadas × (esperas ≤ 180 s) — longe da próxima hora par do produtor
  ok('pior caso por execução fica abaixo de 15 min de espera', 3 * 180000 + 2 * 5000 < 15 * 60000);

  // 7. outras operações
  const PUB = { resource: 'post', operation: 'publishPost', creationId: 'C1' };
  const a10 = await rodar(ANTES, PUB); const d10 = await rodar(DEPOIS, PUB);
  ok('publishPost: mesmas chamadas e mesma saída', JSON.stringify(a10) === JSON.stringify(d10));
  const falhaPub = (o) => E100();
  const a11 = await rodar(ANTES, PUB, falhaPub); const d11 = await rodar(DEPOIS, PUB, falhaPub);
  ok('publishPost com erro: NÃO ganha retry (publicar 2× duplicaria o post)', d11.chamadas.length === a11.chamadas.length && d11.esperas.length === 0);
  ok('publishPost com erro: mensagem passa a ser a do Meta', /Meta HTTP 400 code 100\/2207067: Invalid parameter/.test(d11.json.error || ''), d11.json.error);

  // 8. o patch em si
  let doeu = 0;
  try { patchNo(NOVO_NO, false); } catch (e) { doeu++; }
  try { patchGF(NOVO_GF, false); } catch (e) { doeu++; }
  ok('aplicar duas vezes é erro, nos dois arquivos', doeu === 2);
  ok('reverter volta byte a byte', patchNo(NOVO_NO, true) === ORIG_NO && patchGF(NOVO_GF, true) === ORIG_GF);
  ok('patch do token continua no GenericFunctions', NOVO_GF.includes(MARCA_TOKEN) && ORIG_GF.includes(MARCA_TOKEN));
  ok('marcas que o vigia procura estão no patch', NOVO_NO.includes(MARCA_NO) && NOVO_GF.includes(MARCA_GF));
  const vigia = fs.readFileSync(path.join(__dirname, '..', 'vps', 'bin', 'promo-vigia.cjs'), 'utf8');
  ok('o vigia procura as MESMAS marcas (senão alarmaria à toa, ou calaria)', [MARCA_TOKEN, MARCA_NO, MARCA_GF].every((m) => vigia.includes(m)));
  let compilou = true; try { compila(NOVO_NO, 'no'); compila(NOVO_GF, 'gf'); } catch (e) { compilou = false; }
  ok('os dois arquivos compilam', compilou);

  fs.rmSync(CASA, { recursive: true, force: true });
  console.log('');
  console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('ERRO NO HARNESS', e); process.exit(1); });
