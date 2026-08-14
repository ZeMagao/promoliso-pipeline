const sel = $('Selecionar READY').item.json;
const FRESCOR_MAX_H = 48;   // mesmo número do "Selecionar READY": mudou lá, muda aqui

const t = Date.parse(String(sel.created_at || ''));
const idadeH = Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
const jaTentouDeNovo = String(sel.status_anterior || '').toUpperCase() === 'RETRY';
const podeTentarDeNovo = !jaTentouDeNovo && idadeH <= FRESCOR_MAX_H;

return [{ json: {
  content_key: sel.content_key,
  status: podeTentarDeNovo ? 'RETRY' : 'FAILED',
  tentativa_anterior: String(sel.status_anterior || ''),
  idade_h: Number.isFinite(idadeH) ? Math.round(idadeH * 10) / 10 : null,
  // vai no corpo do alerta: quem lê o e-mail precisa saber se ainda há esperança
  desfecho: podeTentarDeNovo
    ? 'devolvida para a fila — o proximo slot tenta de novo'
    : (jaTentouDeNovo ? 'segunda falha — aposentada' : 'fora da janela de 48h — aposentada'),
} }];