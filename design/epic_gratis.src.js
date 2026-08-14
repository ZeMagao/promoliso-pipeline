// Converte o retorno da Epic em itens no formato de feed, para entrarem na mesma esteira dos RSS.
//
// POR QUE ESTA FONTE. Medido em 14/08/2026: a fila tinha 36 NOTICIA para 8 OFERTA, numa conta
// chamada "PromoLiso | Ofertas Gamer". Não é defeito de ordenação — é o que entra: dos 12 feeds,
// 11 são de notícia. E não existe feed RSS de promoção em português vivo (Pelando 404, Hardmob 403,
// Promobit parado há semanas). A oferta que interessa a este público está NA LOJA, não em blog.
//
// O jogo grátis semanal da Epic é o melhor primeiro caso: é previsível, é sempre relevante para
// quem joga, tem data de início e fim explícitas, traz o preço original (o "de R$ 43,99 por
// grátis" que dá a manchete) e a imagem oficial é 2560x1440 — passa folgado no gate da capa, que é
// onde tanta pauta morre.
//
// O QUE ESTE NÓ NÃO FAZ: escolher pauta. Ele só coloca a oferta na mesa junto com as notícias. Quem
// decide continua sendo o curador — notícia de games segue disputando normalmente.
//
// FORMATO DE SAÍDA: item de feed. O "Preparar candidatos" já deriva a fonte pela URL, e
// `epicgames.com` está na lista de domínios primários dele — então a oferta entra como fonte
// primária sem precisar de nenhuma exceção.
const resposta = ($input.first().json) || {};
const elementos =
  ((((resposta.data || {}).Catalog || {}).searchStore || {}).elements) || [];

const agora = Date.now();
const ddmm = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0')
    : '';
};

// A Epic devolve promoção atual E futura no mesmo pacote. Só interessa o que está de graça AGORA:
// anunciar o que ainda não começou vira post que envelhece antes de sair da fila.
function ofertaVigente(elemento) {
  const blocos = ((elemento.promotions || {}).promotionalOffers) || [];
  for (const bloco of blocos) {
    for (const oferta of (bloco.promotionalOffers || [])) {
      const gratis = Number(((oferta.discountSetting || {}).discountPercentage)) === 0;
      const inicio = Date.parse(oferta.startDate);
      const fim = Date.parse(oferta.endDate);
      if (gratis && Number.isFinite(inicio) && Number.isFinite(fim) && inicio <= agora && agora < fim) {
        return { inicio: oferta.startDate, fim: oferta.endDate };
      }
    }
  }
  return null;
}

// O slug muda de lugar conforme o produto (jogo, DLC, edição). Sem ele não há URL de loja, e sem
// URL de loja o validador reprova a oferta — então é melhor descartar o item aqui.
function slugDe(elemento) {
  const mapeamentos = ((elemento.catalogNs || {}).mappings) || [];
  const doCatalogo = mapeamentos.find((m) => m && m.pageSlug);
  return String(
    elemento.productSlug || (doCatalogo && doCatalogo.pageSlug) || elemento.urlSlug || '',
  ).split('/')[0];
}

function imagemDe(elemento) {
  const imagens = elemento.keyImages || [];
  const preferencia = ['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail', 'OfferImageTall'];
  for (const tipo of preferencia) {
    const achada = imagens.find((i) => i && i.type === tipo && /^https:\/\//i.test(String(i.url || '')));
    if (achada) return String(achada.url).split('?')[0];
  }
  const qualquer = imagens.find((i) => i && /^https:\/\//i.test(String(i.url || '')));
  return qualquer ? String(qualquer.url).split('?')[0] : '';
}

const itens = [];
for (const elemento of elementos) {
  const vigente = ofertaVigente(elemento);
  if (!vigente) continue;
  const slug = slugDe(elemento);
  const imagem = imagemDe(elemento);
  if (!slug || !imagem) continue;

  const titulo = String(elemento.title || '').trim();
  const precoOriginal =
    ((((elemento.price || {}).totalPrice || {}).fmtPrice || {}).originalPrice) || '';
  const ate = ddmm(vigente.fim);
  const descricao = String(elemento.description || '').trim();
  const url = 'https://store.epicgames.com/pt-BR/p/' + slug;

  const corpo = [
    descricao,
    precoOriginal ? ('Preço original: ' + precoOriginal + '. Sai de graça até ' + ate + '.')
      : ('De graça até ' + ate + '.'),
    'Resgate na Epic Games Store: ' + url,
  ].filter(Boolean).join(' ');

  itens.push({
    json: {
      title: titulo + ' está de graça na Epic Games Store até ' + ate,
      link: url,
      isoDate: vigente.inicio,
      pubDate: vigente.inicio,
      contentSnippet: corpo,
      'content:encoded': '<p>' + corpo + '</p><img src="' + imagem + '" />',
      enclosure: { url: imagem },
      categories: ['OFERTA', 'jogo grátis', 'Epic Games Store'],
      // campos próprios, para quem for depurar saber de onde veio sem abrir a execução
      epic_preco_original: precoOriginal,
      epic_validade: vigente.fim,
    },
  });
}

return itens;
