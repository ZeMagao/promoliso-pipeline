const output = $('Validar antes de publicar').item.json.output || {};
const primaryUrl = String(output.fontes?.[0]?.url || '').trim();
const normalizedUrl = primaryUrl
  .toLowerCase()
  .replace(/[?#].*$/, '')
  .replace(/\/$/, '');
const normalizedTopic = String(output.tema || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const contentKey = normalizedUrl || 'tema:' + normalizedTopic;

return [{
  json: {
    content_key: contentKey,
    topic: String(output.tema || ''),
    primary_url: primaryUrl,
    category: String(output.categoria || ''),
    operational_status: 'PREPARED',
    carousel_container_id: '',
    instagram_post_id: '',
    instagram_story_id: '',
    execution_id: String($execution.id || ''),
    published_at: '',
    error_message: '',
  },
}];