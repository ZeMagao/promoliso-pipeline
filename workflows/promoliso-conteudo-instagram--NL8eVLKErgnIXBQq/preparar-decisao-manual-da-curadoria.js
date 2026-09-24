const selected =
  $('Selecionar melhor pauta').item.json || {};
const decision = String($json.decisao || '').trim().toUpperCase();
const approved = decision === 'APROVAR';
const now = new Date().toISOString();

return [{
  json: {
    ...selected,
    registro_id: selected.registro_id,
    decisao_manual: approved ? 'APROVAR' : 'REJEITAR',
    observacao_manual: String($json.observacao || '').trim(),
    status_aprovacao: approved ? 'APROVADO' : 'REJEITADO',
    aprovado_por: 'FORMULARIO_N8N',
    data_aprovacao: now,
    status_processamento: approved
      ? 'CURADORIA_APROVADA'
      : decision
        ? 'CURADORIA_REJEITADA'
        : 'APROVACAO_EXPIRADA',
    liberar_fluxo_atual: approved,
  },
}];