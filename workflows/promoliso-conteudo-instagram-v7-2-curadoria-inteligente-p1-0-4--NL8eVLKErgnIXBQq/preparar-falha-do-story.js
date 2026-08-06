const partial =
  $('Preparar carrossel publicado').item.json || {};
const source = $json || {};
const rawError =
  source?.error?.message ||
  source?.error?.description ||
  source?.message ||
  'O carrossel foi publicado, mas o story falhou';

return [{
  json: {
    ...partial,
    operational_status: 'CAROUSEL_PUBLISHED_STORY_FAILED',
    execution_id: String($execution.id || ''),
    error_message: String(rawError).slice(0, 900),
  },
}];