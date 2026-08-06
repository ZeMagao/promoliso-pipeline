// Harness offline do patch_fallback_imagem.cjs.
// Roda a lógica ANTIGA e a NOVA contra o HTML REAL do slide que derrubou a exec 197
// (produtor 2026-08-06 14:00) + casos sintéticos. Só leitura.
// Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_fallback_imagem.cjs
const { execSync } = require('child_process');
const flatted = require('/opt/promoliso/node_modules/flatted');
const DB = '/opt/promoliso/data/.n8n/database.sqlite';

function safeImage(value, fallback) {
  const source = /^https:\/\//i.test(String(value || '')) ? String(value) : String(fallback || '');
  if (!source) return '';
  if (/^https:\/\/res\.cloudinary\.com\/fy2n2qvr\//i.test(source)) return source;
  if (source.startsWith('https://image.mux.com/')) {
    return source + (source.includes('?') ? '&' : '?') + 'width=1400';
  }
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fit,w_1400,h_900,q_auto,f_auto/' +
    encodeURIComponent(source);
}

// ---------- lógica ANTIGA (a que está no ar e derrubou a 197) ----------
function antiga(htmlOriginal, imagemOriginal, imagemFallback) {
  const alvo = safeImage(imagemOriginal, imagemFallback);
  const substituto = safeImage(imagemFallback);
  if (!substituto) throw new Error('Capa de fallback não produziu uma URL utilizável');
  let html = htmlOriginal;
  if (alvo && alvo !== substituto) html = html.split(alvo).join(substituto);
  html = html.replace(/IMAGEM OFICIAL \/ [^<]*/, 'IMAGEM OFICIAL / CAPA CONFIRMADA');
  if (html.split(substituto).length < 2) {
    throw new Error('Fallback não aplicado: a URL da imagem não foi encontrada no HTML do slide');
  }
  return html;
}

// ---------- lógica NOVA (a do patch) ----------
function nova(htmlOriginal, imagemOriginal, imagemFallback) {
  const substituto = safeImage(imagemFallback);
  if (!substituto) throw new Error('Capa de fallback não produziu uma URL utilizável');
  let html = htmlOriginal;
  let trocou = false;
  const RE_FETCH = /(https:\/\/res\.cloudinary\.com\/fy2n2qvr\/image\/fetch\/[^/]+\/)([^"'\s)]+)/;
  const fallbackDireto =
    /^https:\/\/(?:res\.cloudinary\.com\/fy2n2qvr|image\.mux\.com)\//i.test(imagemFallback);
  if (RE_FETCH.test(htmlOriginal)) {
    const reGlobal = new RegExp(RE_FETCH.source, 'g');
    const fetches = htmlOriginal.match(reGlobal) || [];
    html = htmlOriginal.replace(reGlobal, (todo, prefixo, origem) => {
      let cru = origem;
      try { cru = decodeURIComponent(origem); } catch (e) { cru = origem; }
      const eADoSlide = cru === imagemOriginal || fetches.length === 1;
      if (!eADoSlide) return todo;
      trocou = true;
      return fallbackDireto ? substituto : prefixo + encodeURIComponent(imagemFallback);
    });
  } else if (/^https:\/\//i.test(imagemOriginal) && htmlOriginal.includes(imagemOriginal)) {
    html = htmlOriginal.split(imagemOriginal).join(substituto);
    trocou = true;
  }
  html = html.replace(/IMAGEM OFICIAL \/ [^<]*/, 'IMAGEM OFICIAL / CAPA CONFIRMADA');
  if (!trocou) throw new Error('Fallback não aplicado: não achei URL de imagem no HTML do slide');
  return html;
}

const tenta = (fn, ...a) => { try { return { ok: true, html: fn(...a) }; } catch (e) { return { ok: false, erro: e.message }; } };

// ---------- caso REAL: o slide que derrubou a exec 197 ----------
const casos = [];
try {
  const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=197;"`, { maxBuffer: 1024 * 1024 * 500 }).toString();
  const rd = flatted.parse(raw)?.resultData?.runData;
  const b = rd['Code in JavaScript']?.[0]?.data?.main?.[0]?.[0]?.json;
  if (b?.html && b?.slide) {
    casos.push({
      nome: 'REAL exec 197 (o slide que matou a execução)',
      html: String(b.html),
      original: String(b.slide.imagem || ''),
      fallback: String(b.slide.capaFallback || ''),
      esperaNova: true,
    });
  } else {
    console.log('AVISO: não achei o builder da exec 197 (execução podada?) — seguindo só com sintéticos');
  }
} catch (e) {
  console.log('AVISO: exec 197 ilegível (' + e.message.slice(0, 60) + ') — seguindo só com sintéticos');
}

// ---------- sintéticos ----------
const fetchDe = (transf, url) =>
  `<div style="background-image:url('https://res.cloudinary.com/fy2n2qvr/image/fetch/${transf}/${encodeURIComponent(url)}')"></div>`;
const IMG = 'https://blog.playstation.com/tachyon/2026/08/foto.jpg';
const CAPA = 'https://blog.playstation.com/tachyon/2026/08/capa.jpg';

casos.push({
  nome: 'sintético: transformação do builder diferente da do fallback',
  html: '<span>IMAGEM OFICIAL / PLAYSTATION</span>' + fetchDe('c_fill,g_auto,w_1498,h_723,f_auto,q_auto:best,e_sharpen:60', IMG),
  original: IMG, fallback: CAPA, esperaNova: true,
});
casos.push({
  nome: 'sintético: capa de fallback é image.mux.com (Cloudinary não busca)',
  html: fetchDe('c_fill,w_1498,h_723', IMG),
  original: IMG, fallback: 'https://image.mux.com/abc/thumbnail.jpg?token=xyz', esperaNova: true,
});
casos.push({
  nome: 'sintético: slide servido direto (sem fetch do Cloudinary)',
  html: `<div style="background-image:url('${IMG}')"></div>`,
  original: IMG, fallback: CAPA, esperaNova: true,
});
casos.push({
  nome: 'sintético: HTML sem imagem nenhuma -> guarda TEM que estourar nas duas',
  html: '<div>sem imagem</div>', original: IMG, fallback: CAPA, esperaNova: false,
});
casos.push({
  nome: 'sintético: 2 fetches, só o do slide deve mudar',
  html: fetchDe('c_fill,w_100,h_100', 'https://cdn.exemplo.com/logo.png') + fetchDe('c_fill,w_1498,h_723', IMG),
  original: IMG, fallback: CAPA, esperaNova: true, preservar: 'https://cdn.exemplo.com/logo.png',
});

let falhas = 0;
for (const c of casos) {
  const a = tenta(antiga, c.html, c.original, c.fallback);
  const n = tenta(nova, c.html, c.original, c.fallback);
  console.log('');
  console.log('== ' + c.nome);
  console.log('   antiga: ' + (a.ok ? 'aplicou' : 'ESTOUROU -> ' + a.erro.slice(0, 70)));
  console.log('   nova:   ' + (n.ok ? 'aplicou' : 'ESTOUROU -> ' + n.erro.slice(0, 70)));

  if (n.ok !== c.esperaNova) { falhas++; console.log('   >>> FALHA: esperava nova ' + (c.esperaNova ? 'aplicar' : 'estourar')); continue; }
  if (!n.ok) { console.log('   ok (guarda preservada)'); continue; }

  // a nova precisa realmente ter posto a capa no HTML
  const marca = /^https:\/\/(?:res\.cloudinary\.com\/fy2n2qvr|image\.mux\.com)\//i.test(c.fallback)
    ? safeImage(c.fallback) : encodeURIComponent(c.fallback);
  if (!n.html.includes(marca)) { falhas++; console.log('   >>> FALHA: capa de fallback não aparece no HTML resultante'); continue; }
  // e não pode ter sobrado a imagem que falhou
  if (c.original && n.html.includes(encodeURIComponent(c.original))) {
    falhas++; console.log('   >>> FALHA: a imagem quebrada continua no HTML'); continue;
  }
  // A transformação do builder tem que ser preservada — EXCETO quando a capa de fallback é
  // mux/Cloudinary: aí o fetch inteiro é substituído de propósito (o Cloudinary não
  // consegue buscar image.mux.com), então não sobra transformação pra comparar.
  const ehFallbackDireto = /^https:\/\/(?:res\.cloudinary\.com\/fy2n2qvr|image\.mux\.com)\//i.test(c.fallback);
  const transfAntes = (c.html.match(/image\/fetch\/([^/]+)\//) || [])[1];
  const transfDepois = (n.html.match(/image\/fetch\/([^/]+)\//) || [])[1];
  if (!ehFallbackDireto && transfAntes && transfAntes !== transfDepois) {
    falhas++; console.log(`   >>> FALHA: transformação mudou (${transfAntes} -> ${transfDepois})`); continue;
  }
  if (ehFallbackDireto && /image\/fetch\//.test(n.html)) {
    falhas++; console.log('   >>> FALHA: capa mux/Cloudinary deveria substituir o fetch inteiro'); continue;
  }
  if (c.preservar && !n.html.includes(encodeURIComponent(c.preservar))) {
    falhas++; console.log('   >>> FALHA: mexeu num asset que não era do slide'); continue;
  }
  console.log('   ok — capa aplicada, transformação preservada' + (transfDepois ? ' (' + transfDepois.slice(0, 60) + ')' : ''));
}

console.log('');
console.log('#'.repeat(70));
console.log(falhas === 0
  ? 'TODOS OS CASOS PASSARAM — o fallback passa a recuperar em vez de derrubar a execução.'
  : 'ATENCAO: ' + falhas + ' caso(s) falhando — NÃO deployar.');
process.exit(falhas === 0 ? 0 : 1);
