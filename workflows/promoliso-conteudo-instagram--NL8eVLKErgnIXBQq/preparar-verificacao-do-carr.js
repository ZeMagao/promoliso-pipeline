const created = $json || {};
return [{
  json: {
    container_id: String(created.id || ''),
    verification_attempt: 0,
    status_code: 'IN_PROGRESS',
  },
}];