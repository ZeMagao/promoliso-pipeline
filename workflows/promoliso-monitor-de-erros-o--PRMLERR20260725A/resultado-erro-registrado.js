return [{
  json: {
    status_operacional: 'WORKFLOW_ERROR',
    erro_registrado: true,
    execution_id: String($json.execution_id || ''),
  },
}];