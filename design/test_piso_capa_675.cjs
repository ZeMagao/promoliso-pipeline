// Harness do piso 675. Roda o jsCode REAL da capa antes e depois da troca e confere o efeito
// onde ele existe de verdade: na URL que sai no HTML.
//
//   node design/test_piso_capa_675.cjs           (offline)
//   node design/test_piso_capa_675.cjs --rede    (também busca os recortes no Cloudinary)
const fs = require('fs');
const path = require('path');
const { trocar, DE, PARA, ALVOS } = require('./patch_piso_capa_675.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');
const ARQUIVO = { 'Code in JavaScript1': 'code-in-javascript1.js', 'Code in JavaScript': 'code-in-javascript.js' };
const REDE = process.argv.includes('--rede');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

function rodarNo(code, output) {
  const $input = { first: () => ({ json: { output } }), all: () => [{ json: { output } }] };
  const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  return new Function('$input', '$', '$json', 'require', code)($input, $, { output }, require)[0].json.html;
}
const urlDo = (html) => (html.match(/<img src="([^"]+)"/) || [])[1] || '';

const output = JSON.parse(fs.readFileSync(path.join(__dirname, 'row36_output.json'), 'utf8'));

const exportado = fs.readFileSync(path.join(WFDIR, ARQUIVO['Code in JavaScript1']), 'utf8');
const APLICADO = exportado.includes(PARA);
console.log(APLICADO ? '# export JÁ tem o piso 675 — verificando o que está no ar'
                     : '# export ainda tem o piso 800 — verificando a troca');

let antes, depois;
if (APLICADO) {
  depois = exportado;
  ok('consigo reconstruir o piso antigo', exportado.split(PARA).length - 1 === 1);
  antes = exportado.split(PARA).join(DE);
} else {
  antes = exportado;
  let erro = null;
  try { depois = trocar(antes, 'Code in JavaScript1'); } catch (e) { erro = e.message; }
  ok('troca aplica no código exportado', Boolean(depois), erro);
}
if (!antes || !depois) { console.log('\n1 FALHA(S)'); process.exit(1); }

// os DOIS nós carregam o bloco; nenhum pode ficar pra trás
for (const nomeNo of ALVOS) {
  const code = fs.readFileSync(path.join(WFDIR, ARQUIVO[nomeNo]), 'utf8');
  const alvo = APLICADO ? code : trocar(code, nomeNo);
  ok(`[${nomeNo}] fica com o piso 675`, alvo.includes(PARA) && !alvo.includes(DE));
}

let reErro = null;
try { trocar(depois, 'Code in JavaScript1'); } catch (e) { reErro = e.message; }
ok('recusa reaplicação', /já aplicado/.test(String(reErro)), reErro);

// ---- o efeito onde ele importa: a URL ----
{
  const uAntes = urlDo(rodarNo(antes, output));
  const uDepois = urlDo(rodarNo(depois, output));
  ok('antes o gate exigia altura 800', uAntes.includes('if_iw_gte_1000_and_ih_gte_800'), uAntes.slice(0, 90));
  ok('depois o gate exige altura 675', uDepois.includes('if_iw_gte_1000_and_ih_gte_675'), uDepois.slice(0, 90));
  ok('largura mínima não muda (1000)', uDepois.includes('iw_gte_1000'));
  ok('recorte continua c_fill,g_auto', uDepois.includes('c_fill,g_auto,w_1728,h_2160'));
  ok('gravidade NÃO foi trocada (medido: :faces e :subject não mudam nada nesta conta)',
    !/g_auto:(faces|subject|classic)/.test(uDepois));
  ok('ramo contido segue existindo pra quem não alcança',
    uDepois.includes('if_else') && uDepois.includes('c_pad,g_north') && uDepois.includes('if_end'));
  ok('e_trim continua antes do corte', (uDepois.match(/e_trim:10/g) || []).length === 2);
  ok('flags de entrega seguem fora do condicional', /\/if_end\/f_auto,q_auto:best,e_sharpen:60\//.test(uDepois));
  ok('só o piso mudou na URL',
    uAntes.replace('ih_gte_800', 'ih_gte_675') === uDepois);
}

// ---- o caso concreto que motivou a mudança ----
{
  const W = 1200, H = 675;              // foto da row 36
  const passaAntes = W >= 1000 && H >= 800;
  const passaDepois = W >= 1000 && H >= 675;
  ok('row 36 (1200x675) reprovava antes', !passaAntes);
  ok('row 36 (1200x675) passa depois', passaDepois);
  const recorte = Math.min(W, H * 0.8);
  ok('ampliação declarada de 2,00x confere', Math.abs(1080 / recorte - 2) < 0.01, (1080 / recorte).toFixed(2));
}

// ---- rede: os dois ramos continuam entregando 1728x2160 ----
async function conferirRede() {
  const url = urlDo(rodarNo(depois, output));
  const ACEITES = {
    'accept do renderizador': 'image/jpeg,image/png,image/webp,image/avif',
    'accept do chrome': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  };
  for (const [rot, u] of [['ramo cheio', url], ['ramo contido', url.replace('ih_gte_675', 'ih_gte_99000')]]) {
    for (const [nomeAceite, accept] of Object.entries(ACEITES)) {
      try {
        const r = await fetch(u, { headers: { accept } });
        const tipo = String(r.headers.get('content-type') || '');
        ok(`rede: ${rot} (${nomeAceite})`, r.status === 200 && tipo.startsWith('image/'), r.status + ' ' + tipo);
      } catch (e) { ok(`rede: ${rot} (${nomeAceite})`, false, e.message); }
    }
  }
}

(async () => {
  if (REDE) await conferirRede(); else console.log('(pulei os testes de rede — rode com --rede)');
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
  process.exit(falhas ? 1 : 0);
})();
