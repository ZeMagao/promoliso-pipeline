// MEDE se dá pra recuperar a foto grande tirando os parâmetros de redimensionamento da URL.
//
// O PROBLEMA (medido em 12/08/2026). A capa full-bleed cai no fallback "foto contida sobre preto"
// em 5 das 8 peças renderizadas com ela. Em 3 delas a culpa é nossa: a URL raspada da matéria vem
// com a instrução de redimensionar do próprio CDN do site —
// `blog.playstation.com/.../abc-scaled.jpg?fit=1024%2C1024` — e a mesma foto, sem a instrução, tem
// 2560x1440. Ou seja: pedimos a cópia pequena de uma foto que existe grande, e aí o gate de
// resolução (>=1000x675) reprova por 99 px de altura.
//
// POR QUE MEDIR ANTES DE CODAR. Tirar query de URL às cegas quebra CDN com URL assinada (a
// assinatura cobre os parâmetros; mexeu, a foto some). E este projeto já pagou caro por número
// escolhido no chute — o piso da capa saiu de 800 sem medir e reprovava o formato mais comum.
// Aqui a régua é empírica: baixa as DUAS versões e compara dimensão de verdade.
//
// ATENÇÃO ao que este script mostra e ao que ele NÃO mostra: hoje o sistema nunca mede imagem. O
// `validar-antes-de-publicar` ADIVINHA a dimensão lendo número na URL (`-1200x675`, `?w=`...) e,
// quando não acha, deixa passar. A única medição real acontece lá na frente, dentro do Cloudinary.
//
//   node design/medir_upgrade_imagem.cjs urls.txt          (uma URL por linha)
//   node design/medir_upgrade_imagem.cjs urls.txt --limite 80
const fs = require('fs');
const path = require('path');

// Parâmetros que só encolhem/convertem a imagem — tirar volta pro original.
// `s` NÃO entra: no preview.redd.it ele é a ASSINATURA da URL, não o tamanho. Estava na lista na
// primeira rodada desta medição e as duas URLs do reddit responderam 403 — foi a régua pegando o
// erro antes do código ir pro ar. Sem `s` na lista, essas URLs caem em "intocável" sozinhas.
const PARAMS_DE_TAMANHO = new Set([
  'fit', 'resize', 'w', 'width', 'h', 'height', 'size', 'quality', 'q', 'crop',
  'strip', 'zoom', 'ssl', 'auto', 'format', 'fm', 'dpr', 'cs', 'compress', 'fill',
]);

// Devolve a URL sem os parâmetros de tamanho — ou null quando não é seguro mexer.
function urlOriginal(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (!url.search) return null;
  const chaves = [...url.searchParams.keys()];
  // Um parâmetro que não sabemos o que é pode ser assinatura (sig, token, expires, hash...).
  // Mexer numa URL assinada não devolve foto maior: devolve 403. Na dúvida, não mexe.
  const desconhecido = chaves.find((k) => !PARAMS_DE_TAMANHO.has(k.toLowerCase()));
  if (desconhecido) return { motivo: 'param desconhecido: ' + desconhecido, url: null };
  const limpa = url.origin + url.pathname;
  return { motivo: null, url: limpa, tirou: chaves.join(',') };
}

// Dimensão de JPEG/PNG/WebP lendo só o começo do arquivo.
function dimensoes(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 30 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    const tipo = buf.slice(12, 16).toString();
    if (tipo === 'VP8X') return { w: (buf.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (buf.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
    if (tipo === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
    if (tipo === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3FFF) + 1, h: ((b >> 14) & 0x3FFF) + 1 };
    }
  }
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    for (let p = 2; p < buf.length - 9;) {
      if (buf[p] !== 0xFF) { p++; continue; }
      const m = buf[p + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { w: buf.readUInt16BE(p + 7), h: buf.readUInt16BE(p + 5) };
      }
      const tam = buf.readUInt16BE(p + 2);
      if (!Number.isFinite(tam) || tam < 2) break;
      p += 2 + tam;
    }
  }
  return null;
}

// 64 KB dão de sobra pro cabeçalho; imagem inteira só se o servidor ignorar o Range.
async function medir(u) {
  try {
    const r = await fetch(u, { headers: { range: 'bytes=0-65535', accept: 'image/*', 'user-agent': 'Mozilla/5.0 PromoLiso/1.0' } });
    if (!r.ok && r.status !== 206) return { erro: 'http ' + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    const d = dimensoes(buf);
    return d ? { ...d, bytes: buf.length } : { erro: 'não li o cabeçalho (' + buf.length + ' bytes)' };
  } catch (e) { return { erro: String(e.message).slice(0, 40) }; }
}

const arquivo = process.argv[2];
if (!arquivo) { console.error('uso: node design/medir_upgrade_imagem.cjs <arquivo-com-urls>'); process.exit(1); }
const iLim = process.argv.indexOf('--limite');
const LIMITE = iLim > 0 ? Number(process.argv[iLim + 1]) : 100;

(async () => {
  const todas = [...new Set(fs.readFileSync(arquivo, 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^https:\/\//.test(l)))];

  // amostra equilibrada por host: sem isso o blog.playstation.com sozinho responde pelo resultado
  const porHost = new Map();
  for (const u of todas) {
    const h = new URL(u).host;
    if (!porHost.has(h)) porHost.set(h, []);
    porHost.get(h).push(u);
  }
  const amostra = [];
  for (let i = 0; amostra.length < LIMITE; i++) {
    let adicionou = false;
    for (const lista of porHost.values()) if (lista[i]) { amostra.push(lista[i]); adicionou = true; }
    if (!adicionou) break;
  }

  const contas = { sem_query: 0, intocavel: 0, maior: 0, igual: 0, menor: 0, quebrou: 0, ilegivel: 0 };
  const ganhos = [];
  const quebras = [];
  console.log(`amostra: ${amostra.length} URLs de ${porHost.size} hosts\n`);

  for (const u of amostra) {
    const alvo = urlOriginal(u);
    if (!alvo) { contas.sem_query++; continue; }
    if (!alvo.url) { contas.intocavel++; continue; }

    const [a, b] = await Promise.all([medir(u), medir(alvo.url)]);
    if (a.erro) { contas.ilegivel++; continue; }
    if (b.erro) {
      contas.quebrou++;
      quebras.push(`${new URL(u).host} tirou[${alvo.tirou}] -> ${b.erro}`);
      continue;
    }
    const areaA = a.w * a.h, areaB = b.w * b.h;
    if (areaB > areaA * 1.05) {
      contas.maior++;
      ganhos.push({ host: new URL(u).host, de: `${a.w}x${a.h}`, para: `${b.w}x${b.h}`, tirou: alvo.tirou });
    } else if (areaB < areaA * 0.95) contas.menor++;
    else contas.igual++;
  }

  console.log('--- resultado ---');
  for (const [k, v] of Object.entries(contas)) console.log(String(v).padStart(4), k.replace(/_/g, ' '));

  const gate = (d) => { const [w, h] = d.split('x').map(Number); return w >= 1000 && h >= 675; };
  const viraramCapa = ganhos.filter((g) => !gate(g.de) && gate(g.para));
  console.log(`\n${viraramCapa.length} imagens passam a servir de CAPA que hoje não passam (gate 1000x675)`);
  const porHostGanho = {};
  for (const g of ganhos) porHostGanho[g.host] = (porHostGanho[g.host] || 0) + 1;
  console.log('ganho por host:', JSON.stringify(porHostGanho));
  console.log('\nexemplos:');
  for (const g of ganhos.slice(0, 6)) console.log(`  ${g.host}: ${g.de} -> ${g.para}  (tirou ${g.tirou})`);
  if (quebras.length) { console.log('\nQUEBRARAM ao tirar (a regra tem que excluir estes):'); for (const q of quebras.slice(0, 10)) console.log('  ' + q); }

  fs.writeFileSync(path.join(__dirname, 'upgrade_imagem.json'), JSON.stringify({
    medido_em: '2026-08-12', amostra: amostra.length, hosts: porHost.size, contas, ganhos: ganhos.slice(0, 40), quebras,
  }, null, 2) + '\n');
  console.log('\ngravado design/upgrade_imagem.json');
})();
