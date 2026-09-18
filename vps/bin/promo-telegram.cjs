#!/usr/bin/env node
// promo-telegram.cjs "<texto>"  (ou texto pelo stdin) — manda push pro Telegram do dono.
//
// POR QUE ISTO EXISTE (17/09/2026). O watchdog funcionou o tempo todo: de 25/08 a 17/09 ele
// detectou "sem publicacao" e mandou e-mail em TODA rodada, duas por dia — o Gmail aceitou os ~44.
// Ninguem leu, e a conta ficou 23 dias muda. O alarme nao falhou; o canal falhou. E-mail continua
// indo (e barato), mas quem acorda alguem e o push.
//
// O token NAO mora no repo nem em variavel de ambiente de servico: fica em
// /etc/promoliso/telegram.json, dono promo, modo 600. Nada aqui imprime o token, nem em erro.
//
//   node promo-telegram.cjs "texto"           manda
//   echo texto | node promo-telegram.cjs      manda (stdin)
//   node promo-telegram.cjs --teste           manda uma mensagem de teste
//   node promo-telegram.cjs --descobrir-chat  le getUpdates e mostra o chat_id (setup)
const fs = require('fs');

const ARQ = process.env.PROMO_TELEGRAM_CONF || '/etc/promoliso/telegram.json';
const LIMITE = 3900;   // o Telegram corta em 4096; sobra folga pro cabecalho

function conf() {
  let bruto;
  try {
    bruto = fs.readFileSync(ARQ, 'utf8');
  } catch (e) {
    throw new Error('configuracao do Telegram nao encontrada em ' + ARQ
      + ' — crie com {"token":"...","chat_id":"..."} e chmod 600');
  }
  const c = JSON.parse(bruto);
  if (!c.token) throw new Error('faltando "token" em ' + ARQ);
  return c;
}

async function api(token, metodo, corpo) {
  const r = await fetch('https://api.telegram.org/bot' + token + '/' + metodo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    // A descricao do Telegram nao repete o token, mas o CAMINHO repetiria: por isso nunca
    // imprimimos a URL — so o metodo e a descricao.
    throw new Error('Telegram recusou ' + metodo + ': ' + (j.description || ('HTTP ' + r.status)));
  }
  return j.result;
}

async function mandar(texto) {
  const c = conf();
  // Aceita um chat_id ou uma lista: o dono tem duas contas (a pessoal e a da marca) e pode querer
  // o alerta nas duas. Uma falha num destino nao pode calar os outros.
  const destinos = []
    .concat(c.chat_ids || [])
    .concat(c.chat_id ? [c.chat_id] : [])
    .map(String)
    .filter((v, i, a) => v && a.indexOf(v) === i);
  if (!destinos.length) throw new Error('faltando "chat_id" em ' + ARQ + ' — rode --descobrir-chat');
  const corte = String(texto).slice(0, LIMITE);
  const erros = [];
  for (const chat of destinos) {
    try {
      await api(c.token, 'sendMessage', {
        chat_id: chat,
        text: corte,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (e) { erros.push(e.message); }
  }
  if (erros.length === destinos.length) throw new Error(erros.join(' | '));
  return corte.length;
}

module.exports = { mandar, conf };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);

    if (args[0] === '--descobrir-chat') {
      const c = conf();
      const updates = await api(c.token, 'getUpdates', {});
      const chats = new Map();
      for (const u of updates) {
        const m = u.message || u.edited_message || u.channel_post;
        if (m && m.chat) chats.set(String(m.chat.id), m.chat.first_name || m.chat.title || m.chat.username || '');
      }
      if (!chats.size) {
        console.log('nenhuma conversa encontrada — mande qualquer mensagem pro bot e rode de novo');
        process.exit(1);
      }
      for (const [id, nome] of chats) console.log('chat_id=' + id + '  ' + nome);
      return;
    }

    let texto = args.filter((a) => !a.startsWith('--')).join(' ');
    if (args.includes('--teste')) {
      texto = '✅ <b>PromoLiso</b> — canal de alerta no ar.\n'
        + 'Este e o caminho que vai te avisar quando a conta parar de publicar.';
    }
    if (!texto) {
      for await (const pedaco of process.stdin) texto += pedaco;
    }
    if (!String(texto).trim()) { console.error('sem texto para mandar'); process.exit(1); }

    const n = await mandar(texto);
    console.log('push enviado (' + n + ' caracteres)');
  })().catch((e) => { console.error('FALHA ' + e.message); process.exit(1); });
}
