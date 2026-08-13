const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
let sharp = null;
try { sharp = require('sharp'); } catch { /* sem sharp: supersample sem downscale controlado */ }

const HOST = process.env.RENDERER_HOST || '127.0.0.1';
const PORT = Number(process.env.RENDERER_PORT || 5680);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RENDER_MS = Number(process.env.RENDERER_TIMEOUT_MS || 30000);
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 12000;
const IMAGE_CACHE_LIMIT = 60;

const chromeCandidates = [
  process.env.CHROME_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chromeExecutable = chromeCandidates.find((candidate) =>
  fs.existsSync(candidate),
);

if (!chromeExecutable) {
  throw new Error(
    'Chrome/Chromium não encontrado. Defina CHROME_EXECUTABLE_PATH.',
  );
}

function fontDataUri(fileName) {
  const fontPath = path.join(__dirname, 'fonts', fileName);
  const data = fs.readFileSync(fontPath).toString('base64');
  return `data:font/ttf;base64,${data}`;
}

const fontsCss = `
@font-face {
  font-family: "Barlow Condensed";
  src: url("${fontDataUri('BarlowCondensed-Black.ttf')}") format("truetype");
  font-style: normal;
  font-weight: 900;
  font-display: block;
}
@font-face {
  font-family: "Manrope";
  src: url("${fontDataUri('Manrope-Medium.ttf')}") format("truetype");
  font-style: normal;
  font-weight: 500;
  font-display: block;
}
@font-face {
  font-family: "Manrope";
  src: url("${fontDataUri('Manrope-Bold.ttf')}") format("truetype");
  font-style: normal;
  font-weight: 700;
  font-display: block;
}
html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: #050607;
}
* { box-sizing: border-box; }
`;

let browserPromise;
let renderQueue = Promise.resolve();
const imageCache = new Map();

function getBrowser() {
  if (!browserPromise) {
    const args = [
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
    ];
    if (process.env.RENDERER_NO_SANDBOX === '1') {
      args.push('--no-sandbox', '--disable-setuid-sandbox');
    }
    browserPromise = puppeteer.launch({
      executablePath: chromeExecutable,
      headless: true,
      args,
    });
  }
  return browserPromise;
}

function isLocalRequest(request) {
  const address = request.socket.remoteAddress || '';
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Payload maior que 2 MB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    request.on('error', reject);
  });
}

function allowedResource(urlValue) {
  if (
    urlValue.startsWith('data:') ||
    urlValue.startsWith('about:') ||
    urlValue.startsWith('blob:')
  ) {
    return true;
  }
  try {
    const url = new URL(urlValue);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'res.cloudinary.com' ||
        url.hostname.endsWith('.res.cloudinary.com'))
    );
  } catch {
    return false;
  }
}

async function fetchImageDataUri(url) {
  if (imageCache.has(url)) return imageCache.get(url);

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      IMAGE_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'image/jpeg,image/png,image/webp,image/avif',
          'user-agent': 'PromoLiso-Renderer/1.0',
        },
      });
      if (!response.ok) {
        throw new Error(`Imagem remota respondeu HTTP ${response.status}`);
      }
      const contentType = String(
        response.headers.get('content-type') || '',
      )
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new Error('URL remota não retornou uma imagem');
      }
      const declaredLength = Number(
        response.headers.get('content-length') || 0,
      );
      if (declaredLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error('Imagem remota grande demais');
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error('Imagem remota grande demais');
      }
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } finally {
      clearTimeout(timeout);
    }
  })();

  imageCache.set(url, request);
  request.catch(() => imageCache.delete(url));
  if (imageCache.size > IMAGE_CACHE_LIMIT) {
    imageCache.delete(imageCache.keys().next().value);
  }
  return request;
}

async function inlineRemoteImages(html) {
  const urls = [
    ...new Set(
      Array.from(
        html.matchAll(
          /<img\b[^>]*\bsrc=(["'])(https:\/\/res\.cloudinary\.com\/[^"']+)\1/gi,
        ),
        (match) => match[2],
      ),
    ),
  ];
  if (urls.length > 10) {
    throw new Error('Quantidade de imagens acima do limite');
  }
  const dataUris = await Promise.all(urls.map(fetchImageDataUri));
  let inlined = html;
  for (let index = 0; index < urls.length; index += 1) {
    inlined = inlined.split(urls[index]).join(dataUris[index]);
  }
  return inlined;
}

async function render(payload) {
  const html = String(payload?.html || '');
  const width = Number(payload?.width || 1080);
  const height = Number(payload?.height || 1350);
  const quality = Number(payload?.quality || 90);
  const scale = Number(payload?.scale || 1);

  if (!html || html.length > 1_500_000) {
    throw new Error('HTML ausente ou grande demais');
  }
  if (!Number.isFinite(scale) || scale < 1 || scale > 3) {
    throw new Error('Escala inválida');
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 320 ||
    width > 2160 ||
    height < 320 ||
    height > 2400
  ) {
    throw new Error('Dimensões inválidas');
  }
  if (!Number.isInteger(quality) || quality < 60 || quality > 95) {
    throw new Error('Qualidade inválida');
  }
  if (/<script\b|<iframe\b|<object\b|<embed\b/i.test(html)) {
    throw new Error('HTML contém elementos não permitidos');
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  const startedAt = Date.now();
  try {
    const prefetchStartedAt = Date.now();
    const inlinedHtml = await inlineRemoteImages(html);
    const prefetchElapsedMs = Date.now() - prefetchStartedAt;

    await page.setJavaScriptEnabled(true);
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });
    await page.setRequestInterception(true);
    page.on('request', (resourceRequest) => {
      if (allowedResource(resourceRequest.url())) {
        resourceRequest.continue().catch(() => {});
      } else {
        resourceRequest.abort('blockedbyclient').catch(() => {});
      }
    });

    const document = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <style>${fontsCss}</style>
  </head>
  <body>${inlinedHtml}</body>
</html>`;

    await page.setContent(document, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    await page.evaluate(async (timeoutMs) => {
      const timeout = new Promise((resolve) =>
        setTimeout(resolve, timeoutMs),
      );
      const fonts = document.fonts?.ready || Promise.resolve();
      const images = Promise.all(
        Array.from(document.images).map((image) => {
          if (image.complete) {
            return image.decode?.().catch(() => undefined);
          }
          return new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          });
        }),
      );
      await Promise.race([Promise.all([fonts, images]), timeout]);
    }, Math.min(MAX_RENDER_MS - 2000, 18000));

    let buffer;
    if (scale > 1 && sharp) {
      // Supersample: captura PNG lossless a scale x, downscale lanczos -> width x height, 1 encode JPEG.
      const raw = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
        captureBeyondViewport: false,
        optimizeForSpeed: false,
      });
      buffer = await sharp(raw)
        .resize(width, height, { kernel: 'lanczos3' })
        .jpeg({ mozjpeg: true, quality, chromaSubsampling: '4:4:4' })
        .toBuffer();
    } else {
      buffer = await page.screenshot({
        type: 'jpeg',
        quality,
        clip: { x: 0, y: 0, width, height },
        captureBeyondViewport: false,
        optimizeForSpeed: false,
      });
    }

    return {
      buffer,
      elapsedMs: Date.now() - startedAt,
      prefetchElapsedMs,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function enqueue(payload) {
  const job = renderQueue.then(() => render(payload));
  renderQueue = job.catch(() => {});
  return job;
}

const server = http.createServer(async (request, response) => {
  if (!isLocalRequest(request)) {
    response.writeHead(403, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Acesso apenas local' }));
    return;
  }

  try {
    new URL(request.url, 'http://localhost');
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'URL invÃ¡lida' }));
    return;
  }

  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        status: 'ok',
        chrome: chromeExecutable,
      }),
    );
    return;
  }

  if (request.method !== 'POST' || request.url !== '/render') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Rota não encontrada' }));
    return;
  }

  try {
    const payload = await readJson(request);
    const result = await enqueue(payload);
    response.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': result.buffer.length,
      'cache-control': 'no-store',
      'x-render-time-ms': String(result.elapsedMs),
      'x-prefetch-time-ms': String(result.prefetchElapsedMs),
    });
    response.end(result.buffer);
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: String(error?.message || error).slice(0, 500),
      }),
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      status: 'ready',
      host: HOST,
      port: PORT,
      chrome: chromeExecutable,
    }),
  );
});

async function shutdown() {
  server.close();
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close().catch(() => {});
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
