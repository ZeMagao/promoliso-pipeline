#!/usr/bin/env node
// Harness do apelido curto da ponte e do nome no cache (02/10/2026). Offline.
//
// Usa as 154 URLs REAIS que os montadores de capa e slide geraram em 57 execuções
// (design/ponte_urls_amostra_20261002.json). O que precisa provar:
//   1. URL que funciona hoje passa INTACTA, byte a byte — o caminho que publica não muda.
//   2. As 7 URLs que mataram rodadas viram URL curta, abaixo do limite do Cloudinary, com a MESMA
//      transformação, e o apelido leva de volta exatamente à imagem original.
//   3. O apelido não abre porta: id fora do formato, arquivo inexistente ou host fora da lista
//      não servem nada.
//   4. O nome no cache deixa de colidir: cada URL, um arquivo (antes eram 44 URLs em 33 arquivos,
//      e 5 fotos diferentes da mesma matéria saíam como a mesma).
//
//   node vps/cdn/test_promo_cdn_apelido.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { encurtarPonte, LIMITE_PUBLIC_ID, PONTE_A, PONTE_U } = require('../renderer/candidatos.cjs');
const { nomeNoCache, alvoDoApelido, hostPermitido, RE_APELIDO } = require('./promo-cdn.cjs');

const AMOSTRA = require('../../design/ponte_urls_amostra_20261002.json');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apelido-'));
const registrados = {};
// o mesmo que o server.cjs faz, num diretório temporário
const registrar = (id, original) => {
  registrados[id] = original;
  fs.writeFileSync(path.join(DIR, id + '.url'), original);
};
const encurtar = (u) => encurtarPonte(u, registrar, sha256);

const RE_FETCH = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/fetch\/.*?\/)(https?(?::|%3A).*)$/i;
const remotaDe = (u) => { const m = RE_FETCH.exec(u); if (!m) return null; return /^https?%3A/i.test(m[2]) ? decodeURIComponent(m[2]) : m[2]; };
const prefixoDe = (u) => (RE_FETCH.exec(u) || [])[1];

// 1. o que funciona hoje não muda
const curtas = AMOSTRA.urls.filter((u) => !remotaDe(u) || remotaDe(u).length <= LIMITE_PUBLIC_ID);
const intactas = curtas.filter((u) => encurtar(u) === u);
ok(`${curtas.length} URLs abaixo do limite passam byte a byte (${intactas.length})`, intactas.length === curtas.length);
ok('nenhuma URL de rodada que deu certo é tocada',
  AMOSTRA.urls.filter((u) => !AMOSTRA.das_rodadas_que_morreram.includes(u)).every((u) => encurtar(u) === u));

// 2. as que mataram rodadas
const mortas = AMOSTRA.das_rodadas_que_morreram;
ok(`a amostra tem as 7 URLs que mataram rodadas (${mortas.length})`, mortas.length === 7);
ok('todas elas passavam do limite do Cloudinary (255)', mortas.every((u) => remotaDe(u).length > 255),
  mortas.map((u) => remotaDe(u).length).join(','));
for (const u of mortas) {
  const novo = encurtar(u);
  const remota = remotaDe(novo);
  const id = remota && remota.slice(PONTE_A.length);
  const original = new URL(remotaDe(u)).searchParams.get('u');
  ok(`curta (${remota && remota.length} chars) e mesma transformação: ${original.split('/').pop().slice(0, 40)}`,
    remota && remota.length < 100 && remota.startsWith(PONTE_A) && prefixoDe(novo) === prefixoDe(u));
  ok('   apelido leva de volta à imagem original, e o host passa na lista',
    alvoDoApelido(id, DIR) === original && hostPermitido(original));
  ok('   sem "?" cru depois do fetch (viraria query string do Cloudinary)', !novo.slice(prefixoDe(novo).length).includes('?'));
}
const ids = Object.keys(registrados);
ok('o mesmo original dá sempre o mesmo apelido', encurtar(mortas[0]) === encurtar(mortas[0]));
ok('ids no formato que a ponte aceita', ids.every((id) => RE_APELIDO.test(id)), ids.join(','));
ok('originais diferentes, apelidos diferentes', new Set(Object.values(registrados)).size === ids.length);

// URL longa que não é da nossa ponte: só a ponte sabe servir apelido
const longaAlheia = 'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fill/' + encodeURIComponent('https://news.xbox.com/' + 'a'.repeat(300) + '.jpg');
ok('URL longa de outro host passa intacta (não vira apelido que ninguém serve)', encurtar(longaAlheia) === longaAlheia);
ok('URL que não é fetch do Cloudinary passa intacta', encurtar('https://res.cloudinary.com/fy2n2qvr/image/upload/v1/abc.jpg') === 'https://res.cloudinary.com/fy2n2qvr/image/upload/v1/abc.jpg');
const ponteComHostRuim = 'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fill/' + encodeURIComponent(PONTE_U + encodeURIComponent('http://inseguro/' + 'b'.repeat(300)));
ok('original sem https não vira apelido', encurtar(ponteComHostRuim) === ponteComHostRuim);

// 3. o apelido não abre porta
for (const ruim of ['../../../etc/passwd', 'ABCDEF0123456789ABCDEF0123456789', 'abc', '', null, ids[0] + 'x']) {
  ok(`apelido recusado: ${String(ruim).slice(0, 34) || '(vazio)'}`, alvoDoApelido(ruim, DIR) === null);
}
ok('apelido bem formado mas não registrado: nada', alvoDoApelido('0'.repeat(32), DIR) === null);
fs.writeFileSync(path.join(DIR, '1'.repeat(32) + '.url'), 'https://evil.com/x.jpg');
ok('apelido que aponta para host fora da lista é barrado pela mesma lista do ?u=',
  alvoDoApelido('1'.repeat(32), DIR) === 'https://evil.com/x.jpg' && !hostPermitido('https://evil.com/x.jpg'));

// 4. nome no cache
const originais = [...new Set(AMOSTRA.urls.map((u) => remotaDe(u)).filter((r) => r && r.startsWith(PONTE_U))
  .map((r) => new URL(r).searchParams.get('u')))];
const nomeAntigo = (a) => Buffer.from(a).toString('base64url').slice(0, 120);
const antigos = new Set(originais.map(nomeAntigo)).size;
const novos = new Set(originais.map(nomeNoCache)).size;
ok(`ANTES: ${originais.length} URLs da ponte caíam em ${antigos} arquivos (o defeito)`, antigos < originais.length);
ok(`DEPOIS: ${originais.length} URLs, ${novos} arquivos — um por URL`, novos === originais.length);
const tlou = originais.filter((a) => /the-last-of-us-day-2026-avatares-tema-ps5-steam-0/.test(a));
ok(`as ${tlou.length} fotos do The Last of Us Day: antes 1 arquivo, agora ${new Set(tlou.map(nomeNoCache)).size}`,
  tlou.length >= 2 && new Set(tlou.map(nomeAntigo)).size === 1 && new Set(tlou.map(nomeNoCache)).size === tlou.length);
ok('nome no cache só tem [0-9a-f] (nada de caminho)', originais.every((a) => /^[0-9a-f]{64}$/.test(nomeNoCache(a))));

fs.rmSync(DIR, { recursive: true, force: true });
console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
