const original = $('Code in JavaScript').item.json;
const slide = original.slide || {};
const imagemOriginal = String(slide.imagem || '');
const imagemFallback = String(slide.capaFallback || '');

if (!imagemFallback) throw new Error('A imagem do slide falhou e não existe capa de fallback');

// Mesma transformação de "Code in JavaScript": o HTML contém a URL já embrulhada
// pelo Cloudinary fetch e percent-encoded, não a URL crua. Procurar a crua aqui
// era o motivo de o fallback nunca trocar nada.
function safeImage(value, fallback) {
  const source = /^https:\/\//i.test(String(value || ''))
    ? String(value)
    : String(fallback || '');
  if (!source) return '';
  if (/^https:\/\/res\.cloudinary\.com\/fy2n2qvr\//i.test(source)) {
    return source;
  }
  // Cloudinary image/fetch não consegue buscar image.mux.com (retorna 400); o
  // PlayStation Blog serve thumbnails via Mux com URL assinada. O renderizador
  // busca direto (o Mux aceita o token e honra o parâmetro width). Bypass:
  if (source.startsWith('https://image.mux.com/')) {
    return source + (source.includes('?') ? '&' : '?') + 'width=1400';
  }
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fit,w_1400,h_900,q_auto,f_auto/' +
    encodeURIComponent(source);
}

const substituto = safeImage(imagemFallback);
if (!substituto) throw new Error('Capa de fallback não produziu uma URL utilizável');

const htmlOriginal = String(original.html || '');
let html = htmlOriginal;
let trocou = false;

// O builder do slide escolhe a transformação do Cloudinary e as dimensões mudam por tipo
// de slide (ex.: c_fill,g_auto,w_1498,h_723,f_auto,q_auto:best,e_sharpen:60). Reconstruir a
// URL aqui com outra transformação NUNCA casa com o HTML — era por isso que este nó só
// sabia estourar, virando erro fatal da execução. Trocamos só a URL de ORIGEM dentro do
// fetch que já está no HTML, preservando a transformação do builder.
const RE_FETCH = /(https:\/\/res\.cloudinary\.com\/fy2n2qvr\/image\/fetch\/[^/]+\/)([^"'\s)]+)/;
// Cloudinary image/fetch não consegue buscar image.mux.com, e refetchar uma URL que já é
// Cloudinary é desperdício: nesses casos o fetch inteiro é substituído.
const fallbackDireto =
  /^https:\/\/(?:res\.cloudinary\.com\/fy2n2qvr|image\.mux\.com)\//i.test(imagemFallback);

if (RE_FETCH.test(htmlOriginal)) {
  const reGlobal = new RegExp(RE_FETCH.source, 'g');
  const fetches = htmlOriginal.match(reGlobal) || [];
  html = htmlOriginal.replace(reGlobal, (todo, prefixo, origem) => {
    let cru = origem;
    try { cru = decodeURIComponent(origem); } catch (e) { cru = origem; }
    // troca só o fetch da imagem que falhou; outros assets do template ficam intactos
    const eADoSlide = cru === imagemOriginal || fetches.length === 1;
    if (!eADoSlide) return todo;
    trocou = true;
    return fallbackDireto ? substituto : prefixo + encodeURIComponent(imagemFallback);
  });
} else if (/^https:\/\//i.test(imagemOriginal) && htmlOriginal.includes(imagemOriginal)) {
  // slide servido direto pelo renderizador (bypass do image.mux.com): troca a URL crua
  html = htmlOriginal.split(imagemOriginal).join(substituto);
  trocou = true;
}

html = html.replace(/IMAGEM OFICIAL \/ [^<]*/, 'IMAGEM OFICIAL / CAPA CONFIRMADA');

// Guarda mantida — falha silenciosa é pior (re-renderizaria o mesmo HTML e tomaria o mesmo
// erro). Mas agora ela só dispara quando de fato não há URL de imagem pra trocar, não por
// divergência de transformação.
if (!trocou) {
  throw new Error('Fallback não aplicado: não achei URL de imagem no HTML do slide');
}

return [{
  json: {
    ...original,
    html,
    slide: {
      ...slide,
      imagem: imagemFallback,
      fonte_imagem: 'CAPA CONFIRMADA',
    },
    fallback_aplicado: true,
  },
}];