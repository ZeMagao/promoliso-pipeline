const fs = require('fs');
const http = require('http');
const path = require('path');
const sqlite3 = require(
  'C:\\Users\\Magal\\Documents\\Codex\\promoliso-n8n\\node_modules\\sqlite3',
);
const { parse } = require(
  'C:\\Users\\Magal\\Documents\\Codex\\promoliso-n8n\\node_modules\\flatted',
);

const executionId = Number(process.argv[2] || 45);
const outputDir = path.resolve(
  __dirname,
  '..',
  'outputs',
  `renderer-chrome-test-${executionId}`,
);

function render(html) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(
      JSON.stringify({
        html,
        width: 1080,
        height: 1350,
        quality: 90,
      }),
    );
    const startedAt = Date.now();
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: 5680,
        path: '/render',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          if (response.statusCode !== 200) {
            reject(new Error(body.toString('utf8')));
            return;
          }
          resolve({
            body,
            elapsedMs: Date.now() - startedAt,
            rendererElapsedMs: Number(
              response.headers['x-render-time-ms'] || 0,
            ),
            prefetchElapsedMs: Number(
              response.headers['x-prefetch-time-ms'] || 0,
            ),
          });
        });
      },
    );
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

const db = new sqlite3.Database(
  'C:\\Users\\Magal\\Documents\\Codex\\promoliso-n8n\\data\\.n8n\\database.sqlite',
  sqlite3.OPEN_READONLY,
);

db.get(
  `SELECT data FROM execution_data WHERE executionId = ?`,
  [executionId],
  async (error, row) => {
    try {
      if (error) throw error;
      if (!row) throw new Error('Execução não encontrada');
      const parsed = parse(row.data);
      const runData = parsed?.resultData?.runData || {};
      const jsonItems = (name) =>
        (runData[name] || []).flatMap((run) =>
          (run.data?.main?.[0] || []).map((item) => item.json || {}),
        );

      const cover = jsonItems('Code in JavaScript1').at(-1);
      const slides = jsonItems('Code in JavaScript');
      const arts = [
        { name: '01-capa.jpg', html: cover?.html },
        ...slides.map((slide, index) => ({
          name: `${String(index + 2).padStart(2, '0')}-slide.jpg`,
          html: slide.html,
        })),
      ].filter((art) => art.html);

      fs.mkdirSync(outputDir, { recursive: true });
      const timings = [];
      for (const art of arts) {
        const result = await render(art.html);
        fs.writeFileSync(path.join(outputDir, art.name), result.body);
        timings.push({
          name: art.name,
          elapsedMs: result.elapsedMs,
          rendererElapsedMs: result.rendererElapsedMs,
          prefetchElapsedMs: result.prefetchElapsedMs,
          bytes: result.body.length,
        });
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            executionId,
            outputDir,
            arts: timings.length,
            totalElapsedMs: timings.reduce(
              (sum, item) => sum + item.elapsedMs,
              0,
            ),
            timings,
          },
          null,
          2,
        ),
      );
    } catch (runError) {
      console.error(runError);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  },
);
