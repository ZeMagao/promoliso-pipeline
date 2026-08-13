// promo-alerta.js "<assunto>" — corpo vem do stdin
// Manda email pela credencial SMTP do proprio n8n (decifra com a encryptionKey local).
const fs = require('fs');
const { execFileSync } = require('child_process');

const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const DESTINO = process.env.ALERT_EMAIL || '<email-de-alerta>';
const assunto = process.argv[2] || '[PromoLiso] alerta';

function credSmtp() {
  const key = JSON.parse(fs.readFileSync('/opt/promoliso/data/.n8n/config', 'utf8')).encryptionKey;
  const { CipherAes256CBC } = require('/opt/promoliso/node_modules/n8n-core/dist/encryption/aes-256-cbc.js');
  const cifra = new CipherAes256CBC();
  const linha = execFileSync('sqlite3', [DB, "SELECT data FROM credentials_entity WHERE type='smtp' LIMIT 1;"])
    .toString().trim();
  if (!linha) throw new Error('credencial smtp nao encontrada no banco');
  return JSON.parse(cifra.decrypt(linha, key));
}

(async () => {
  let corpo = '';
  for await (const pedaco of process.stdin) corpo += pedaco;
  if (!corpo.trim()) corpo = '(sem detalhes)';

  const c = credSmtp();
  const nodemailer = require('/opt/promoliso/node_modules/nodemailer');
  const porta = Number(c.port || 465);
  const transporte = nodemailer.createTransport({
    host: c.host,
    port: porta,
    secure: c.secure !== undefined ? !!c.secure : porta === 465,
    auth: { user: c.user, pass: c.password },
  });
  await transporte.sendMail({
    from: c.user,
    to: DESTINO,
    subject: assunto,
    text: corpo,
  });
  console.log('alerta enviado para ' + DESTINO);
})().catch((e) => {
  console.error('FALHOU enviar alerta: ' + e.message);
  process.exit(1);
});
