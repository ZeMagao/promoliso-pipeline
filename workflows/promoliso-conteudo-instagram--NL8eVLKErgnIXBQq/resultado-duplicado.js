return [{
  json: {
    operational_status: 'DUPLICATE',
    published: false,
    message: 'A pauta já existe no histórico persistente e foi bloqueada.',
    content_key: $json.content_key || '',
    topic: $json.topic || '',
    finished_at: new Date().toISOString(),
  },
}];