// Harness do carrossel variável — metade do produtor. Offline, rodando o validador REAL.
//
//   node design/test_carrossel_variavel_produtor.cjs
//
// A parte que mais importa é a D: as SEIS cópias do mesmo número têm de falar o mesmo número. Foi
// exatamente uma divergência dessas (um teto em dois lugares) que zerou a pauta por semanas em
// 05/08 — e este patch multiplica as cópias por seis, então a checagem vira obrigatória.
const fs = require('fs');
const path = require('path');
const P = require('./patch_carrossel_variavel_produtor.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}
const lf = P.lf;
const WDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');
const ler = (f) => lf(fs.readFileSync(path.join(WDIR, f), 'utf8'));

const VAL_ANTES = ler('validar-antes-de-publicar.js');
const CAPA_ANTES = ler('code-in-javascript1.js');
const ROW_ANTES = ler('fila-montar-row.js');
const PROMPT_ANTES = ler('ai-agent.prompt.md');

const APLICADO = VAL_ANTES.includes('MAX_SLIDES');
console.log(APLICADO ? '# export JÁ tem a faixa — verificando o que está no ar'
                     : '# export ainda exige 5 slides — verificando a troca');

let VAL, CAPA, ROW, PROMPT;
if (APLICADO) {
  VAL = VAL_ANTES; CAPA = CAPA_ANTES; ROW = ROW_ANTES; PROMPT = PROMPT_ANTES;
  let re = null;
  try { P.trocarValidador(VAL); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já aplicado/.test(String(re)), re);
} else {
  const tenta = (f, x, nome) => { try { return f(x); } catch (e) { ok('aplica em ' + nome, false, e.message); return null; } };
  VAL = tenta(P.trocarValidador, VAL_ANTES, 'validador');
  CAPA = tenta(P.trocarCapa, CAPA_ANTES, 'capa');
  ROW = tenta(P.trocarRow, ROW_ANTES, 'fila');
  PROMPT = tenta(P.trocarPrompt, PROMPT_ANTES, 'prompt');
  ok('as quatro trocas de texto aplicam', Boolean(VAL && CAPA && ROW && PROMPT));
  if (!(VAL && CAPA && ROW && PROMPT)) { console.log('\nFALHA'); process.exit(1); }
  ok('a troca do Edit Fields aplica', P.trocarEdit(P.EDIT_DE) === P.EDIT_PARA);
}

// ====================================================================== A. o validador, rodando
console.log('\n# A. validador (código real)');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'row36_output.json'), 'utf8'));
function validar(code, output) {
  const $ = (nome) => (nome === 'Montar contexto editorial'
    ? { item: { json: { candidatos: [] } } }
    : { item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  const r = new Function('$json', '$', '$input', '$now', '$execution', code)(
    { output }, $, { first: () => ({ json: { output } }), all: () => [{ json: { output } }] },
    undefined, { mode: 'trigger' },
  );
  return r[0].json.relatorio_validacao?.erros || [];
}
const soEstrutura = (e) => e.filter((x) => /slide|imagens válidas/i.test(x));

// um output com N slides e N+1 imagens coerentes
const MEIO = ['contexto', 'evidencia', 'impacto'];
function pauta(n, opcoes) {
  const o = JSON.parse(JSON.stringify(base));
  const slide = (tipo, i) => ({
    tipo,
    selo: 'SELO ' + i,
    titulo: 'Titulo especifico ' + i,
    destaque: 'Destaque ' + i,
    texto: ('Texto com ancora concreta 24 de agosto e numero 42 explicando o slide ' + i + '. ').repeat(3).slice(0, 260),
    subtitulo: 'Fecha a ideia do slide ' + i,
    imagem: 'https://exemplo.com/img-' + i + '.jpg',
    fonte_imagem: 'FONTE OFICIAL',
  });
  o.slides = Array.from({ length: n }, (_, i) => slide(
    i === 0 ? 'capa' : (i === n - 1 ? 'acao' : MEIO[(i - 1) % MEIO.length]), i));
  o.capa = 'https://exemplo.com/capa.jpg';
  return Object.assign(o, opcoes || {});
}

{
  // o tamanho de hoje continua passando: é a garantia de que nada regride
  const cinco = soEstrutura(validar(VAL, pauta(5)));
  ok('5 slides (o tamanho de hoje) continua passando', cinco.length === 0, cinco.join(' | '));
  if (!APLICADO) {
    const antes = soEstrutura(validar(VAL_ANTES, pauta(5)));
    ok('e passava antes também (o teste não está medindo o teste)', antes.length === 0, antes.join(' | '));
  }

  for (let n = P.MIN_SLIDES; n <= P.MAX_SLIDES; n++) {
    const e = soEstrutura(validar(VAL, pauta(n)));
    ok(n + ' slides passa (' + (n + 1) + ' imagens)', e.length === 0, e.join(' | '));
    if (!APLICADO && n !== 5) {
      const antes = soEstrutura(validar(VAL_ANTES, pauta(n)));
      ok('  e ANTES ' + n + ' slides era reprovado', antes.length > 0, 'passava antes — então não é ganho');
    }
  }
  for (const n of [P.MIN_SLIDES - 1, P.MAX_SLIDES + 1, 1, 12]) {
    const e = soEstrutura(validar(VAL, pauta(n)));
    ok(n + ' slides é reprovado (fora da faixa)', e.some((x) => /esperava de/.test(x)), e.join(' | '));
  }
}

{
  // a regra de tipos por posição
  const trocado = pauta(5);
  trocado.slides[0].tipo = 'contexto';
  ok('primeiro slide que não é capa reprova',
    soEstrutura(validar(VAL, trocado)).some((x) => /slide 1/.test(x)));

  const semAcao = pauta(5);
  semAcao.slides[4].tipo = 'impacto';
  ok('último slide que não é acao reprova',
    soEstrutura(validar(VAL, semAcao)).some((x) => /slide 5/.test(x)));

  const meioTrocado = pauta(6);
  meioTrocado.slides[1].tipo = 'impacto';
  meioTrocado.slides[2].tipo = 'contexto';
  ok('ordem dos tipos do meio é livre', soEstrutura(validar(VAL, meioTrocado)).length === 0,
    soEstrutura(validar(VAL, meioTrocado)).join(' | '));

  const repetido = pauta(6);
  repetido.slides[1].tipo = 'evidencia';
  repetido.slides[2].tipo = 'evidencia';
  ok('repetir tipo no meio é permitido', soEstrutura(validar(VAL, repetido)).length === 0);

  const inventado = pauta(6);
  inventado.slides[2].tipo = 'timeline';
  ok('tipo fora da lista reprova',
    soEstrutura(validar(VAL, inventado)).some((x) => /slide 3/.test(x)));

  const capaNoMeio = pauta(6);
  capaNoMeio.slides[3].tipo = 'capa';
  ok('capa no meio reprova', soEstrutura(validar(VAL, capaNoMeio)).some((x) => /slide 4/.test(x)));
}

{
  // imagens: uma por slide, mais a capa
  for (const n of [4, 5, 7]) {
    const faltando = pauta(n);
    faltando.slides[1].imagem = '';
    const e = soEstrutura(validar(VAL, faltando));
    ok(n + ' slides com uma imagem a menos reprova, citando ' + (n + 1),
      e.some((x) => new RegExp('Esperava ' + (n + 1) + ' imagens').test(x)), e.join(' | '));
  }
  const seteOk = soEstrutura(validar(VAL, pauta(7)));
  ok('7 slides com 8 imagens não reclama de imagem',
    !seteOk.some((x) => /imagens válidas/.test(x)), seteOk.join(' | '));
}

// ====================================================================== B. a capa
console.log('\n# B. guarda da capa');
{
  const rodarCapa = (code, output) => {
    const $input = { first: () => ({ json: { output } }) };
    return new Function('$input', '$', '$json', code)($input, () => ({}), {});
  };
  for (let n = P.MIN_SLIDES; n <= P.MAX_SLIDES; n++) {
    let e = null;
    try { rodarCapa(CAPA, pauta(n)); } catch (x) { e = x.message; }
    ok('capa renderiza com ' + n + ' slides', !e, e);
  }
  for (const n of [P.MIN_SLIDES - 1, P.MAX_SLIDES + 1]) {
    let e = null;
    try { rodarCapa(CAPA, pauta(n)); } catch (x) { e = x.message; }
    ok('capa recusa ' + n + ' slides, dizendo quantos vieram',
      /incompleta/.test(String(e)) && new RegExp(n + ' slides').test(String(e)), String(e));
  }
  let semSlides = null;
  try { rodarCapa(CAPA, { slides: null }); } catch (x) { semSlides = x.message; }
  ok('capa recusa saída sem slides', /sem slides/.test(String(semSlides)), String(semSlides));

  // o HTML da capa não pode mudar por causa deste patch
  const antesHtml = (() => { try { return rodarCapa(CAPA_ANTES, pauta(5))[0].json.html; } catch (e) { return 'ERRO:' + e.message; } })();
  const depoisHtml = rodarCapa(CAPA, pauta(5))[0].json.html;
  ok('o HTML da capa com 5 slides é idêntico ao de antes', antesHtml === depoisHtml,
    antesHtml.length + ' vs ' + depoisHtml.length);
}

// ====================================================================== B2. o contador de página
// O "03 / 06" no topo de cada slide é o que o dono vê primeiro se a conta estiver errada: um
// carrossel de 4 páginas dizendo "de 06" denuncia o bug na arte, não no log. O renderizador do
// slide não é tocado por este patch — ele já lê `slide.pagina` e `slide.total`. Isto aqui prova que
// lê, para os totais novos, com o contrato REAL do nó (`$input.first().json.slides`).
console.log('\n# B2. contador de página com total variável');
{
  const code = ler('code-in-javascript.js');
  const rodar = (slide) => {
    const env = { slides: slide };
    return new Function('$input', '$', '$json', code)(
      { first: () => ({ json: env }), all: () => [{ json: env }] }, () => ({}), env);
  };
  const tab = (html) => {
    const m = /<span style="color:#fff;">([^<]*)<\/span>&nbsp;\/&nbsp;([^<]*)</.exec(html);
    return m ? m[1] + '/' + m[2] : 'nao achei';
  };
  const dois = (n) => String(n).padStart(2, '0');
  for (let n = P.MIN_SLIDES; n <= P.MAX_SLIDES; n++) {
    const total = n + 1;
    const meio = rodar({ tipo: 'contexto', pagina: 2, total, titulo: 'T', destaque: 'D', texto: 'X',
      selo: 'S', imagem: 'https://e/i.jpg', fonte_imagem: 'F', capaFallback: 'https://e/c.jpg' });
    const cta = rodar({ tipo: 'cta', pagina: total, total });
    ok('com ' + n + ' slides o contador diz 02/' + dois(total) + ' e o cta ' + dois(total) + '/' + dois(total),
      tab(meio[0].json.html) === '02/' + dois(total) && tab(cta[0].json.html) === dois(total) + '/' + dois(total),
      tab(meio[0].json.html) + ' e ' + tab(cta[0].json.html));
  }
}

// ====================================================================== C. fila e Edit Fields
console.log('\n# C. fila e Edit Fields');
{
  const rodarRow = (code, agg, cover) => {
    const nos = {
      'Preparar registro pendente': { content_key: 'k', topic: 't', category: 'NOTICIA', primary_url: 'https://p' },
      'Obter URL primeira imagem': { url: cover },
      Aggregate: { url: agg },
      'Edit Fields': { legenda: 'L' },
      'Selecionar melhor pauta': { registro: { pontuacao_total: 77 } },
    };
    const $ = (nome) => ({ first: () => ({ json: nos[nome] }) });
    return new Function('$', '$input', '$execution', '$json', code)(
      $, { first: () => ({ json: { secure_url: 'https://story' } }) }, { id: '1' }, {});
  };
  for (let n = P.MIN_SLIDES; n <= P.MAX_SLIDES; n++) {
    const agg = Array.from({ length: n }, (_, i) => 'https://s' + i);   // capa + (n-1) meio + cta = n
    const r = rodarRow(ROW, agg, 'https://capa');
    const urls = JSON.parse(r[0].json.carousel_urls);
    ok(n + ' slides -> ' + (n + 1) + ' urls na fila', urls.length === n + 1, JSON.stringify(urls.length));
    if (!APLICADO) {
      const antes = JSON.parse(rodarRow(ROW_ANTES, agg, 'https://capa')[0].json.carousel_urls);
      ok('  e ANTES truncava em ' + Math.min(6, n + 1), antes.length === Math.min(6, n + 1),
        String(antes.length));
    }
  }
  const hoje = rodarRow(ROW, ['a', 'b', 'c', 'd', 'e'], 'capa');
  ok('o caso de hoje (5 agregadas) dá as mesmas 6 urls',
    hoje[0].json.carousel_urls === JSON.stringify(['capa', 'a', 'b', 'c', 'd', 'e']),
    hoje[0].json.carousel_urls);
  ok('a nota continua chegando na fila', hoje[0].json.score === 77);
  const vazio = rodarRow(ROW, [], 'capa');
  ok('sem agregadas não quebra', JSON.parse(vazio[0].json.carousel_urls).length === 1);

  // Edit Fields: o motor de expressão do n8n avalia o corpo; aqui roda em JS puro, que é o que ele
  // é. O que importa é a CONTA de pagina/total, e ela tem de dar o mesmo de hoje quando são 5.
  const avaliar = (expr, output) => {
    const corpo = lf(expr).replace(/^=\{\{/, '').replace(/\}\}$/, '');
    const $ = (nome) => {
      if (nome !== 'Validar antes de publicar') throw new Error('nó inesperado: ' + nome);
      return { item: { json: { output } } };
    };
    return new Function('$', 'return (' + corpo + ')')($);
  };
  for (let n = P.MIN_SLIDES; n <= P.MAX_SLIDES; n++) {
    const o = pauta(n);
    o.cta = {};
    const lista = avaliar(P.EDIT_PARA, o);
    const paginas = lista.map((s) => s.pagina);
    const totais = [...new Set(lista.map((s) => s.total))];
    ok(n + ' slides -> ' + n + ' páginas renderizadas, total ' + (n + 1),
      lista.length === n && totais.length === 1 && totais[0] === n + 1,
      JSON.stringify({ len: lista.length, totais }));
    ok('  páginas numeradas 2..' + (n + 1) + ', sem furo',
      JSON.stringify(paginas) === JSON.stringify(Array.from({ length: n }, (_, i) => i + 2)),
      JSON.stringify(paginas));
    ok('  o último é o cta e é a última página',
      lista[n - 1].tipo === 'cta' && lista[n - 1].pagina === n + 1);
  }
  const o5 = pauta(5); o5.cta = {};
  ok('com 5 slides a saída é IDÊNTICA à da expressão de hoje',
    JSON.stringify(avaliar(P.EDIT_PARA, o5)) === JSON.stringify(avaliar(P.EDIT_DE, o5)));
  const comCta = pauta(4);
  comCta.cta = { selo: 'S', titulo: 'T', destaque: 'D', texto: 'X' };
  const lista = avaliar(P.EDIT_PARA, comCta);
  ok('o cta do agente continua sendo espalhado', lista[3].titulo === 'T' && lista[3].tipo === 'cta');
}

// ====================================================================== D. as seis cópias
console.log('\n# D. as seis cópias do mesmo número concordam');
{
  const numerosDe = (texto, nome) => {
    const min = /MIN_SLIDES = (\d+)/.exec(texto);
    const max = /MAX_SLIDES = (\d+)/.exec(texto);
    ok(nome + ' declara MIN_SLIDES e MAX_SLIDES', Boolean(min && max));
    return { min: min && Number(min[1]), max: max && Number(max[1]) };
  };
  const v = numerosDe(VAL, 'validador');
  const c = numerosDe(CAPA, 'capa');
  ok('validador e capa usam a MESMA faixa', v.min === c.min && v.max === c.max,
    JSON.stringify({ v, c }));
  ok('e é a faixa que o patch declara', v.min === P.MIN_SLIDES && v.max === P.MAX_SLIDES,
    JSON.stringify(v));

  ok('o prompt diz a mesma faixa em número',
    PROMPT.includes('de ' + P.MIN_SLIDES + ' a ' + P.MAX_SLIDES + ' slides'), 'faixa não citada');
  ok('o prompt cita os três tipos do meio',
    ['contexto', 'evidencia', 'impacto'].every((t) => PROMPT.includes('- ' + t + ':')));
  ok('o prompt manda o primeiro ser capa e o último acao',
    /primeiro slide é sempre `capa`/.test(PROMPT) && /último é sempre `acao`/.test(PROMPT));
  ok('o prompt diz explicitamente para preferir menos',
    /Preferir menos é sempre permitido/.test(PROMPT));
  ok('o prompt não fala mais "exatamente cinco slides"', !/exatamente cinco slides/.test(PROMPT));
  ok('nenhum "cinco" sobrou falando de quantidade de slide/imagem',
    !/menos de cinco/.test(PROMPT) && !/para os cinco slides/.test(PROMPT),
    (PROMPT.match(/.{0,40}cinco.{0,40}/g) || []).join(' // '));

  // o teto do publicador tem de caber a faixa do produtor, senão a peça nasce impublicável
  const pub = require('./patch_carrossel_variavel_publicador.cjs');
  ok('a faixa do produtor cabe no publicador (' + pub.MIN_IMAGENS + '..' + pub.MAX_IMAGENS + ' imagens)',
    P.MIN_IMAGENS >= pub.MIN_IMAGENS && P.MAX_IMAGENS <= pub.MAX_IMAGENS,
    P.MIN_IMAGENS + '..' + P.MAX_IMAGENS);
  ok('e o publicador tem um nó para cada tamanho que o produtor pode gerar',
    Array.from({ length: P.MAX_IMAGENS - P.MIN_IMAGENS + 1 }, (_, i) => i + P.MIN_IMAGENS)
      .every((n) => pub.TAMANHOS.includes(n)));
}

// ====================================================================== E. a volta
if (!APLICADO) {
  console.log('\n# E. reverter');
  ok('validador volta byte a byte', P.voltarValidador(VAL) === VAL_ANTES);
  ok('capa volta byte a byte', P.voltarCapa(CAPA) === CAPA_ANTES);
  ok('fila volta byte a byte', P.voltarRow(ROW) === ROW_ANTES);
  ok('prompt volta byte a byte', P.voltarPrompt(PROMPT) === PROMPT_ANTES);
  ok('Edit Fields volta byte a byte', P.voltarEdit(P.EDIT_PARA) === P.EDIT_DE);
}

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
