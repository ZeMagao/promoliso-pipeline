const created = $json || {};
if (!created.id) {
  throw new Error('O Instagram não retornou o ID do contêiner');
}
return [{
  json: {
    container_id: String(created.id),
    execution_id: '71',
  },
}];