// OFERTA passa a ter duas formas: PRODUTO e EVENTO.
//
// POR QUE. Medido em 12/08/2026 sobre 40 execuções: pauta de promoção reprova 73% (a média geral é
// 48%), e a maior causa editorial é o próprio agente recusando. Nas palavras dele: "matéria
// editorial genérica e recorrente de catálogo de descontos, SEM UM PRODUTO ÚNICO". Ele estava
// obedecendo o contrato: OFERTA exigia produto, variante, preço, condição de pagamento. Só que a
// promoção que os feeds de games trazem é quase sempre EVENTO — "Promoção de Inverno da PS Store",
// "Steam até 95% off", "Nuuvem 08.08 com cupom". O formato não comportava o que existe.
//
// O QUE ENTRA NO LUGAR DA TRAVA. Não é só afrouxar. Produto único deixa de ser exigência e a
// exigência vira **até quando vale**, que é o que decide se um evento é publicável: a fila guarda a
// peça e publica com até 48 h de atraso, então promoção sem prazo conhecido é post que nasce velho.
// Evento precisa de loja, validade, disponibilidade, URL de loja conhecida e desconto (faixa com
// número ou cupom).
//
// O QUE NÃO MUDA: a forma PRODUTO continua igual, campo por campo — inclusive a exceção do jogo
// grátis (Epic toda semana), que já custou uma reprovação boba na exec 200. E a URL continua tendo
// que ser de loja conhecida nas duas formas: é o que separa promoção de matéria sobre promoção.
//
// LIMITE CONHECIDO, deixado de fora de propósito: nada impede uma promoção de terminar entre a
// aprovação e a publicação (a fila atrasa até 48 h). A regra aqui só recusa o que JÁ nasceu vencido.
// Fechar essa janela é trabalho do publicador, que é quem sabe a hora da publicação — e ele hoje
// nem carrega a validade na fila.

// Data final da promoção a partir de texto livre ("até 26 de agosto", "26/08", "2026-08-26").
// Devolve null quando não dá pra ler, e nesse caso a pauta PASSA: adivinhar data é pior que não
// saber — um chute erra para o lado de matar pauta boa.
function fimDaPromocao(texto) {
  const t = String(texto || '').toLowerCase();
  if (!t.trim()) return null;
  const MESES = {
    janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  };
  let dia = 0, mes = 0, ano = 0;
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { ano = Number(m[1]); mes = Number(m[2]); dia = Number(m[3]); }
  if (!dia) {
    m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/);
    if (m) {
      dia = Number(m[1]); mes = Number(m[2]);
      if (m[3]) ano = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    }
  }
  if (!dia) {
    m = t.match(/(\d{1,2})\s*de\s+([a-zç]+)/);
    if (m && MESES[m[2]]) { dia = Number(m[1]); mes = MESES[m[2]]; }
  }
  if (!dia || !mes || mes > 12 || dia > 31) return null;
  const agora = new Date();
  if (!ano) {
    // sem ano, assume o ano corrente; se isso jogar a data mais de 6 meses para trás, era do ano
    // que vem (promoção de janeiro anunciada em dezembro)
    ano = agora.getUTCFullYear();
    const tentativa = Date.UTC(ano, mes - 1, dia);
    if (tentativa < agora.getTime() - 182 * 86400000) ano += 1;
  }
  return Date.UTC(ano, mes - 1, dia, 23, 59, 59);
}

let ofertaAuditada = null;
if (output.categoria === 'OFERTA') {
  const oferta = output.oferta || {};
  const urlOferta = urlInfo(oferta.url);
  const precoAtual = valorNumerico(oferta.preco_atual);
  const precoReferencia = valorNumerico(oferta.preco_referencia);
  const tipoOferta =
    String(oferta.tipo || '').trim().toLowerCase() === 'evento' ? 'evento' : 'produto';

  // vale para as duas formas: é o que separa promoção de matéria FALANDO de promoção
  if (!urlOferta || !hostIn(urlOferta.host, dominiosLojas)) {
    erros.push('Oferta sem URL direta de uma loja conhecida');
  }
  if (/\b(esgotad[oa]|indisponível|encerrad[oa])\b/i.test(oferta.disponibilidade || '')) {
    erros.push('Oferta marcada como indisponível');
  }

  if (tipoOferta === 'evento') {
    const camposEvento = [oferta.loja, oferta.validade, oferta.disponibilidade]
      .every((value) => String(value || '').trim());
    if (!camposEvento) {
      erros.push('Evento promocional sem loja, validade ou disponibilidade');
    }
    // "até 95%" ou um cupom: sem um dos dois não há promoção nenhuma para anunciar
    const temFaixa = /\d/.test(String(oferta.desconto || ''));
    const temCupom = Boolean(String(oferta.cupom || '').trim());
    if (!temFaixa && !temCupom) {
      erros.push('Evento promocional sem faixa de desconto nem cupom');
    }
    const fim = fimDaPromocao(oferta.validade);
    // 36 h de folga porque a comparação mistura fuso do agente com o do servidor, e errar aqui
    // para o lado severo mataria promoção viva
    if (fim && fim < Date.now() - 36 * 3600 * 1000) {
      erros.push('Promoção já encerrada segundo a própria validade (' + String(oferta.validade).slice(0, 40) + ')');
    }
  } else {
    const camposObrigatorios = [
      oferta.produto,
      oferta.variante,
      oferta.loja,
      oferta.preco_atual,
      oferta.condicao_pagamento,
      oferta.disponibilidade,
    ].every((value) => String(value || '').trim());
    if (!camposObrigatorios) erros.push('Oferta sem todos os dados obrigatórios');
    // Jogo grátis é oferta legítima e recorrente (Epic toda semana), mas caía aqui: a exec 200
    // reprovou "Epic Games Store libera Beacon Pines" com preco_atual "Grátis (R$ 0,00)".
    // Só aceita quando o texto DIZ que é grátis — preço vazio ou ilegível continua sendo erro,
    // senão uma falha de extração passaria disfarçada de promoção.
    const ofertaGratuita =
      /\b(?:gr[áa]tis|free|de\s+gra[çc]a|sem\s+custo)\b/i.test(String(oferta.preco_atual || ''));
    if (precoAtual <= 0 && !ofertaGratuita) erros.push('Preço atual inválido');
    if (precoReferencia > 0 && precoReferencia < precoAtual) {
      erros.push('Preço de referência menor que o preço atual');
    }
  }

  ofertaAuditada = {
    tipo: tipoOferta,
    host: urlOferta?.host || '',
    preco_atual: precoAtual,
    preco_referencia: precoReferencia,
    validade: String(oferta.validade || ''),
  };
}
