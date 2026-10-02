// PROVA AO VIVO do patch no nó do Instagram — contra o Meta de verdade, SEM publicar nada.
//
// Por que existe: o harness offline (design/test_dist_instagram.cjs) prova a lógica, mas o
// formato do erro do Meta é suposição minha até ser visto. Esta prova roda o código REAL do nó (o
// que está no disco do VPS, com o patch aplicado SÓ EM MEMÓRIA — o arquivo não é tocado), com o
// cliente HTTP REAL do n8n (`executeLegacyRequest`) e o token real. O n8n não é parado nem tocado.
//
// Só cria CONTÊINERES (rascunho de carrossel), que o Instagram descarta sozinho em 24 h. Nenhuma
// chamada a `media_publish` existe aqui. Nada vai para o perfil.
//
//   P1 controle POSITIVO   2 imagens reais (da última peça publicada) com o código NOVO.
//                          Tem que sair id de contêiner, sem espera. Se falhar, nada abaixo vale.
//   P2 controle NEGATIVO   1 imagem que não existe, com o código ANTIGO. Tem que dar o genérico
//                          "Bad request" — é o defeito que o patch conserta.
//   P3 o conserto          a mesma imagem inexistente, com o código NOVO. Tem que trazer o texto
//                          do Meta na mensagem, e mostra se esse erro é tratado como passageiro
//                          (com espera de 15/30/60 s) ou não.
//
// Uso, no VPS (leva ~2 a 4 min por causa das esperas do P3):
//   cd /opt/promoliso && sudo -u promo node design/prova_dist_instagram.cjs
// Não imprime token. Não grava arquivo nenhum além do que o próprio nó já grava
// (~/ig-token.json, se o token estiver na janela de renovação — igual a uma execução do n8n).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { DIST, ARQ_NO, ARQ_GF, MARCA_NO, patchNo, patchGF, lf } = require('./patch_dist_instagram.cjs');

const RAIZ = '/opt/promoliso';
const wf = require(path.join(RAIZ, 'node_modules', 'n8n-workflow'));
const { executeLegacyRequest } = require(path.join(RAIZ, 'node_modules', '@n8n', 'backend-network', 'dist', 'http', 'legacy-request.js'));
const DB = path.join(RAIZ, 'data', '.n8n', 'database.sqlite');
const FILA = 'data_table_user_i2e8ZwnL9kwOV6OG';
const INEXISTENTE = 'https://n8n.promoliso.com.br/cdn/v1/prova-nao-existe-' + Date.now() + '.jpg';

const noDisco = lf(fs.readFileSync(path.join(DIST, ARQ_NO), 'utf8'));
const gfDisco = lf(fs.readFileSync(path.join(DIST, ARQ_GF), 'utf8'));
const jaAplicado = noDisco.includes(MARCA_NO);
const codigo = {
  antigo: jaAplicado ? { no: patchNo(noDisco, true), gf: patchGF(gfDisco, true) } : { no: noDisco, gf: gfDisco },
  novo: jaAplicado ? { no: noDisco, gf: gfDisco } : { no: patchNo(noDisco, false), gf: patchGF(gfDisco, false) },
};
console.log(`# disco: patch ${jaAplicado ? 'JÁ aplicado' : 'ainda NÃO aplicado'} — o outro lado é montado em memória`);

function modulo(texto, nome, req) {
  const m = { exports: {} };
  vm.runInThisContext('(function (exports, require, module, __filename, __dirname) {' + texto + '\n})', { filename: path.join(DIST, nome) })(
    m.exports, req, m, path.join(DIST, nome), DIST);
  return m.exports;
}
function carregar({ no, gf }) {
  const g = modulo(gf, ARQ_GF, (n) => (n === 'n8n-workflow' ? wf : require(n)));
  return modulo(no, ARQ_NO, (n) => (n === 'n8n-workflow' ? wf : n === './GenericFunctions' ? g : require(n))).Instagram;
}

async function criarCarrossel(Classe, urls) {
  const chamadas = [];
  const inicio = Date.now();
  const ctx = {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (n, i, d) => ({
      resource: 'post', operation: 'createCarouselPost',
      carouselChildren: { child: urls.map((u) => ({ media_type: 'IMAGE', image_url: u })) },
      carouselCaption: 'PROVA — contêiner temporário, não publicado', carouselAdditionalOptions: {},
    }[n] ?? d),
    getNode: () => ({ name: 'PROVA dist', type: 'n8n-nodes-instagram-integrations.instagram', typeVersion: 1, parameters: {} }),
    continueOnFail: () => true,
    getCredentials: async () => { throw new Error('a prova não usa credencial do n8n: o token tem que vir do ~/ig-token.json'); },
    helpers: {
      request: async (o) => {
        if (/media_publish/.test(String(o.url))) throw new Error('PROVA ABORTADA: tentou publicar');
        chamadas.push(String(o.method) + ' ' + String(o.url).replace(/^https:\/\/graph\.instagram\.com\/v[0-9.]+/, '')
          + (o.body && o.body.image_url ? ' ' + o.body.image_url.split('/').pop() : ''));
        return executeLegacyRequest(o, undefined, { debug() {}, warn() {}, info() {}, error() {} }, {});
      },
    },
  };
  const out = await new Classe().execute.call(ctx);
  return { json: out[0][0].json, chamadas, segundos: Math.round((Date.now() - inicio) / 100) / 10 };
}

(async () => {
  const linha = execFileSync('sqlite3', ['-readonly', DB,
    `SELECT carousel_urls FROM ${FILA} WHERE status='PUBLISHED' ORDER BY published_at DESC LIMIT 1;`], { encoding: 'utf8' }).trim();
  const paraCdn = (u) => String(u).replace(/^https:\/\/res\.cloudinary\.com\/fy2n2qvr\/image\/upload\/(v[0-9]+)\/([A-Za-z0-9_-]+)\.jpg$/,
    'https://n8n.promoliso.com.br/cdn/$1/$2.jpg');
  const boas = JSON.parse(linha).slice(0, 2).map(paraCdn);

  const NOVO = carregar(codigo.novo);
  const ANTIGO = carregar(codigo.antigo);

  const p1 = await criarCarrossel(NOVO, boas);
  console.log(`\nP1 controle positivo (novo, 2 imagens reais) — ${p1.segundos}s`);
  console.log('   ', JSON.stringify(p1.json));
  p1.chamadas.forEach((c) => console.log('    ·', c));
  const p1ok = !!p1.json.id && !p1.json.error;
  console.log(p1ok ? 'PASS  contêiner criado: a bancada é fiel' : 'FALHA controle positivo falhou — nada abaixo vale');

  const p2 = await criarCarrossel(ANTIGO, [boas[0], INEXISTENTE]);
  console.log(`\nP2 controle negativo (antigo, imagem inexistente) — ${p2.segundos}s`);
  console.log('   ', JSON.stringify(p2.json));
  console.log(/Bad request/i.test(p2.json.error || '') ? 'PASS  antigo esconde a causa ("Bad request")' : 'ATENÇÃO  o antigo não deu o genérico — rever o diagnóstico');

  const p3 = await criarCarrossel(NOVO, [boas[0], INEXISTENTE]);
  console.log(`\nP3 o conserto (novo, imagem inexistente) — ${p3.segundos}s`);
  console.log('   ', JSON.stringify(p3.json));
  p3.chamadas.forEach((c) => console.log('    ·', c));
  const tentativas = p3.chamadas.filter((c) => c.includes('prova-nao-existe')).length;
  console.log(/^Meta /.test(p3.json.error || '') ? 'PASS  a mensagem traz o texto do Meta' : 'FALHA a mensagem não traz o Meta');
  console.log(`INFO  a imagem inexistente foi tentada ${tentativas}× — `
    + (tentativas > 1 ? 'o erro foi classificado como passageiro (9004: download falhou) e o retry por filho agiu' : 'erro tratado como NÃO passageiro (sem retry)'));
  console.log('\n(nenhum contêiner foi publicado; o Instagram descarta os rascunhos em 24 h)');
  process.exit(p1ok ? 0 : 1);
})().catch((e) => { console.error('ERRO NA PROVA', e && e.stack || e); process.exit(1); });
