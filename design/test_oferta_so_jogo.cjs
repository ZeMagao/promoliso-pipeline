// Harness do corte de promoção de produto físico. Offline, rodando o validador REAL.
//
//   node design/test_oferta_so_jogo.cjs
const fs = require('fs');
const path = require('path');
const { trocarValidador, trocarPrompt } = require('./patch_oferta_so_jogo.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const lf = (s) => String(s).split('\r\n').join('\n');
const antigo = lf(fs.readFileSync(path.join(WFDIR, 'validar-antes-de-publicar.js'), 'utf8'));
const promptAntigo = lf(fs.readFileSync(path.join(WFDIR, 'ai-agent.prompt.md'), 'utf8'));
const APLICADO = antigo.includes('lojasDeEletronicos');
console.log(APLICADO ? '# export JÁ corta produto físico — verificando o que está no ar'
                     : '# export ainda aceita produto físico — verificando a troca');

let novo, promptNovo;
if (APLICADO) {
  novo = antigo; promptNovo = promptAntigo;
  let re = null;
  try { trocarValidador(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já separa as lojas/.test(String(re)), re);
} else {
  let e1 = null, e2 = null;
  try { novo = trocarValidador(antigo); } catch (e) { e1 = e.message; }
  try { promptNovo = trocarPrompt(promptAntigo); } catch (e) { e2 = e.message; }
  ok('o patch aplica no validador', Boolean(novo), e1);
  ok('o patch aplica no prompt', Boolean(promptNovo), e2);
  if (!novo || !promptNovo) { console.log('\nFALHA'); process.exit(1); }
}

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
const soOferta = (e) => e.filter((x) => /oferta|promoç|preço|evento|físic/i.test(x)).sort();

const dias = (n) => { const d = new Date(Date.now() + n * 86400000); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); };
const OFERTA_JOGO = {
  tipo: 'produto', produto: 'Elden Ring', variante: 'edição padrão', loja: 'Steam',
  preco_atual: 'R$ 149,00', preco_referencia: 'R$ 249,00', condicao_pagamento: 'à vista',
  disponibilidade: 'disponível', url: 'https://store.steampowered.com/app/1245620',
};
const pauta = (oferta, categoria) => ({ ...base, categoria: categoria || 'OFERTA', oferta });

// ---- o caso que motivou o pedido ----
{
  const monitor = { ...OFERTA_JOGO, produto: 'Monitor LG UltraGear 24G411A-B', loja: 'Kabum',
    url: 'https://www.kabum.com.br/produto/123/monitor-lg-ultragear' };
  const erros = soOferta(validar(novo, pauta(monitor)));
  ok('promoção de MONITOR reprova', erros.some((e) => /produto físico não é pauta/.test(e)), erros.join(' | '));
  if (!APLICADO) ok('e passava antes', soOferta(validar(antigo, pauta(monitor))).length === 0);

  const ryzen = { ...OFERTA_JOGO, produto: 'AMD Ryzen 9 9950X3D', loja: 'Amazon',
    url: 'https://www.amazon.com.br/dp/B0XYZ' };
  ok('promoção de PROCESSADOR na Amazon reprova',
    soOferta(validar(novo, pauta(ryzen))).some((e) => /produto físico não é pauta/.test(e)));
}

// ---- o que TEM que continuar passando ----
{
  ok('promoção de JOGO na Steam passa', soOferta(validar(novo, pauta(OFERTA_JOGO))).length === 0,
    soOferta(validar(novo, pauta(OFERTA_JOGO))).join(' | '));

  for (const [loja, url] of [
    ['Epic', 'https://store.epicgames.com/pt-BR/p/caravan-sandwitch'],
    ['PS Store', 'https://store.playstation.com/pt-br/product/x'],
    ['Xbox', 'https://www.xbox.com/pt-BR/games/store/x/y'],
    ['Nintendo', 'https://www.nintendo.com/store/products/x'],
    ['GOG', 'https://www.gog.com/game/x'],
    ['Nuuvem', 'https://www.nuuvem.com/br-pt/item/x'],
  ]) {
    ok(`oferta de jogo na ${loja} passa`, soOferta(validar(novo, pauta({ ...OFERTA_JOGO, url }))).length === 0);
  }

  // jogo grátis da Epic: o caso da fonte nova, com a excecao de preço já existente
  const gratis = { ...OFERTA_JOGO, produto: 'Caravan SandWitch', preco_atual: 'Grátis',
    preco_referencia: 'R$ 43,99', url: 'https://store.epicgames.com/pt-BR/p/caravan-sandwitch' };
  ok('jogo grátis da Epic passa', soOferta(validar(novo, pauta(gratis))).length === 0,
    soOferta(validar(novo, pauta(gratis))).join(' | '));

  // evento de promoção numa loja de jogo
  const evento = { tipo: 'evento', loja: 'Steam', validade: 'até ' + dias(9), desconto: 'até 95%',
    disponibilidade: 'disponível', url: 'https://store.steampowered.com/specials' };
  ok('evento promocional na Steam passa', soOferta(validar(novo, pauta(evento))).length === 0,
    soOferta(validar(novo, pauta(evento))).join(' | '));
  const eventoKabum = { ...evento, loja: 'Kabum', url: 'https://www.kabum.com.br/promocoes' };
  ok('evento promocional na Kabum reprova',
    soOferta(validar(novo, pauta(eventoKabum))).some((e) => /produto físico não é pauta/.test(e)));
}

// ---- hardware como NOTÍCIA continua sendo pauta ----
if (!APLICADO) {
  for (const cat of ['NOTICIA', 'ALERTA', 'GUIA']) {
    const a = validar(antigo, pauta({}, cat)).sort();
    const d = validar(novo, pauta({}, cat)).sort();
    ok(`${cat} não é afetada (notícia de hardware segue valendo)`, JSON.stringify(a) === JSON.stringify(d));
  }
}

// ---- prompt e validador de acordo ----
{
  ok('prompt diz que produto físico não é OFERTA', /NÃO existe OFERTA de produto físico/.test(promptNovo));
  ok('prompt lista as lojas de eletrônico que o validador recusa',
    ['Amazon', 'Kabum', 'Magazine Luiza', 'Mercado Livre', 'Terabyte', 'Pichau']
      .every((l) => promptNovo.includes(l)));
  ok('prompt lista as lojas de jogo que o validador aceita',
    ['Steam', 'Epic', 'PS Store', 'Xbox', 'Nintendo', 'GOG', 'Nuuvem'].every((l) => promptNovo.includes(l)));
  ok('prompt preserva hardware como NOTICIA/ALERTA', /Hardware continua sendo pauta como NOTICIA ou ALERTA/.test(promptNovo));
  // as duas listas do código têm de estar citadas no prompt, senão o agente escreve o que o
  // validador vai recusar — o desencontro que custou semanas em 05/08
  // O domínio não é o nome que uma pessoa escreve: o prompt fala "Mercado Livre" e "Terabyte",
  // não "mercadolivre.com.br". O mapa é explícito para o teste não virar adivinhação de string.
  const NOME_HUMANO = {
    'amazon.com.br': 'amazon',
    'kabum.com.br': 'kabum',
    'magazineluiza.com.br': 'magazine luiza',
    'mercadolivre.com.br': 'mercado livre',
    'terabyteshop.com.br': 'terabyte',
    'pichau.com.br': 'pichau',
  };
  const eletronicos = (novo.match(/const lojasDeEletronicos = \[([\s\S]*?)\]/) || [])[1] || '';
  const hosts = (eletronicos.match(/'([^']+)'/g) || []).map((h) => h.replace(/'/g, ''));
  ok('conheço o nome humano de toda loja de eletrônico da lista',
    hosts.every((h) => NOME_HUMANO[h]), hosts.filter((h) => !NOME_HUMANO[h]).join(','));
  for (const host of hosts) {
    const nome = NOME_HUMANO[host] || host;
    ok(`o prompt cita "${nome}", que o validador recusa`, promptNovo.toLowerCase().includes(nome));
  }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
