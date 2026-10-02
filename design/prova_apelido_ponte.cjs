// PROVA AO VIVO do apelido curto da ponte — contra o Cloudinary de verdade, sem render e sem n8n.
//
// Pré-requisito: o promo-cdn NOVO no ar (ele é quem entende `/img?a=`). O renderizador NÃO precisa
// ter sido trocado: esta prova usa o `candidatos.cjs` novo que está em design/_novo/.
//
//   N  controle NEGATIVO  as URLs longas que mataram as rodadas 763/796/799, como estavam.
//                         Têm que dar 400 "public_id ... is too long" — senão o diagnóstico mudou.
//   P  controle POSITIVO  uma URL curta que funciona hoje. Tem que dar 200 (bancada fiel).
//   A  o conserto         as mesmas URLs longas, encurtadas pelo apelido. Têm que dar 200 com
//                         imagem do tamanho da capa.
//   C  a ponte local      `/img?a=<id>` direto no promo-cdn, sem Cloudinary no meio.
//
// Grava só o que o renderizador novo gravaria: os arquivos de apelido em cdn-cache/_ponte/apelido.
//   cd /opt/promoliso && sudo -u promo node design/prova_apelido_ponte.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encurtarPonte, PONTE_A } = require('./_novo/candidatos.cjs');
const AMOSTRA = require('./ponte_urls_amostra_20261002.json');

const DIR = '/opt/promoliso/cdn-cache/_ponte/apelido';
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ids = [];
const registrar = (id, original) => {
  ids.push(id);
  const arq = path.join(DIR, id + '.url');
  if (fs.existsSync(arq)) return;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(arq + '.tmp', original);
  fs.renameSync(arq + '.tmp', arq);
};

async function olhar(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'PromoLiso-Renderer/1.0' } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, tipo: String(r.headers.get('content-type') || ''), erro: r.headers.get('x-cld-error') || '', bytes: buf.length };
}

(async () => {
  let falhas = 0;
  const ok = (nome, cond, det) => { console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (det ? '  -> ' + det : '')); if (!cond) falhas++; };
  const longas = [...new Set(AMOSTRA.das_rodadas_que_morreram)].slice(0, 3);
  const curta = AMOSTRA.urls.find((u) => !AMOSTRA.das_rodadas_que_morreram.includes(u) && /blogger|adrenaline/.test(decodeURIComponent(u)));

  for (const u of longas) {
    const n = await olhar(u);
    ok('N longa como estava: 400 "too long"', n.status === 400 && /too long/.test(n.erro), n.status + ' ' + n.erro.slice(0, 60));
  }
  const p = await olhar(curta);
  ok('P curta de hoje: 200 imagem', p.status === 200 && /^image\//.test(p.tipo), p.status + ' ' + p.tipo + ' ' + p.bytes + 'B');

  for (const u of longas) {
    const novo = encurtarPonte(u, registrar, sha256);
    ok('A virou apelido', novo !== u && decodeURIComponent(novo).includes(PONTE_A));
    const a = await olhar(novo);
    ok('A encurtada: 200 imagem', a.status === 200 && /^image\//.test(a.tipo) && a.bytes > 20000, a.status + ' ' + a.tipo + ' ' + a.bytes + 'B ' + a.erro.slice(0, 60));
  }
  for (const id of [...new Set(ids)]) {
    const c = await olhar('http://127.0.0.1:5701/img?a=' + id);
    ok('C ponte local serve o apelido ' + id.slice(0, 8), c.status === 200 && /^image\//.test(c.tipo), c.status + ' ' + c.tipo + ' ' + c.bytes + 'B');
  }
  const d = await olhar('http://127.0.0.1:5701/img?a=' + '0'.repeat(32));
  ok('C apelido desconhecido: 404', d.status === 404, String(d.status));

  console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'TUDO PASSOU'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('ERRO NA PROVA', e); process.exit(1); });
