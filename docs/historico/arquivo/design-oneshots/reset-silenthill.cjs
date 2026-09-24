// Reabilita o Silent Hill (id=123) na curadoria: APROVADO -> CANDIDATO, pra o produtor re-selecionar.
const path = require('path');
const sqlite3 = require(path.join(__dirname, '..', 'node_modules', 'sqlite3'));
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const db = new sqlite3.Database(DB, sqlite3.OPEN_READWRITE);
db.run("UPDATE data_table_user_PLAiCur8cTx26M1Q SET status_aprovacao='CANDIDATO' WHERE id=123", function (e) {
  if (e) { console.error('ERRO:', e.message); process.exit(1); }
  console.log('OK: Silent Hill (id=123) -> CANDIDATO, changes=' + this.changes);
  db.get("SELECT id,status_aprovacao,pontuacao_total,titulo_sugerido FROM data_table_user_PLAiCur8cTx26M1Q WHERE id=123", (e2, r) => {
    console.log('agora:', JSON.stringify(r));
    db.close();
  });
});
