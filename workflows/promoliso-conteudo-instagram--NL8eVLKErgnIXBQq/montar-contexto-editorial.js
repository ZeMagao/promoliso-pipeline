const candidatosFeed =
  $('Consolidar candidatos aprovados').item.json.candidatos || [];
const rows = $input
  .all()
  .map((item) => item.json || {});
const now = Date.now();
const preparedMaxAgeMs = 6 * 60 * 60 * 1000;

function normalizedStatus(row) {
  return String(row.operational_status || '')
    .trim()
    .toUpperCase();
}

function rowAgeMs(row) {
  const timestamp = new Date(
    row.updatedAt || row.createdAt || 0,
  ).getTime();
  return Number.isFinite(timestamp)
    ? Math.max(0, now - timestamp)
    : Number.POSITIVE_INFINITY;
}

function blocksTopic(row) {
  const status = normalizedStatus(row);
  if (
    status === 'PUBLISHED' ||
    status === 'CAROUSEL_PUBLISHED' ||
    status === 'CAROUSEL_PUBLISHED_STORY_FAILED'
  ) return true;
  return status === 'PREPARED' && rowAgeMs(row) <= preparedMaxAgeMs;
}

function reusableTestTopic(row) {
  const status = normalizedStatus(row);
  const message = String(row.error_message || '');
  return (
    status === 'REJECTED' &&
    /^Teste P0\.\d+ concluído sem publicar\./i.test(message) &&
    row.topic &&
    row.primary_url
  );
}

const historico = rows
  .filter((row) => row.topic && row.content_key)
  .filter(blocksTopic)
  .map((row) => ({
    post_id: row.instagram_post_id || row.id || '',
    tema: row.topic,
    categoria: row.category || '',
    url_primaria: row.primary_url || '',
    status: normalizedStatus(row),
    published_at: row.published_at || row.createdAt || '',
  }));

const reaproveitaveis = rows
  .filter(reusableTestTopic)
  .map((row) => ({
    titulo: String(row.topic || '').trim(),
    url: String(row.primary_url || '').trim(),
    publicado_em: row.createdAt || '',
    fonte: 'PAUTA VALIDADA EM TESTE',
    tipo_fonte: 'revalidar',
    resumo:
      'Pauta aprovada em teste editorial e ainda não publicada. Confirme novamente fatos, atualidade e imagens antes de usar.',
  }));

const seen = new Set();
const candidatos = [...candidatosFeed]
  .filter((item) => {
    const key = String(item.url || item.titulo || '')
      .trim()
      .toLowerCase()
      .replace(/[?#].*$/, '')
      .replace(/\/$/, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0, 28);

return [{
  json: {
    historico,
    candidatos,
    pautas_reaproveitaveis: reaproveitaveis.length,
  },
}];