const source =
  $('Preservar retorno do Curador').item.json || {};
const noticia = source.noticia || {};
const config = source.promo_liso_ai || {};
const verifierRaw =
  $json.text ??
  $json.output ??
  $json.response ??
  '';
const verifierError =
  $json.error?.message ??
  $json.error ??
  (!verifierRaw
    ? 'Agente Verificador de Confiabilidade não retornou conteúdo'
    : '');
const curatorRaw = source.resposta_bruta_curador || '';
const validationErrors = [];
const alerts = [];

function parseStrict(raw, agent) {
  if (typeof raw !== 'string' || !raw.trim()) {
    validationErrors.push(agent + ': resposta ausente');
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    validationErrors.push(agent + ': texto fora do JSON');
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('objeto esperado');
    }
    return parsed;
  } catch {
    validationErrors.push(agent + ': JSON malformado');
    return null;
  }
}

function score(object, field, max, agent) {
  const value = Number(object?.[field]);
  if (!Number.isFinite(value) || value < 0 || value > max) {
    validationErrors.push(
      agent + ': ' + field + ' fora do limite 0-' + max,
    );
    return 0;
  }
  return Math.round(value);
}

function stringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

if (source.erro_curador) {
  validationErrors.push('curador: ' + source.erro_curador);
}
if (verifierError) {
  validationErrors.push('confiabilidade: ' + String(verifierError));
}

const curator = parseStrict(curatorRaw, 'curador') || {};
const verifier = parseStrict(
  typeof verifierRaw === 'string'
    ? verifierRaw
    : JSON.stringify(verifierRaw),
  'confiabilidade',
) || {};

const relevance = score(curator, 'relevancia', 30, 'curador');
const engagement = score(curator, 'engajamento', 20, 'curador');
const actuality = score(curator, 'atualidade', 15, 'curador');
const originality = score(curator, 'originalidade', 10, 'curador');
const utility = score(curator, 'utilidade', 10, 'curador');
const reliability = score(
  verifier,
  'confiabilidade',
  15,
  'confiabilidade',
);
const partial =
  relevance + engagement + actuality + originality + utility;
if (
  Number.isFinite(Number(curator.pontuacao_parcial)) &&
  Number(curator.pontuacao_parcial) !== partial
) {
  alerts.push('pontuacao_parcial_recalculada');
}
if (
  Object.prototype.hasOwnProperty.call(curator, 'pontuacao_total')
) {
  alerts.push('pontuacao_total_da_ia_ignorada');
}

const allowedPriorities = new Set(['baixa', 'media', 'alta']);
const requestedPriority = String(
  curator.prioridade_sugerida || '',
).toLowerCase();
if (!allowedPriorities.has(requestedPriority)) {
  validationErrors.push('curador: prioridade não permitida');
}

const allowedDecisions = new Set(['descartar', 'arquivar', 'aprovar']);
const requestedDecision = String(
  curator.decisao_sugerida || '',
).toLowerCase();
if (!allowedDecisions.has(requestedDecision)) {
  validationErrors.push('curador: decisão não permitida');
}

const allowedFormats = new Set(
  config.formatos_permitidos || [
    'imagem_unica',
    'carrossel',
    'story_estatico',
    'nenhum',
  ],
);
const requestedFormat = String(
  curator.formato_recomendado || 'nenhum',
).toLowerCase();
const forbiddenMedia =
  /reel|video|vídeo|animacao|animação|audiovisual|slideshow/i.test(
    requestedFormat,
  );
if (!allowedFormats.has(requestedFormat) || forbiddenMedia) {
  validationErrors.push('curador: formato não permitido');
}

const allowedUrgency = new Set(['agora', 'agendar', 'guardar']);
const urgency = String(curator.urgencia || 'guardar').toLowerCase();
if (!allowedUrgency.has(urgency)) {
  validationErrors.push('curador: urgência não permitida');
}

const allowedClassifications = new Set([
  'oficial',
  'confirmado',
  'rumor',
  'especulativo',
  'opinativo',
  'inconclusivo',
]);
const classification = String(
  verifier.classificacao_conteudo || 'inconclusivo',
).toLowerCase();
if (!allowedClassifications.has(classification)) {
  validationErrors.push('confiabilidade: classificação não permitida');
}

alerts.push(
  ...stringArray(curator.alertas),
  ...stringArray(verifier.alertas),
);
const total =
  relevance +
  engagement +
  actuality +
  reliability +
  originality +
  utility;
let decision =
  total >= 70 ? 'aprovar' : total >= 50 ? 'arquivar' : 'descartar';
let priority = total >= 85 ? 'alta' : total >= 70 ? 'media' : 'baixa';
let status = decision === 'aprovar'
  ? 'CURADO_APROVAVEL'
  : decision === 'arquivar'
    ? 'ARQUIVADO'
    : 'DESCARTADO';
const riskyClassification = [
  'rumor',
  'especulativo',
  'inconclusivo',
].includes(classification);
const divergence =
  Boolean(verifier.divergencia_com_curador) ||
  (riskyClassification && requestedDecision === 'aprovar');
if (divergence) alerts.push('divergencia_curador_confiabilidade');

if (validationErrors.length) {
  decision = 'arquivar';
  priority = 'baixa';
  status = 'ERRO_CURADORIA';
}

const now = new Date().toISOString();
const missing = [
  ...(Array.isArray(noticia.dados_ausentes)
    ? noticia.dados_ausentes
    : []),
  ...stringArray(curator.dados_ausentes),
];
const unique = (items) => [...new Set(items.filter(Boolean))];
const agents = [
  'coletor_normalizador',
  'curador',
  'verificador_confiabilidade',
  'validador',
  'orquestrador',
];
const result = {
  publicar: false,
  pontuacao_total: total,
  relevancia: relevance,
  engajamento: engagement,
  atualidade: actuality,
  confiabilidade: reliability,
  originalidade: originality,
  utilidade: utility,
  categoria: String(curator.categoria || ''),
  prioridade: priority,
  decisao: decision,
  formato_recomendado: validationErrors.length
    ? 'nenhum'
    : requestedFormat,
  urgencia: allowedUrgency.has(urgency) ? urgency : 'guardar',
  titulo_sugerido: String(curator.titulo_sugerido || '').trim(),
  classificacao_conteudo: allowedClassifications.has(classification)
    ? classification
    : 'inconclusivo',
  motivo: validationErrors.length
    ? 'Curadoria bloqueada por erro de validação'
    : String(curator.motivo || verifier.motivo || '').trim(),
  alertas: unique([...alerts, ...validationErrors]),
  dados_ausentes: unique(missing),
  agentes_executados: agents,
  requer_revisao_manual: true,
  divergencia_agentes: divergence,
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
  curador: {
    agente: 'curador',
    versao: config.prompt_curador || 'curador-1.0.1',
    status: source.erro_curador ? 'erro' : 'sucesso',
    executado_em: now,
    dados_recebidos: { item_id: noticia.item_id },
    resultado: curator,
    alertas: stringArray(curator.alertas),
  },
  verificador_confiabilidade: {
    agente: 'verificador_confiabilidade',
    versao:
      config.prompt_confiabilidade || 'confiabilidade-1.0.0',
    status: verifierError ? 'erro' : 'sucesso',
    executado_em: now,
    dados_recebidos: {
      item_id: noticia.item_id,
      dominio_fonte: noticia.dominio_fonte,
    },
    resultado: verifier,
    alertas: stringArray(verifier.alertas),
  },
  validador: {
    agente: 'validador',
    versao: '1.0.4',
    status: validationErrors.length ? 'erro' : 'sucesso',
    executado_em: now,
    resultado: {
      pontuacao_recalculada: total,
      decisao_deterministica: decision,
    },
    alertas: validationErrors,
  },
  orquestrador: {
    agente: 'orquestrador_n8n',
    versao: '1.0.4',
    status: validationErrors.length ? 'bloqueado' : 'sucesso',
    executado_em: now,
    resultado: {
      status_processamento: status,
      elegivel_aprovacao:
        !validationErrors.length && decision === 'aprovar',
    },
    alertas: divergence ? ['divergencia_agentes'] : [],
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
      titulo_sugerido: result.titulo_sugerido,
      url: noticia.url,
      url_normalizada: noticia.url_normalizada,
      fonte: noticia.fonte,
      dominio_fonte: noticia.dominio_fonte,
      autor: noticia.autor,
      data_publicacao: noticia.data_publicacao || '',
      data_coleta: noticia.data_coleta || now,
      categoria_original: noticia.categoria_original,
      categoria_classificada: result.categoria,
      pontuacao_total: total,
      relevancia: relevance,
      engajamento: engagement,
      atualidade: actuality,
      confiabilidade: reliability,
      originalidade: originality,
      utilidade: utility,
      prioridade: priority,
      decisao_recomendada: String(
        curator.decisao_sugerida || decision,
      ),
      decisao_final: decision,
      formato_recomendado: result.formato_recomendado,
      urgencia: result.urgencia,
      classificacao_conteudo: result.classificacao_conteudo,
      motivo: result.motivo,
      alertas: JSON.stringify(result.alertas),
      dados_ausentes: JSON.stringify(result.dados_ausentes),
      agentes_executados: JSON.stringify(agents),
      status_aprovacao:
        !validationErrors.length && decision === 'aprovar'
          ? 'CANDIDATO'
          : 'NAO_APLICAVEL',
      aprovado_por: '',
      data_aprovacao: '',
      data_avaliacao: now,
      status_processamento: status,
      erro_processamento: validationErrors.join(' | '),
      dados_brutos: JSON.stringify(noticia.dados_brutos || {}),
      resposta_bruta_ia: JSON.stringify({
        curador: curatorRaw,
        verificador_confiabilidade:
          typeof verifierRaw === 'string'
            ? verifierRaw
            : JSON.stringify(verifierRaw),
      }),
      resultados_dos_agentes: JSON.stringify(agentResults),
    },
    elegivel_aprovacao:
      !validationErrors.length && decision === 'aprovar',
    persistencia_obrigatoria: true,
  },
};