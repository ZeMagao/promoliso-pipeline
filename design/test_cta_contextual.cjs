// Harness do passo 2 (CTA contextual). Roda offline, no Windows, sem VPS.
//
// O que ele tem que provar, nesta ordem de importância:
//   1. NADA MUDA HOJE. O HTML do slide 06 depois do patch é byte a byte o de antes, com o slide que
//      o Edit Fields passa a montar. Se um pixel de texto mudasse sem ninguém pedir, o carrossel
//      mudaria de arte por acidente.
//   2. A capacidade EXISTE: com `output.cta` preenchido, os campos aparecem no HTML.
//   3. O corte segura texto absurdo dentro dos limites medidos.
//   4. Texto do agente não injeta HTML.
//   5. Os limites do código e os do design/limites_cta.json não divergem (a divergência entre duas
//      cópias do mesmo número é o bug que custou semanas em 05/08).
//
//   node design/test_cta_contextual.cjs
const fs = require('fs');
const path = require('path');
const { trocarRender, trocarEditFields, ALVOS, SHA_ANTIGO, NOVO } = require('./patch_cta_contextual.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');
const ARQUIVO = { 'Code in JavaScript': 'code-in-javascript.js', 'Code in JavaScript1': 'code-in-javascript1.js' };

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

// ---- roda o nó de render como o n8n roda ----
function htmlDo(code, slide) {
  const $input = { first: () => ({ json: { slides: slide } }), all: () => [{ json: { slides: slide } }] };
  const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  return new Function('$input', '$', '$json', 'require', code)($input, $, {}, require)[0].json.html;
}

// ---- avalia a expressão do Edit Fields com as mesmas semânticas do n8n ----
function avaliarEditFields(expr, output) {
  const corpo = String(expr).replace(/^=\{\{/, '').replace(/\}\}$/, '');
  const $ = (nome) => {
    if (nome !== 'Validar antes de publicar') throw new Error('nó inesperado: ' + nome);
    return { item: { json: { output } } };
  };
  return new Function('$', 'return (' + corpo + ');')($);
}

const antigo = fs.readFileSync(path.join(WFDIR, ARQUIVO['Code in JavaScript']), 'utf8');
const novo = trocarRender(antigo, 'Code in JavaScript');

// ---- 1. o patch aplica nos dois nós, e só uma vez ----
for (const nomeNo of ALVOS) {
  const code = fs.readFileSync(path.join(WFDIR, ARQUIVO[nomeNo]), 'utf8');
  let erro = null, saida = null;
  try { saida = trocarRender(code, nomeNo); } catch (e) { erro = e.message; }
  ok(`[${nomeNo}] o patch aplica (sha do buildCta bate)`, Boolean(saida), erro);
  if (saida) {
    ok(`[${nomeNo}] ctaCampo entrou`, saida.includes('function ctaCampo('));
    let reErro = null;
    try { trocarRender(saida, nomeNo); } catch (e) { reErro = e.message; }
    ok(`[${nomeNo}] recusa reaplicação`, /já aplicado/.test(String(reErro)), reErro);
  }
}
ok('sha do buildCta em produção é o fixado no patch', /^[0-9a-f]{64}$/.test(SHA_ANTIGO));

// ---- 2. o Edit Fields troca sem mexer no resto ----
// O `Edit Fields` é um nó Set: o exportador não grava parâmetro de Set, então o valor não está em
// workflows/. A fixture saiu do banco local OBSOLETO-2026-08-04 — que para este nó é igual ao vivo,
// porque a única mudança posterior (carrossel variável, 05/08) foi revertida no mesmo dia. Se
// produção divergir, o patch aborta: ele confere as chaves antes de trocar.
const efAntes = fs.readFileSync(path.join(__dirname, 'edit_fields_slides.atual.txt'), 'utf8').trim();
let efDepois = null, efErro = null;
try { efDepois = trocarEditFields(efAntes); } catch (e) { efErro = e.message; }
ok('Edit Fields: a troca aplica', Boolean(efDepois), efErro);
if (efDepois) {
  let reErro = null;
  try { trocarEditFields(efDepois); } catch (e) { reErro = e.message; }
  ok('Edit Fields: recusa reaplicação', /já aplicado/.test(String(reErro)), reErro);
}

const output = JSON.parse(fs.readFileSync(path.join(__dirname, 'row36_output.json'), 'utf8'));

if (efDepois) {
  const listaAntes = avaliarEditFields(efAntes, output);
  const listaDepois = avaliarEditFields(efDepois, output);
  ok('Edit Fields: mesma quantidade de slides', listaAntes.length === listaDepois.length,
    `${listaAntes.length} vs ${listaDepois.length}`);
  ok('Edit Fields: os 5 slides do agente não mudam',
    JSON.stringify(listaAntes.slice(0, -1)) === JSON.stringify(listaDepois.slice(0, -1)));
  const ctaAntes = listaAntes[listaAntes.length - 1];
  const ctaDepois = listaDepois[listaDepois.length - 1];
  ok('Edit Fields: o cta perde só os 4 campos mortos',
    JSON.stringify({ ...ctaAntes, selo: undefined, titulo: undefined, destaque: undefined, texto: undefined })
    === JSON.stringify({ ...ctaDepois, selo: undefined, titulo: undefined, destaque: undefined, texto: undefined }),
    JSON.stringify(ctaDepois));
  ok('Edit Fields: estrutura do cta preservada',
    ctaDepois.tipo === 'cta' && ctaDepois.pagina === 6 && ctaDepois.total === 6
    && ctaDepois.fonte_imagem === 'PROMOLISO' && ctaDepois.imagem === ''
    && ctaDepois.capaFallback === output.capa);

  // ---- 3. O TESTE QUE IMPORTA: hoje não muda ----
  const htmlHoje = htmlDo(antigo, ctaAntes);      // código de hoje, slide de hoje
  const htmlNovo = htmlDo(novo, ctaDepois);       // código novo, slide novo
  ok('slide 06 sai IDÊNTICO ao de hoje', htmlHoje === htmlNovo,
    htmlHoje === htmlNovo ? '' : 'primeiro diff em ' + [...htmlHoje].findIndex((c, i) => c !== htmlNovo[i]));

  // ---- 4. a capacidade existe: com output.cta, o texto do agente aparece ----
  const comCta = avaliarEditFields(efDepois, {
    ...output,
    cta: { selo: 'OFERTA RELÂMPAGO', titulo: 'Corre que acaba hoje', destaque: 'CUPOM NA BIO', texto: 'O preço volta ao normal à meia-noite e o estoque some antes disso.' },
  });
  const ctaGerado = comCta[comCta.length - 1];
  const htmlGerado = htmlDo(novo, ctaGerado);
  ok('com output.cta o selo do agente entra', htmlGerado.includes('OFERTA RELÂMPAGO'));
  ok('com output.cta o título do agente entra', htmlGerado.includes('HOJE'));
  ok('com output.cta o destaque do agente entra', htmlGerado.includes('CUPOM NA BIO'));
  ok('com output.cta o corpo do agente entra', htmlGerado.includes('meia-noite'));
  ok('o texto institucional some quando o agente escreve', !htmlGerado.includes('Entre no grupo'));
  ok('a assinatura da conta continua cravada', htmlGerado.includes('@promoliso0'));
  ok('output.cta não consegue trocar a estrutura do slide',
    ctaGerado.tipo === 'cta' && ctaGerado.total === 6);
}

// ---- 5. corte: texto absurdo não estoura ----
{
  const LIM = Function('return ' + novo.match(/const CTA_LIM = (\{[^}]*\});/)[1])();
  const medido = JSON.parse(fs.readFileSync(path.join(__dirname, 'limites_cta.json'), 'utf8'));
  ok('CTA_LIM do código == limite_adotado medido',
    JSON.stringify(LIM) === JSON.stringify(medido.limite_adotado),
    JSON.stringify(LIM) + ' vs ' + JSON.stringify(medido.limite_adotado));

  const gigante = 'palavra '.repeat(120);
  const html = htmlDo(novo, { tipo: 'cta', pagina: 6, total: 6, selo: gigante, titulo: gigante, destaque: gigante, texto: gigante });
  // o corte é por campo; confere pelo tamanho do que sobrou em cada pedaço do HTML
  const corpo = (html.match(/line-height:1\.36;width:470px;">([^<]*)</) || [])[1] || '';
  ok('corpo cortado dentro do limite', corpo.length <= LIM.texto, corpo.length + ' chars');
  ok('corpo cortado termina com reticência', corpo.endsWith('…'), corpo.slice(-20));
  const strip = (html.match(/<span style="display:flex;">([^<]*)<\/span><\/div>/) || [])[1] || '';
  ok('destaque cortado dentro do limite', strip.length > 0 && strip.length <= LIM.destaque, strip.length + ' chars: ' + strip);
}

// ---- 6. campo vazio cai no institucional, e HTML do agente não passa ----
{
  const vazio = htmlDo(novo, { tipo: 'cta', pagina: 6, total: 6, selo: '', titulo: '   ', destaque: null, texto: undefined });
  // titleMetal/stripDestaque/kickerChip sobem tudo pra caixa alta antes de escrever no HTML
  ok('campo vazio cai no texto institucional',
    vazio.includes('ENTRE NO GRUPO') && vazio.includes('LINK NA BIO') && vazio.includes('SÓ QUEM SEGUE'));
  ok('vazio rende exatamente o HTML de hoje', vazio === htmlDo(antigo, { tipo: 'cta', pagina: 6, total: 6 }));

  const injecao = htmlDo(novo, { tipo: 'cta', pagina: 6, total: 6, texto: '<img src=x onerror=alert(1)>bom preço' });
  ok('corpo do agente é escapado', !injecao.includes('<img src=x') && injecao.includes('&lt;img'));
}

// ---- 7. a paginação deixa de ser cravada ----
{
  const seis = htmlDo(novo, { tipo: 'cta', pagina: 6, total: 6 });
  ok('pagina 6 de 6 continua "06"', /06\b/.test(seis));
  const quatro = htmlDo(novo, { tipo: 'cta', pagina: 4, total: 4 });
  ok('com 4 slides o CTA diz 04, não 06', quatro.includes('04') && !/>06</.test(quatro));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
