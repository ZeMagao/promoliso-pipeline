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
// SEGUNDA FUNCAO (17/09, noite): /jogo/fotos?titulo=<manchete> devolve as fotos OFICIAIS do jogo
// citado na manchete. Existe porque a peca do Gears saiu com a MESMA foto em todos os slides: a
// materia do Xbox Wire entregou 2 imagens distintas e uma delas era o logo da loja, entao sobrou
// UMA foto real para 6 slots. A logica mora aqui, e nao num no de codigo do n8n, porque o Code
// node do n8n NAO tem `fetch` -- medido em workflow temporario: "fetch is not defined", com
// controle positivo (2+2=4) na mesma resposta.
//
//   node promo-cdn.cjs                      sobe o servidor (unit promo-cdn.service)
//   node promo-cdn.cjs --aquecer <url...>   baixa antes da hora (URL do Cloudinary ou nossa)
//   node promo-cdn.cjs --jogo "<manchete>"  testa a identificacao pela linha de comando
const fs = require('fs');
const path = require('path');
const http = require('http');

const CLOUD = process.env.PROMO_CDN_CLOUD || 'fy2n2qvr';
const HOST = process.env.PROMO_CDN_HOST || '127.0.0.1';
const PORT = Number(process.env.PROMO_CDN_PORT || 5701);
const CACHE = process.env.PROMO_CDN_CACHE || '/opt/promoliso/cdn-cache';
const TENTATIVAS = 3;
const TIMEOUT_MS = 20000;
const CACHE_JOGOS = path.join(CACHE, '_jogos');
const TTL_ACHOU_MS = 7 * 24 * 3600 * 1000;    // ficha de jogo muda pouco
const TTL_NAO_ACHOU_MS = 24 * 3600 * 1000;    // jogo pode entrar na Steam amanha
const MAX_FOTOS = 10;

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


// ─────────────────────────────────────────────────────────────────────────────
// FOTOS OFICIAIS DO JOGO
//
// A regra que segura tudo: a Steam so vale se o nome que ELA devolve aparecer na manchete. Sem
// isso, "Game Pass: confira os jogos que estao chegando" puxaria foto de um jogo sorteado.
// Medido em 40 pautas reais: 21 identificadas, 19 recusadas (hardware, promocao de loja, leva de
// Game Pass, exclusivo de PS que nao existe na Steam) e ZERO falso positivo.
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normal = (s) => semAcento(s).toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function confirmaNome(nomeSteam, manchete) {
  const n = normal(nomeSteam);
  const t = normal(manchete);
  if (n.length < 4) return false;
  // Fronteira de palavra na marra: "control" casava dentro de "controle do PS5" e traria fotos do
  // jogo Control para uma noticia sobre controle de videogame. Comparar com espacos nas pontas
  // resolve sem depender de , que em JS e ASCII e ja mordeu este projeto duas vezes.
  if ((' ' + t + ' ').includes(' ' + n + ' ')) return true;
  // Nome com pontuacao diferente ("SILENT HILL: Townfall" x "Silent Hill: Townfall") passa por
  // tokens. Exige 2+ tokens de 3+ letras para nao casar por "the" ou "of".
  const tokens = n.split(' ').filter((x) => x.length > 2);
  const comEspacos = ' ' + t + ' ';
  return tokens.length >= 2 && tokens.every((tk) => comEspacos.includes(' ' + tk + ' '));
}

// A busca da Steam nao e fuzzy: manchete inteira devolve vazio (medido em 39 de 40). O nome mora
// na CABECA da manchete, entao descemos de 8 palavras ate 2 e paramos no primeiro confirmado.
function termosDaManchete(manchete) {
  const cabeca = String(manchete).split(/\s+[–—-]\s+|\s*\|\s*|\s*:\s(?=[a-z])/)[0];
  const palavras = cabeca.split(/\s+/).filter(Boolean);
  const termos = [];
  for (let n = Math.min(8, palavras.length); n >= 2; n -= 1) {
    const termo = palavras.slice(0, n).join(' ').replace(/[,;:]+$/, '');
    if (termo.length >= 4) termos.push(termo);
  }
  return termos;
}

async function json(url) {
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'PromoLiso/1.0' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally { clearTimeout(relogio); }
}

function fichaNoDisco(chave) {
  const arq = path.join(CACHE_JOGOS, chave + '.json');
  try {
    const ficha = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const ttl = ficha.jogo ? TTL_ACHOU_MS : TTL_NAO_ACHOU_MS;
    if (Date.now() - (ficha.em || 0) < ttl) return ficha;
  } catch (e) { /* sem cache */ }
  return null;
}

function gravarFicha(chave, ficha) {
  try {
    fs.mkdirSync(CACHE_JOGOS, { recursive: true });
    fs.writeFileSync(path.join(CACHE_JOGOS, chave + '.json'), JSON.stringify(ficha));
  } catch (e) { /* cache e conveniencia, nao requisito */ }
}

async function fotosDoJogo(manchete) {
  const chave = normal(manchete).replace(/ /g, '-').slice(0, 80) || 'vazio';
  const cacheada = fichaNoDisco(chave);
  if (cacheada) return Object.assign({}, cacheada, { cache: true });

  const ficha = { em: Date.now(), manchete: String(manchete).slice(0, 200), jogo: null, appid: null, fotos: [] };
  for (const termo of termosDaManchete(manchete)) {
    const busca = await json('https://store.steampowered.com/api/storesearch/?term='
      + encodeURIComponent(termo) + '&cc=br&l=portuguese');
    const item = busca && (busca.items || [])[0];
    if (!item || !confirmaNome(item.name, manchete)) continue;

    const det = await json('https://store.steampowered.com/api/appdetails?appids=' + item.id + '&l=portuguese');
    const d = det && det[String(item.id)] && det[String(item.id)].data;
    if (!d) continue;
    ficha.jogo = d.name;
    ficha.appid = item.id;
    ficha.termo = termo;
    // Screenshot do jogo primeiro; o header serve de reserva e nunca vem sozinho como "variedade".
    ficha.fotos = (d.screenshots || []).map((x) => String(x.path_full || '')).filter(Boolean).slice(0, MAX_FOTOS);
    break;
  }
  gravarFicha(chave, ficha);
  return Object.assign({}, ficha, { cache: false });
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
  if (caminho === '/jogo/fotos') {
    const titulo = new URL(req.url, 'http://x').searchParams.get('titulo') || '';
    if (!titulo.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end('{"erro":"falta titulo"}');
    }
    try {
      const ficha = await fotosDoJogo(titulo);
      const corpo = JSON.stringify({
        jogo: ficha.jogo, appid: ficha.appid, fotos: ficha.fotos, cache: !!ficha.cache,
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
      console.log('GET /jogo/fotos '
        + (ficha.jogo ? ('achou "' + ficha.jogo + '" com ' + ficha.fotos.length + ' fotos') : 'sem jogo confirmado')
        + (ficha.cache ? ' (cache)' : '') + ' ' + (Date.now() - inicio) + 'ms titulo="' + titulo.slice(0, 60) + '"');
      return res.end(corpo);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      console.error('GET /jogo/fotos 502 ' + e.message);
      return res.end('{"erro":"falha ao consultar"}');
    }
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

module.exports = { paraCaminhoLocal, upstream, ROTA, CLOUD, baixar, confirmaNome, termosDaManchete, fotosDoJogo, normal };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--jogo') {
    (async () => {
      const ficha = await fotosDoJogo(args.slice(1).join(' '));
      console.log(JSON.stringify(ficha, null, 1));
    })();
  } else if (args[0] === '--aquecer') {
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
