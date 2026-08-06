// Classificação por SUFIXO de domínio (não mais mapa exato): os feeds oficiais
// linkam de subdomínios (nvidianews.nvidia.com, newsroom.intel.com,
// www.nintendo.co.jp...) que o mapa exato jogava em "editorial". Esta lista
// espelha dominiosPrimarios do "Validar antes de publicar".
const dominiosPrimarios = [
  'playstation.com', 'sony.com', 'sonyinteractive.com',
  'xbox.com', 'microsoft.com', 'majornelson.com',
  'nintendo.com', 'nintendo.co.jp', 'nintendo-europe.com', 'nintendo.com.au',
  'nvidia.com', 'amd.com', 'intel.com',
  'samsung.com', 'lg.com', 'asus.com', 'msi.com', 'gigabyte.com', 'acer.com',
  'dell.com', 'alienware.com', 'lenovo.com', 'corsair.com', 'logitechg.com',
  'razer.com', 'ea.com', 'ubisoft.com', 'rockstargames.com', 'bethesda.net',
  'bandainamcoent.com', 'capcom.com', 'capcom.co.jp', 'konami.com',
  'square-enix.com', 'activision.com', 'blizzard.com', 'riotgames.com',
  'sega.com', 'sega.jp', 'cdprojektred.com', 'epicgames.com',
  'steampowered.com', 'unrealengine.com', 'unity.com',
];
const dominiosEditoriais = [
  'adrenaline.com.br', 'flowgames.gg', 'gamevicio.com',
];
function fonteBate(host, dominios) {
  return dominios.some((d) => host === d || host.endsWith('.' + d));
}
function classificarFonte(host) {
  if (!host) return 'editorial';
  if (fonteBate(host, dominiosPrimarios)) return 'primaria';
  if (fonteBate(host, dominiosEditoriais)) return 'editorial';
  return 'editorial';
}

function hostnameFromUrl(value) {
  const match = String(value || '').match(/^https?:\/\/([^\/?#]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, '') : '';
}

const candidatos = $input.all()
  .map((item) => item.json || {})
  .map((item) => {
    const url = String(item.link || item.url || '').trim();
    const hostname = hostnameFromUrl(url);
    const tipoFonte = classificarFonte(hostname);
    const categories =
      item.categories || item.category || item.tags || [];
    const enclosure =
      item.enclosure?.url ||
      item.image?.url ||
      item.image ||
      item.thumbnail ||
      '';
    return {
      titulo: String(item.title || '').trim(),
      conteudo: String(
        item.contentSnippet ||
          item.content ||
          item.description ||
          item.summary ||
          '',
      )
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000),
      url,
      publicado_em:
        item.isoDate || item.pubDate || item.date || item.published || '',
      fonte:
        String(item.source || '').trim() ||
        (hostname ? hostname.toUpperCase() : ''),
      tipo_fonte: tipoFonte,
      autor: String(item.creator || item.author || item.byline || '').trim(),
      imagem_principal:
        typeof enclosure === 'string' ? enclosure.trim() : '',
      categoria_original: Array.isArray(categories)
        ? String(categories[0] || '')
        : String(categories || ''),
      palavras_chave: Array.isArray(categories)
        ? categories
        : String(categories || '').split(','),
      dados_brutos: item,
    };
  })
  .sort(
    (a, b) =>
      new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0),
  )
  .slice(0, 24);

return [{ json: { candidatos } }];