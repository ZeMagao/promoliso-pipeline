#!/usr/bin/env node
// PROMO-CDN — serve as imagens do carrossel de um host NOSSO, não do `res.cloudinary.com`.
//
// POR QUE ISTO EXISTE (17/09/2026). Desde 16/09 nenhuma publicação passa: o buscador de mídia do
// Meta falha ao baixar de `res.cloudinary.com`, de forma intermitente, e o nó só guarda
// "Bad request - please check your parameters". Medido em 16/09: ~38-50% de sucesso por imagem no
// Cloudinary contra 8/8 num host fora dele. Com 6 filhos e retry all-or-nothing, publicar virava
// ~0,3%. Não é token, não é cota, não é formato — as imagens respondem 200 em 0,3 s do próprio VPS.
//
// O que este serviço faz: recebe /cdn/<versao>/<id>.jpg, baixa UMA vez do Cloudinary, guarda em
// disco e serve do disco dali em diante. Quando o Meta vier buscar, já é leitura de arquivo local
// — o buscador do Meta não fala mais com o Cloudinary.
//
// NÃO é proxy aberto: só casa `/cdn/v<digitos>/<id>.jpg` e só monta URL para o cloud configurado.
// Qualquer outro caminho é 404, então ninguém usa este host para buscar a internet.
//
//   node promo-cdn.cjs                      sobe o servidor (unit promo-cdn.service)
//   node promo-cdn.cjs --aquecer <url...>   baixa antes da hora (URL do Cloudinary ou nossa)
const fs = require('fs');
const path = require('path');
const http = require('http');

const CLOUD = process.env.PROMO_CDN_CLOUD || 'fy2n2qvr';
const HOST = process.env.PROMO_CDN_HOST || '127.0.0.1';
const PORT = Number(process.env.PROMO_CDN_PORT || 5701);
const CACHE = process.env.PROMO_CDN_CACHE || '/opt/promoliso/cdn-cache';
const TENTATIVAS = 3;
const TIMEOUT_MS = 20000;

// Só isto é aceito. `v` + dígitos é a versão do Cloudinary; o id é o public_id que ele sorteia.
const ROTA = /^\/cdn\/(v[0-9]+)\/([A-Za-z0-9_-]{4,128})\.jpg$/;

const upstream = (versao, id) =>
  'https://res.cloudinary.com/' + CLOUD + '/image/upload/' + versao + '/' + id + '.jpg';

// Converte uma URL do Cloudinary na nossa. Devolve null para qualquer coisa que não seja
// exatamente uma imagem `upload` do nosso cloud — o chamador decide o que fazer com isso.
const RE_CLOUDINARY = new RegExp(
  '^https://res\\.cloudinary\\.com/' + CLOUD + '/image/upload/(v[0-9]+)/([A-Za-z0-9_-]{4,128})\\.jpg$');

function paraCaminhoLocal(url) {
  const m = String(url || '').match(RE_CLOUDINARY);
  return m ? '/cdn/' + m[1] + '/' + m[2] + '.jpg' : null;
}

function arquivoDe(versao, id) { return path.join(CACHE, versao, id + '.jpg'); }

async function baixar(versao, id) {
  const destino = arquivoDe(versao, id);
  if (fs.existsSync(destino) && fs.statSync(destino).size > 0) return destino;
  fs.mkdirSync(path.dirname(destino), { recursive: true });

  let ultimo = null;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
    try {
      const ctrl = new AbortController();
      const relogio = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(upstream(versao, id), { signal: ctrl.signal });
      clearTimeout(relogio);
      if (!r.ok) throw new Error('upstream HTTP ' + r.status);
      const tipo = String(r.headers.get('content-type') || '');
      if (!/^image\//.test(tipo)) throw new Error('upstream devolveu ' + (tipo || 'sem content-type'));
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1024) throw new Error('upstream devolveu ' + buf.length + ' bytes');
      // grava em temporário e renomeia: nunca serve arquivo pela metade
      const tmp = destino + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, destino);
      return destino;
    } catch (e) {
      ultimo = e;
      if (tentativa < TENTATIVAS) await new Promise((r) => setTimeout(r, 400 * tentativa));
    }
  }
  throw ultimo || new Error('falhou sem motivo');
}

function servirArquivo(req, res, arquivo) {
  const st = fs.statSync(arquivo);
  const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
  const base = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }

  // O buscador do Meta às vezes pede faixa; sem isto ele recebe o arquivo inteiro e reclama.
  const faixa = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (faixa && (faixa[1] || faixa[2])) {
    let ini = faixa[1] ? Number(faixa[1]) : st.size - Number(faixa[2]);
    let fim = faixa[1] && faixa[2] ? Number(faixa[2]) : st.size - 1;
    ini = Math.max(0, ini); fim = Math.min(st.size - 1, fim);
    if (ini > fim) {
      res.writeHead(416, Object.assign({}, base, { 'Content-Range': 'bytes */' + st.size }));
      return res.end();
    }
    res.writeHead(206, Object.assign({}, base, {
      'Content-Range': 'bytes ' + ini + '-' + fim + '/' + st.size,
      'Content-Length': fim - ini + 1,
    }));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(arquivo, { start: ini, end: fim }).pipe(res);
  }

  res.writeHead(200, Object.assign({}, base, { 'Content-Length': st.size }));
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(arquivo).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  const inicio = Date.now();
  const caminho = String(req.url || '').split('?')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  if (caminho === '/cdn/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok\n');
  }
  const m = ROTA.exec(caminho);
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('nao encontrado\n');
  }

  const versao = m[1];
  const id = m[2];
  try {
    const cacheado = fs.existsSync(arquivoDe(versao, id));
    const arquivo = await baixar(versao, id);
    servirArquivo(req, res, arquivo);
    console.log(req.method + ' ' + caminho + ' 200 ' + (cacheado ? 'cache' : 'baixado')
      + ' ' + (Date.now() - inicio) + 'ms ua="' + (req.headers['user-agent'] || '') + '"');
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('falha ao obter a imagem\n');
    console.error(req.method + ' ' + caminho + ' 502 ' + e.message + ' ' + (Date.now() - inicio) + 'ms');
  }
});

module.exports = { paraCaminhoLocal, upstream, ROTA, CLOUD, baixar };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--aquecer') {
    (async () => {
      let ok = 0;
      let falhou = 0;
      for (const bruta of args.slice(1)) {
        let local = paraCaminhoLocal(bruta);
        if (!local) {
          try { local = new URL(bruta).pathname; } catch (e) { local = bruta; }
        }
        const m = ROTA.exec(String(local));
        if (!m) { console.error('IGNORADA (não é imagem nossa): ' + bruta); falhou += 1; continue; }
        try {
          const f = await baixar(m[1], m[2]);
          console.log('OK    ' + local + ' ' + fs.statSync(f).size + ' bytes');
          ok += 1;
        } catch (e) {
          console.error('FALHA ' + local + ' ' + e.message);
          falhou += 1;
        }
      }
      console.log('aquecidas ' + ok + ', falharam ' + falhou);
      process.exit(falhou ? 1 : 0);
    })();
  } else {
    servidor.listen(PORT, HOST, () => {
      console.log('promo-cdn no ar em http://' + HOST + ':' + PORT + '  cloud=' + CLOUD + '  cache=' + CACHE);
    });
  }
}
