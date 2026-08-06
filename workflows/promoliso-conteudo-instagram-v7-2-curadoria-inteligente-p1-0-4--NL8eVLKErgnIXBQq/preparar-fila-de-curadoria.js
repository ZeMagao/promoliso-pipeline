const normalized =
  $('Normalizar notícias PromoLiso AI').item.json || {};
const noticias = Array.isArray(normalized.noticias)
  ? normalized.noticias
  : [];
const config = normalized.promo_liso_ai || {};
const existingRows = $input
  .all()
  .map((item) => item.json || {})
  .filter((row) => row.curation_key);
const processed = new Set(
  existingRows.map((row) => String(row.curation_key || '').toLowerCase()),
);
const now = Date.now();
const oldLimitMs =
  Number(config.janela_antiga_dias || 30) * 86400000;

function ageMs(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    ? Math.max(0, now - timestamp)
    : Number.POSITIVE_INFINITY;
}

const unseen = noticias.filter(
  (noticia) =>
    !processed.has(String(noticia.curation_key || '').toLowerCase()),
);
const deterministic = [];
const aiCandidates = [];

for (const noticia of unseen) {
  if (!noticia.url_valida || !noticia.titulo || !noticia.conteudo) {
    deterministic.push({
      noticia,
      requer_ia: false,
      preavaliacao: {
        tipo: 'ERRO_DADOS_MINIMOS',
        motivo: !noticia.url_valida
          ? 'URL ausente ou inválida'
          : 'Notícia sem título ou conteúdo suficiente',
      },
      promo_liso_ai: config,
    });
    continue;
  }
  if (
    noticia.data_publicacao &&
    ageMs(noticia.data_publicacao) > oldLimitMs
  ) {
    deterministic.push({
      noticia,
      requer_ia: false,
      preavaliacao: {
        tipo: 'NOTICIA_ANTIGA',
        motivo:
          'Notícia fora da janela máxima de ' +
          String(config.janela_antiga_dias || 30) +
          ' dias',
      },
      promo_liso_ai: config,
    });
    continue;
  }
  aiCandidates.push({
    noticia,
    requer_ia: true,
    preavaliacao: null,
    promo_liso_ai: config,
  });
}

aiCandidates.sort((a, b) => {
  const sourceWeight = (value) =>
    value === 'primaria' ? 2 : value === 'editorial' ? 1 : 0;
  const sourceDelta =
    sourceWeight(b.noticia.tipo_fonte) -
    sourceWeight(a.noticia.tipo_fonte);
  if (sourceDelta) return sourceDelta;
  return (
    new Date(b.noticia.data_publicacao || 0) -
    new Date(a.noticia.data_publicacao || 0)
  );
});

const selected = [
  ...deterministic.slice(0, 3),
  ...aiCandidates.slice(0, Number(config.max_candidatos_ia || 5)),
];

if (!selected.length) {
  return [{
    json: {
      sem_noticias: true,
      requer_ia: false,
      motivo:
        noticias.length && !unseen.length
          ? 'Todas as notícias coletadas já foram processadas'
          : 'Nenhuma notícia foi coletada',
      promo_liso_ai: config,
    },
  }];
}

return selected.map((item) => ({
  json: {
    ...item,
    sem_noticias: false,
    id_execucao: String($execution.id || ''),
  },
}));