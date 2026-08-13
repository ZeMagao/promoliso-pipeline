// Harness da forma EVENTO de OFERTA. Offline, roda o validador REAL (o nó inteiro, não uma cópia
// da regra) contra pautas sintéticas montadas sobre uma saída editorial de verdade.
//
// O que precisa provar:
//   1. Promoção de catálogo — a que o agente vinha recusando — PASSA agora.
//   2. A trava não sumiu, mudou de lugar: evento sem validade, sem desconto, com validade vencida
//      ou com URL que não é de loja continua reprovando.
//   3. A forma PRODUTO não mudou NADA. Mesmo veredito, caso a caso, inclusive o jogo grátis da
//      Epic (que já causou uma reprovação boba na exec 200).
//   4. Prompt e validador falam dos mesmos campos — foi o desalinho entre os dois que custou
//      semanas em 05/08.
//
//   node design/test_oferta_evento.cjs
const fs = require('fs');
const path = require('path');
const { trocarValidador, trocarPrompt, NOVO, SHA_ANTIGO, recortarBloco } = require('./patch_oferta_evento.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const lf = (s) => String(s).split('\r\n').join('\n');
const exportado = lf(fs.readFileSync(path.join(WFDIR, 'validar-antes-de-publicar.js'), 'utf8'));
const promptExportado = lf(fs.readFileSync(path.join(WFDIR, 'ai-agent.prompt.md'), 'utf8'));
const APLICADO = exportado.includes('function fimDaPromocao(');
console.log(APLICADO ? '# export JÁ tem a forma evento — verificando o que está no ar'
                     : '# export ainda não tem a forma evento — verificando a troca');

let antigo, novo, promptNovo;
if (APLICADO) {
  novo = exportado;
  ok('no ar está exatamente o bloco versionado', novo.includes(NOVO));
  let re = null;
  try { trocarValidador(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já aplicado/.test(String(re)), re);
  antigo = null;                                   // sem o bloco antigo não dá pra comparar
  promptNovo = promptExportado;
} else {
  antigo = exportado;
  let erro = null;
  try { novo = trocarValidador(antigo); } catch (e) { erro = e.message; }
  ok('o patch aplica no validador (sha bate)', Boolean(novo), erro);
  if (!novo) { console.log('\n1 FALHA(S)'); process.exit(1); }
  let re = null;
  try { trocarValidador(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já aplicado/.test(String(re)), re);
  let ep = null;
  try { promptNovo = trocarPrompt(promptExportado); } catch (e) { ep = e.message; }
  ok('o patch aplica no prompt', Boolean(promptNovo), ep);
  if (!promptNovo) { console.log('\nFALHA'); process.exit(1); }
}

// ---- roda o nó inteiro, como o n8n roda ----
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'row36_output.json'), 'utf8'));
function validar(code, output) {
  const $json = { output };
  const $ = (nome) => {
    if (nome === 'Montar contexto editorial') return { item: { json: { candidatos: [] } } };
    return { item: { json: {} }, first: () => ({ json: {} }), all: () => [] };
  };
  const $input = { first: () => ({ json: { output } }), all: () => [{ json: { output } }] };
  const r = new Function('$json', '$', '$input', '$now', '$execution', code)($json, $, $input, undefined, { mode: 'trigger' });
  return r[0].json.relatorio_validacao?.erros || [];
}
const soOferta = (erros) => erros.filter((e) => /oferta|promoç|preço|evento/i.test(e)).sort();
const semOferta = (erros) => erros.filter((e) => !/oferta|promoç|preço|evento/i.test(e)).sort();

const dias = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
};

const pauta = (oferta, categoria) => ({ ...base, categoria: categoria || 'OFERTA', oferta });

const EVENTO_OK = {
  tipo: 'evento', produto: '', variante: '', loja: 'Steam',
  preco_atual: '', preco_referencia: '', condicao_pagamento: '',
  cupom: '', desconto: 'até 95%', validade: 'até ' + dias(9),
  disponibilidade: 'disponível', url: 'https://store.steampowered.com/specials',
};
const PRODUTO_OK = {
  tipo: 'produto', produto: 'AMD Ryzen 9 9950X3D', variante: '16 núcleos', loja: 'Amazon',
  preco_atual: 'R$ 4.299,00', preco_referencia: 'R$ 5.099,00', condicao_pagamento: 'à vista no Pix',
  cupom: '', disponibilidade: 'disponível', url: 'https://www.amazon.com.br/dp/B0XYZ',
};

// ---- 1. o caso que motivou tudo ----
{
  const erros = soOferta(validar(novo, pauta(EVENTO_OK)));
  ok('promoção de catálogo (evento) PASSA agora', erros.length === 0, erros.join(' | '));
  if (antigo) {
    const antes = soOferta(validar(antigo, pauta(EVENTO_OK)));
    ok('e ela reprovava antes (era esta a trava)', antes.length > 0, antes.join(' | '));
  }
}

// ---- 2. a trava mudou de lugar, não sumiu ----
const NEGATIVOS = [
  ['evento sem validade', { ...EVENTO_OK, validade: '' }, /sem loja, validade ou disponibilidade/],
  ['evento sem desconto nem cupom', { ...EVENTO_OK, desconto: '', cupom: '' }, /sem faixa de desconto nem cupom/],
  ['evento com validade vencida', { ...EVENTO_OK, validade: 'até ' + dias(-9) }, /já encerrada/],
  ['evento sem loja', { ...EVENTO_OK, loja: '' }, /sem loja, validade ou disponibilidade/],
  ['evento com URL que não é loja', { ...EVENTO_OK, url: 'https://www.adrenaline.com.br/noticia' }, /URL direta de uma loja conhecida/],
  ['evento marcado como encerrado', { ...EVENTO_OK, disponibilidade: 'encerrada' }, /marcada como indisponível/],
];
for (const [nome, oferta, esperado] of NEGATIVOS) {
  const erros = soOferta(validar(novo, pauta(oferta)));
  ok(nome + ' reprova', erros.some((e) => esperado.test(e)), erros.join(' | ') || '(passou)');
}
{
  // validade que não dá pra ler NÃO pode virar reprovação: adivinhar data mata pauta boa
  const erros = soOferta(validar(novo, pauta({ ...EVENTO_OK, validade: 'enquanto durarem os estoques' })));
  ok('validade ilegível passa (não adivinhar data)', erros.length === 0, erros.join(' | '));
}
{
  const erros = soOferta(validar(novo, pauta({ ...EVENTO_OK, desconto: '', cupom: 'NUUOITO' })));
  ok('evento só com cupom passa', erros.length === 0, erros.join(' | '));
}

// ---- 3. a forma PRODUTO não pode ter mudado ----
if (antigo) {
  const CASOS_PRODUTO = [
    ['produto completo', PRODUTO_OK],
    ['produto sem preço', { ...PRODUTO_OK, preco_atual: '' }],
    ['produto sem condição de pagamento', { ...PRODUTO_OK, condicao_pagamento: '' }],
    ['jogo grátis da Epic', { ...PRODUTO_OK, produto: 'Beacon Pines', preco_atual: 'Grátis (R$ 0,00)', preco_referencia: '', loja: 'Epic Games', url: 'https://store.steampowered.com/app/1' }],
    ['preço de referência menor que o atual', { ...PRODUTO_OK, preco_referencia: 'R$ 10,00' }],
    ['produto com URL que não é loja', { ...PRODUTO_OK, url: 'https://www.adrenaline.com.br/noticia' }],
    ['oferta sem tipo declarado (o que existe hoje)', { ...PRODUTO_OK, tipo: undefined }],
  ];
  for (const [nome, oferta] of CASOS_PRODUTO) {
    const a = soOferta(validar(antigo, pauta(oferta)));
    const d = soOferta(validar(novo, pauta(oferta)));
    ok('PRODUTO idêntico: ' + nome, JSON.stringify(a) === JSON.stringify(d), `antes[${a}] depois[${d}]`);
  }
  for (const cat of ['NOTICIA', 'ALERTA', 'GUIA']) {
    const a = validar(antigo, pauta({}, cat)).sort();
    const d = validar(novo, pauta({}, cat)).sort();
    ok(`${cat} não é afetada`, JSON.stringify(a) === JSON.stringify(d), `antes[${a.length}] depois[${d.length}]`);
  }
  const a = semOferta(validar(antigo, pauta(EVENTO_OK)));
  const d = semOferta(validar(novo, pauta(EVENTO_OK)));
  ok('nada fora de oferta mudou de veredito', JSON.stringify(a) === JSON.stringify(d));
}

// ---- 4. leitura de data ----
{
  const fimDaPromocao = new Function(
    novo.slice(novo.indexOf('function fimDaPromocao('), novo.indexOf('let ofertaAuditada')) + '\nreturn fimDaPromocao;',
  )();
  const casos = [
    ['até 26 de agosto', true], ['26/08', true], ['26/08/2026', true], ['2026-08-26', true],
    ['enquanto durarem os estoques', false], ['', false], ['por tempo limitado', false], [null, false],
  ];
  for (const [texto, deveLer] of casos) {
    const r = fimDaPromocao(texto);
    ok(`data ${deveLer ? 'lida' : 'ignorada'}: ${JSON.stringify(texto)}`, Boolean(r) === deveLer, String(r));
  }
}

// ---- 5. prompt e validador de acordo ----
{
  const p = promptNovo;
  ok('prompt descreve a forma evento', /tipo "evento"/.test(p));
  ok('prompt diz que catálogo é pauta válida', /Catálogo de descontos É pauta válida/.test(p));
  ok('prompt pede validade com data', /validade precisa dizer até quando/.test(p));
  ok('prompt avisa da fila de 48 horas', /48 horas/.test(p));
  ok('prompt mantém a recusa de evento repetido', /MESMO já publicado no histórico/.test(p));
  for (const campo of ['tipo', 'validade', 'desconto']) {
    ok(`campo "${campo}" está no JSON do prompt`, new RegExp('"' + campo + '":').test(p));
  }
  // o que o CÓDIGO exige de um evento tem que aparecer no prompt
  for (const campo of ['loja', 'validade', 'disponibilidade']) {
    ok(`o prompt cita "${campo}", que o validador exige em evento`,
      new RegExp('\\b' + campo + '\\b').test(p));
  }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
