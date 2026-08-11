// Harness da capa full-bleed. Roda no Windows, sem VPS e sem banco: pega o jsCode REAL exportado
// dos nós, aplica a mesma função de troca que o patch usa e executa o resultado.
//
// Cobre os TRÊS modelos (a/b/c). Enquanto a escolha não estiver feita, qualquer um pode ir pro ar,
// então qualquer um tem que estar verde.
//
//   node design/test_capa_fullbleed.cjs          (offline)
//   node design/test_capa_fullbleed.cjs --rede   (também bate no Cloudinary)
const fs = require('fs');
const path = require('path');
const { ALVOS, trocar, blocoDoModelo, SHA_ANTIGO, recortarBuildCapa } = require('./patch_capa_fullbleed.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');
const ARQUIVO = { 'Code in JavaScript1': 'code-in-javascript1.js', 'Code in JavaScript': 'code-in-javascript.js' };
const MODELOS = ['a', 'b', 'c'];
const REDE = process.argv.includes('--rede');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

// Executa o jsCode do nó como o n8n executaria, devolvendo o que ele retorna.
function rodarNo(code, inputJson) {
  const $input = { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] };
  const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  return new Function('$input', '$', '$json', 'require', code)($input, $, inputJson, require);
}

const amostras = ['exec87_output.json', 'silenthill_output.json', 'stress_output.json']
  .map((f) => {
    const bruto = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    return { nome: f, output: bruto.output || bruto };
  });

const original = {};
for (const nomeNo of ALVOS) original[nomeNo] = fs.readFileSync(path.join(WFDIR, ARQUIVO[nomeNo]), 'utf8');

// ---- 1. a troca acontece nos dois nós, em todo modelo, sobre o código real exportado ----
const patchado = {}; // patchado[modelo][nó]
for (const modelo of MODELOS) {
  patchado[modelo] = {};
  for (const nomeNo of ALVOS) {
    let novo = null, erro = null;
    try { novo = trocar(original[nomeNo], nomeNo, blocoDoModelo(modelo)); } catch (e) { erro = e.message; }
    ok(`[${modelo}] troca aplica em "${nomeNo}"`, Boolean(novo), erro);
    if (!novo) continue;
    patchado[modelo][nomeNo] = novo;

    ok(`[${modelo}] "${nomeNo}" perdeu o hero recortado da capa`,
      !recortarBuildCapa(novo).texto.includes('heroBoxTitan'));
    ok(`[${modelo}] "${nomeNo}" mantém o resto do arquivo intacto`,
      novo.includes('function buildSlide(slide){') && novo.includes('function buildCta(slide){'));

    // reaplicar tem que ser recusado, não duplicar helper
    let reErro = null;
    try { trocar(novo, nomeNo, blocoDoModelo(modelo)); } catch (e) { reErro = e.message; }
    ok(`[${modelo}] "${nomeNo}" recusa reaplicação`, /já existe/.test(String(reErro)), reErro);
  }
}

// os três modelos têm que produzir código DIFERENTE — senão algum arquivo não está sendo lido
{
  const corpos = MODELOS.map((m) => blocoDoModelo(m));
  ok('os três modelos geram blocos distintos', new Set(corpos).size === 3);
  ok('todo modelo carrega a base (gate + trim)',
    corpos.every((c) => c.includes('CAPA_MIN_W') && c.includes('e_trim:10') && c.includes('function capaImg(')));
  ok('base não aparece duplicada em nenhum modelo',
    corpos.every((c) => (c.match(/function capaImg\(/g) || []).length === 1));
}

// ---- 2. o sha protege contra produção divergente ----
{
  const mexido = original['Code in JavaScript1'].replace(
    'const HX=72, HY=124, HW=936, HH=520, CW=936;',
    'const HX=72, HY=124, HW=936, HH=521, CW=936;');
  ok('o teste de sha realmente altera o bloco', mexido !== original['Code in JavaScript1']);
  let erro = null;
  try { trocar(mexido, 'Code in JavaScript1'); } catch (e) { erro = e.message; }
  ok('sha divergente aborta o patch', /não é o esperado/.test(String(erro)), erro);
  ok('sha fixado tem 64 hex', /^[0-9a-f]{64}$/.test(SHA_ANTIGO));
}

// ---- 3. cada modelo roda e produz uma capa full-bleed válida ----
const urlPorCaso = new Map();
for (const modelo of MODELOS) {
  const code = patchado[modelo]['Code in JavaScript1'];
  if (!code) continue;
  for (const { nome, output } of amostras) {
    const caso = `${modelo}/${nome.replace('_output.json', '')}`;
    let saida = null, erro = null;
    try { saida = rodarNo(code, { output }); } catch (e) { erro = e.message; }
    ok(`[${caso}] nó executa`, Boolean(saida), erro);
    if (!saida) continue;

    const j = saida[0] && saida[0].json;
    ok(`[${caso}] contrato de saída preservado`,
      Boolean(j && typeof j.html === 'string' && j.capaUsada && j.output),
      j && Object.keys(j).join(','));

    const html = j.html;
    ok(`[${caso}] tela 1080x1350`, html.includes('width:1080px;height:1350px'));

    const imgs = [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
    ok(`[${caso}] uma única imagem de fundo`, imgs.length === 1, 'achei ' + imgs.length);
    const url = imgs[0] || '';
    urlPorCaso.set(caso, url);

    ok(`[${caso}] imagem cobre a tela inteira`,
      html.includes('inset:0;width:1080px;height:1350px;object-fit:cover'));
    ok(`[${caso}] gate de resolução na URL`, url.includes('if_iw_gte_1000_and_ih_gte_800'), url.slice(0, 120));
    ok(`[${caso}] ramo cheio recorta 4:5`, url.includes('c_fill,g_auto,w_1728,h_2160'));
    ok(`[${caso}] ramo contido não estica`, url.includes('if_else') && url.includes('c_pad,g_north') && url.includes('if_end'));
    ok(`[${caso}] tarja cinematográfica é aparada`, (url.match(/e_trim:10/g) || []).length === 2);
    // f_auto dentro dos ramos do condicional faz o Cloudinary devolver 400 pra quem aceita
    // AVIF/WebP — que é o Chrome do renderizador. Os flags de entrega ficam depois do if_end.
    ok(`[${caso}] flags de entrega ficam fora do condicional`,
      /\/if_end\/f_auto,q_auto:best,e_sharpen:60\//.test(url)
      && !/f_auto/.test(url.split('/if_end/')[0]),
      url);

    ok(`[${caso}] sumiu o hero recortado`, !html.includes('clip-path:polygon'));
    ok(`[${caso}] rodapé traz marca, crédito e arraste`,
      html.includes('@promoliso0') && html.includes('ARRASTE') && html.includes('FOTO '));
    ok(`[${caso}] título presente`, /text-transform:uppercase/.test(html));
  }
}

// mesma pauta, mesma URL: nada de transformação variando por sorte. O gate vem da base, então os
// três modelos têm que gerar a MESMA URL pra mesma foto.
{
  const porAmostra = ['exec87', 'silenthill', 'stress'].map((a) =>
    new Set(MODELOS.map((m) => urlPorCaso.get(`${m}/${a}`))));
  ok('o gate independe do modelo (mesma foto, mesma URL)', porAmostra.every((s) => s.size === 1));
  ok('mesma foto de origem gera a mesma URL',
    urlPorCaso.get('a/silenthill') === urlPorCaso.get('a/stress'));
}

// ---- 4. escape continua valendo em todo modelo (a capa recebe texto de feed de terceiros) ----
for (const modelo of MODELOS) {
  const code = patchado[modelo]['Code in JavaScript1'];
  if (!code) continue;
  const venenoso = JSON.parse(JSON.stringify(amostras[0].output));
  venenoso.slides[0].titulo = 'Xbox <img src=x onerror=alert(1)> "novo"';
  venenoso.slides[0].destaque = '</div><script>alert(2)</script>';
  venenoso.slides[0].fonte_imagem = 'FONTE" onload="alert(3)';
  const html = rodarNo(code, { output: venenoso })[0].json.html;
  ok(`[${modelo}] título de feed é escapado`, !html.includes('<img src=x') && html.includes('&lt;IMG'));
  ok(`[${modelo}] destaque de feed é escapado`, !html.includes('<script>'));
  ok(`[${modelo}] crédito de feed não fecha atributo`, !/onload="alert/.test(html));
  // só a imagem de fundo pode ser um <img>; texto de feed não pode injetar outro
  ok(`[${modelo}] segue com uma única <img>`, (html.match(/<img /g) || []).length === 1);
}

// ---- 5. imagem sem https cai na capa do output, não vira src vazio ----
for (const modelo of MODELOS) {
  const code = patchado[modelo]['Code in JavaScript1'];
  if (!code) continue;
  const semImagem = JSON.parse(JSON.stringify(amostras[1].output));
  semImagem.slides[0].imagem = '';
  const j = rodarNo(code, { output: semImagem })[0].json;
  ok(`[${modelo}] sem imagem no slide, usa output.capa`, j.capaUsada === semImagem.capa, j.capaUsada);
  ok(`[${modelo}] src não fica vazio`, /<img src="https:\/\/res\.cloudinary\.com/.test(j.html));
}

// ---- 6. rede: os dois ramos do gate entregam 1728x2160 de verdade ----
async function conferirRede() {
  const dims = (buf) => {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return buf.readUInt16BE(i + 7) + 'x' + buf.readUInt16BE(i + 5);
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return '?';
  };
  // O Accept do Chrome NÃO é detalhe: com f_auto no lugar errado o Cloudinary responde 200 pra
  // `Accept: */*` e 400 pra quem aceita AVIF/WebP. Testar só com o fetch padrão do node deixa
  // passar uma capa que quebra exatamente no renderizador. Os dois Accept são cobrados.
  const ACEITES = {
    'accept do chrome': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'accept genérico': '*/*',
  };
  // a URL vem da base, igual nos três modelos — basta conferir uma
  const url = urlPorCaso.get('a/silenthill');
  for (const [rotulo, u] of [
    ['ramo cheio', url],
    ['ramo contido', url.replace('if_iw_gte_1000_and_ih_gte_800', 'if_iw_gte_99000')],
  ]) {
    for (const [nomeAceite, accept] of Object.entries(ACEITES)) {
      try {
        const r = await fetch(u, { headers: { accept } });
        const b = Buffer.from(await r.arrayBuffer());
        const tipo = String(r.headers.get('content-type') || '');
        // com webp/avif o leitor de dimensão de JPEG não serve; aí basta status + tipo de imagem
        const dim = tipo.includes('jpeg') ? dims(b) : 'n/a';
        ok(`rede: ${rotulo} (${nomeAceite})`,
          r.status === 200 && tipo.startsWith('image/') && (dim === '1728x2160' || dim === 'n/a'),
          r.status + ' ' + tipo + ' ' + dim);
      } catch (e) { ok(`rede: ${rotulo} (${nomeAceite})`, false, e.message); }
    }
  }
}

(async () => {
  if (REDE) await conferirRede(); else console.log('(pulei os testes de rede — rode com --rede)');
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
  process.exit(falhas ? 1 : 0);
})();
