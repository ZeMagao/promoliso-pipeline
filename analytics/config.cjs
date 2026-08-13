// Configuração do módulo de analytics. TUDO por variável de ambiente, com default seguro.
//
// REGRA: nenhum segredo mora aqui. O token do Instagram é lido de um ARQUIVO (o mesmo que o
// community node já usa, ~/ig-token.json) e nunca é logado. A senha de SMTP não é lida por este
// módulo — o envio delega em /usr/local/bin/promo-alerta.sh, que decifra a credencial do próprio
// n8n com a encryptionKey local (ver OPERACAO-VPS.md). Assim não existe segredo duplicado.
const path = require('path');
const os = require('os');

const RAIZ = process.env.PROMO_RAIZ || path.join(__dirname, '..');

// Data Tables que JÁ existem (descobertas no banco em 2026-08-07; ver docs/FASE0-INVENTARIO.md).
// Os ids são do n8n, não nossos — por isso ficam fixos e não são gerados.
const TABELAS_EXISTENTES = {
  publicacoes: 'FJFzDiOhgaT2ZOKv',
  curadoria: 'PLAiCur8cTx26M1Q',
  fila: 'i2e8ZwnL9kwOV6OG',
};

const WORKFLOWS = {
  produtor: 'NL8eVLKErgnIXBQq',
  publicador: 'E27F7yVdsZRj',
  watchdog: 'MJly91QFGKep',
  monitorErros: 'PRMLERR20260725A',
};

const bool = (v, padrao) => (v === undefined || v === '' ? padrao : /^(1|true|sim|yes)$/i.test(String(v)));
const num = (v, padrao) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : padrao);

const config = {
  raiz: RAIZ,
  db: process.env.PROMO_DB || path.join(RAIZ, 'data', '.n8n', 'database.sqlite'),

  // n8n project onde as Data Tables vivem. Se vazio, é descoberto do banco (project pessoal).
  projectId: process.env.PROMO_PROJECT_ID || '',

  tabelas: TABELAS_EXISTENTES,
  workflows: WORKFLOWS,

  // --- Instagram Graph -------------------------------------------------------------------
  // Arquivo com { access_token: "..." } — o MESMO que o node patcheado lê. Nunca versionado.
  igTokenFile: process.env.PROMO_IG_TOKEN_FILE || path.join(os.homedir(), 'ig-token.json'),
  igGraphBase: process.env.PROMO_IG_GRAPH_BASE || 'https://graph.instagram.com',
  igGraphVersion: process.env.PROMO_IG_GRAPH_VERSION || 'v23.0',
  // Id da conta IG, só necessário para métricas de PERFIL (visitas ao perfil / seguidores).
  // Sem ele, as métricas de mídia continuam sendo coletadas normalmente.
  igUserId: process.env.PROMO_IG_USER_ID || '',
  igTimeoutMs: num(process.env.PROMO_IG_TIMEOUT_MS, 20000),

  // --- Janelas de coleta (RF-02) ---------------------------------------------------------
  janelas: (process.env.PROMO_JANELAS || 'D1:1,D3:3,D7:7').split(',').map((p) => {
    const [nome, dias] = p.split(':');
    return { nome: String(nome).trim(), dias: Number(dias) };
  }).filter((j) => j.nome && Number.isFinite(j.dias)),
  // Tolerância: uma janela só é coletada quando venceu, e é retentada até este limite.
  janelaToleranciaHoras: num(process.env.PROMO_JANELA_TOLERANCIA_H, 48),
  maxTentativasColeta: num(process.env.PROMO_MAX_TENTATIVAS, 4),
  // Marco zero: janela que venceu ANTES disto é incoletável (a API não devolve insight retroativo)
  // e fica fora do denominador da taxa. Normalmente é derivado da data da migration 001; esta
  // variável existe para homologação (fingir que o módulo já roda há semanas) e para um backfill
  // deliberado. Formato ISO.
  marcoZero: process.env.PROMO_MARCO_ZERO || '',

  // --- Alertas ---------------------------------------------------------------------------
  alertaCmd: process.env.PROMO_ALERTA_CMD || '/usr/local/bin/promo-alerta.sh',
  alertasLigados: bool(process.env.PROMO_ALERTAS, true),

  // --- Modo de operação ------------------------------------------------------------------
  // mock=1: nenhuma chamada de rede. É o modo de homologação/local sem credencial real.
  mock: bool(process.env.PROMO_ANALYTICS_MOCK, false),
  logDir: process.env.PROMO_ANALYTICS_LOG_DIR || path.join(RAIZ, 'analytics', 'logs'),
  tz: process.env.PROMO_TZ || 'America/Sao_Paulo',

  // Versão do formato do registro gravado em promoliso_publicacoes. Sobe quando o coletor
  // passa a preencher campo novo — permite saber que linha velha não tem campo novo.
  registroVersao: '1',
};

module.exports = config;
module.exports.bool = bool;
module.exports.num = num;
