// Contact sheet dos recortes 4:5 por modo de gravidade do Cloudinary.
// O recorte importa muito com o piso em 675: de uma foto 1200x675 sobram 540x675, ou seja,
// 45% da largura. Onde ele corta decide se o assunto fica ou some.
//
//   node design/comparar_gravidade.cjs && node design/shot.cjs gravidade
const fs = require('fs');
const path = require('path');

const FOTOS = [
  ['arqueiro fora do centro (1200x675)', 'https://www.adrenaline.com.br/wp-content/uploads/2026/08/Lord-Rings-War-North-Remaster-Aspyr-01.jpg'],
  ['rosto (2048x1152)', 'https://live.staticflickr.com/65535/55426789530_e1f92a0f12_k.jpg'],
  ['produto centrado', 'https://www.adrenaline.com.br/wp-content/uploads/2026/07/gmktec-neo-x1-pro-pc-compacto-01.jpg'],
];
const GRAVIDADES = ['g_auto', 'g_auto:subject', 'g_auto:faces', 'g_center'];

const url = (src, g) => 'https://res.cloudinary.com/fy2n2qvr/image/fetch/e_trim:10/c_fill,' + g
  + ',w_864,h_1080/f_auto,q_auto:best,e_sharpen:60/' + encodeURIComponent(src);

const linhas = FOTOS.map(([rot, src]) => `
  <section>
    <h2>${rot}</h2>
    <div class="fila">
      ${GRAVIDADES.map((g) => `<figure><figcaption>${g}</figcaption><img src="${url(src, g)}"></figure>`).join('')}
    </div>
  </section>`).join('');

fs.writeFileSync(path.join(__dirname, 'capa_gravidade.html'), `<!doctype html><meta charset="utf-8">
<div style="width:1080px;background:#0B0C0F;color:#e4e8ee;font:14px system-ui,Arial;padding:18px;">
<style>
  section{margin-bottom:18px;}
  h2{font:700 13px/1 Arial;letter-spacing:2px;text-transform:uppercase;color:#A6FF2E;margin:0 0 8px;}
  .fila{display:flex;gap:10px;}
  figure{margin:0;flex:1;display:flex;flex-direction:column;gap:5px;}
  figcaption{font:700 10px/1 Arial;letter-spacing:1px;color:#8A93A2;}
  img{width:100%;height:auto;display:block;border:1px solid #252A34;}
</style>
${linhas}
</div>`);
console.log('WROTE capa_gravidade.html');
