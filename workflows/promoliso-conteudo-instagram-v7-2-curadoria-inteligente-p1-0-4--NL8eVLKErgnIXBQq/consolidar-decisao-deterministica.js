const source = $json || {};
const noticia = source.noticia || {};
const pre = source.preavaliacao || {};
const config = source.promo_liso_ai || {};
const now = new Date().toISOString();
const isError = pre.tipo === 'ERRO_DADOS_MINIMOS';
const reason = String(pre.motivo || 'Item bloqueado por regra determinística');
const agents = [
  'coletor_normalizador',
  'validador',
  'orquestrador',
];
const result = {
  publicar: false,
  pontuacao_total: 0,
  relevancia: 0,
  engajamento: 0,
  atualidade: 0,
  confiabilidade: 0,
  originalidade: 0,
  utilidade: 0,
  categoria: '',
  prioridade: 'baixa',
  decisao: 'descartar',
  formato_recomendado: 'nenhum',
  urgencia: 'guardar',
  titulo_sugerido: '',
  classificacao_conteudo: 'inconclusivo',
  motivo: reason,
  alertas: [pre.tipo || 'REGRA_DETERMINISTICA'],
  dados_ausentes: noticia.dados_ausentes || [],
  agentes_executados: agents,
  requer_revisao_manual: true,
};
const agentResults = {
  coletor_normalizador: {
    agente: 'coletor_normalizador',
    versao: config.versao || '1.0.4',
    status: 'sucesso',
    executado_em: noticia.data_coleta || now,
    resultado: noticia,
    alertas: noticia.dados_ausentes || [],
  },
  validador: {
    agente: 'validador',
    versao: '1.0.4',
    status: isError ? 'erro' : 'sucesso',
    executado_em: now,
    resultado: { regra: pre.tipo || '' },
    alertas: [reason],
  },
  orquestrador: {
    agente: 'orquestrador_n8n',
    versao: '1.0.4',
    status: 'bloqueado',
    executado_em: now,
    resultado: { elegivel_aprovacao: false },
    alertas: [],
  },
};

return {
  json: {
    noticia,
    curadoria: result,
    registro: {
      curation_key: noticia.curation_key,
      id_execucao: String($execution.id || source.id_execucao || ''),
      item_id: noticia.item_id,
      titulo_original: noticia.titulo,
      titulo_sugerido: '',
      url: noticia.url,
      url_normalizada: noticia.url_normalizada,
      fonte: noticia.fonte,
      dominio_fonte: noticia.dominio_fonte,
      autor: noticia.autor,
      data_publicacao: noticia.data_publicacao || '',
      data_coleta: noticia.data_coleta || now,
      categoria_original: noticia.categoria_original,
      categoria_classificada: '',
      pontuacao_total: 0,
      relevancia: 0,
      engajamento: 0,
      atualidade: 0,
      confiabilidade: 0,
      originalidade: 0,
      utilidade: 0,
      prioridade: 'baixa',
      decisao_recomendada: 'descartar',
      decisao_final: 'descartar',
      formato_recomendado: 'nenhum',
      urgencia: 'guardar',
      classificacao_conteudo: 'inconclusivo',
      motivo: reason,
      alertas: JSON.stringify(result.alertas),
      dados_ausentes: JSON.stringify(result.dados_ausentes),
      agentes_executados: JSON.stringify(agents),
      status_aprovacao: 'NAO_APLICAVEL',
      aprovado_por: '',
      data_aprovacao: '',
      data_avaliacao: now,
      status_processamento: isError
        ? 'ERRO_DADOS_MINIMOS'
        : 'DESCARTADO',
      erro_processamento: isError ? reason : '',
      dados_brutos: JSON.stringify(noticia.dados_brutos || {}),
      resposta_bruta_ia: JSON.stringify({}),
      resultados_dos_agentes: JSON.stringify(agentResults),
    },
    elegivel_aprovacao: false,
    persistencia_obrigatoria: true,
  },
};