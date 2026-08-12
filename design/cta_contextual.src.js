// CTA CONTEXTUAL — o slide 06 passa a renderizar o que o slide traz, não texto literal cravado.
//
// O `Edit Fields` já injeta o slide de CTA com selo/titulo/destaque/texto preenchidos, e o
// buildCta() de hoje ignora os quatro: renderiza os literais de baixo. Aqui eles viram DEFAULT —
// campo vazio cai neles, campo preenchido vence. Enquanto o agente não gerar `output.cta`, a saída
// é byte a byte a de hoje (é o que design/test_cta_contextual.cjs prova).
//
// O que NÃO é editorial e por isso continua cravado: o `@promoliso0` (identidade da conta) e o
// mascote. O agente escreve o convite, não a assinatura.
//
// Os limites vêm MEDIDOS de design/limites_cta.json (design/medir_limites_cta.cjs). São os MESMOS
// que os outros slides já usam (LIMITES do validador: 22/42/38/300) com UMA exceção medida: o
// destaque cai de 38 para 19. Motivo: a strip do destaque é larga (46 px de fonte) e a tinta do
// mascote começa em x=580 — 22 caracteres já chegam a x=595 e encostam nele assim que o corpo
// empurra a strip para baixo de y=807. O corte aqui é a última linha de defesa; recusar texto
// grande é trabalho do validador (passo 5 do plano).
const CTA_LIM = { selo: 22, titulo: 42, destaque: 19, texto: 300 };

// DUAS travas de CSS que o buildCta de hoje não tinha, porque hoje o texto é literal e o problema
// não existia. Com texto do agente, existe:
//
//   overflow-wrap:anywhere  — token único e longo (uma URL, um "PROMOÇÃOOOOO") não quebra linha
//   no bloco e sai correndo pela largura. Medido antes da trava: 8567 px de largura.
//
//   max-width:496px na linha da strip — o destaque é o único elemento largo que o corpo consegue
//   empurrar para baixo da altura do mascote (tinta em x=580). Com o teto, a strip não alcança o
//   mascote com conteúdo NENHUM: 72+496 = 568, que é a folga de 12 px. Vira garantia de estrutura,
//   não promessa de contagem de caractere. Hoje a strip mede 380 px, então nada muda.
//
// O que continua sendo aposta e não garantia: a ALTURA. Contagem de caractere é proxy ruim de
// pixel — 300 caracteres de prosa medem 1287 px de bloco, e 300 letras "W" medem 1959. Texto assim
// não sai de um modelo escrevendo português, e quem tem que recusar é o validador (passo 5).

// Guarda de LAYOUT, não régua editorial: quem devia recusar texto grande é o validador (o
// `limitar()` de lá, com fronteira de frase). Aqui só garante que nada estoure o slide. O '…' entra
// DENTRO do limite — a medição usa strings de exatamente `limite` caracteres, e devolver
// limite+1 fazia a strip do destaque encostar no mascote justamente no caso que o corte deveria
// salvar.
function ctaCampo(valor, padrao, limite) {
  const t = String(valor == null ? '' : valor).trim();
  const base = t || padrao;
  if (base.length <= limite) return base;
  const janela = base.slice(0, Math.max(1, limite - 1));
  const espaco = janela.lastIndexOf(' ');
  const corte = espaco > limite * 0.6 ? janela.slice(0, espaco) : janela;
  return corte.replace(/[\s.,;:!?—-]+$/, '') + '…';
}

function buildCta(slide){
  const total = String(slide.total||6).padStart(2,'0');
  // era '06' cravado. Hoje dá exatamente '06'; deixa de mentir quando a quantidade variar (passo 6).
  const pagina = String(slide.pagina||6).padStart(2,'0');
  const selo = ctaCampo(slide.selo, 'SÓ QUEM SEGUE VÊ 1º', CTA_LIM.selo);
  const titulo = ctaCampo(slide.titulo, 'Entre no grupo de OFERTAS', CTA_LIM.titulo);
  const destaque = ctaCampo(slide.destaque, 'LINK NA BIO ↗', CTA_LIM.destaque);
  const texto = ctaCampo(slide.texto, 'As melhores promoções de games e hardware caem primeiro no grupo — e as notícias antes de todo mundo.', CTA_LIM.texto);
  // esc() no corpo: o literal de hoje era interpolado cru, o que deixaria HTML do agente entrar no
  // slide. Nos outros campos quem escapa é o kickerChip/titleMetal/stripDestaque.
  const html = `${STYLE}
<div style="width:1080px;height:1350px;position:relative;display:flex;overflow:hidden;background:${INK};font-family:Arial,Helvetica,sans-serif;">
  ${bgLayer()}${grain()}${glow()}${slash()}
  ${titanHeader(tabPage(pagina,total))}

  <div style="position:absolute;left:72px;right:470px;top:250px;display:flex;flex-direction:column;overflow-wrap:anywhere;">
    <div style="display:flex;">${kickerChip(selo)}</div>
    <div style="display:flex;margin-top:24px;">${titleMetal(titulo, 540, 118, 72)}</div>
    <div style="display:flex;margin-top:30px;color:${BODY};font-size:30px;line-height:1.36;width:470px;">${esc(texto)}</div>
    <div style="display:flex;margin-top:36px;max-width:496px;">${stripDestaque(destaque, 46)}</div>
    <div style="display:flex;margin-top:24px;color:#fff;font-size:30px;font-weight:800;letter-spacing:1px;">@promoliso0</div>
  </div>

  <img src="${MASCOT}" style="position:absolute;right:-24px;bottom:0;width:540px;height:560px;object-fit:contain;object-position:right bottom;filter:drop-shadow(0 16px 22px rgba(0,0,0,.7));" />
</div>`;
  return [{ json: { html, slide } }];
}
