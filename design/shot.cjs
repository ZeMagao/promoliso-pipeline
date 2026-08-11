// Screenshot local das capas (usa Edge/Chrome instalado, sem baixar browser).
//
//   node design/shot.cjs a_sh b_sh c_sh          -> shot_<nome>.png, 1080x1350
//   node design/shot.cjs --mini a_sh b_sh        -> shot_mini_<nome>.jpg, 540x675
//
// O modo --mini existe pra página de comparação: doze PNGs em tamanho real embutidos como data
// URI passam do teto de 16 MB do artifact.
const { chromium } = require('../node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const cands = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const exe = cands.find((p) => fs.existsSync(p));
if (!exe) { console.log('NO BROWSER'); process.exit(1); }

const MINI = process.argv.includes('--mini');
const nomes = process.argv.slice(2).filter((a) => !a.startsWith('--'));

(async () => {
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: MINI ? 0.5 : 1,
  });
  for (const n of nomes) {
    const f = path.join(__dirname, 'capa_' + n + '.html').split(path.sep).join('/');
    await p.goto('file:///' + f);
    // esperar imagem DE VERDADE: transformação condicional do Cloudinary demora no primeiro hit
    // e um timeout fixo tirava foto do <img> quebrado.
    const carregou = await p.evaluate(() => Promise.all(
      [...document.images].map((i) => i.complete
        ? i.naturalWidth > 0
        : new Promise((r) => { i.onload = () => r(true); i.onerror = () => r(false); })),
    ), { timeout: 60000 });
    if (carregou.some((c) => !c)) console.log('  AVISO: imagem nao carregou em ' + n);

    const saida = MINI ? 'shot_mini_' + n + '.jpg' : 'shot_' + n + '.png';
    await p.screenshot(MINI
      ? { path: path.join(__dirname, saida), type: 'jpeg', quality: 86 }
      : { path: path.join(__dirname, saida) });
    console.log(saida, carregou.length + ' img(s)');
  }
  await b.close();
})();
