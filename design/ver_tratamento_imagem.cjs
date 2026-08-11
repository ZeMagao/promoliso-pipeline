// Página de decisão do tratamento da imagem de capa quando a foto não alcança o piso.
// Usa os mocks da row 36 (foto real de 1200x675) embutidos como data URI.
//
//   node design/capa_mock_fallback.cjs
//   node design/shot.cjs --mini mock_pad mock_borrado mock_piso675
//   node design/ver_tratamento_imagem.cjs
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const OUT = __dirname;

const OPCOES = [
  {
    id: 'pad',
    nome: 'Como está no ar',
    chamada: 'Foto contida sobre a cor da marca.',
    detalhe: 'É o que a row 36 produziu. A foto ocupa o topo e o resto é preto chapado. Lê como defeito, não como escolha — foi o que motivou esta página.',
    veredito: 'ruim',
  },
  {
    id: 'borrado',
    nome: 'Fundo borrado',
    chamada: 'A própria foto, ampliada e desfocada, preenche o resto.',
    detalhe: 'A foto nítida fica contida e puxada pro alto; atrás dela, uma cópia borrada cobre a tela. Nada é esticado, então não há perda de nitidez. Custa uma segunda busca de imagem no renderizador. É o mesmo tratamento que o heroBoxTitan já usa nos slides.',
    veredito: 'bom',
  },
  {
    id: 'piso675',
    nome: 'Baixar o piso para 675',
    chamada: 'A foto passa a preencher o quadro inteiro.',
    detalhe: 'Com o piso em ih ≥ 675, uma foto 1200×675 entra em tela cheia. O recorte 4:5 usa 540×675 e sobe 2,00× até 1080×1350 — mais mole que o corte de hoje, mas com e_sharpen aguenta. É o que entrega o objetivo original: a capa É a imagem.',
    veredito: 'bom',
  },
];

const MEDICAO = [
  ['ih ≥ 900', '10%'],
  ['ih ≥ 800 &nbsp;(hoje)', '17%'],
  ['ih ≥ 720', '18%'],
  ['ih ≥ 675', '30%'],
  ['ih ≥ 600', '33%'],
];

const uri = (f) => {
  const p = path.join(OUT, f);
  return fs.existsSync(p) ? 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64') : null;
};

const cartao = (o) => {
  const d = uri(`shot_mini_mock_${o.id}.jpg`);
  return `<article class="opcao opcao--${o.veredito}">
      <header>
        <h2>${o.nome}</h2>
        <p class="chamada">${o.chamada}</p>
      </header>
      ${d ? `<img src="${d}" alt="Capa: ${o.nome}" width="540" height="675" loading="lazy">`
          : '<div class="placa">sem render</div>'}
      <p class="detalhe">${o.detalhe}</p>
    </article>`;
};

const page = `<title>Capa — tratamento da imagem sub-piso</title>
<style>
  :root{
    --ground:#F5F6F3; --surface:#FFFFFF; --sunken:#ECEEE8;
    --hairline:#D8DBD2; --ink:#14161B; --ink-mute:#5F6670;
    --verde:#4F8A00; --roxo:#6B2FD6; --marca-verde:#A6FF2E; --marca-roxo:#9A4DFF;
    --ruim:#B0341A; --tinta-foto:#0B0C0F;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#0B0C0F; --surface:#141720; --sunken:#0F1116;
      --hairline:#252A34; --ink:#E4E8EE; --ink-mute:#8A93A2;
      --verde:#A6FF2E; --roxo:#B98BFF; --ruim:#FF7A5C;
    }
  }
  :root[data-theme="dark"]{
    --ground:#0B0C0F; --surface:#141720; --sunken:#0F1116;
    --hairline:#252A34; --ink:#E4E8EE; --ink-mute:#8A93A2;
    --verde:#A6FF2E; --roxo:#B98BFF; --ruim:#FF7A5C;
  }
  *,*::before,*::after{box-sizing:border-box;}
  body{margin:0; background:var(--ground); color:var(--ink);
    font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased;}
  .envelope{max-width:1180px; margin:0 auto; padding:clamp(28px,5vw,72px) clamp(18px,4vw,40px) 96px;}
  .regua{display:flex; height:6px; margin-bottom:clamp(26px,4vw,44px);}
  .regua i{display:block; height:100%;}
  .regua i:first-child{width:62%; background:var(--marca-verde);}
  .regua i:last-child{width:38%; background:var(--marca-roxo);}
  h1,h2,.capitular,th{font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;
    text-transform:uppercase; font-weight:700;}
  .capitular{font-size:12px; letter-spacing:.18em; color:var(--ink-mute);}
  h1{font-size:clamp(32px,5.4vw,54px); line-height:1; margin:10px 0 14px; letter-spacing:.02em; text-wrap:balance;}
  .linha-fina{max-width:66ch; color:var(--ink-mute); margin:0;}
  .achado{margin-top:26px; border-left:3px solid var(--ruim); background:var(--surface);
    padding:16px 20px; max-width:72ch;}
  .achado b{color:var(--ink);}

  .grade{display:grid; gap:clamp(16px,2vw,26px); margin-top:clamp(40px,6vw,64px);
    grid-template-columns:repeat(auto-fit,minmax(280px,1fr));}
  .opcao{display:flex; flex-direction:column; gap:12px; background:var(--surface);
    border:1px solid var(--hairline); padding:20px;}
  .opcao--bom{border-color:var(--verde);}
  .opcao--ruim{opacity:.82;}
  .opcao h2{font-size:18px; letter-spacing:.06em; margin:0;}
  .opcao--ruim h2{color:var(--ruim);}
  .chamada{margin:6px 0 0; font-size:15px;}
  .opcao img{display:block; width:100%; height:auto; background:var(--tinta-foto);
    border:1px solid var(--hairline);}
  .detalhe{margin:0; font-size:14px; color:var(--ink-mute);}
  .placa{aspect-ratio:1080/1350; display:grid; place-items:center; border:1px dashed var(--hairline);
    color:var(--ink-mute); font-size:13px;}

  .medicao{margin-top:clamp(48px,7vw,80px); border-top:1px solid var(--hairline); padding-top:28px;}
  .medicao h2{font-size:clamp(19px,2.4vw,26px); letter-spacing:.06em; margin:0 0 12px;}
  .medicao p{max-width:70ch; color:var(--ink-mute); margin:0 0 20px;}
  table{border-collapse:collapse; font-size:15px;}
  th,td{text-align:left; padding:8px 26px 8px 0; border-bottom:1px solid var(--hairline);}
  th{font-size:11px; letter-spacing:.14em; color:var(--ink-mute);}
  td.n{font-variant-numeric:tabular-nums;}
  tr.destaque td{color:var(--verde); font-weight:600;}
  code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.9em;
    background:var(--sunken); padding:1px 5px; border:1px solid var(--hairline);}
  .rodape{margin-top:48px; border-top:1px solid var(--hairline); padding-top:20px;
    color:var(--ink-mute); font-size:13px;}
</style>

<div class="envelope">
  <div class="regua"><i></i><i></i></div>
  <p class="capitular">PromoLiso · capa do carrossel · 11 ago 2026</p>
  <h1>A foto não alcança<br>o piso. E agora?</h1>
  <p class="linha-fina">A primeira capa renderizada em produção (row 36, “War in the North”) saiu com tarja preta: a foto de origem tem 1200×675 e reprovou no piso de <code>ih ≥ 800</code>. Os três tratamentos abaixo usam a <strong>mesma foto real</strong>, para comparação justa.</p>

  <p class="achado">O piso foi escolhido no chute, justificado com “1,69× de ampliação”, sem medir o estoque. <b>1200×675 é o formato mais comum de imagem de matéria</b> — e reprova por 125 pixels de altura.</p>

  <div class="grade">
    ${OPCOES.map(cartao).join('\n    ')}
  </div>

  <section class="medicao">
    <h2>O que a medição diz</h2>
    <p>60 URLs candidatas dos últimos 40 registros de curadoria, dimensões consultadas no próprio Cloudinary — a mesma fonte que o gate usa. Ressalva: a amostra inclui thumbnail de post relacionado, que nunca viraria capa, então a taxa real de aprovação é maior que a da tabela. O que não muda é o corte em 675.</p>
    <table>
      <tr><th>piso de altura</th><th>passa em tela cheia</th></tr>
      ${MEDICAO.map(([p, v]) => `<tr${p.includes('675') ? ' class="destaque"' : ''}><td>${p}</td><td class="n">${v}</td></tr>`).join('\n      ')}
    </table>
  </section>

  <p class="rodape">Mocks gerados de <code>design/capa_mock_fallback.cjs</code>, a partir do jsCode que está no ar e do output editorial real da execução 261.</p>
</div>
`;

const destino = path.join(OUT, 'ver_tratamento_imagem.html');
fs.writeFileSync(destino, page);
console.log('WROTE ver_tratamento_imagem.html', (page.length / 1e6).toFixed(2) + ' MB');
if (!process.argv.includes('--no-abrir')) {
  execFile('cmd', ['/c', 'start', '', destino], (e) => e && console.log('abra à mão:', destino));
}
