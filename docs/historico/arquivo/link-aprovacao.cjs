/**
 * Imprime o link assinado do formulário de aprovação pendente.
 *
 * O n8n 2.30 assina os links de form-waiting: sem o parâmetro `signature` a
 * página responde "expirou", mesmo com a execução viva. O popup da UI monta
 * essa URL sozinho — este script existe para quando o navegador bloqueia o
 * popup.
 *
 * Uso: node link-aprovacao.cjs [id-da-execucao]
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const db = new DatabaseSync(path.join(RAIZ, 'data', '.n8n', 'database.sqlite'), { readOnly: true });

let base = '';
try {
  base = fs.readFileSync(path.join(RAIZ, 'tunnel-url.txt'), 'utf8').trim();
} catch {
  base = 'http://localhost:5678';
}

const alvo = process.argv[2];
const pendentes = alvo
  ? db.prepare('select id, waitTill, status from execution_entity where id=?').all(Number(alvo))
  : db.prepare("select id, waitTill, status from execution_entity where status='waiting' order by id desc").all();

if (!pendentes.length) {
  console.log('Nenhuma execução aguardando aprovação.');
  process.exit(0);
}

for (const e of pendentes) {
  const bruto = db.prepare('select data from execution_data where executionId=?').get(e.id)?.data;
  if (!bruto) {
    console.log(`execução ${e.id}: sem dados`);
    continue;
  }
  const arr = JSON.parse(bruto);
  const D = (v) => (typeof v === 'string' && /^[0-9]+$/.test(v) ? arr[Number(v)] : v);
  const token = D(arr[0].resumeToken);
  const node = D(D(arr[0].resultData).lastNodeExecuted);

  console.log(`\nexecução ${e.id} — parada em "${node}"`);
  console.log(`expira em ${e.waitTill}`);
  if (!token) {
    console.log('  (sem resumeToken — link não assinado)');
    console.log(`  ${base}/form-waiting/${e.id}`);
  } else {
    console.log(`  ${base}/form-waiting/${e.id}?signature=${token}`);
  }
}
console.log('\nEsse link aprova a publicação. Não compartilhe.');
