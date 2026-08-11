// MODELO B — MARCA-TEXTO
// Cada linha do título vem dentro de um bloco chapado, a última em verde com texto escuro. A
// leitura não depende da foto: não existe degradê global, só uma sombra curta no rodapé pra
// assinatura. É o mais agressivo dos três e o único que garante contraste em foto clara —
// em troca, os blocos cobrem parte da imagem.

function capaTituloB(text, containerW, capMax, capMin){
  const t = capaLinhas(text, containerW, capMax, capMin, 0.50);
  if(!t.lines.length) return '';
  const padY = Math.round(t.size*0.12), padX = Math.round(t.size*0.16);
  const rows = t.lines.map(function(l,i){
    const ultima = i === t.lines.length-1;
    const fundo = ultima ? GREEN : 'rgba(5,6,10,.92)';
    const cor = ultima ? INK : '#fff';
    return '<div style="display:flex;background:' + fundo + ';color:' + cor + ';padding:' + padY + 'px ' + padX + 'px;">'
      + esc(l.toUpperCase()) + '</div>';
  }).join('');
  return '<div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;font-family:' + DISPLAY + ';'
    + 'font-weight:800;text-transform:uppercase;font-size:' + t.size + 'px;line-height:.86;letter-spacing:-1px;">'
    + rows + '</div>';
}

// Destaque no mesmo idioma dos blocos: tinta chapada, texto verde, sem moldura.
function capaDestaqueB(text, size){
  if(!String(text||'').trim()) return '';
  const s = size || 40;
  const mk = Math.max(9, Math.round(s*0.22));
  return '<div style="display:inline-flex;align-items:center;gap:14px;background:rgba(5,6,10,.92);padding:' + Math.round(s*0.30) + 'px ' + Math.round(s*0.42) + 'px;">'
    + '<span style="width:' + mk + 'px;height:' + mk + 'px;background:' + GREEN + ';display:block;flex:0 0 auto;"></span>'
    + '<span style="display:flex;color:#fff;font-family:' + DISPLAY + ';font-size:' + s + 'px;font-weight:800;letter-spacing:.5px;">'
    + esc(String(text).trim().toUpperCase()) + '</span></div>';
}

function buildCapa(output){
  const slide = output.slides[0];
  const source = capaFonte(output);
  const selo = slide.selo || output.categoria || 'NOTÍCIA';

  const html = `${STYLE}
<div style="width:1080px;height:1350px;position:relative;display:flex;overflow:hidden;background:${INK};font-family:Arial,Helvetica,sans-serif;">
  ${capaImg(source)}
  ${capaVinheta(0.5)}
  <div style="position:absolute;left:0;right:0;bottom:0;height:260px;display:flex;background:linear-gradient(180deg,rgba(5,6,10,0) 0,rgba(5,6,10,.82) 60%,#05060A 100%);"></div>
  ${grain()}
  ${slash()}

  <div style="position:absolute;left:72px;right:72px;top:50px;display:flex;align-items:center;">
    ${capaWordmark()}<div style="display:flex;margin-left:14px;">${kickerChip(selo)}</div>
  </div>

  <div style="position:absolute;left:64px;bottom:126px;display:flex;flex-direction:column;align-items:flex-start;width:952px;">
    ${capaTituloB(slide.titulo, 952, 112, 62)}
    ${slide.destaque ? '<div style="display:flex;margin-top:20px;">'+capaDestaqueB(slide.destaque, 40)+'</div>' : ''}
  </div>

  ${capaRodape(capaCredito(output))}
</div>`;
  return [{ json: { html, capaUsada: source, output } }];
}
