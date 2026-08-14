// Peça boa não morre por tropeço de rede.
//
// Antes esta linha era `status: 'FAILED'`, ponto. Em 13/08 o Meta devolveu um HTTP 400 passageiro
// e a row 38 foi aposentada com conteúdo perfeito: refazendo a mesma chamada à mão, minutos depois,
// o Meta respondeu 200 em tudo. Não se perdeu um slot — perdeu-se a pauta.
//
// Agora a peça volta para a fila como RETRY e o próximo slot tenta de novo.
//
// DUAS TRAVAS, porque devolver sem limite é pior que aposentar:
//   1. Só volta UMA vez. Quem já veio como RETRY e falhou de novo vira FAILED. Sem isso, uma peça
//      genuinamente quebrada (imagem podre, legenda recusada) seria escolhida em TODOS os slots
//      seguintes — ela é a mais velha, e o "Selecionar READY" publica a mais perto de vencer
//      primeiro. Uma peça defeituosa entupiria a fila inteira até envelhecer.
//   2. Só volta se ainda estiver fresca. Peça fora da janela de 48 h não seria publicada de
//      qualquer jeito; devolvê-la só faria barulho e sujaria a fila.
//
// O alerta por e-mail continua saindo nas duas situações — a diferença é que agora ele avisa
// "vou tentar de novo" em vez de "morreu".
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
