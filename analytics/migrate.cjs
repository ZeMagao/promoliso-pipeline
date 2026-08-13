#!/usr/bin/env node
// Runner de migrations do módulo de analytics.
//
//   node analytics/migrate.cjs status
//   node analytics/migrate.cjs up   [--dry] [--ate=002]
//   node analytics/migrate.cjs down [--dry] [--ate=001]   (reverte da mais nova para trás)
//
// GARANTIAS
//  - cada migration roda dentro de UMA transação; erro no meio = ROLLBACK, nada pela metade
//  - estado guardado em `promoliso_analytics_migrations` (tabela SQLite comum, não Data Table:
//    ela precisa existir ANTES de qualquer Data Table poder ser criada, e não é dado de negócio)
//  - idempotente: `up` duas vezes não faz nada na segunda
//  - `--dry` abre o banco em READONLY — é fisicamente impossível gravar
//  - o n8n DEVE estar parado (o runner avisa se a porta 5678 estiver de pé, quando dá pra checar)
const path = require('path');
const fs = require('fs');
const net = require('net');
const cfg = require('./config.cjs');
const { abrirEnvolvido, agoraUtc } = require('./lib/db.cjs');
const { projetoPadrao } = require('./lib/datatable.cjs');

const DIR = path.join(__dirname, 'migrations');
const TABELA_ESTADO = 'promoliso_analytics_migrations';

const argv = process.argv.slice(2);
const comando = (argv.find((a) => !a.startsWith('--')) || 'status').toLowerCase();
const DRY = argv.includes('--dry');
const ate = (argv.find((a) => a.startsWith('--ate=')) || '').split('=')[1] || '';

function carregar() {
  return fs.readdirSync(DIR)
    .filter((f) => /^\d{3}-.*\.cjs$/.test(f))
    .sort()
    .map((f) => {
      const mod = require(path.join(DIR, f));
      const id = f.slice(0, 3);
      if (typeof mod.up !== 'function' || typeof mod.down !== 'function') {
        throw new Error(`${f}: migration precisa exportar up() e down()`);
      }
      return { id, arquivo: f, descricao: mod.descricao || '', up: mod.up, down: mod.down };
    });
}

async function garantirEstado(w) {
  await w.run(
    `CREATE TABLE IF NOT EXISTS ${TABELA_ESTADO} (` +
    'id TEXT PRIMARY KEY NOT NULL, arquivo TEXT NOT NULL, descricao TEXT, aplicada_em TEXT NOT NULL)',
  );
}

async function aplicadas(w) {
  const t = await w.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [TABELA_ESTADO]);
  if (!t) return new Set();
  const rows = await w.all(`SELECT id FROM ${TABELA_ESTADO}`);
  return new Set(rows.map((r) => r.id));
}

function portaOcupada(porta) {
  return new Promise((r) => {
    const s = net.createConnection({ host: '127.0.0.1', port: porta });
    const fim = (v) => { try { s.destroy(); } catch { /* já morto */ } r(v); };
    s.setTimeout(600);
    s.on('connect', () => fim(true));
    s.on('timeout', () => fim(false));
    s.on('error', () => fim(false));
  });
}

// A trava da porta 5678 protege contra migrar o banco QUE O n8n ESTÁ USANDO. Ela não faz sentido
// para um banco de homologação em /tmp — e é exatamente isso que os testes migram.
//
// Descoberto rodando os testes no VPS em 2026-08-07: na máquina de desenvolvimento o n8n está
// desligado, então a trava nunca disparava; no servidor, com o n8n no ar, ela reprovava 3 dos 7
// arquivos de teste. A trava estava certa, só estava aplicada larga demais.
//
// Agora ela só vale quando o alvo é, de fato, o banco de produção — comparado por caminho real
// (realpath resolve link simbólico e caminho relativo; sem isso, dois nomes do mesmo arquivo
// enganariam a comparação).
function ehBancoDeProducao() {
  const padrao = path.join(cfg.raiz, 'data', '.n8n', 'database.sqlite');
  const resolver = (p) => {
    try { return fs.realpathSync(p); } catch { return path.resolve(p); }
  };
  return resolver(cfg.db) === resolver(padrao);
}

(async () => {
  if (!fs.existsSync(cfg.db)) throw new Error(`banco não encontrado: ${cfg.db} (use PROMO_DB=...)`);
  const migs = carregar();

  if (comando !== 'status' && !DRY && ehBancoDeProducao() && await portaOcupada(5678)) {
    throw new Error('a porta 5678 está de pé — o n8n parece estar rodando. `systemctl stop promo-n8n` antes de migrar.');
  }

  const w = await abrirEnvolvido(cfg.db, DRY || comando === 'status');
  const feitas = await aplicadas(w);
  const projectId = cfg.projectId || await projetoPadrao(w);

  if (comando === 'status') {
    console.log(`banco:   ${cfg.db}`);
    console.log(`projeto: ${projectId}`);
    console.log('');
    for (const m of migs) {
      console.log(`  [${feitas.has(m.id) ? 'x' : ' '}] ${m.id}  ${m.descricao}`);
    }
    const pend = migs.filter((m) => !feitas.has(m.id)).length;
    console.log('');
    console.log(pend ? `${pend} migration(s) pendente(s).` : 'tudo aplicado.');
    await w.fechar();
    return;
  }

  if (comando === 'up') {
    let alvo = migs.filter((m) => !feitas.has(m.id));
    if (ate) alvo = alvo.filter((m) => m.id <= ate);
    if (!alvo.length) { console.log('nada a aplicar.'); await w.fechar(); return; }

    if (!DRY) await garantirEstado(w);
    for (const m of alvo) {
      console.log(`>> up ${m.id} — ${m.descricao}`);
      if (DRY) {
        const plano = await m.up({ w, projectId, cfg, dry: true });
        console.log('   ' + JSON.stringify(plano));
        continue;
      }
      await w.tx(async () => {
        await m.up({ w, projectId, cfg, dry: false });
        await w.run(`INSERT INTO ${TABELA_ESTADO} (id,arquivo,descricao,aplicada_em) VALUES (?,?,?,?)`,
          [m.id, m.arquivo, m.descricao, agoraUtc()]);
      });
      console.log(`   OK ${m.id}`);
    }
    console.log(DRY ? '\nDRY — nada gravado.' : '\nup concluído.');
    await w.fechar();
    return;
  }

  if (comando === 'down') {
    let alvo = migs.filter((m) => feitas.has(m.id)).reverse();
    if (ate) alvo = alvo.filter((m) => m.id >= ate);
    if (!alvo.length) { console.log('nada a reverter.'); await w.fechar(); return; }

    for (const m of alvo) {
      console.log(`<< down ${m.id} — ${m.descricao}`);
      if (DRY) {
        const plano = await m.down({ w, projectId, cfg, dry: true });
        console.log('   ' + JSON.stringify(plano));
        continue;
      }
      await w.tx(async () => {
        await m.down({ w, projectId, cfg, dry: false });
        await w.run(`DELETE FROM ${TABELA_ESTADO} WHERE id=?`, [m.id]);
      });
      console.log(`   OK ${m.id} revertida`);
    }
    console.log(DRY ? '\nDRY — nada gravado.' : '\ndown concluído.');
    await w.fechar();
    return;
  }

  throw new Error(`comando desconhecido: ${comando} (use status | up | down)`);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
