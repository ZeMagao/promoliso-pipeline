// Harness offline do patch_imagem_blogger.cjs.
// Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_imagem_blogger.cjs
// (só leitura no banco; a checagem de rede é opcional, com --rede)
//
// ⚠️ DIFERENÇA IMPORTANTE em relação ao test_validador_mensagens.cjs: aquele exigia veredito
// IDÊNTICO, porque o patch dele só mudava mensagem. ESTE patch MUDA COMPORTAMENTO de propósito —
// imagem do Blogger passa a ser aceita. Então o harness cobra VEREDITO ESPERADO por caso, não
// identidade. O que ele protege é o outro lado: que a mudança seja CIRÚRGICA, e que tudo o que
// era bloqueado por bom motivo continue bloqueado.

const { execSync } = require('child_process');
const path = require('path');
const patch = require('./patch_imagem_blogger.cjs');

const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const REDE = process.argv.includes('--rede');

// ---------------------------------------------------------------- réplica do ambiente do nó
const dominiosBloqueados = [
  'google.com', 'googleusercontent.com', 'bing.com', 'brave.com', 'instagram.com',
  'facebook.com', 'tiktok.com', 'pinterest.com', 'x.com', 'twitter.com', 'example.com', 'localhost',
];
const imagensBloqueadas = [...dominiosBloqueados, 'ytimg.com', 'twimg.com', 'fbcdn.net'];
const hostsImagemConhecidos = ['image.mux.com', 'res.cloudinary.com', 'thesourcemediaassets.com'];
const hostIn = (host, domains) => domains.some((d) => host === d || host.endsWith('.' + d));
const pareceImagemUrl = (u) => /\.(?:jpe?g|png|webp|gif|avif)$/.test(String(u).split(/[?#]/)[0].toLowerCase());
function urlInfo(url) {
  const bruta = String(url || '').trim();
  if (!/^https:\/\//i.test(bruta)) return null;
  try { return { url: bruta, host: new URL(bruta).hostname.toLowerCase() }; } catch (e) { return null; }
}

// ANTIGA — exatamente como está no ar hoje
function antiga(imagem) {
  if (!imagem || !imagem.url) return false;
  if (hostIn(imagem.host, imagensBloqueadas)) return false;
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\.(?:html?|php|asp|aspx)$/.test(caminho)) return false;
  if (/\/(?:search|busca)(?:\/|$)/.test(caminho)) return false;
  return pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos);
}

// NOVA — a do patch
const hostsImagemLiberados = [patch.HOST_LIBERADO];
function motivoDescarteImagem(imagem) {
  if (!imagem || !imagem.url) return 'sem URL utilizável';
  if (!hostsImagemLiberados.includes(imagem.host)
      && hostIn(imagem.host, imagensBloqueadas)) return 'host bloqueado';
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\.(?:html?|php|asp|aspx)$/.test(caminho)) return 'é página, não imagem';
  if (/\/(?:search|busca)(?:\/|$)/.test(caminho)) return 'veio de busca';
  if (!(pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos))) {
    return 'não parece URL de imagem';
  }
  return null;
}
const nova = (imagem) => motivoDescarteImagem(imagem) === null;

const RE_TAMANHO_BLOGGER = /\/(s\d+(?:-[a-z0-9-]+)*|w\d+-h\d+(?:-[a-z0-9-]+)*)\/([^/]+)$/i;
const blateralMaximo = (seg) => (String(seg).match(/\d+/g) || []).reduce((m, n) => Math.max(m, Number(n)), 0);
function originalDoBlogger(url) {
  const bruta = String(url || '');
  if (!/^https:\/\/blogger\.googleusercontent\.com\//i.test(bruta)) return bruta;
  const caminho = bruta.split(/[?#]/)[0];
  const casou = caminho.match(RE_TAMANHO_BLOGGER);
  if (!casou) return bruta;
  if (blateralMaximo(casou[1]) >= patch.LADO_MIN_ORIGINAL) return bruta;
  return caminho.replace(RE_TAMANHO_BLOGGER, '/s0/$2');
}

// ---------------------------------------------------------------- guarda contra drift
// Se alguém editar o patch e as duas cópias divergirem, o harness vira teatro. Estas asserções
// cobram que o texto que o patch injeta contenha as mesmas definições que o harness replica.
const corpoPatch = patch.TROCAS.map((t) => t.para).join('\n');
const exigidos = [
  "hostsImagemLiberados = ['blogger.googleusercontent.com']",
  'function motivoDescarteImagem(imagem)',
  'imagens_bloqueadas: imagensBloqueadasDetalhe',
  'function originalDoBlogger(url)',
  "replace(RE_TAMANHO_BLOGGER, '/s0/$2')",
];
let driftou = 0;
for (const trecho of exigidos) {
  if (!corpoPatch.includes(trecho)) { console.log('DRIFT   patch não contém: ' + trecho); driftou++; }
}
console.log(driftou ? `\nDRIFT: ${driftou} definição(ões) divergindo` : 'OK  harness e patch em sincronia\n');

// ---------------------------------------------------------------- casos do filtro
const URL_REAL_598 = 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEiKiQuRer1YW9YqG0Igvk0s2CbVER3FHuMzT3ZkONuZTMaNIBXIOO-XtKjgdD-YlQFsrqiVLKbkm0mT-kRXy2_mRewXw_8T3vI2ml0YJ_HpkpGEDt27gbgf2H66IDWeiksC7Ueuy1VE2UULDUD1nSu3z_-Fa08hsSvTY0yrxufu5mU6s2XJB1FxSudXnSA/s1920/game%20pass.jpg';

const casos = [
  // o caso que motivou o patch
  { nome: 'exec 598 REAL — capa do GameBlast (Blogger)', url: URL_REAL_598, antiga: false, nova: true },
  { nome: 'thumb do Blogger', url: URL_REAL_598.replace('/s1920/', '/w640-h360/'), antiga: false, nova: true },
  // ⚠️ o que NÃO pode ter sido afrouxado junto
  { nome: 'Google Fotos (lh3) continua bloqueado', url: 'https://lh3.googleusercontent.com/abc/foto.jpg', antiga: false, nova: false },
  { nome: 'googleusercontent.com raiz continua bloqueado', url: 'https://googleusercontent.com/x.jpg', antiga: false, nova: false },
  { nome: 'subdominio inventado do blogger NAO passa', url: 'https://x.blogger.googleusercontent.com/y.jpg', antiga: false, nova: false },
  { nome: 'thumb do YouTube continua bloqueada', url: 'https://i.ytimg.com/vi/abc/hq.jpg', antiga: false, nova: false },
  { nome: 'instagram.com continua bloqueado', url: 'https://www.instagram.com/p/abc/foto.jpg', antiga: false, nova: false },
  // 🕳️ BURACO PRÉ-EXISTENTE, documentado de propósito: 'cdninstagram.com' NÃO termina em
  // '.instagram.com', então a CDN do Instagram nunca esteve na lista — nem antes nem depois deste
  // patch. Descoberto por este harness em 15/09/2026. O caso fica aqui cravado com o
  // comportamento REAL (aceita nas duas) para que, no dia em que alguém fechar o buraco, o teste
  // acuse a mudança em vez de deixá-la passar despercebida. Não foi fechado junto porque é outro
  // assunto e não foi medido — fechar às cegas é como o 'googleusercontent.com' chegou aqui.
  { nome: 'cdninstagram NAO e coberto pela lista (buraco conhecido)', url: 'https://scontent.cdninstagram.com/v/a.jpg', antiga: true, nova: true },
  { nome: 'google.com continua bloqueado', url: 'https://www.google.com/img.jpg', antiga: false, nova: false },
  // o que já passava tem que continuar passando
  { nome: 'PlayStation Blog', url: 'https://blog.playstation.com/uploads/2026/09/foto.jpg', antiga: true, nova: true },
  { nome: 'Cloudinary (host conhecido, sem extensao)', url: 'https://res.cloudinary.com/fy2n2qvr/image/upload/v1/abc', antiga: true, nova: true },
  { nome: 'Adrenaline', url: 'https://www.adrenaline.com.br/wp-content/uploads/2026/09/a.jpg', antiga: true, nova: true },
  // o que era barrado por bom motivo continua barrado
  { nome: 'pagina HTML fabricada como capa', url: 'https://www.xbox.com/games/game-pass.html', antiga: false, nova: false },
  { nome: 'URL de busca', url: 'https://exemplo.com.br/search/foto.jpg', antiga: false, nova: false },
  { nome: 'sem extensao e host desconhecido', url: 'https://exemplo.com.br/pagina', antiga: false, nova: false },
];

let falhas = 0;
console.log('--- filtro de imagem ---');
for (const c of casos) {
  const info = urlInfo(c.url);
  const a = antiga(info);
  const n = nova(info);
  const ok = (a === c.antiga && n === c.nova);
  if (!ok) falhas++;
  console.log((ok ? 'OK    ' : 'FALHA ')
    + ' antiga=' + String(a).padEnd(5) + ' nova=' + String(n).padEnd(5)
    + (n ? '' : ' [' + motivoDescarteImagem(info) + ']').padEnd(26)
    + ' ' + c.nome);
}

// ---------------------------------------------------------------- casos da reescrita /s0/
const reescritas = [
  { nome: 'thumb w640-h360 -> s0', de: URL_REAL_598.replace('/s1920/', '/w640-h360/'), espera: 's0' },
  { nome: 's680 (pequeno) -> s0', de: URL_REAL_598.replace('/s1920/', '/s680/'), espera: 's0' },
  { nome: 'w320-h640 -> s0', de: URL_REAL_598.replace('/s1920/', '/w320-h640/'), espera: 's0' },
  { nome: 'composto s72-w640-h360-c -> s0', de: URL_REAL_598.replace('/s1920/', '/s72-w640-h360-c/'), espera: 's0' },
  { nome: 's1920 (grande) fica como esta', de: URL_REAL_598, espera: 's1920' },
  { nome: 's3840 (grande) fica como esta', de: URL_REAL_598.replace('/s1920/', '/s3840/'), espera: 's3840' },
  { nome: 's1200 (no piso) fica como esta', de: URL_REAL_598.replace('/s1920/', '/s1200/'), espera: 's1200' },
  { nome: 'nao-Blogger nao e tocada', de: 'https://blog.playstation.com/w640-h360/foto.jpg', espera: 'w640-h360' },
];
console.log('\n--- reescrita para o original (/s0/) ---');
for (const r of reescritas) {
  const saida = originalDoBlogger(r.de);
  const seg = (saida.match(RE_TAMANHO_BLOGGER) || [])[1] || '(sem segmento)';
  const ok = seg === r.espera;
  if (!ok) falhas++;
  console.log((ok ? 'OK    ' : 'FALHA ') + ' segmento=' + seg.padEnd(18) + ' ' + r.nome);
}

// ---------------------------------------------------------------- dado real do banco
console.log('\n--- exec 598 no banco (o caso que motivou o patch) ---');
try {
  const flatted = require('/opt/promoliso/node_modules/flatted');
  const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=598;"`,
    { maxBuffer: 1024 * 1024 * 400 }).toString();
  if (!raw.trim()) {
    console.log('AVISO  exec 598 já foi podada (retenção 7 dias) — os casos sintéticos acima cobrem a lógica');
  } else {
    const rd = flatted.parse(raw)?.resultData?.runData;
    const j = rd?.['Validar antes de publicar']?.slice(-1)[0]?.data?.main?.[0]?.[0]?.json;
    const out = j?.output || {};
    const urls = [out.capa, ...(out.slides || []).map((s) => s?.imagem)].filter(Boolean);
    const validasAntes = urls.map(urlInfo).filter(antiga).length;
    const validasDepois = urls.map(originalDoBlogger).map(urlInfo).filter(nova).length;
    const okReal = (validasAntes === 0 && validasDepois === urls.length);
    if (!okReal) falhas++;
    console.log((okReal ? 'OK    ' : 'FALHA ')
      + ` ${urls.length} URLs reais: antiga aceitou ${validasAntes}, nova aceita ${validasDepois}`);
    console.log(`       relatório no ar dizia: imagens_validas=${j?.relatorio_validacao?.imagens_validas}`);
  }
} catch (e) {
  console.log('AVISO  não deu para ler o banco (' + e.message.split('\n')[0] + ') — casos sintéticos cobrem a lógica');
}

// ---------------------------------------------------------------- rede (opcional)
if (REDE) {
  console.log('\n--- rede: as URLs reescritas respondem? (--rede) ---');
  for (const r of reescritas.filter((x) => x.espera === 's0')) {
    const u = originalDoBlogger(r.de);
    try {
      const code = execSync(`curl -sS -o /dev/null -L --max-time 20 -w "%{http_code}" "${u}"`).toString().trim();
      const ok = code === '200';
      if (!ok) falhas++;
      console.log((ok ? 'OK    ' : 'FALHA ') + ' HTTP ' + code + '  ' + r.nome);
    } catch (e) { falhas++; console.log('FALHA  curl morreu  ' + r.nome); }
  }
}

console.log('');
if (falhas === 0 && driftou === 0) {
  console.log('VEREDITO ESPERADO EM TODOS OS CASOS — patch pode ir pro ar');
  process.exit(0);
}
console.log(`FALHOU: ${falhas} caso(s) fora do esperado, ${driftou} drift(s) — NÃO deployar`);
process.exit(1);
