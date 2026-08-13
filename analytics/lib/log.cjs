// Log estruturado + registro da própria execução + alerta.
//
// ISOLAMENTO (restrição do PRD: "uma falha em analytics não pode impedir uma publicação"):
// nada aqui roda dentro do n8n. Estes scripts são processos separados, disparados por timer do
// systemd. Se um deles explodir, o pior que acontece é o timer marcar `failed` — o produtor e o
// publicador nem tomam conhecimento. `envolver()` abaixo é a segunda camada: captura qualquer
// exceção, registra e sai com código != 0 sem nunca deixar o banco em transação aberta.
//
// SEGREDO NUNCA VAI PARA O LOG: `limpar()` remove token/senha/chave de qualquer string logada.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cfg = require('../config.cjs');
const { agoraUtc } = require('./db.cjs');
const { NOVAS } = require('./schema.cjs');
const dt = require('./datatable.cjs');

const SEGREDOS = [
  /(access_?token["'\s:=]+)[A-Za-z0-9._\-]{8,}/gi,
  /(token["'\s:=]+)[A-Za-z0-9._\-]{8,}/gi,
  /(password|senha|secret|api[_-]?key)(["'\s:=]+)\S+/gi,
  /\bIG[A-Za-z0-9_\-]{20,}\b/g,           // formato dos tokens do Instagram
  /\b(sk|pk)-[A-Za-z0-9_\-]{16,}\b/g,     // formato OpenAI/Anthropic
];

function limpar(v) {
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return '';
  for (const re of SEGREDOS) s = s.replace(re, (m, g1) => `${g1 || ''}[REDACTED]`);
  return s;
}

function criarLogger(nome) {
  const inicio = Date.now();
  const linhas = [];
  const contadores = { ok: 0, erro: 0, pulado: 0 };

  function emitir(nivel, msg, extra) {
    const registro = {
      ts: new Date().toISOString(),
      nivel,
      script: nome,
      msg: limpar(msg),
      ...(extra ? JSON.parse(limpar(extra)) : {}),
    };
    linhas.push(registro);
    const alvo = nivel === 'erro' ? console.error : console.log;
    alvo(JSON.stringify(registro));
  }

  return {
    nome,
    inicio,
    contadores,
    info: (m, e) => emitir('info', m, e),
    aviso: (m, e) => emitir('aviso', m, e),
    erro: (m, e) => emitir('erro', m, e),
    ok: () => { contadores.ok++; },
    falha: () => { contadores.erro++; },
    pulo: () => { contadores.pulado++; },
    linhas,
    // grava o JSONL em disco; nunca derruba o script se o disco falhar
    persistir() {
      try {
        fs.mkdirSync(cfg.logDir, { recursive: true });
        const dia = new Date().toISOString().slice(0, 10);
        fs.appendFileSync(path.join(cfg.logDir, `${nome}-${dia}.jsonl`),
          linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
      } catch (e) {
        console.error(JSON.stringify({ nivel: 'aviso', script: nome, msg: 'nao consegui gravar o log em disco: ' + limpar(e.message) }));
      }
    },
  };
}

// Registra a execução do PRÓPRIO script em promoliso_execucoes (RF-11 básico / observabilidade).
// Idempotente pela chave `analytics:<script>:<iniciado_em>`.
async function registrarExecucao(w, logger, { status, erro, detalhe }) {
  const tabela = dt.prefixoFisico(NOVAS.execucoes.id);
  const existe = await w.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tabela]);
  if (!existe) return { gravado: false, motivo: 'tabela ainda não migrada' };

  const iniciadoEm = agoraUtc(new Date(logger.inicio));
  const chave = `analytics:${logger.nome}:${iniciadoEm}`;
  const t = agoraUtc();
  const ja = await w.get(`SELECT id FROM "${tabela}" WHERE execucao_key=?`, [chave]);
  const campos = {
    execucao_key: chave,
    origem: 'analytics',
    workflow_id: '',
    workflow_nome: logger.nome,
    etapa: 'run',
    status,
    iniciado_em: iniciadoEm,
    terminado_em: t,
    duracao_ms: Date.now() - logger.inicio,
    tentativas: 1,
    erro: limpar(erro || '').slice(0, 500),
    detalhe: limpar(JSON.stringify({ ...logger.contadores, ...(detalhe || {}) })).slice(0, 2000),
    updatedAt: t,
  };
  if (ja) {
    const sets = Object.keys(campos).map((k) => `"${k}"=?`).join(', ');
    await w.run(`UPDATE "${tabela}" SET ${sets} WHERE id=?`, [...Object.values(campos), ja.id]);
  } else {
    campos.createdAt = t;
    const cols = Object.keys(campos).map((k) => `"${k}"`).join(',');
    const phs = Object.keys(campos).map(() => '?').join(',');
    await w.run(`INSERT INTO "${tabela}" (${cols}) VALUES (${phs})`, Object.values(campos));
  }
  return { gravado: true, chave };
}

// Alerta por e-mail delegando em promo-alerta.sh (reusa a credencial SMTP do n8n — sem senha nova).
// Falha de alerta é logada, nunca propagada: alerta que derruba o script é pior que alerta perdido.
function alertar(assunto, corpo) {
  if (!cfg.alertasLigados) return { enviado: false, motivo: 'alertas desligados' };
  if (cfg.mock) return { enviado: false, motivo: 'modo mock' };
  if (!fs.existsSync(cfg.alertaCmd)) return { enviado: false, motivo: `alertaCmd inexistente: ${cfg.alertaCmd}` };
  try {
    execFileSync(cfg.alertaCmd, [assunto], { input: limpar(corpo), timeout: 30000 });
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: limpar(e.message).slice(0, 200) };
  }
}

// Casca padrão de todo script do módulo: cria logger, roda, registra a execução, persiste o log.
// A `fn` recebe ({ logger }) e devolve um objeto de resumo.
//
// `registrar: false` (usado quando o script roda com --dry) pula a gravação em
// promoliso_execucoes: `--dry` promete não escrever nada, e registrar a própria execução seria
// uma escrita. O log em disco continua, porque arquivo de log não é o banco.
async function envolver(nome, fn, { registrar = true } = {}) {
  const logger = criarLogger(nome);
  let status = 'success';
  let erro = '';
  let detalhe = {};
  try {
    detalhe = (await fn({ logger })) || {};
  } catch (e) {
    status = 'error';
    erro = e && e.message ? e.message : String(e);
    logger.erro('execução falhou', JSON.stringify({ erro }));
  }
  if (registrar) {
    try {
      const { abrirEnvolvido } = require('./db.cjs');
      const w = await abrirEnvolvido(cfg.db, false);
      try { await registrarExecucao(w, logger, { status, erro, detalhe }); } finally { await w.fechar(); }
    } catch (e) {
      logger.aviso('não consegui registrar a execução em promoliso_execucoes', JSON.stringify({ erro: String(e.message) }));
    }
  }
  logger.persistir();
  if (status !== 'success') process.exitCode = 1;
  return { status, erro, detalhe };
}

module.exports = { criarLogger, registrarExecucao, alertar, envolver, limpar };
