return [{
  json: {
    operational_status: 'REJECTED',
    published: false,
    topic: $json.topic || '',
    content_key: $json.content_key || '',
    message: $json.error_message || 'Publicação rejeitada.',
    finished_at: new Date().toISOString(),
  },
}];