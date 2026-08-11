// BASE DA CAPA FULL-BLEED — tudo que os três modelos compartilham.
//
// O patch (design/patch_capa_fullbleed.cjs) grava ESTE arquivo seguido do modelo escolhido, nesta
// ordem, no lugar do buildCapa() antigo. Regra que vale pra qualquer modelo mora aqui e só aqui;
// o arquivo do modelo tem apenas a composição visual.
//
// Depende dos helpers que já existem no nó: cloud(), esc(), QUAL, balanceLines(), fitSize(),
// kickerChip(), kickerLine(), stripDestaque(), grain(), slash(), GREEN, PURPLE, INK, MUT, BODY,
// DISPLAY, STYLE.

// Piso de resolução da imagem de capa.
//
// Por que existe: o full-bleed pede 1080x1350 de imagem contra os 936x520 do hero antigo — ~4,3x
// mais pixel. Imagem que passava despercebida no hero vira capa borrada em tela cheia. O filtro do
// "Normalizar notícias" não cobre isso: ele só sabe medir quando a URL traz sufixo -LARGURAxALTURA
// (padrão WordPress) e deixa passar como MAX_SAFE_INTEGER quando não traz — que é a maioria.
//
// O teste real acontece no Cloudinary, que conhece as dimensões da imagem buscada. `if_iw/if_ih`
// são avaliados no servidor dele, então o gate sai de graça: nenhum nó novo, nenhuma requisição a
// mais, nenhuma dimensão pra adivinhar aqui dentro.
//
// O corte foi MEDIDO, não chutado (a primeira versão usava ih>=800 por estimativa e a primeira
// capa real reprovou). 60 URLs candidatas dos últimos 40 registros de curadoria, dimensões
// consultadas no próprio Cloudinary:
//
//     ih>=900 -> 10%      ih>=720 -> 18%      ih>=600 -> 33%
//     ih>=800 -> 17%      ih>=675 -> 30%
//
// O degrau está em 675 porque é onde 1200x675 entra — o formato mais comum de imagem de matéria.
// Custo: o recorte 4:5 aproveita 540x675 e sobe 2,00x até 1080x1350, que o e_sharpen segura.
//
// Abaixo do piso a foto NÃO é recusada (recusar custaria a pauta) — ela cai pro ramo c_pad:
// aparece contida, no tamanho real, ancorada no topo, com o resto preenchido pela cor da marca.
// Fica menor, mas nunca esticada.
//
// A gravidade é g_auto e continua assim por medição: g_auto e g_auto:faces devolvem bytes
// IDÊNTICOS nas fotos de teste e g_auto:subject só difere em retrato — nesta conta os modos
// extras não fazem nada. O controle g_center corta o assunto pela metade, o que confirma que o
// g_auto de fato busca o assunto. Limite conhecido: imagem que é GRÁFICO não sobrevive a recorte
// 4:5 com gravidade nenhuma; o caminho seria fundo borrado (prototipado, não adotado).
const CAPA_MIN_W = 1000, CAPA_MIN_H = 675;

function capaImg(source){
  // e_trim tira a tarja preta do screenshot cinematográfico ANTES do corte. Sem ele o recorte
  // vertical corta as LATERAIS e preserva as barras — a capa nascia com faixa morta no topo.
  const cheia = 'e_trim:10/c_fill,g_auto,w_1728,h_2160';
  const contida = 'e_trim:10/c_pad,g_north,w_1728,h_2160,b_rgb:05060A';
  // QUAL fica FORA do condicional, depois do if_end. Com f_auto dentro dos ramos o Cloudinary
  // devolve 400 quando o cliente aceita AVIF/WebP — ou seja, some no Chrome do renderizador e
  // funciona em qualquer teste que peça a URL com Accept: */*.
  const t = 'if_iw_gte_' + CAPA_MIN_W + '_and_ih_gte_' + CAPA_MIN_H + '/' + cheia + '/if_else/' + contida + '/if_end/' + QUAL;
  return '<img src="' + cloud(source, t) + '" style="position:absolute;inset:0;width:1080px;height:1350px;object-fit:cover;filter:contrast(1.06) saturate(1.06);" />';
}

// Escurece o rodapé pro texto ganhar contraste sem apagar a foto no topo. `inicio` é onde o
// degradê começa a fechar (em % da altura).
function capaScrim(inicio){
  const i = inicio || 38;
  return '<div style="position:absolute;inset:0;display:flex;background:linear-gradient(180deg,rgba(5,6,10,0) ' + i + '%,rgba(5,6,10,.55) ' + (i+16) + '%,rgba(5,6,10,.90) ' + (i+32) + '%,#05060A 100%);"></div>';
}
function capaVinheta(forca){
  const f = forca == null ? 0.45 : forca;
  return '<div style="position:absolute;inset:0;display:flex;background:radial-gradient(120% 80% at 50% 28%,rgba(0,0,0,0) 45%,rgba(0,0,0,' + f + ') 100%);"></div>';
}

// Wordmark em caixa, pra sobreviver em cima de qualquer foto.
function capaWordmark(){
  return '<div style="display:inline-flex;align-items:center;background:rgba(5,6,10,.82);border:2px solid rgba(166,255,46,.55);padding:8px 16px;">'
    + '<div style="display:flex;color:#fff;font-size:27px;font-weight:800;letter-spacing:2px;">Promo<span style="color:' + GREEN + ';">Liso</span></div></div>';
}
// Wordmark sem caixa, só com sombra — pra composição mais limpa.
function capaWordmarkLimpo(){
  return '<div style="display:flex;color:#fff;font-size:30px;font-weight:800;letter-spacing:2px;text-shadow:0 3px 14px rgba(0,0,0,.9);">Promo<span style="color:' + GREEN + ';">Liso</span></div>';
}

// Rodapé comum: assinatura + crédito da foto à esquerda, chamada de arraste à direita.
function capaRodape(credit){
  return '<div style="position:absolute;left:72px;right:72px;bottom:52px;display:flex;align-items:center;justify-content:space-between;color:' + MUT + ';font-size:22px;font-weight:700;letter-spacing:2px;">'
    + '<div style="display:flex;">@promoliso0 · FOTO ' + credit + '</div>'
    + '<div style="display:flex;font-family:' + DISPLAY + ';color:' + GREEN + ';font-size:30px;letter-spacing:4px;">ARRASTE →</div></div>';
}

// Quebra o título em linhas equilibradas e devolve também o corpo escolhido.
function capaLinhas(text, containerW, capMax, capMin, fator){
  const clean = String(text||'').replace(/[.\s]+$/,'');
  if(!clean) return { lines: [], size: capMin };
  const lines = balanceLines(clean, 15);
  return { lines: lines, size: fitSize(lines, containerW, capMax, capMin, fator || 0.46) };
}

// Fonte de origem da capa: a imagem do slide quando é URL, senão a capa da pauta.
function capaFonte(output){
  const slide = output.slides[0];
  return /^https:\/\//i.test(String(slide.imagem||'')) ? slide.imagem : output.capa;
}
function capaCredito(output){
  const slide = output.slides[0];
  return esc(slide.fonte_imagem || (output.fontes&&output.fontes[0]&&output.fontes[0].nome) || 'OFICIAL');
}
