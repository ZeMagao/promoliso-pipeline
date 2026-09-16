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
  );

// RESERVA DE VAGA PARA FONTE PRIMÁRIA.
// Antes daqui era `.slice(0, 24)` direto sobre a ordem por data, e o resultado medido na exec 601
// foi 23 portais e 1 primária — Xbox, Nintendo e NVIDIA zerados. O peso de fonte que existe em
// "Preparar fila de curadoria" roda DEPOIS do corte e não alcança quem já morreu aqui.
// A primária importa por imagem: traz 5-11 por artigo contra 1 do portal.
const VAGAS_PRIMARIA = 6;   // replay dos 441 itens reais da exec 601
const TETO_POR_HOST = 3;    // sem ele, news.xbox sozinho leva a reserva inteira
const TOTAL = 24;

// PISO DE FRESCOR NA RESERVA. Sem ele a reserva desce a lista inteira atrás de primária: o lote
// da exec 601 tinha 241 primárias, mas só 10 com menos de 24 h — e a mais antiga era de 2016-03-16
// (nvidianews). Num dia parado, a vaga privilegiada iria para notícia de 2016 sem ninguém ver.
// Item sem data legível dá Infinity e fica fora da reserva; ainda pode entrar pelo bolo geral.
const FRESCOR_RESERVA_H = 48;
const idadeEmHoras = (candidato) => {
  const t = Date.parse(String(candidato.publicado_em || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};

const reservadas = [];
const usadosPorHost = Object.create(null);
for (const candidato of candidatos) {
  if (reservadas.length >= VAGAS_PRIMARIA) break;
  if (candidato.tipo_fonte !== 'primaria') continue;
  if (idadeEmHoras(candidato) > FRESCOR_RESERVA_H) continue;
  const host = hostnameFromUrl(candidato.url);
  if (!host) continue;
  if ((usadosPorHost[host] || 0) >= TETO_POR_HOST) continue;
  usadosPorHost[host] = (usadosPorHost[host] || 0) + 1;
  reservadas.push(candidato);
}
// PISO, NÃO COTA: vaga de primária que sobrou volta pro bolo geral, então o total continua 24
// mesmo num dia em que nenhuma primária publique.
const naReserva = new Set(reservadas);
const completando = candidatos
  .filter((candidato) => !naReserva.has(candidato))
  .slice(0, TOTAL - reservadas.length);
const selecionados = [...reservadas, ...completando].sort(
  (a, b) => new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0),
);

return [{ json: { candidatos: selecionados } }];