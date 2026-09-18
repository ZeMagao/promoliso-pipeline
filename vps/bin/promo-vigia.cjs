#!/usr/bin/env node
// PROMO-VIGIA — o alarme que mora FORA do n8n e fala no Telegram.
//
// POR QUE ISTO EXISTE (17/09/2026). A conta ficou 23 dias sem publicar (25/08 → 17/09) e o
// watchdog detectou tudo: em toda rodada, duas por dia, ele mandou "Sem publicacao ha ~533h" por
// e-mail, e o Gmail aceitou os ~44. Ninguem leu. Tres defeitos, e este arquivo ataca os tres:
//
//   1. CANAL   — e-mail nao acorda ninguem. Aqui e push no Telegram (e-mail segue como reserva).
//   2. LUGAR   — o watchdog antigo roda DENTRO do n8n. Se o n8n cair, o alarme cai junto e o
//                silencio vira "esta tudo bem". Este roda por timer do systemd, le o banco direto
//                e checa o proprio n8n de fora.
//   3. RUIDO   — 44 mensagens identicas treinam qualquer um a ignorar. Aqui a mensagem so sai
//                quando a situacao PIORA, quando ela VOLTA ao normal, uma vez por dia enquanto
//                estiver grave, e um "tudo certo" por semana — para que silencio total tambem
//                seja suspeito (o alarme prova que esta vivo).
//
//   node promo-vigia.cjs            checa e avisa se precisar
//   node promo-vigia.cjs --seco     checa e imprime, sem mandar nada
//   node promo-vigia.cjs --forcar   manda o resumo mesmo sem novidade (para testar o caminho)
//   node promo-vigia.cjs --estado   mostra o estado guardado
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DB = process.env.PROMO_DB || '/opt/promoliso/data/.n8n/database.sqlite';
const ESTADO = process.env.PROMO_VIGIA_ESTADO || '/var/lib/promo-vigia/estado.json';
const TELEGRAM = process.env.PROMO_TELEGRAM || '/usr/local/bin/promo-telegram.cjs';
const ALERTA_EMAIL = '/usr/local/bin/promo-alerta.sh';
const FILA = 'data_table_user_i2e8ZwnL9kwOV6OG';

const H = 3600 * 1000;
const REPETIR_H = 24;        // enquanto continuar grave, no maximo um lembrete por dia
const HEARTBEAT_DIAS = 7;    // "tudo certo" semanal: silencio total tambem tem que ser suspeito

const NIVEL = { ok: 0, aviso: 1, grave: 2, critico: 3 };
const EMOJI = { ok: '✅', aviso: '🟡', grave: '🟠', critico: '🔴' };

// ── avaliação: função pura, é o que o harness exercita ───────────────────────
function avaliar(f) {
  const p = [];
  const add = (chave, nivel, titulo, acao) => p.push({ chave, nivel, titulo, acao });

  if (f.n8n_ativo === false || f.healthz_ok === false) {
    add('n8n', 'critico', 'n8n fora do ar' + (f.n8n_ativo === false ? ' (serviço parado)' : ' (healthz não responde)'),
      'systemctl status promo-n8n; journalctl -u promo-n8n -n 50');
  }

  // O caso de 25/08: alguem desligou o produtor pela UI e nada gritou.
  for (const w of (f.workflows || [])) {
    if (!w.ativo) {
      add('wf_' + w.id, 'grave', 'workflow DESLIGADO: ' + w.nome,
        'religar no editor do n8n — foi assim que a conta ficou 23 dias muda');
    } else if (!w.draft_igual_publicado) {
      add('wf_' + w.id, 'aviso', 'draft ≠ publicado em ' + w.nome + ' (deploy pela metade?)',
        'o agendamento roda a versão PUBLICADA; conferir no editor');
    }
  }

  const h = f.horas_sem_post;
  if (h !== null && h !== undefined) {
    if (h >= 72) add('sem_post', 'critico', `sem publicar há ${Math.round(h)} h (${(h / 24).toFixed(1)} dias)`, 'conferir fila, token e publicador');
    else if (h >= 48) add('sem_post', 'grave', `sem publicar há ${Math.round(h)} h`, 'conferir fila e último erro do publicador');
    else if (h >= 26) add('sem_post', 'aviso', `sem publicar há ${Math.round(h)} h`, 'um slot já passou em branco');
  }

  if (f.publicaveis === 0) {
    add('fila_vazia', 'aviso', 'fila sem peça publicável', 'o próximo slot vai passar em branco');
  }

  for (const s of (f.servicos || [])) {
    if (!s.ativo) add('svc_' + s.nome, 'grave', 'serviço parado: ' + s.nome, 'systemctl status ' + s.nome);
  }

  if (typeof f.disco_pct === 'number') {
    if (f.disco_pct >= 95) add('disco', 'grave', `disco em ${f.disco_pct}%`, 'limpar backups antigos / execuções');
    else if (f.disco_pct >= 90) add('disco', 'aviso', `disco em ${f.disco_pct}%`, 'olhar retenção de backup');
  }

  return p;
}

// ── decisão de envio: também pura ────────────────────────────────────────────
// Manda quando PIORA, quando VOLTA ao normal, no máximo 1×/dia enquanto grave, e o "tudo certo"
// semanal. É o que separa um alarme de um ruído de fundo.
function decidir(estadoAnterior, problemas, agora, opts) {
  const anterior = (estadoAnterior && estadoAnterior.chaves) || {};
  const ultimoEnvio = (estadoAnterior && estadoAnterior.ultimo_envio) || 0;
  const forcar = !!(opts && opts.forcar);

  const chaves = {};
  const novos = [];
  const lembretes = [];
  for (const prob of problemas) {
    const antes = anterior[prob.chave];
    const nivelAntes = antes ? NIVEL[antes.nivel] || 0 : 0;
    const nivelAgora = NIVEL[prob.nivel] || 0;
    const piorou = nivelAgora > nivelAntes;
    const passouODia = antes && (agora - (antes.ultimo_envio || 0)) >= REPETIR_H * H;
    let enviar = false;
    if (piorou) { novos.push(prob); enviar = true; }
    else if (nivelAgora >= NIVEL.grave && passouODia) { lembretes.push(prob); enviar = true; }
    chaves[prob.chave] = {
      nivel: prob.nivel,
      desde: (antes && antes.desde) || agora,
      ultimo_envio: enviar ? agora : (antes && antes.ultimo_envio) || 0,
    };
  }

  // O que sumiu da lista voltou ao normal.
  const resolvidos = Object.keys(anterior).filter((k) => !chaves[k]);

  const precisaHeartbeat = !problemas.length && !resolvidos.length
    && (agora - ultimoEnvio) >= HEARTBEAT_DIAS * 24 * H;

  const temAlgo = novos.length || lembretes.length || resolvidos.length || precisaHeartbeat || forcar;
  return {
    enviar: !!temAlgo,
    novos,
    lembretes,
    resolvidos,
    heartbeat: precisaHeartbeat || (forcar && !problemas.length),
    novoEstado: { chaves, ultimo_envio: temAlgo ? agora : ultimoEnvio },
  };
}

function montarMensagem(decisao, problemas, f) {
  const pior = problemas.reduce((m, p) => Math.max(m, NIVEL[p.nivel] || 0), 0);
  const nomeNivel = Object.keys(NIVEL).find((k) => NIVEL[k] === pior) || 'ok';
  const linhas = [];

  if (problemas.length) linhas.push(`${EMOJI[nomeNivel]} <b>PromoLiso</b> — ${problemas.length} problema(s)`);
  else linhas.push('✅ <b>PromoLiso</b> — tudo certo');

  for (const p of decisao.novos) linhas.push(`${EMOJI[p.nivel]} ${p.titulo}\n   ↳ ${p.acao}`);
  for (const p of decisao.lembretes) linhas.push(`${EMOJI[p.nivel]} (segue) ${p.titulo}`);
  for (const k of decisao.resolvidos) linhas.push(`✅ resolvido: ${k}`);

  linhas.push('');
  linhas.push(`último post: ${f.horas_sem_post === null ? 'desconhecido' : Math.round(f.horas_sem_post) + ' h atrás'}`
    + ` · fila: ${f.publicaveis} publicável(is)` + ` · posts em 7 d: ${f.posts_7d}`);
  return linhas.join('\n');
}

// ── coleta: a parte que fala com o mundo ─────────────────────────────────────
const sql = (q) => execFileSync('sqlite3', [DB, q], { encoding: 'utf8' }).trim();
const ativo = (unit) => {
  try { return execFileSync('systemctl', ['is-active', unit], { encoding: 'utf8' }).trim() === 'active'; }
  catch (e) { return false; }
};

function coletar() {
  const agora = Date.now();
  const f = { agora };

  f.n8n_ativo = ativo('promo-n8n');
  try {
    const s = execFileSync('curl', ['-sS', '--max-time', '5', 'http://127.0.0.1:5678/healthz'], { encoding: 'utf8' });
    f.healthz_ok = /ok/i.test(s);
  } catch (e) { f.healthz_ok = false; }

  f.servicos = ['promo-renderer', 'promo-cdn', 'caddy'].map((nome) => ({ nome, ativo: ativo(nome) }));

  f.workflows = sql('SELECT id||"|"||name||"|"||active||"|"||(versionId=activeVersionId) FROM workflow_entity WHERE active=1 OR id IN ("NL8eVLKErgnIXBQq","E27F7yVdsZRj");')
    .split('\n').filter(Boolean).map((linha) => {
      const [id, nome, at, igual] = linha.split('|');
      return { id, nome, ativo: at === '1', draft_igual_publicado: igual === '1' };
    });

  const ultimo = sql(`SELECT MAX(published_at) FROM ${FILA} WHERE status='PUBLISHED';`);
  const t = Date.parse(ultimo);
  f.horas_sem_post = Number.isFinite(t) ? (agora - t) / H : null;
  f.posts_7d = Number(sql(`SELECT COUNT(*) FROM ${FILA} WHERE status='PUBLISHED' AND published_at >= datetime('now','-7 days');`)) || 0;
  f.publicaveis = Number(sql(`SELECT COUNT(*) FROM ${FILA} WHERE status IN ('READY','RETRY') AND created_at >= datetime('now','-48 hours');`)) || 0;

  try {
    const df = execFileSync('df', ['--output=pcent', '/'], { encoding: 'utf8' }).split('\n')[1] || '';
    f.disco_pct = Number(df.replace(/[^0-9]/g, '')) || null;
  } catch (e) { f.disco_pct = null; }

  return f;
}

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); }
  catch (e) { return { chaves: {}, ultimo_envio: 0 }; }
}

function gravarEstado(estado) {
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
  fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 1));
}

module.exports = { avaliar, decidir, montarMensagem, NIVEL, REPETIR_H, HEARTBEAT_DIAS };

if (require.main === module) {
  const SECO = process.argv.includes('--seco');
  const FORCAR = process.argv.includes('--forcar');

  if (process.argv.includes('--estado')) {
    console.log(JSON.stringify(lerEstado(), null, 1));
    process.exit(0);
  }

  const f = coletar();
  const problemas = avaliar(f);
  const estado = lerEstado();
  const d = decidir(estado, problemas, f.agora, { forcar: FORCAR });
  const msg = montarMensagem(d, problemas, f);

  console.log(msg.replace(/<\/?b>/g, ''));
  console.log('---');
  console.log('enviar=' + d.enviar + ' novos=' + d.novos.length + ' lembretes=' + d.lembretes.length
    + ' resolvidos=' + d.resolvidos.length + ' heartbeat=' + d.heartbeat);

  if (SECO) { console.log('(--seco: nada enviado, estado não gravado)'); process.exit(0); }

  if (d.enviar) {
    let push = false;
    try {
      execFileSync('node', [TELEGRAM, msg], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
      push = true;
    } catch (e) {
      console.error('FALHA no push do Telegram — caindo para e-mail');
    }
    // E-mail continua como reserva, e vira o canal principal se o push falhar.
    const grave = problemas.some((p) => NIVEL[p.nivel] >= NIVEL.grave);
    if (!push || grave) {
      try {
        execFileSync(ALERTA_EMAIL, ['PromoLiso: ' + (problemas.length ? problemas[0].titulo : 'tudo certo')],
          { input: msg.replace(/<\/?b>/g, ''), encoding: 'utf8' });
      } catch (e) { console.error('FALHA também no e-mail: ' + e.message); }
    }
  }

  gravarEstado(d.novoEstado);
}
