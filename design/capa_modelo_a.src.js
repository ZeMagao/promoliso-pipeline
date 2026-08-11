// MODELO A — DEGRADÊ
// A foto ocupa a tela e o rodapé escurece num degradê contínuo. Selo roxo e wordmark lado a lado,
// título grande com contorno preto (a foto pode ter região clara embaixo e a sombra sozinha não
// segura a leitura). É o que mais preserva a foto: nenhum bloco chapado cobre imagem.

function capaTituloA(text, containerW, capMax, capMin){
  const t = capaLinhas(text, containerW, capMax, capMin);
  if(!t.lines.length) return '';
  const stroke = Math.max(3, Math.round(t.size*0.045));
  const ul = Math.max(4, Math.round(t.size*0.07));
  const rows = t.lines.map(function(l,i){
    if(i===t.lines.length-1){
      const parts = l.trim().split(' ');
      const last = parts.pop();
      const pre = parts.join(' ');
      const acc = '<span style="color:' + GREEN + ';border-bottom:' + ul + 'px solid ' + PURPLE + ';">' + esc(last.toUpperCase()) + '</span>';
      return '<div style="display:flex;">' + (pre ? esc(pre.toUpperCase()) + '&nbsp;' : '') + acc + '</div>';
    }
    return '<div style="display:flex;">' + esc(l.toUpperCase()) + '</div>';
  }).join('');
  return '<div style="display:flex;flex-direction:column;color:#fff;font-family:' + DISPLAY + ';font-weight:800;'
    + 'text-transform:uppercase;font-size:' + t.size + 'px;line-height:.90;letter-spacing:-1px;'
    + '-webkit-text-stroke:' + stroke + 'px ' + INK + ';paint-order:stroke fill;'
    + 'text-shadow:0 6px 24px rgba(0,0,0,.85);">' + rows + '</div>';
}

function buildCapa(output){
  const slide = output.slides[0];
  const source = capaFonte(output);
  const selo = slide.selo || output.categoria || 'NOTÍCIA';

  // O subtítulo saiu da capa de propósito: a capa agora é gancho, não resumo. O texto continua
  // no slide 2, que é o primeiro que a pessoa vê ao arrastar.
  const html = `${STYLE}
<div style="width:1080px;height:1350px;position:relative;display:flex;overflow:hidden;background:${INK};font-family:Arial,Helvetica,sans-serif;">
  ${capaImg(source)}
  ${capaVinheta()}
  ${capaScrim(38)}
  ${grain()}
  ${slash()}

  <div style="position:absolute;left:64px;bottom:126px;display:flex;flex-direction:column;width:952px;">
    <div style="display:flex;align-items:center;">${kickerChip(selo)}<div style="display:flex;margin-left:14px;">${capaWordmark()}</div></div>
    <div style="display:flex;margin-top:22px;">${capaTituloA(slide.titulo, 952, 118, 66)}</div>
    ${slide.destaque ? '<div style="display:flex;margin-top:26px;">'+stripDestaque(slide.destaque, 46)+'</div>' : ''}
  </div>

  ${capaRodape(capaCredito(output))}
</div>`;
  return [{ json: { html, capaUsada: source, output } }];
}
