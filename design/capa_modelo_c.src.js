// MODELO C — EDITORIAL
// Menos elementos: sem chip roxo, sem contorno no título, sem moldura no destaque. O degradê sobe
// mais alto e mais suave, a chamada vira uma linha fina verde e a marca fica solta no topo. É o
// mais silencioso dos três — dá mais espaço pra foto e confia nela pra prender o olho.

function capaTituloC(text, containerW, capMax, capMin){
  const t = capaLinhas(text, containerW, capMax, capMin);
  if(!t.lines.length) return '';
  const rows = t.lines.map(function(l,i){
    if(i===t.lines.length-1){
      const parts = l.trim().split(' ');
      const last = parts.pop();
      const pre = parts.join(' ');
      const acc = '<span style="color:' + GREEN + ';">' + esc(last.toUpperCase()) + '</span>';
      return '<div style="display:flex;">' + (pre ? esc(pre.toUpperCase()) + '&nbsp;' : '') + acc + '</div>';
    }
    return '<div style="display:flex;">' + esc(l.toUpperCase()) + '</div>';
  }).join('');
  return '<div style="display:flex;flex-direction:column;color:#fff;font-family:' + DISPLAY + ';font-weight:800;'
    + 'text-transform:uppercase;font-size:' + t.size + 'px;line-height:.92;letter-spacing:-1.5px;'
    + 'text-shadow:0 4px 30px rgba(0,0,0,.9);">' + rows + '</div>';
}

// Destaque sem moldura: barra verde à esquerda e texto claro, no ritmo de legenda de revista.
function capaDestaqueC(text, size){
  if(!String(text||'').trim()) return '';
  const s = size || 34;
  return '<div style="display:flex;align-items:center;">'
    + '<span style="width:5px;height:' + Math.round(s*1.4) + 'px;background:' + GREEN + ';display:block;flex:0 0 auto;"></span>'
    + '<span style="display:flex;margin-left:18px;color:#e8edf3;font-family:' + DISPLAY + ';font-size:' + s + 'px;font-weight:700;letter-spacing:1px;text-shadow:0 2px 12px rgba(0,0,0,.9);">'
    + esc(String(text).trim().toUpperCase()) + '</span></div>';
}

function buildCapa(output){
  const slide = output.slides[0];
  const source = capaFonte(output);
  const selo = slide.selo || output.categoria || 'NOTÍCIA';

  const html = `${STYLE}
<div style="width:1080px;height:1350px;position:relative;display:flex;overflow:hidden;background:${INK};font-family:Arial,Helvetica,sans-serif;">
  ${capaImg(source)}
  ${capaVinheta(0.3)}
  ${capaScrim(30)}
  ${grain()}
  ${slash()}

  <div style="position:absolute;left:72px;top:52px;display:flex;">${capaWordmarkLimpo()}</div>

  <div style="position:absolute;left:72px;bottom:130px;display:flex;flex-direction:column;width:936px;">
    <div style="display:flex;">${kickerLine(selo)}</div>
    <div style="display:flex;margin-top:26px;">${capaTituloC(slide.titulo, 936, 122, 68)}</div>
    ${slide.destaque ? '<div style="display:flex;margin-top:28px;">'+capaDestaqueC(slide.destaque, 34)+'</div>' : ''}
  </div>

  ${capaRodape(capaCredito(output))}
</div>`;
  return [{ json: { html, capaUsada: source, output } }];
}
