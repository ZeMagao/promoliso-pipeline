#!/usr/bin/env node
// PROMO-REPESCAGEM — a pauta que morreu DEPOIS de aprovada volta para a disputa (02/10/2026).
//
// O DEFEITO, MEDIDO. A curadoria marca a pauta como APROVADO antes de o redator escrever. Se a
// rodada morre depois disso (capa que não renderiza, upload que falha), a pauta fica APROVADO para
// sempre — e a deduplicação (`Preparar fila de curadoria`) descarta toda notícia cuja
// `curation_key` já está na tabela. Ela nunca volta. Na semana de 25/09 a 02/10 foram 3 pautas
// boas perdidas assim (Hades, Grave Seasons, Call of Duty), todas na capa.
//
// O conserto da capa (apelido curto, 02/10) tira a causa conhecida, mas o desenho segue frágil:
// QUALQUER falha depois da validação perde a pauta. Este script fecha isso por fora do n8n — sem nó
// novo, sem religar conexão (cirurgia de conexão foi o que derrubou a publicação por 3 dias em
// 05/08). Molde: promo-fila-writeback.cjs, que já escreve no banco do n8n por timer.
//
// A REGRA. Execução do produtor com status `error`, que PASSOU na validação (`Pauta validada?`
// soltou item no ramo verdadeiro) e terminou nas últimas JANELA_H horas. A linha APROVADO dela tem
// a chave renomeada para `<chave>#repescagem-<exec>`: a deduplicação deixa de reconhecer a
// notícia, que volta como candidata na rodada seguinte — se ainda estiver no feed. Medido: as 4
// pautas perdidas da semana continuaram no feed por mais 1 a 9 rodadas.
//
// TRAVAS
//  - uma repescagem por notícia: se já existe `<chave>#repescagem-*`, ela morreu duas vezes e não
//    volta (vai aviso).
//  - só renomeia a chave; nada de INSERT nem DELETE. A linha continua lá, com a história.
//  - só rodada que morreu DEPOIS de validar: reprovação do validador não é falha, é veredito.
//  - `--seco` mostra tudo sem gravar e sem avisar.
//
//   node promo-repescagem.cjs                 repesca e avisa
//   node promo-repescagem.cjs --seco          mostra o que faria
//   node promo-repescagem.cjs --seco --janela-h 200   (prova: alcança as mortes antigas)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DB = process.env.PROMO_DB || '/opt/promoliso/data/.n8n/database.sqlite';
const FLATTED = process.env.PROMO_FLATTED || '/opt/promoliso/node_modules/flatted';
const TELEGRAM = process.env.PROMO_TELEGRAM || '/usr/local/bin/promo-telegram.cjs';
const ESTADO = process.env.PROMO_REPESCAGEM_ESTADO || '/var/lib/promo-vigia/repescagem.json';
const PRODUTOR = 'NL8eVLKErgnIXBQq';
const CURADORIA = 'data_table_user_PLAiCur8cTx26M1Q';
const SUFIXO = '#repescagem-';
const JANELA_H_PADRAO = 6;

// ── decisão: função pura, é o que o harness exercita ─────────────────────────
// execs: [{ id, status, parou_em (ms), validou, ultimo_no }]
// linhas: [{ id, id_execucao, status_aprovacao, curation_key, titulo }]
// chavesExistentes: Set de todas as curation_key da tabela
function decidir(execs, linhas, chavesExistentes, agora, janelaH, jaVistos) {
  const repescar = [];
  const desistir = [];
  const limite = agora - janelaH * 3600 * 1000;
  for (const e of execs) {
    if (e.status !== 'error' || !e.validou || !(e.parou_em >= limite)) continue;
    if (jaVistos && jaVistos.has(String(e.id))) continue;
    for (const l of linhas) {
      if (String(l.id_execucao) !== String(e.id)) continue;
      if (String(l.status_aprovacao).toUpperCase() !== 'APROVADO') continue;
      const chave = String(l.curation_key || '');
      if (!chave || chave.includes(SUFIXO)) continue;
      const jaRepescada = [...chavesExistentes].some((k) => k.startsWith(chave + SUFIXO));
      const item = { exec: String(e.id), linha: l.id, chave, titulo: String(l.titulo || ''), ultimo_no: e.ultimo_no };
      if (jaRepescada) desistir.push(item);
      else repescar.push(Object.assign(item, { chave_nova: chave + SUFIXO + e.id }));
    }
  }
  return { repescar, desistir };
}

function montarMensagem({ repescar, desistir }) {
  const linhas = [];
  for (const r of repescar) {
    linhas.push(`♻️ <b>PromoLiso</b> — rodada ${r.exec} morreu em "${r.ultimo_no}" depois de aprovar a pauta`
      + `\n   ↳ "${r.titulo.slice(0, 90)}" volta como candidata na próxima rodada`);
  }
  for (const d of desistir) {
    linhas.push(`🟠 <b>PromoLiso</b> — a pauta "${d.titulo.slice(0, 90)}" morreu de novo (rodada ${d.exec}, em "${d.ultimo_no}")`
      + '\n   ↳ já foi repescada uma vez; não volta. Olhar a execução.');
  }
  return linhas.join('\n\n');
}

module.exports = { decidir, montarMensagem, SUFIXO };

// ── coleta: a parte que fala com o mundo ─────────────────────────────────────
const sql = (q) => execFileSync('sqlite3', ['-readonly', DB, q], { encoding: 'utf8', maxBuffer: 1 << 29 }).trim();
const aspas = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function coletar(janelaH) {
  const { parse } = require(FLATTED);
  const execs = [];
  const brutas = sql(`SELECT id||'|'||status||'|'||COALESCE(stoppedAt,'') FROM execution_entity WHERE workflowId='${PRODUTOR}' `
    + `AND status='error' AND stoppedAt >= datetime('now','-${Number(janelaH)} hours') ORDER BY id;`);
  for (const linha of brutas.split('\n').filter(Boolean)) {
    const [id, status, parou] = linha.split('|');
    let validou = false;
    let ultimo = '';
    try {
      const d = parse(sql(`SELECT data FROM execution_data WHERE executionId=${Number(id)};`));
      const pv = (d.resultData.runData || {})['Pauta validada?'] || [];
      validou = pv.some((r) => ((((r.data || {}).main || [])[0]) || []).length > 0);
      ultimo = String(d.resultData.lastNodeExecuted || '');
    } catch (e) { /* execução sem dados (podada): não dá para provar que validou — não mexe */ }
    // stoppedAt é UTC sem fuso no sqlite do n8n
    execs.push({ id, status, parou_em: Date.parse(parou.replace(' ', 'T') + 'Z'), validou, ultimo_no: ultimo });
  }
  const ids = execs.map((e) => aspas(e.id)).join(',');
  const linhas = ids ? sql(`SELECT json_object('id',id,'id_execucao',id_execucao,'status_aprovacao',status_aprovacao,`
    + `'curation_key',curation_key,'titulo',titulo_original) FROM ${CURADORIA} WHERE id_execucao IN (${ids});`)
    .split('\n').filter(Boolean).map((j) => JSON.parse(j)) : [];
  // Só as chaves já repescadas importam (para a trava de "uma vez só"); `instr` e não LIKE, porque
  // URL tem `_` e `%`, que no LIKE são curinga.
  const chaves = new Set(sql(`SELECT curation_key FROM ${CURADORIA} WHERE instr(curation_key, '${SUFIXO}') > 0;`)
    .split('\n').filter(Boolean));
  return { execs, linhas, chaves };
}

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch (e) { return { vistos: [] }; }
}

if (require.main === module) {
  const SECO = process.argv.includes('--seco');
  const iJ = process.argv.indexOf('--janela-h');
  const janelaH = iJ > 0 ? Number(process.argv[iJ + 1]) : JANELA_H_PADRAO;
  const estado = lerEstado();
  const vistos = new Set((estado.vistos || []).map(String));

  const { execs, linhas, chaves } = coletar(janelaH);
  const decisao = decidir(execs, linhas, chaves, Date.now(), janelaH, SECO ? null : vistos);
  console.log(`execuções com erro em ${janelaH} h: ${execs.length} (validaram: ${execs.filter((e) => e.validou).length})`);
  for (const r of decisao.repescar) console.log(`REPESCAR  exec ${r.exec} linha ${r.linha}  ${r.chave}  ->  ${r.chave_nova}`);
  for (const d of decisao.desistir) console.log(`DESISTIR  exec ${d.exec} linha ${d.linha}  ${d.chave} (já repescada uma vez)`);
  if (SECO) { console.log('(--seco: nada gravado, nada enviado)'); process.exit(0); }

  if (decisao.repescar.length) {
    const sqlite3 = require(process.env.PROMO_SQLITE3 || '/opt/promoliso/node_modules/sqlite3');
    const db = new sqlite3.Database(DB, sqlite3.OPEN_READWRITE);
    const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
    const agora = new Date().toISOString().replace('T', ' ').replace('Z', '');
    (async () => {
      await run('PRAGMA busy_timeout=8000');
      for (const r of decisao.repescar) {
        // a condição repete a chave antiga: se alguém mexeu no meio, não sobrescreve nada
        const res = await run(`UPDATE ${CURADORIA} SET curation_key=?, updatedAt=? WHERE id=? AND curation_key=?`,
          [r.chave_nova, agora, r.linha, r.chave]);
        console.log(`OK  linha ${r.linha}: ${res.changes} alterada`);
      }
      db.close();
      finalizar();
    })().catch((e) => { console.error('FALHA ao gravar: ' + e.message); try { db.close(); } catch (x) {} process.exit(1); });
  } else {
    finalizar();
  }

  function finalizar() {
    const msg = montarMensagem(decisao);
    if (msg) {
      try { execFileSync('node', [TELEGRAM, msg], { stdio: ['ignore', 'inherit', 'inherit'] }); }
      catch (e) { console.error('FALHA no push do Telegram'); }
    }
    const novos = execs.filter((e) => e.validou).map((e) => String(e.id));
    const tudo = [...new Set([...vistos, ...novos])].slice(-200);
    fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
    fs.writeFileSync(ESTADO, JSON.stringify({ vistos: tudo }, null, 1));
  }
}
