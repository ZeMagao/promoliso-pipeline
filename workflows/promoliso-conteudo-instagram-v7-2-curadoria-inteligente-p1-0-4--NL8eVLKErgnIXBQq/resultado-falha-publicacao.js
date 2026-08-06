const row = $json || {};
return [{
  json: {
    status_operacional: row.operational_status || 'FAILED',
    publicado: false,
    carrossel_publicado:
      row.operational_status === 'CAROUSEL_PUBLISHED_STORY_FAILED',
    instagram_post_id: row.instagram_post_id || '',
    mensagem:
      row.error_message ||
      'A publicação foi interrompida com segurança',
  },
}];