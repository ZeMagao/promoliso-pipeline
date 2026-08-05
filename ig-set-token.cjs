/**
 * Semeia UMA vez o token do Instagram para o fluxo PromoLiso.
 *
 * O node de publicação lê ~/ig-token.json (token de 60 dias + validade) e o
 * renova sozinho via ig_refresh_token antes de vencer. Este script só existe
 * para o primeiro seed — depois dele, o token se mantém sozinho e você não
 * precisa mais mexer, nem reconectar no n8n, nem depender do túnel.
 *
 * Uso:
 *   node ig-set-token.cjs <TOKEN>
 *
 * <TOKEN> pode ser um token de longa OU curta duração do Instagram Login
 * (graph.instagram.com). Se você tiver o client_secret do app, passe também
 * para trocar um token curto por um de 60 dias:
 *   node ig-set-token.cjs <TOKEN> <CLIENT_SECRET>
 *
 * O script valida o token em /me, tenta normalizar a validade via refresh e
 * grava ~/ig-token.json. Nunca imprime o token completo.
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => resolve({ status: r.statusCode, body: d }));
      })
      .on('error', reject);
  });
}

function parse(body) {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

const STORE = path.join(os.homedir(), 'ig-token.json');
const G = 'https://graph.instagram.com';

(async () => {
  const token = process.argv[2];
  const clientSecret = process.argv[3];
  if (!token) {
    console.error('Uso: node ig-set-token.cjs <TOKEN> [CLIENT_SECRET]');
    process.exit(1);
  }

  // 1. Valida o token.
  const me = await get(`${G}/v23.0/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`);
  if (me.status !== 200) {
    console.error('Token NÃO validou (/me status ' + me.status + '):');
    console.error('  ' + me.body.slice(0, 400));
    console.error('\nPegue um token novo do Instagram Login e tente de novo.');
    process.exit(1);
  }
  const meJson = parse(me.body) || {};
  console.log('Token válido. IG user: @' + (meJson.username || '?') + ' (id ' + (meJson.id || '?') + ', ' + (meJson.account_type || '?') + ')');

  let finalToken = token;
  let expiresIn = 60 * 24 * 3600; // padrão conservador: 60 dias

  // 2. Se veio client_secret, troca curto -> longo (60 dias).
  if (clientSecret) {
    const ex = await get(`${G}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(token)}`);
    const exJson = parse(ex.body);
    if (ex.status === 200 && exJson && exJson.access_token) {
      finalToken = exJson.access_token;
      expiresIn = exJson.expires_in || expiresIn;
      console.log('Troca curto->longo OK. expires_in=' + expiresIn + ' (~' + Math.round(expiresIn / 86400) + 'd)');
    } else {
      console.log('Troca com client_secret não rolou (status ' + ex.status + '); seguindo com o token informado.');
    }
  }

  // 3. Tenta refresh para pegar a validade real (funciona se o token tiver >24h).
  const rf = await get(`${G}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(finalToken)}`);
  const rfJson = parse(rf.body);
  if (rf.status === 200 && rfJson && rfJson.access_token) {
    finalToken = rfJson.access_token;
    expiresIn = rfJson.expires_in || expiresIn;
    console.log('Refresh OK. expires_in=' + expiresIn + ' (~' + Math.round(expiresIn / 86400) + 'd)');
  } else {
    console.log('Refresh não aplicado (token muito novo? <24h). Gravando validade assumida de ~' + Math.round(expiresIn / 86400) + 'd; o node renova sozinho depois.');
  }

  // 4. Grava.
  const expiresAt = Math.floor(Date.now() / 1000) + Number(expiresIn);
  fs.writeFileSync(STORE, JSON.stringify({ token: finalToken, expiresAt }), { mode: 0o600 });
  console.log('\nGravado em ' + STORE);
  console.log('Expira em ' + new Date(expiresAt * 1000).toISOString() + ' — o node renova automaticamente antes disso.');
  console.log('Pronto. Pode re-rodar o fluxo e publicar.');
})().catch((e) => {
  console.error('Erro:', e && e.message);
  process.exit(1);
});
