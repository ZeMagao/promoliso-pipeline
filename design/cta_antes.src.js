// O buildCta que estava no ar ATE 12/08/2026 18:21 BRT (antes do versionId 09b70099).
// Guardado porque o harness precisa dele: depois do deploy o export ja vem patchado, e sem
// esta copia nao existe com o que comparar para provar que a arte nao mudou.
// Ver design/patch_cta_contextual.cjs e design/test_cta_contextual.cjs.
function buildCta(slide){
  const total = String(slide.total||6).padStart(2,'0');
  const html = `${STYLE}
<div style="width:1080px;height:1350px;position:relative;display:flex;overflow:hidden;background:${INK};font-family:Arial,Helvetica,sans-serif;">
  ${bgLayer()}${grain()}${glow()}${slash()}
  ${titanHeader(tabPage('06',total))}

  <div style="position:absolute;left:72px;right:470px;top:250px;display:flex;flex-direction:column;">
    <div style="display:flex;">${kickerChip('SÓ QUEM SEGUE VÊ 1º')}</div>
    <div style="display:flex;margin-top:24px;">${titleMetal('Entre no grupo de OFERTAS', 540, 118, 72)}</div>
    <div style="display:flex;margin-top:30px;color:${BODY};font-size:30px;line-height:1.36;width:470px;">As melhores promoções de games e hardware caem primeiro no grupo — e as notícias antes de todo mundo.</div>
    <div style="display:flex;margin-top:36px;">${stripDestaque('LINK NA BIO ↗', 46)}</div>
    <div style="display:flex;margin-top:24px;color:#fff;font-size:30px;font-weight:800;letter-spacing:1px;">@promoliso0</div>
  </div>

  <img src="${MASCOT}" style="position:absolute;right:-24px;bottom:0;width:540px;height:560px;object-fit:contain;object-position:right bottom;filter:drop-shadow(0 16px 22px rgba(0,0,0,.7));" />
</div>`;
  return [{ json: { html, slide } }];
}
