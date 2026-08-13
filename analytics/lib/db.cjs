// Helpers de acesso ao SQLite do n8n. Mesma convenção dos scripts que já existem no projeto
// (promo-fila-writeback.cjs, design/patch_*.cjs): sqlite3 do node_modules do n8n, promessas finas,
// e o cuidado com os DOIS FUSOS documentado em OPERACAO-VPS.md.
//
// FUSO — leia antes de mexer:
//   o n8n grava createdAt/updatedAt das Data Tables e execution_entity em UTC;
//   os patch_*.cjs gravam workflow_entity.updatedAt em hora LOCAL.
//   Este módulo escreve SEMPRE em UTC (agoraUtc) porque só toca Data Table.
const sqlite3 = require('sqlite3');

function abrir(caminho, somenteLeitura) {
  return new sqlite3.Database(caminho, somenteLeitura ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
}

function envolver(db) {
  const all = (q, p) => new Promise((r, j) => db.all(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { (e ? j(e) : r(this)); }));
  const exec = (q) => new Promise((r, j) => db.exec(q, (e) => (e ? j(e) : r())));
  const fechar = () => new Promise((r) => db.close(() => r()));

  // Transação de verdade: qualquer erro faz ROLLBACK e re-lança. As migrations dependem disso.
  async function tx(fn) {
    await run('BEGIN IMMEDIATE');
    try {
      const out = await fn();
      await run('COMMIT');
      return out;
    } catch (e) {
      try { await run('ROLLBACK'); } catch { /* já abortada */ }
      throw e;
    }
  }

  return { db, all, get, run, exec, tx, fechar };
}

// Timestamp no formato que o n8n usa nas Data Tables: 'YYYY-MM-DD HH:MM:SS.mmm' em UTC.
function agoraUtc(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

// Aceita tanto o formato do n8n ('2026-08-06 15:04:05.123', que é UTC sem sufixo) quanto ISO.
// Sem isto, Date.parse trata o primeiro como hora LOCAL e erra 3 h no Brasil.
function paraMs(valor) {
  const s = String(valor || '').trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return Date.parse(s.replace(' ', 'T') + 'Z');
  return Date.parse(s);
}

async function abrirEnvolvido(caminho, somenteLeitura) {
  const w = envolver(abrir(caminho, somenteLeitura));
  if (!somenteLeitura) await w.run('PRAGMA busy_timeout=15000');
  await w.run('PRAGMA foreign_keys=ON'); // sem isto o CASCADE de data_table_column não dispara
  return w;
}

module.exports = { abrir, envolver, abrirEnvolvido, agoraUtc, paraMs };
