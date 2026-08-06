const prepared = $('Preparar registro pendente').item.json || {};
const source = {
  ...($json || {}),
  container_id: String($json.container_id || ''),
  message:
    $json.status_error ||
    'Status do contêiner: ' + String($json.status_code || 'DESCONHECIDO'),
};
const rawError =
  source?.error?.message ||
  source?.error?.description ||
  source?.message ||
  source?.status_code ||
  'O contêiner do carrossel não ficou pronto a tempo';

return [{
  json: {
    ...prepared,
    operational_status: 'FAILED_PROCESSING',
    carousel_container_id: String(
      source?.container_id ||
      source?.carousel_container_id ||
      prepared.carousel_container_id ||
      '',
    ),
    instagram_post_id: String(
      source?.instagram_post_id ||
      source?.post_id ||
      source?.media_id ||
      prepared.instagram_post_id ||
      '',
    ),
    instagram_story_id: String(
      source?.instagram_story_id ||
      source?.story_id ||
      prepared.instagram_story_id ||
      '',
    ),
    execution_id: String($execution.id || ''),
    error_message: String(rawError).slice(0, 900),
  },
}];