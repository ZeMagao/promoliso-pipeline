const execution = $json.execution || {};
const failedWorkflow = $json.workflow || {};
const error = execution.error || $json.error || {};
const executionId = String(execution.id || $execution.id || '');
const message = String(
  error.message ||
  error.description ||
  $json.message ||
  'Erro não identificado',
).slice(0, 900);

return [{
  json: {
    content_key: 'error:' + (executionId || Date.now()),
    topic: String(
      failedWorkflow.name ||
      'Falha operacional no workflow PromoLiso',
    ),
    primary_url: '',
    category: 'SYSTEM',
    operational_status: 'WORKFLOW_ERROR',
    carousel_container_id: '',
    instagram_post_id: '',
    instagram_story_id: '',
    execution_id: executionId,
    published_at: '',
    error_message: message,
  },
}];