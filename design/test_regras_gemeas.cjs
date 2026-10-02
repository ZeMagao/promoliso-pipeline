// REGRAS GÊMEAS — detector de divergência (02/10/2026). Offline, lê o código que roda.
//
// O padrão que mais custou neste projeto: uma regra escrita em dois lugares que precisam
// concordar, e uma delas muda sozinha. Já foram quatro bugs assim (caps 42/38, URL do Cloudinary
// no fallback, "imagem válida" no recovery, a faixa de slides que truncava a peça na fila).
//
// Juntar cada regra num lugar só exigiria mexer em 8 nós de produção — um Code node do n8n não
// importa código de outro. Então a correção é outra: cada cópia é LIDA do export (o que roda) e
// comparada com as irmãs. Mudou uma sem as outras, este harness fica vermelho no `npm test` e na CI.
//
// Cada checagem também exige ACHAR todas as cópias: se uma variável for renomeada, o teste falha
// dizendo "cópia não encontrada" em vez de passar vazio.
//
//   node design/test_regras_gemeas.cjs
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const P = 'workflows/promoliso-conteudo-instagram--NL8eVLKErgnIXBQq/';
const F = 'workflows/promoliso-publicador-fila--E27F7yVdsZRj/';
const ARQUIVOS = {
  portao: P + 'portao-da-fila.js',
  capa: P + 'code-in-javascript1.js',
  slide: P + 'code-in-javascript.js',
  fallback: P + 'usar-capa-como-fallback.js',
  validador: P + 'validar-antes-de-publicar.js',
  normalizar: P + 'normalizar-noticias-promolis.js',
  curador: P + 'validar-e-consolidar-curador.js',
  promptRedator: P + 'ai-agent.prompt.md',
  promptCurador: P + 'agente-curador-promoliso-ai.prompt.md',
  promptVerificador: P + 'agente-verificador-de-confia.prompt.md',
  selecionar: F + 'selecionar-ready.js',
  falha: F + 'preparar-falha.js',
  vigia: 'vps/bin/promo-vigia.cjs',
  cdn: 'vps/cdn/promo-cdn.cjs',
  cdnUnit: 'vps/systemd/promo-cdn.service',
  renderer: 'vps/renderer/candidatos.cjs',
  caddy: 'vps/caddy/Caddyfile',
};
const lerTudo = () => Object.fromEntries(Object.entries(ARQUIVOS)
  .map(([k, rel]) => [k, fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\r\n').join('\n')]));

// Acha o valor numa fonte; sem achar, lança — "cópia não encontrada" é falha, não passe.
function achar(fontes, chave, re, grupo) {
  const m = re.exec(fontes[chave]);
  if (!m) throw new Error(`cópia não encontrada em ${ARQUIVOS[chave]} (${re}) — a regra mudou de forma; atualizar este harness`);
  return grupo === undefined ? m : m[grupo];
}
function funcao(fontes, chave, nome) {
  const t = fontes[chave];
  const i = t.indexOf('function ' + nome + '(');
  if (i < 0) throw new Error(`function ${nome} não encontrada em ${ARQUIVOS[chave]}`);
  const f = t.indexOf('\n}\n', i);
  return t.slice(i, f + 2);
}
const iguais = (valores) => new Set(valores.map((v) => JSON.stringify(v))).size === 1;
const descreve = (pares) => pares.map(([onde, v]) => `${onde}=${JSON.stringify(v)}`).join('  ');

// Cada regra devolve [ok, detalhe]. Puras sobre `fontes`, para o controle negativo poder mutar.
const REGRAS = [
  ['frescor da fila (h): portão, Selecionar READY, Preparar FALHA, vigia', (f) => {
    const p = [
      ['portão', Number(achar(f, 'portao', /const FRESCOR_MAX_H = (\d+)/, 1))],
      ['selecionar', Number(achar(f, 'selecionar', /const FRESCOR_MAX_H = (\d+)/, 1))],
      ['falha', Number(achar(f, 'falha', /const FRESCOR_MAX_H = (\d+)/, 1))],
      ['vigia', Number(achar(f, 'vigia', /const FRESCA = [^\n]*-(\d+) hours/, 1))],
    ];
    return [iguais(p.map((x) => x[1])), descreve(p)];
  }],
  ['faixa de slides: montador da capa, validador, prompt do redator', (f) => {
    const re = /const MIN_SLIDES = (\d+);\s*const MAX_SLIDES = (\d+);/;
    const p = [
      ['capa', achar(f, 'capa', re).slice(1, 3).map(Number)],
      ['validador', achar(f, 'validador', re).slice(1, 3).map(Number)],
      ['prompt', achar(f, 'promptRedator', /de (\d+) a (\d+) slides/).slice(1, 3).map(Number)],
    ];
    return [iguais(p.map((x) => x[1])), descreve(p)];
  }],
  ['publicador cobre a faixa de imagens (capa + slides) que o produtor gera', (f) => {
    const [, min, max] = achar(f, 'validador', /const MIN_SLIDES = (\d+);\s*const MAX_SLIDES = (\d+);/).map(Number);
    const pubMin = Number(achar(f, 'selecionar', /const MIN_IMAGENS = (\d+)/, 1));
    const pubMax = Number(achar(f, 'selecionar', /const MAX_IMAGENS = (\d+)/, 1));
    return [pubMin <= min + 1 && pubMax >= max + 1, `produtor ${min + 1}..${max + 1} imagens, publicador aceita ${pubMin}..${pubMax}`];
  }],
  ['piso da capa (px): montador da capa, montador do slide, normalizar (WordPress)', (f) => {
    const re = /const CAPA_MIN_W = (\d+), CAPA_MIN_H = (\d+);/;
    const p = [
      ['capa', achar(f, 'capa', re).slice(1, 3).map(Number)],
      ['slide', achar(f, 'slide', re).slice(1, 3).map(Number)],
      ['normalizar', achar(f, 'normalizar', /Number\(m\[2\]\) >= (\d+) && Number\(m\[3\]\) >= (\d+)/).slice(1, 3).map(Number)],
    ];
    return [iguais(p.map((x) => x[1])), descreve(p)];
  }],
  ['montagem da URL do Cloudinary: cloud() idêntica nos dois montadores', (f) => {
    const a = funcao(f, 'capa', 'cloud');
    const b = funcao(f, 'slide', 'cloud');
    return [a === b, a === b ? `${a.split('\n').length} linhas iguais` : 'cloud() divergiu entre capa e slide'];
  }],
  ['hosts da ponte: montadores × promo-cdn', (f) => {
    const doRegex = (k) => {
      const m = achar(f, k, /\(\?:\[a-z0-9-\]\+\\\.\)\*\(\?:([^)]+)\)\\\//);
      return m[1].split('|').map((h) => h.replace(/\\\./g, '.')).sort();
    };
    const doCdn = achar(f, 'cdn', /const HOSTS_PONTE = \[([^\]]+)\]/, 1).match(/'([^']+)'/g).map((s) => s.slice(1, -1)).sort();
    const p = [['capa', doRegex('capa')], ['slide', doRegex('slide')], ['promo-cdn', doCdn]];
    return [iguais(p.map((x) => x[1])), descreve(p)];
  }],
  ['prefixo da ponte: montadores × apelido do renderizador', (f) => {
    const re = /'(https:\/\/[a-z0-9.-]+\/img\?u=)'/;
    const p = [
      ['capa', achar(f, 'capa', re, 1)],
      ['slide', achar(f, 'slide', re, 1)],
      ['renderer', achar(f, 'renderer', /const PONTE_U = '([^']+)'/, 1)],
    ];
    const hostA = achar(f, 'renderer', /const PONTE_A = '(https:\/\/[^/]+)\/img\?a='/, 1);
    return [iguais(p.map((x) => x[1])) && p[0][1].startsWith(hostA + '/'), descreve(p) + `  PONTE_A=${hostA}/img?a=`];
  }],
  ['nome do cloud do Cloudinary em todo lugar que monta ou reconhece URL', (f) => {
    const nomes = (k) => [...new Set([...f[k].matchAll(/res\\?\.cloudinary\\?\.com\\?\/([a-z0-9]+)\\?\//g)].map((m) => m[1]))];
    const p = ['capa', 'slide', 'fallback', 'selecionar'].map((k) => [k, nomes(k)]);
    p.push(['promo-cdn.service', [achar(f, 'cdnUnit', /PROMO_CDN_CLOUD=([a-z0-9]+)/, 1)]]);
    const todos = new Set(p.flatMap((x) => x[1]));
    return [p.every((x) => x[1].length) && todos.size === 1, descreve(p)];
  }],
  ['nosso domínio: CDN do publicador, ponte e Caddy', (f) => {
    const p = [
      ['selecionar', achar(f, 'selecionar', /const CDN_BASE = 'https:\/\/([^']+)'/, 1)],
      ['ponte', achar(f, 'capa', /'https:\/\/([a-z0-9.-]+)\/img\?u='/, 1)],
      ['caddy', achar(f, 'caddy', /^([a-z0-9.-]+\.[a-z]{2,}) \{/m, 1)],
    ];
    return [iguais(p.map((x) => x[1])), descreve(p)];
  }],
  ['tetos das notas: prompt do Curador/Verificador × consolidação', (f) => {
    const campos = ['relevancia', 'engajamento', 'atualidade', 'originalidade', 'utilidade'];
    const prompt = Object.fromEntries(campos.map((c) => [c, Number(achar(f, 'promptCurador', new RegExp('^' + c + ' \\(0 a (\\d+)\\)', 'm'), 1))]));
    const codigo = Object.fromEntries(campos.map((c) => [c, Number(achar(f, 'curador', new RegExp("score\\(curator, '" + c + "', (\\d+)"), 1))]));
    prompt.confiabilidade = Number(achar(f, 'promptVerificador', /confiabilidade de 0 a (\d+)/, 1));
    codigo.confiabilidade = Number(achar(f, 'curador', /score\(\s*verifier,\s*'confiabilidade',\s*(\d+)/, 1));
    const ok = Object.keys(prompt).every((c) => prompt[c] === codigo[c]);
    return [ok, Object.keys(prompt).map((c) => `${c} ${prompt[c]}/${codigo[c]}`).join('  ')];
  }],
];

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (detalhe ? '\n        ' + detalhe : ''));
  if (!cond) falhas += 1;
};
function avaliar(fontes) {
  return REGRAS.map(([nome, regra]) => {
    try { const [bom, det] = regra(fontes); return { nome, bom, det }; }
    catch (e) { return { nome, bom: false, det: e.message }; }
  });
}

// 1. o código de hoje
for (const r of avaliar(lerTudo())) ok(r.nome, r.bom, r.det);

// 2. controle negativo: cada tipo de divergência, injetado numa cópia, tem que ser pego
const MUTACOES = [
  ['frescor só no Preparar FALHA', 'falha', 'const FRESCOR_MAX_H = 48', 'const FRESCOR_MAX_H = 36'],
  ['faixa de slides só no prompt', 'promptRedator', 'de 3 a 7 slides', 'de 3 a 8 slides'],
  ['piso da capa só no normalizar', 'normalizar', 'Number(m[2]) >= 1000', 'Number(m[2]) >= 1200'],
  ['host novo de ponte só no promo-cdn', 'cdn', "  'blogger.googleusercontent.com',\n", "  'blogger.googleusercontent.com',\n  'exemplo.com',\n"],
  ['prefixo da ponte só no renderizador', 'renderer', "const PONTE_U = 'https://n8n.promoliso.com.br/img?u='", "const PONTE_U = 'https://cdn.promoliso.com.br/img?u='"],
  ['teto de nota só no código', 'curador', "score(curator, 'atualidade', 15", "score(curator, 'atualidade', 20"],
  ['variável renomeada (cópia some)', 'portao', 'const FRESCOR_MAX_H', 'const FRESCOR_H'],
];
for (const [nome, chave, de, para] of MUTACOES) {
  const fontes = lerTudo();
  if (!fontes[chave].includes(de)) { ok(`controle negativo "${nome}": trecho existe para mutar`, false, de); continue; }
  fontes[chave] = fontes[chave].split(de).join(para);
  const pegou = avaliar(fontes).some((r) => !r.bom);
  ok(`controle negativo: detecta ${nome}`, pegou);
}

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
