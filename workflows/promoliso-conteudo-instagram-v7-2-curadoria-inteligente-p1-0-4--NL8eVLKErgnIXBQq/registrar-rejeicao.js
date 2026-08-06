const prepared =
  $('Preparar registro pendente').item.json || {};
const decision = String($json.decisao || '').trim().toUpperCase();
const observation = String(
  $json.observacao || $json.observation || '',
).trim();
const expired = !decision;

return [{
  json: {
    ...prepared,
    content_key:
      'rejected:' +
      String($execution.id || Date.now()) +
      ':' +
      String(prepared.content_key || ''),
    operational_status: expired ? 'APPROVAL_EXPIRED' : 'REJECTED',
    execution_id: String($execution.id || ''),
    error_message: observation || (
      expired
        ? 'O link de aprovação expirou após 4 horas.'
        : 'Publicação rejeitada na revisão manual.'
    ),
  },
}];