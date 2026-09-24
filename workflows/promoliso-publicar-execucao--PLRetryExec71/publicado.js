const response = $json || {};
return [{
  json: {
    status: 'PUBLICADO',
    execution_id_origem: '71',
    topic: 'Xbox confirma presença na gamescom 2026',
    primary_url:
      'https://news.xbox.com/en-us/2026/07/28/xbox-gamescom-2026',
    carousel_container_id:
      $('Preparar verificação').item.json.container_id,
    instagram_post_id: String(
      response.id || response.media_id || response.post_id || '',
    ),
    published_at: new Date().toISOString(),
  },
}];