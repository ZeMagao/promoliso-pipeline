// PromoLiso — REDESIGN "TITAN" (Nvidia/ROG premium)
// Fundo #05060A + grain + glow, hero ANGULAR (clip-path canto cortado) com rim neon,
// titulo METALICO (gradiente branco->cinza) com ultima palavra verde + sublinhado roxo,
// kicker chip roxo, strip neon verde (marcador), sem HUD gamer (brackets/chevrons/barras).
// Preserva contratos: capa le output; slide le slide; CTA quando tipo==='cta'.
const fs = require('fs');
const path = require('path');
const http = require('http');
const OUT = __dirname;

const FONT = fs.readFileSync(path.join(OUT, 'asset_font.txt'), 'utf8');   // data: barlow condensed
const MASCOT = fs.readFileSync(path.join(OUT, 'asset_mascot.txt'), 'utf8');

// ---- tokens ----
const GREEN = '#A6FF2E', PURPLE = '#9A4DFF', INK = '#05060A';
const MUT = '#8791a0', BODY = '#c3cbd5', HAIR = '#1b1f27';
const DISPLAY = "PLDisplay,'Barlow Condensed',Impact,sans-serif";
const STYLE = `<style>@font-face{font-family:PLDisplay;src:url(${FONT}) format('truetype');font-weight:100 900;}</style>`;

function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// nitidez + qualidade (renderizador roda a 2x e faz downscale lanczos)
const QUAL = 'f_auto,q_auto:best,e_sharpen:60';
function cloud(source, transform){
  source = String(source||'');
  if(!/^https:\/\//i.test(source)) return '';
  if(/^https:\/\/res\.cloudinary\.com\/fy2n2qvr\//i.test(source)) return source;
  if(source.startsWith('https://image.mux.com/')) return source+(source.includes('?')?'&':'?')+'width=1600';
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/'+transform+'/'+encodeURIComponent(source);
}

// ---- tipografia balanceada (quebras intencionais + auto-fit) ----
function balanceLines(text, maxPerLine){
  const words = String(text||'').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  const longest = Math.max(...words.map(w=>w.length));
  const greedy = (max)=>{
    const out=[]; let cur='';
    for(const w of words){
      if(!cur) cur=w;
      else if((cur+' '+w).length<=max) cur+=' '+w;
      else { out.push(cur); cur=w; }
    }
    if(cur) out.push(cur);
    return out;
  };
  const natural = greedy(Math.max(maxPerLine, longest));
  const L = natural.length;
  let lo = longest, hi = Math.max(maxPerLine, longest), best = natural;
  while(lo <= hi){
    const mid = (lo+hi)>>1;
    const g = greedy(mid);
    if(g.length <= L){ best = g; hi = mid-1; } else lo = mid+1;
  }
  return best;
}
function fitSize(lines, containerW, capMax, capMin, factor){
  factor = factor || 0.50;
  const maxLen = Math.max(1, ...lines.map(l=>l.length));
  let s = Math.floor(containerW / (maxLen*factor));
  return Math.max(capMin, Math.min(capMax, s));
}
// auto-fit do CORPO: maior fonte (<=maxPx) em que o texto cabe na altura disponivel.
function fitBody(text, width, availH, maxPx, minPx){
  const chars = String(text||'').length;
  maxPx = maxPx||32; minPx = minPx||23;
  const lh = 1.36;
  for(let s=maxPx; s>minPx; s--){
    const cpl = Math.max(1, Math.floor(width/(s*0.50)));
    const lines = Math.max(1, Math.ceil(chars/cpl));
    if(lines*s*lh <= availH) return s;
  }
  return minPx;
}
// metricas do titulo (mesma logica de titleMetal) p/ calcular altura ocupada
function titleMetrics(text, containerW, capMax, capMin){
  const lines = balanceLines(String(text||'').replace(/[.\s]+$/,''), capMax>=100?15:17);
  const size = fitSize(lines, containerW, capMax, capMin);
  return { count: lines.length || 1, size };
}

// titulo SOLIDO: branco chapado, ultima palavra verde solida + sublinhado roxo
function titleMetal(text, containerW, capMax, capMin, accentLast){
  const clean = String(text||'').replace(/[.\s]+$/,'');
  if(!clean) return '';
  const lines = balanceLines(clean, capMax>=100?15:17);
  const size = fitSize(lines, containerW, capMax, capMin);
  const ul = Math.max(4, Math.round(size*0.07));
  const rows = lines.map((l,i)=>{
    if(accentLast!==false && i===lines.length-1){
      const parts = l.trim().split(' ');
      const last = parts.pop();
      const pre = parts.join(' ');
      const acc = `<span style="color:${GREEN};border-bottom:${ul}px solid ${PURPLE};">${esc(last.toUpperCase())}</span>`;
      return `<div style="display:flex;">${pre?esc(pre.toUpperCase())+'&nbsp;':''}${acc}</div>`;
    }
    return `<div style="display:flex;">${esc(l.toUpperCase())}</div>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;color:#fff;font-family:${DISPLAY};font-weight:800;text-transform:uppercase;font-size:${size}px;line-height:.88;letter-spacing:-1px;text-shadow:0 3px 16px rgba(0,0,0,.55);">${rows}</div>`;
}

// strip neon verde do destaque (marcador quadrado + borda + glow)
function stripDestaque(text, size){
  if(!String(text||'').trim()) return '';
  size = size || 46;
  const mk = Math.max(10, Math.round(size*0.24));
  const t = esc(String(text).trim().toUpperCase());
  return `<div style="display:inline-flex;align-items:center;gap:14px;border:2px solid rgba(166,255,46,.55);background:rgba(166,255,46,.07);color:#eaffd0;font-family:${DISPLAY};font-weight:800;letter-spacing:-.5px;font-size:${size}px;line-height:1;padding:12px 22px;"><span style="width:${mk}px;height:${mk}px;background:${GREEN};flex:0 0 auto;display:block;"></span><span style="display:flex;">${t}</span></div>`;
}

// kicker roxo (slides/CTA) e kicker linha verde (capa)
function kickerChip(text){
  return `<div style="display:inline-flex;background:${PURPLE};color:#fff;font-family:${DISPLAY};font-size:24px;letter-spacing:4px;padding:9px 18px;font-weight:800;">${esc(String(text||'').toUpperCase())}</div>`;
}
function kickerLine(text){
  return `<div style="display:flex;align-items:center;color:${GREEN};font-family:${DISPLAY};font-size:26px;font-weight:800;letter-spacing:5px;"><span style="width:40px;height:3px;background:${GREEN};margin-right:16px;display:block;"></span>${esc(String(text||'').toUpperCase())}</div>`;
}

// mascote (caricatura) - circulo pro canto do rodape (mantido, uso opcional)
function mascotAvatar(size){
  const b=Math.max(2,Math.round(size*0.045));
  return `<div style="width:${size}px;height:${size}px;position:relative;display:flex;overflow:hidden;border-radius:${size/2}px;border:${b}px solid ${GREEN};background:#120a1e;box-shadow:0 0 0 ${b}px ${PURPLE};flex:0 0 auto;"><img src="${MASCOT}" style="position:absolute;left:${-size*0.26}px;top:${-size*0.12}px;width:${size*1.5}px;height:${size*1.5}px;object-fit:contain;" /></div>`;
}

// Rotulo editorial: prefere o selo do agente; cai no fixo por tipo se vazio.
function kickerFor(tipo, selo){
  const map = { contexto:'O LANÇAMENTO', evidencia:'CONFIRMADO', impacto:'POR QUE IMPORTA', acao:'O QUE FAZER' };
  const s = String(selo||'').trim();
  return s || map[tipo] || 'NOTÍCIA';
}
// Tratamento de hero por papel editorial - mesma foto vira visuais distintos.
function treatmentFor(tipo, pagina){
  // fotos limpas (sem duotone/contain-letterbox): cover cheio + zoom sutil pra variar
  const map = { contexto:'full', evidencia:'detail', impacto:'full', acao:'detail' };
  if (map[tipo]) return map[tipo];
  const cycle = ['full','detail'];
  return cycle[(Number(pagina||2)-2+2)%2];
}

// ---- chrome TITAN ----
function grain(){
  return `<div style="position:absolute;inset:0;background-image:radial-gradient(circle at 1px 1px,rgba(255,255,255,.05) 1px,transparent 0);background-size:24px 24px;opacity:.5;"></div>`;
}
function glow(){
  return '';  // fundo 100% liso (sem brilho de atmosfera) — pedido do usuario
}
function slash(){
  return `<div style="position:absolute;left:0;top:0;width:1080px;height:8px;display:flex;"><div style="width:62%;height:100%;background:${GREEN};box-shadow:0 0 16px rgba(166,255,46,.35);"></div><div style="width:38%;height:100%;background:${PURPLE};box-shadow:0 0 16px rgba(154,77,255,.4);"></div></div>`;
}
function wordmark(){
  return `<div style="display:flex;color:#fff;font-size:30px;font-weight:800;letter-spacing:2px;">Promo<span style="color:${GREEN};text-shadow:0 0 16px rgba(166,255,46,.7);">Liso</span></div>`;
}
function tabPage(pg,total){
  return `<div style="display:flex;font-family:${DISPLAY};font-size:22px;letter-spacing:3px;color:${MUT};border:1px solid #2b303a;padding:8px 16px;"><span style="color:#fff;">${pg}</span>&nbsp;/&nbsp;${total}</div>`;
}
function tabLabel(txt){
  return `<div style="display:flex;font-family:${DISPLAY};font-size:22px;letter-spacing:5px;color:#cbd2da;border:1px solid #2b303a;padding:8px 16px;">${esc(String(txt||'').toUpperCase())}</div>`;
}
function titanHeader(right){
  return `<div style="position:absolute;left:72px;right:72px;top:50px;display:flex;align-items:center;justify-content:space-between;">${wordmark()}${right}</div>`;
}
function footer(rightText){
  return `<div style="position:absolute;left:72px;right:72px;bottom:56px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${HAIR};padding-top:20px;color:${MUT};font-size:22px;font-weight:700;letter-spacing:2px;"><div style="display:flex;">@promoliso0</div><div style="display:flex;font-family:${DISPLAY};color:${GREEN};font-size:30px;letter-spacing:4px;text-shadow:0 0 14px rgba(166,255,46,.5);">${rightText||'ARRASTE →'}</div></div>`;
}

// hero ANGULAR (canto inferior direito cortado) + rim neon verde + credito
function heroAngular(inner, x, y, W, H, credit, cut){
  cut = cut || 46;
  const clip = `polygon(0 0,${W}px 0,${W}px ${H-cut}px,${W-cut}px ${H}px,0 ${H}px)`;
  const creditTag = credit ? `<div style="position:absolute;left:0;bottom:0;background:rgba(5,6,10,.8);color:#c9cfd7;font-size:15px;font-weight:700;letter-spacing:2px;padding:8px 14px;">${credit}</div>` : '';
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:${W}px;height:${H}px;overflow:hidden;background:#0a0c12;clip-path:${clip};filter:drop-shadow(0 0 30px rgba(154,77,255,.30));">`
    + inner
    + `<div style="position:absolute;inset:0;border:2px solid rgba(166,255,46,.35);clip-path:${clip};"></div>`
    + creditTag + `</div>`;
}
function heroBoxTitan(source, treatment, credit, x, y, W, H){
  const SW=Math.round(W*1.6), SH=Math.round(H*1.6);
  const cover=(t)=>`<img src="${cloud(source,t)}" style="position:absolute;inset:0;width:${W}px;height:${H}px;object-fit:cover;filter:contrast(1.05) saturate(1.04);" />`;
  if (treatment==='detail'){
    return heroAngular(cover(`c_thumb,g_auto,z_1.3,w_${SW},h_${SH},${QUAL}`), x,y,W,H, credit);
  }
  if (treatment==='duotone'){
    return heroAngular(
      `<img src="${cloud(source,`c_fill,g_auto,e_grayscale,w_${SW},h_${SH},${QUAL}`)}" style="position:absolute;inset:0;width:${W}px;height:${H}px;object-fit:cover;filter:contrast(1.1);" />`+
      `<div style="position:absolute;inset:0;background:${GREEN};mix-blend-mode:multiply;opacity:.34;"></div>`+
      `<div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 15%,${PURPLE},transparent 55%);mix-blend-mode:screen;opacity:.5;"></div>`,
      x,y,W,H, credit);
  }
  if (treatment==='contain'){
    const bg = cloud(source, `c_fill,g_auto,w_${SW},h_${SH},${QUAL}`);
    const fg = cloud(source, `c_fit,w_${Math.round((W-40)*1.6)},h_${Math.round((H-40)*1.6)},${QUAL}`);
    return heroAngular(
      `<img src="${bg}" style="position:absolute;inset:-30px;width:${W+60}px;height:${H+60}px;object-fit:cover;filter:blur(26px) brightness(.4) saturate(1.25);transform:scale(1.06);" />`+
      `<img src="${fg}" style="position:absolute;inset:0;width:${W}px;height:${H}px;object-fit:contain;filter:drop-shadow(0 12px 22px rgba(0,0,0,.6));" />`,
      x,y,W,H, credit);
  }
  return heroAngular(cover(`c_fill,g_auto,w_${SW},h_${SH},${QUAL}`), x,y,W,H, credit);
}

function bgLayer(){
  return `<div style="position:absolute;inset:0;background:#0B0C0F;"></div>`;
}

// ---------- SLIDE DE CONTEUDO ----------
function buildSlide(slide){
  if (slide.tipo === 'cta') return buildCta(slide);
  const pagina = String(slide.pagina||2).padStart(2,'0');
  const total = String(slide.total||6).padStart(2,'0');
  const kicker = kickerFor(slide.tipo, slide.selo);
  const texto = esc(slide.texto||'');
  const credit = 'FOTO · '+esc(slide.fonte_imagem||'OFICIAL');
  const treatment = treatmentFor(slide.tipo, slide.pagina);
  const source = /^https:\/\//i.test(String(slide.imagem||'')) ? slide.imagem : slide.capaFallback;

  const HX=72, HY=130, HW=936, HH=452, CW=936;
  const T_MAX=80, T_MIN=48, BLOCK_TOP=600, BLOCK_BOT=118;
  const tm = titleMetrics(slide.titulo, CW, T_MAX, T_MIN);
  const titleH = tm.count * tm.size * 0.9;
  const stripH = slide.destaque ? 44*1.2 + 24 : 0;             // strip + margin
  const used = 42 + 20 + titleH + 18 + stripH + 24;            // kicker+gaps+title+strip
  const availText = (1350 - BLOCK_TOP - BLOCK_BOT) - used;
  const bodySize = fitBody(slide.texto, CW, Math.max(80, availText), 32, 23);

  const html = `${STYLE}
<div style="width:1080px;height:1350px;position:relative;display:flex;overflow:hidden;background:${INK};font-family:Arial,Helvetica,sans-serif;">
  ${bgLayer()}${grain()}${glow()}${slash()}
  ${titanHeader(tabPage(pagina,total))}
  ${heroBoxTitan(source, treatment, credit, HX,HY,HW,HH)}

  <div style="position:absolute;left:72px;right:72px;top:${BLOCK_TOP}px;bottom:${BLOCK_BOT}px;display:flex;flex-direction:column;overflow:hidden;">
    <div style="display:flex;">${kickerChip(kicker)}</div>
    <div style="display:flex;margin-top:20px;">${titleMetal(slide.titulo, CW, T_MAX, T_MIN)}</div>
    <div style="display:flex;margin-top:18px;">${stripDestaque(slide.destaque, 44)}</div>
    <div style="display:flex;margin-top:24px;color:${BODY};font-size:${bodySize}px;line-height:1.36;">${texto}</div>
  </div>

  ${footer('ARRASTE →')}
</div>`;
  return [{ json: { html, slide } }];
}

// ---------- CAPA ----------
function buildCapa(output){
  const slide = output.slides[0];
  const source = /^https:\/\//i.test(String(slide.imagem||'')) ? slide.imagem : output.capa;
  const kicker = output.categoria || slide.selo || 'NOTÍCIA';
  const credit = esc(slide.fonte_imagem || (output.fontes&&output.fontes[0]&&output.fontes[0].nome) || 'OFICIAL');
  function subCap(t){ t=String(t||'').trim(); const dot=t.search(/[.!?]\s/); if(dot>0&&dot<=95) return t.slice(0,dot+1); if(t.length<=92) return t; let c=t.slice(0,92); const sp=c.lastIndexOf(' '); return (sp>50?c.slice(0,sp):c).replace(/[\s,;:]+$/,'')+'…'; }
  const subtitulo = esc(slide.subtitulo || subCap(slide.texto) || slide.destaque);

  const HX=72, HY=124, HW=936, HH=520, CW=936;
  const T_MAX=90, T_MIN=54, BLOCK_TOP=700, BLOCK_BOT=150;
  const tm = titleMetrics(slide.titulo, CW, T_MAX, T_MIN);
  const titleH = tm.count * tm.size * 0.9;
  const stripH = slide.destaque ? 52*1.2 + 24 : 0;
  const used = 34 + 22 + titleH + 24 + stripH;
  const availDek = (1350 - BLOCK_TOP - BLOCK_BOT) - used;
  const dekSize = fitBody(subtitulo, 930, Math.max(60, availDek), 30, 22);

  const html = `${STYLE}
<div style="width:1080px;height:1350px;position:relative;display:flex;overflow:hidden;background:${INK};font-family:Arial,Helvetica,sans-serif;">
  ${bgLayer()}${grain()}${glow()}${slash()}
  ${titanHeader(tabLabel(kicker))}
  ${heroBoxTitan(source, 'full', 'FOTO · '+credit, HX,HY,HW,HH)}

  <div style="position:absolute;left:72px;right:72px;top:${BLOCK_TOP}px;bottom:${BLOCK_BOT}px;display:flex;flex-direction:column;overflow:hidden;">
    <div style="display:flex;">${kickerLine(slide.selo || kicker)}</div>
    <div style="display:flex;margin-top:22px;">${titleMetal(slide.titulo, CW, T_MAX, T_MIN)}</div>
    <div style="display:flex;margin-top:24px;">${stripDestaque(slide.destaque, 52)}</div>
    <div style="display:flex;width:930px;margin-top:24px;color:${BODY};font-size:${dekSize}px;line-height:1.34;">${subtitulo}</div>
  </div>

  ${footer('ARRASTE →')}
</div>`;
  return [{ json: { html, capaUsada: source, output } }];
}

// ---------- CTA (preenche a altura toda) ----------
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

// ---------- runner ----------
function render(html, w, h, outFile){
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({html,width:w,height:h,quality:95,scale:2});
    const req=http.request({host:'127.0.0.1',port:5680,path:'/render',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
      const ch=[];res.on('data',c=>ch.push(c));res.on('end',()=>{const b=Buffer.concat(ch);if(res.statusCode!==200){reject(new Error('HTTP '+res.statusCode+' '+b.toString().slice(0,300)));return;}fs.writeFileSync(path.join(OUT,outFile),b);console.log('WROTE',outFile,b.length,'bytes',res.headers['x-render-time-ms']+'ms');resolve();});
    });
    req.on('error',reject);req.write(body);req.end();
  });
}

if (require.main===module){(async()=>{
  const output=JSON.parse(fs.readFileSync(path.join(OUT, process.argv[2]||'exec87_output.json'),'utf8'));
  const p=process.argv[3]||'titan';
  await render(buildCapa(output)[0].json.html,1080,1350,`${p}_1_capa.jpg`);
  const tipos=['contexto','evidencia','impacto','acao'];
  for(let i=0;i<4;i++){
    const s={...output.slides[i+1],pagina:i+2,total:6,capaFallback:output.capa,tipo:tipos[i]};
    await render(buildSlide(s)[0].json.html,1080,1350,`${p}_${i+2}_slide.jpg`);
  }
  await render(buildSlide({tipo:'cta',total:6})[0].json.html,1080,1350,`${p}_6_cta.jpg`);
  console.log('done');
})().catch(e=>{console.error('ERR',e);process.exit(1);});}

module.exports={buildCapa,buildSlide};
