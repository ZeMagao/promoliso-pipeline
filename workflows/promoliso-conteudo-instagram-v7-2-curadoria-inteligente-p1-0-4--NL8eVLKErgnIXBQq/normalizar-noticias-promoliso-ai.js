const candidatos = Array.isArray($json.candidatos)
  ? $json.candidatos
  : [];
const config = $json.promo_liso_ai || {};
const collectedAt = new Date().toISOString();

function clean(value, max = 4000) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeUrl(value) {
  const raw = clean(value, 2048);
  if (!raw) return { original: '', normalized: '', valid: false, domain: '' };
  try {
    const match = raw.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(?:#.*)?$/i);
    if (!match) throw new Error('syntax');
    const protocol = match[1].toLowerCase();
    const authority = match[2];
    if (authority.includes('@') || authority.startsWith('[')) {
      throw new Error('authority');
    }
    const authorityMatch = authority.match(/^([^:]+)(?::(\d{1,5}))?$/);
    if (!authorityMatch) throw new Error('authority');
    const host = authorityMatch[1].toLowerCase().replace(/^www\./, '');
    const port = authorityMatch[2] || '';
    if (
      port &&
      !(
        (protocol === 'http' && port === '80') ||
        (protocol === 'https' && port === '443')
      )
    ) {
      throw new Error('port');
    }
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    ) throw new Error('private');
    if (!/^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(host)) throw new Error('host');
    const path = (match[3] || '/').replace(/\/{2,}/g, '/');
    const tracking = ['fbclid', 'gclid', 'igshid'];
    const keptParams = [];
    const query = (match[4] || '').replace(/^\?/, '');
    for (const pair of query.split('&').filter(Boolean)) {
      const rawKey = pair.split('=', 1)[0].replace(/\+/g, ' ');
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {}
      const lower = key.toLowerCase();
      if (!lower.startsWith('utm_') && !tracking.includes(lower)) {
        keptParams.push(pair);
      }
    }
    const normalizedPath = path === '/' ? '' : path.replace(/\/+$/, '');
    const normalizedQuery = keptParams.length ? `?${keptParams.join('&')}` : '';
    const normalized = `${protocol}://${host}${normalizedPath}${normalizedQuery}`;
    return { original: raw, normalized, valid: true, domain: host };
  } catch {
    return { original: raw, normalized: '', valid: false, domain: '' };
  }
}

function normalizeDate(value) {
  const raw = clean(value, 100);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function decodeHtmlUrl(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .trim();
}

function directImageUrl(value) {
  const raw = decodeHtmlUrl(value);
  if (!/^https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'<>]*)?$/i.test(raw)) {
    return '';
  }
  return raw.slice(0, 2048);
}

const PARAMS_DE_TAMANHO = new Set([
  'fit', 'resize', 'w', 'width', 'h', 'height', 'size', 'quality', 'q', 'crop',
  'strip', 'zoom', 'ssl', 'auto', 'format', 'fm', 'dpr', 'cs', 'compress', 'fill',
]);

function semRedimensionar(url) {
  const u = String(url || '');
  if (!u) return u;
  const corte = u.indexOf('?');
  if (corte < 0) return u;
  const consulta = u.slice(corte + 1).split('#')[0];
  if (!consulta) return u;
  const chaves = consulta.split('&').filter(Boolean).map((par) => par.split('=')[0].toLowerCase());
  if (!chaves.length) return u;
  if (chaves.some((k) => !PARAMS_DE_TAMANHO.has(k))) return u;   // pode ser assinatura: não mexe
  return u.slice(0, corte);
}

function collectOfficialImages(item, sourceDomain) {
  const officialCdnDomains = {
    'news.xbox.com': ['xboxwire.thesourcemediaassets.com'],
    'blog.playstation.com': ['blog.playstation.com'],
  };
  const allowedCdnDomains = officialCdnDomains[sourceDomain] || [];
  const values = [
    item.imagem_principal,
    item.image?.url,
    item.image,
    item.thumbnail?.url,
    item.thumbnail,
    item.enclosure?.url,
    item['media:content']?.url,
    item['media:thumbnail']?.url,
  ];
  const htmlValues = [
    item['content:encoded'],
    item.content,
    item.description,
    item.summary,
  ].filter((value) => typeof value === 'string');
  const attributePattern =
    /(?:src|data-src|href)=["'](https:\/\/[^"'<>]+\.(?:jpe?g|png|webp)(?:[?#][^"'<>]*)?)["']/gi;
  const rawPattern =
    /https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'<>]*)?/gi;
  for (const html of htmlValues) {
    for (const pattern of [attributePattern, rawPattern]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(html)) !== null) {
        values.push(match[1] || match[0]);
        if (values.length >= 40) break;
      }
    }
  }
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const direct = semRedimensionar(directImageUrl(value));
    if (!direct) continue;
    const hostMatch = direct.match(/^https:\/\/([^/?#]+)/i);
    const host = String(hostMatch?.[1] || '')
      .toLowerCase()
      .replace(/^www\./, '');
    const sameOfficialDomain =
      sourceDomain &&
      (host === sourceDomain || host.endsWith('.' + sourceDomain));
    const trustedOfficialCdn = allowedCdnDomains.some(
      (domain) => host === domain || host.endsWith('.' + domain),
    );
    // O domínio oficial deixa de ser exigência e passa a ser só prioridade.
    // O corte agora é por qualidade — era daqui que vinham os slides repetidos
    // e as "imagens em baixa resolução" reclamadas na revisão.
    const hostDescartavel =
      /(?:gravatar|feedburner|doubleclick|googlesyndication|google-analytics|facebook|fbcdn|twimg|adservice|analytics)/i.test(host);
    const caminhoDescartavel =
      /(?:\/avatars?\/|\/emoji\/|\/icons?\/|spacer|tracking|\/ads?\/|1x1)/i.test(direct);
    if (hostDescartavel || caminhoDescartavel || seen.has(direct)) {
      continue;
    }
    seen.add(direct);
    unique.push({ url: direct, oficial: Boolean(sameOfficialDomain || trustedOfficialCdn) });
    if (unique.length >= 40) break;
  }
  // O WordPress publica a mesma foto em vários tamanhos (-640x400, -210x131…).
  // Aceitar todas enchia o carrossel com cópias da mesma imagem. Agrupamos por
  // nome-base e mantemos só a maior versão de cada foto.
  const porFoto = new Map();
  for (const imagem of unique) {
    const semTamanho = imagem.url.replace(
      /-(\d{2,4})x(\d{2,4})(\.(?:jpe?g|png|webp))/i,
      '$3',
    );
    const medida = imagem.url.match(/-(\d{2,4})x(\d{2,4})\.(?:jpe?g|png|webp)/i);
    // sem sufixo de tamanho = arquivo original, sempre o preferido
    const area = medida ? Number(medida[1]) * Number(medida[2]) : Number.MAX_SAFE_INTEGER;
    const atual = porFoto.get(semTamanho);
    if (!atual || area > atual.area) {
      porFoto.set(semTamanho, { url: imagem.url, oficial: imagem.oficial, area });
    }
  }
  return [...porFoto.values()]
    .filter((imagem) => imagem.area >= 360000 || imagem.area === Number.MAX_SAFE_INTEGER)
    .sort((a, b) => Number(b.oficial) - Number(a.oficial) || b.area - a.area)
    .slice(0, 10)
    .map((imagem) => imagem.url);
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value || '')) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

const noticias = candidatos.map((item, index) => {
  const title = clean(item.titulo ?? item.title, 500);
  const content = clean(
    item.conteudo ?? item.resumo ?? item.content ?? item.description,
    6000,
  );
  const url = normalizeUrl(item.url ?? item.link);
  const source = clean(item.fonte ?? item.source, 300);
  const author = clean(item.autor ?? item.author ?? item.creator, 300);
  const publishedAt = normalizeDate(
    item.publicado_em ?? item.data_publicacao ?? item.pubDate ?? item.isoDate,
  );
  const officialImages = collectOfficialImages(
    item.dados_brutos ?? item,
    url.domain,
  );
  const image = officialImages[0] || directImageUrl(
    item.imagem_principal ??
      item.image?.url ??
      item.image ??
      item.thumbnail?.url ??
      item.thumbnail ??
      item.enclosure?.url,
  );
  const category = clean(
    item.categoria_original ?? item.category,
    200,
  );
  const keywordsSource =
    item.palavras_chave ?? item.keywords ?? item.categories ?? [];
  const keywords = (Array.isArray(keywordsSource)
    ? keywordsSource
    : String(keywordsSource || '').split(','))
    .map((value) => clean(value, 120))
    .filter(Boolean)
    .slice(0, 20);
  const missing = [];
  if (!title) missing.push('titulo');
  if (!content) missing.push('conteudo');
  if (!url.original) missing.push('url');
  else if (!url.valid) missing.push('url_valida');
  if (!source) missing.push('fonte');
  if (!author) missing.push('autor');
  if (!publishedAt) missing.push('data_publicacao');
  if (!image) missing.push('imagem_principal');
  if (!category) missing.push('categoria_original');
  if (!keywords.length) missing.push('palavras_chave');

  const stable = [
    url.normalized,
    title.toLowerCase(),
    publishedAt || '',
  ].join('|');
  const itemId =
    String($execution.id || 'execucao') + ':' + index + ':' + hash(stable);
  const curationKey =
    url.normalized.toLowerCase() ||
    'sem-url:' + hash(title.toLowerCase() + '|' + (publishedAt || collectedAt));

  return {
    item_id: itemId,
    curation_key: curationKey,
    titulo: title,
    conteudo: content,
    url: url.original,
    url_normalizada: url.normalized,
    url_valida: url.valid,
    fonte: source,
    dominio_fonte: url.domain,
    tipo_fonte: clean(item.tipo_fonte, 50),
    autor: author,
    data_publicacao: publishedAt,
    data_coleta: collectedAt,
    imagem_principal: image,
    imagens_oficiais: officialImages,
    categoria_original: category,
    palavras_chave: keywords,
    dados_ausentes: missing,
    dados_brutos: item.dados_brutos ?? item,
  };
});

return [{
  json: {
    noticias,
    promo_liso_ai: config,
    normalizacao: {
      agente: 'coletor_normalizador',
      versao: '1.0.16',
      status: 'sucesso',
      total_recebido: candidatos.length,
      total_normalizado: noticias.length,
      executado_em: collectedAt,
    },
  },
}];