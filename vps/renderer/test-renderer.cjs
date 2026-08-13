const assert = require('assert');
const http = require('http');

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 5680,
        path,
        method,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': payload.length,
            }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const health = await request('/healthz');
  assert.strictEqual(health.status, 200);

  const startedAt = Date.now();
  const image = await request('/render', 'POST', {
    width: 1080,
    height: 1350,
    quality: 90,
    html: `<div style="width:1080px;height:1350px;display:flex;align-items:center;justify-content:center;background:#050607;color:#9BFF25;font-family:'Barlow Condensed';font-size:110px;font-weight:900;">PROMOLISO</div>`,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.strictEqual(image.status, 200);
  assert.strictEqual(image.headers['content-type'], 'image/jpeg');
  assert(image.body.length > 10000);
  assert(image.body[0] === 0xff && image.body[1] === 0xd8);

  const blocked = await request('/render', 'POST', {
    html: '<script>alert(1)</script>',
  });
  assert.strictEqual(blocked.status, 400);

  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedMs,
        rendererElapsedMs: Number(
          image.headers['x-render-time-ms'] || 0,
        ),
        bytes: image.body.length,
        blockedUnsafeHtml: true,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
