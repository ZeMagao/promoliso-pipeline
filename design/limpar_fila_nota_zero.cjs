// LIMPEZA DO ESTOQUE MORTO DA FILA — apaga as rows READY de nota 0.0 que já venceram.
//
// O QUE SÃO ESSAS ROWS. Em 20/08 a fila tinha 23 `READY`, das quais 20 fora da janela de 48 h — a
// mais velha de 07/08, treze dias. Catorze delas têm `score: 0.0`, e isso as data: são anteriores ao
// patch que fez a nota da curadoria chegar na fila (antes disso o campo ia `0` cravado). São peças
// de duas gerações de prompt atrás.
//
// POR QUE NÃO APAGAR TODAS AS 20. O `Selecionar READY` tem um terceiro ramo que pega peça vencida
// quando não há NADA fresco. Ele nunca foi acionado (0 das 37 publicações), mas é a única rede
// contra um dia de produção zero — como 13/08, quando o token caiu e nasceram 0 peças. As 6 rows
// vencidas COM nota ficam como essa reserva; as 14 sem nota vão embora, porque numa escolha por
// nota elas perdem de qualquer coisa e só ocupam espaço.
//
// TRÊS CONDIÇÕES, TODAS OBRIGATÓRIAS: `status = 'READY'`, `score = 0` e idade > 48 h. Medido em
// 20/08: as três selecionam exatamente as mesmas 14 rows. A terceira é cinto de segurança — sem ela,
// no dia em que a gravação da nota falhar, esta faxina apagaria uma peça fresca recém-nascida.
//
// NÃO MEXE em PUBLISHED, FAILED, RETRY nem em nada fresco. O histórico de publicação (que alimenta
// analytics e o watchdog) fica intacto: ele vive nas rows PUBLISHED e em `promoliso_publicacoes`.
//
// Uso, no VPS (dry-run é o padrão; sem --apagar nada é gravado):
//   sudo -u promo node design/limpar_fila_nota_zero.cjs
//   sudo -u promo node design/limpar_fila_nota_zero.cjs --apagar
const fs = require('fs');
const path = require('path');

const TABELA = 'data_table_user_i2e8ZwnL9kwOV6OG';   // promoliso_fila
const FRESCOR_MAX_H = 48;                            // o mesmo do publicador e do portão da fila
const ESPERADAS = 14;                                // o que foi medido em 20/08; divergir = revisar

const ONDE = `status = 'READY' AND score = 0
   AND (julianday('now') - julianday(created_at)) * 24 > ${FRESCOR_MAX_H}`;

module.exports = { TABELA, ONDE, FRESCOR_MAX_H, ESPERADAS };

if (require.main !== module) return;

const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n nao existe aqui: ' + DB + '\n      Este script so roda no VPS.');
  process.exit(1);
}
const sqlite3 = require('sqlite3');
const APAGAR = process.argv.includes('--apagar');
const db = new sqlite3.Database(DB, APAGAR ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
const all = (q, p) => new Promise((r, j) => db.all(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));

(async () => {
  const antes = await all(`SELECT status, COUNT(*) n FROM ${TABELA} GROUP BY status ORDER BY n DESC`);
  console.log('fila antes: ' + antes.map((r) => r.status + '=' + r.n).join('  '));

  const alvo = await all(`SELECT id, substr(created_at,1,16) nasceu, score,
      round((julianday('now') - julianday(created_at)) * 24) idade_h, substr(topic,1,44) topic
    FROM ${TABELA} WHERE ${ONDE} ORDER BY created_at`);
  console.log('\nalvo: ' + alvo.length + ' rows (esperado ' + ESPERADAS + ')\n');
  alvo.forEach((r) => console.log('  id ' + String(r.id).padStart(3) + '  ' + r.nasceu
    + '  ' + String(r.idade_h).padStart(4) + 'h  nota ' + r.score + '  ' + r.topic));

  // guardas: nada é apagado se o alvo não for o que foi medido
  const frescas = await all(`SELECT COUNT(*) n FROM ${TABELA}
    WHERE ${ONDE} AND (julianday('now') - julianday(created_at)) * 24 <= ${FRESCOR_MAX_H}`);
  if (Number(frescas[0].n) !== 0) throw new Error('o alvo pegou row FRESCA — abortando');
  const foraDoStatus = await all(`SELECT COUNT(*) n FROM ${TABELA} WHERE (${ONDE}) AND status <> 'READY'`);
  if (Number(foraDoStatus[0].n) !== 0) throw new Error('o alvo pegou row que nao e READY — abortando');
  if (alvo.length > ESPERADAS) {
    throw new Error(`o alvo cresceu (${alvo.length} > ${ESPERADAS}): rows novas com nota 0 significam que a
gravacao da nota voltou a falhar. Investigar isso ANTES de apagar — a faxina esconderia o sintoma.`);
  }

  const reserva = await all(`SELECT COUNT(*) n FROM ${TABELA} WHERE status = 'READY' AND score > 0
    AND (julianday('now') - julianday(created_at)) * 24 > ${FRESCOR_MAX_H}`);
  console.log('\nreserva do ramo C que SOBRA (vencidas com nota): ' + reserva[0].n + ' rows');

  if (!APAGAR) { console.log('\nDRY — nada apagado. Rode com --apagar para valer.'); db.close(); return; }

  await run('BEGIN');
  try {
    const r = await run(`DELETE FROM ${TABELA} WHERE ${ONDE}`);
    if (r.changes !== alvo.length) throw new Error(`apagou ${r.changes} e o alvo era ${alvo.length} — desfazendo`);
    await run('COMMIT');
    console.log('\nOK apagadas ' + r.changes + ' rows.');
  } catch (e) { await run('ROLLBACK'); throw e; }

  const depois = await all(`SELECT status, COUNT(*) n FROM ${TABELA} GROUP BY status ORDER BY n DESC`);
  console.log('fila depois: ' + depois.map((r) => r.status + '=' + r.n).join('  '));
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
