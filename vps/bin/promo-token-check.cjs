#!/usr/bin/env node
// Testa se o token do Instagram AINDA VALE — e avisa por e-mail quando não vale mais.
//
// POR QUE ISTO EXISTE (13/08/2026). A conta ficou ~20 h sem publicar e ninguém soube. O token
// tinha sido INVALIDADO (troca de senha da conta), não expirado: a validade gravada dizia 27/09.
//
// A armadilha é a ordem em que o nó do Instagram resolve o token: ele lê `~/ig-token.json` e, se a
// DATA ainda estiver longe, devolve o token guardado **sem validar**. Só olha a credencial do n8n
// quando o arquivo está ausente ou vencido. Ou seja: reconectar a credencial na interface não
// conserta nada enquanto o arquivo jurar que está tudo bem. Foi exatamente o que aconteceu — a
// reconexão não teve efeito nenhum até o arquivo ser trocado na mão.
//
// Data de validade, portanto, NÃO é sinal de saúde. O único sinal honesto é perguntar para a API.
// É só isso que este script faz, uma vez por dia.
//
//   node promo-token-check.cjs           testa e, se falhar, manda e-mail
//   node promo-token-check.cjs --seco    testa e só imprime (não manda e-mail)
//
// Sai 0 quando o token vale, 1 quando não vale. Nenhum segredo é impresso nem enviado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ARQ = process.env.PROMO_IG_TOKEN_FILE || path.join(os.homedir(), 'ig-token.json');
const SECO = process.argv.includes('--seco');
const ALERTA = '/usr/local/bin/promo-alerta.sh';
const MARGEM_DIAS = 10;   // o próprio nó renova quando falta menos que isto

function avisar(assunto, corpo) {
  console.log(corpo);
  if (SECO) { console.log('(--seco: e-mail não enviado)'); return; }
  try {
    execFileSync(ALERTA, [assunto], { input: corpo, stdio: ['pipe', 'inherit', 'inherit'] });
  } catch (e) {
    console.error('FALHA ao enviar o alerta: ' + e.message);
  }
}

(async () => {
  let store;
  try {
    store = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  } catch (e) {
    avisar('[PromoLiso] token do Instagram: arquivo ilegível',
      'Não consegui ler ' + ARQ + '.\n' + e.message
      + '\n\nSem esse arquivo o nó cai no bootstrap da credencial. Se a publicação parar, reconecte'
      + '\na credencial "Instagram account" no n8n.');
    process.exit(1);
  }

  const token = String(store.token || '');
  const expiresAt = Number(store.expiresAt || 0);
  const diasRestantes = expiresAt ? (expiresAt - Date.now() / 1000) / 86400 : null;
  const validade = diasRestantes === null ? 'sem data' : diasRestantes.toFixed(1) + ' dias';

  if (!token) {
    avisar('[PromoLiso] token do Instagram ausente',
      'O arquivo ' + ARQ + ' existe mas não tem a chave "token".\n'
      + '(atenção: a chave se chama "token", NÃO "access_token" — script que procura o nome errado falha calado)');
    process.exit(1);
  }

  let status = 0, corpo = null;
  try {
    const r = await fetch('https://graph.instagram.com/me?fields=id,username&access_token=' + encodeURIComponent(token));
    status = r.status;
    corpo = await r.json();
  } catch (e) {
    avisar('[PromoLiso] token do Instagram: sem resposta da API',
      'A chamada a graph.instagram.com falhou: ' + e.message
      + '\nValidade gravada: ' + validade + '\n\nPode ser rede. Se repetir amanhã, é o token.');
    process.exit(1);
  }

  const ok = status === 200 && corpo && corpo.username;
  if (ok) {
    let extra = '';
    // a data ainda importa para UM caso: a renovação automática falhando em silêncio
    if (diasRestantes !== null && diasRestantes < MARGEM_DIAS) {
      extra = '\n\nATENÇÃO: faltam ' + validade + ' e o nó deveria ter renovado sozinho. '
        + 'Se este aviso repetir, a renovação está falhando.';
      avisar('[PromoLiso] token do Instagram perto de vencer sem renovar',
        'O token responde (@' + corpo.username + '), mas a validade está em ' + validade + '.' + extra);
      process.exit(1);
    }
    console.log('ok  token válido  | conta @' + corpo.username + '  | validade gravada: ' + validade);
    process.exit(0);
  }

  const erro = (corpo && corpo.error) || {};
  avisar('[PromoLiso] TOKEN DO INSTAGRAM INVÁLIDO — a conta não vai publicar',
    'A API recusou o token guardado.\n\n'
    + '  HTTP ' + status + '\n'
    + '  code ' + (erro.code || '?') + ': ' + String(erro.message || JSON.stringify(corpo)).slice(0, 300) + '\n'
    + '  validade GRAVADA no arquivo: ' + validade + '  <- não quer dizer nada, o token pode ter sido invalidado\n\n'
    + 'COMO CONSERTAR (a ordem importa):\n'
    + '  1. Reconecte a credencial "Instagram account" no n8n.\n'
    + '  2. RECONECTAR NÃO BASTA: o nó lê ' + ARQ + ' primeiro e, se a data estiver longe,\n'
    + '     devolve o token velho sem validar. Troque o arquivo também:\n'
    + '       cd /opt/promoliso && sudo -u promo node ig-set-token.cjs <TOKEN_NOVO>\n'
    + '     ou apague o arquivo para o nó semear sozinho a partir da credencial.\n'
    + '  3. Confirme: sudo -u promo node /usr/local/bin/promo-token-check.cjs --seco\n');
  process.exit(1);
})();
