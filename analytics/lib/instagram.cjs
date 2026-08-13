// Cliente mínimo da Instagram Graph API só para LEITURA de insights.
//
// SEGREDO: o token é lido do MESMO arquivo que o community node patcheado já usa
// (`~/ig-token.json`, 600, dono `promo` — ver OPERACAO-VPS.md). Não existe token novo, não existe
// token em variável de ambiente com valor, e ele nunca entra em log nem em mensagem de erro.
//
// PERMISSÕES: quais métricas a conta pode ler é pendência de Fase 0 (não dá para descobrir sem
// bater na API com o token real). Por isso o cliente é TOLERANTE: se a API recusar uma métrica,
// ele remove essa métrica e tenta de novo, e o que sobrar é gravado. Assim uma permissão faltando
// degrada a coleta em vez de zerá-la — e o motivo fica registrado na linha.
//
// MODO MOCK (`PROMO_ANALYTICS_MOCK=1`): nenhuma chamada de rede. Devolve números determinísticos
// derivados do id da mídia, para homologação e teste sem credencial real.
const fs = require('fs');
const crypto = require('crypto');
const cfg = require('../config.cjs');

// Métricas de MÍDIA. A lista é ordenada por importância: as primeiras são as que o relatório usa.
// `views` substituiu `impressions` nas versões recentes da API; as duas ficam na lista e a que a
// conta não suportar é descartada pelo mecanismo de retirada abaixo.
const METRICAS_MIDIA = [
  'reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits',
];
// Métricas de PERFIL (precisam de PROMO_IG_USER_ID). `follows_and_unfollows` dá o saldo de
// seguidores atribuível à janela.
const METRICAS_PERFIL = ['reach', 'profile_views', 'follows_and_unfollows'];

// Mapa API -> coluna da Data Table. Uma métrica sem entrada aqui só vai para `metricas_brutas`.
const PARA_COLUNA = {
  reach: 'alcance',
  views: 'visualizacoes',
  impressions: 'visualizacoes',
  likes: 'curtidas',
  comments: 'comentarios',
  shares: 'compartilhamentos',
  saved: 'salvamentos',
  profile_visits: 'visitas_perfil',
  profile_views: 'visitas_perfil',
};

function lerToken() {
  if (cfg.mock) return 'MOCK';
  if (!fs.existsSync(cfg.igTokenFile)) {
    throw new Error(`arquivo de token não encontrado (${cfg.igTokenFile}) — defina PROMO_IG_TOKEN_FILE ou rode com PROMO_ANALYTICS_MOCK=1`);
  }
  let j;
  try { j = JSON.parse(fs.readFileSync(cfg.igTokenFile, 'utf8')); } catch (e) {
    throw new Error('arquivo de token ilegível (conteúdo não logado): ' + e.message.replace(/token.*/i, ''));
  }
  const t = j.access_token || j.accessToken || j.token;
  if (!t) throw new Error('arquivo de token sem campo access_token');
  return String(t);
}

// Nunca deixa o token aparecer numa mensagem de erro que vai para log/e-mail.
function semToken(s, token) {
  let out = String(s || '');
  if (token && token !== 'MOCK') out = out.split(token).join('[TOKEN]');
  return out.replace(/access_token=[^&\s]+/g, 'access_token=[TOKEN]');
}

function mockValores(mediaId, metricas) {
  const h = crypto.createHash('sha256').update(String(mediaId)).digest();
  const out = {};
  metricas.forEach((m, i) => { out[m] = h[i % h.length] + (h[(i + 7) % h.length] % 40); });
  return out;
}

async function buscarJson(url, token, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    const texto = await r.text();
    let j = null;
    try { j = JSON.parse(texto); } catch { /* resposta não-JSON: tratada abaixo */ }
    if (!r.ok || (j && j.error)) {
      const msg = (j && j.error && (j.error.message || j.error.type)) || `HTTP ${r.status}`;
      const err = new Error(semToken(msg, token));
      err.codigo = j && j.error && (j.error.code || j.error.error_subcode);
      err.http = r.status;
      throw err;
    }
    if (!j) throw new Error('resposta não-JSON da API');
    return j;
  } finally { clearTimeout(t); }
}

// Extrai o nome da métrica que a API recusou, para poder tentar de novo sem ela.
function metricaRecusada(mensagem, candidatas) {
  const m = String(mensagem);
  for (const c of candidatas) {
    if (new RegExp(`\\b${c}\\b`).test(m)) return c;
  }
  return null;
}

// Insights de uma mídia. Devolve { valores, brutas, metricasUsadas, avisos }.
// Tenta com a lista inteira; a cada recusa, tira a métrica citada e tenta de novo (no máximo
// uma volta por métrica). Só falha de vez quando não sobra métrica nenhuma.
async function insightsDaMidia(mediaId, { metricas = METRICAS_MIDIA } = {}) {
  const token = lerToken();
  const avisos = [];
  let restantes = metricas.slice();

  if (cfg.mock) {
    const brutas = mockValores(mediaId, restantes);
    return { valores: paraColunas(brutas), brutas, metricasUsadas: restantes, avisos: ['modo mock'] };
  }

  for (let volta = 0; volta < metricas.length + 1; volta++) {
    if (!restantes.length) break;
    const url = `${cfg.igGraphBase}/${cfg.igGraphVersion}/${encodeURIComponent(mediaId)}/insights` +
      `?metric=${encodeURIComponent(restantes.join(','))}&access_token=${encodeURIComponent(token)}`;
    try {
      const j = await buscarJson(url, token, cfg.igTimeoutMs);
      const brutas = {};
      for (const d of j.data || []) {
        const v = d.total_value && d.total_value.value !== undefined
          ? d.total_value.value
          : (d.values && d.values[0] && d.values[0].value);
        brutas[d.name] = Number(v) || 0;
      }
      return { valores: paraColunas(brutas), brutas, metricasUsadas: restantes, avisos };
    } catch (e) {
      const ruim = metricaRecusada(e.message, restantes);
      if (!ruim) throw new Error(semToken(e.message, token));
      restantes = restantes.filter((m) => m !== ruim);
      avisos.push(`métrica recusada e removida: ${ruim} (${String(e.message).slice(0, 120)})`);
    }
  }
  throw new Error('a API recusou todas as métricas pedidas: ' + avisos.join(' | '));
}

function paraColunas(brutas) {
  const out = {};
  for (const [k, v] of Object.entries(brutas)) {
    const col = PARA_COLUNA[k];
    if (col && (out[col] === undefined || out[col] === 0)) out[col] = Number(v) || 0;
  }
  return out;
}

// Insights de PERFIL numa janela. Opcional — sem PROMO_IG_USER_ID devolve null sem erro.
async function insightsDoPerfil(desdeMs, ateMs) {
  if (!cfg.igUserId) return null;
  const token = lerToken();
  if (cfg.mock) return { seguidores_atribuiveis: 3, visitas_perfil: 42, brutas: { mock: true } };
  const url = `${cfg.igGraphBase}/${cfg.igGraphVersion}/${encodeURIComponent(cfg.igUserId)}/insights` +
    `?metric=${METRICAS_PERFIL.join(',')}&period=day&metric_type=total_value` +
    `&since=${Math.floor(desdeMs / 1000)}&until=${Math.floor(ateMs / 1000)}` +
    `&access_token=${encodeURIComponent(token)}`;
  const j = await buscarJson(url, token, cfg.igTimeoutMs);
  const brutas = {};
  for (const d of j.data || []) {
    brutas[d.name] = d.total_value ? d.total_value.value : (d.values || []).reduce((a, x) => a + (Number(x.value) || 0), 0);
  }
  const fu = brutas.follows_and_unfollows;
  return {
    visitas_perfil: Number(brutas.profile_views) || 0,
    seguidores_atribuiveis: typeof fu === 'object' && fu ? Number(fu.follows || 0) - Number(fu.unfollows || 0) : Number(fu) || 0,
    brutas,
  };
}

module.exports = { insightsDaMidia, insightsDoPerfil, METRICAS_MIDIA, METRICAS_PERFIL, PARA_COLUNA, lerToken, semToken };
