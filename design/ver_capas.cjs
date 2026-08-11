// Monta a página de escolha dos modelos de capa com as imagens EMBUTIDAS (data URI): abre em
// qualquer lugar, sem servidor e sem depender do Cloudinary responder.
//
// Usa os shot_mini_*.jpg (540x675). Gere com:
//   node design/capa_modelos.cjs
//   node design/shot.cjs --mini atual_sh a_sh b_sh c_sh atual_ex a_ex b_ex c_ex atual_st a_st b_st c_st
//   node design/ver_capas.cjs
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const OUT = __dirname;

// A escolha sai do MESMO arquivo que o patch lê, pra página não poder divergir do que vai pro ar.
const ESCOLHIDO = fs.readFileSync(path.join(OUT, 'capa_modelo_escolhido.txt'), 'utf8').trim().toLowerCase();

const MODELOS = [
  {
    id: 'a',
    nome: 'Degradê',
    tese: 'A foto some no escuro aos poucos e o texto nasce dela.',
    ganha: 'É o que menos cobre imagem — nenhum bloco chapado por cima da foto.',
    perde: 'A leitura depende do degradê. Em foto muito clara no rodapé o título trabalha só com contorno.',
  },
  {
    id: 'b',
    nome: 'Marca-texto',
    tese: 'Cada linha do título num bloco chapado, a última em verde.',
    ganha: 'Contraste garantido em qualquer foto — a leitura não depende da imagem.',
    perde: 'Os blocos comem uma faixa da foto, e num título de quatro linhas comem bastante.',
  },
  {
    id: 'c',
    nome: 'Editorial',
    tese: 'Menos elementos: sem chip, sem contorno, sem moldura.',
    ganha: 'Dá mais respiro pra foto e passa mais silêncio — parece menos "post de página".',
    perde: 'Aposta na foto pra prender o olho. Com imagem fraca, sobra pouca coisa segurando.',
  },
];

const PAUTAS = [
  { sfx: 'sh', titulo: 'Silent Hill: Townfall', nota: 'Título curto, foto limpa, rosto ocupando o quadro. O caso fácil.' },
  { sfx: 'ex', titulo: 'GMKtec Neo X1 Pro', nota: 'Foto de release com texto embutido. Em tela cheia aparece tudo, inclusive o chinês — limite da fonte de imagem, que o full-bleed amplifica.' },
  { sfx: 'st', titulo: 'Ryzen 9 9955HX3D', nota: 'Teste de estresse: título de quatro linhas. É aqui que os modelos se separam.' },
];

const uri = (f) => {
  const p = path.join(OUT, f);
  return fs.existsSync(p) ? 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64') : null;
};

const quadro = (rotulo, arquivo, tipo) => {
  const d = uri(arquivo);
  const classe = 'quadro' + (tipo ? ' quadro--' + tipo : '');
  if (!d) return `<figure class="${classe}"><figcaption class="rotulo">${rotulo}</figcaption><div class="placa">sem render</div></figure>`;
  return `<figure class="${classe}">
          <figcaption class="rotulo">${rotulo}</figcaption>
          <img src="${d}" alt="Capa ${rotulo}" width="540" height="675" loading="lazy">
        </figure>`;
};

const pauta = (p) => `<article class="pauta">
      <header class="pauta__cab">
        <h2>${p.titulo}</h2>
        <p>${p.nota}</p>
      </header>
      <div class="fileira">
        ${quadro('Hoje', `shot_mini_atual_${p.sfx}.jpg`, '')}
        ${MODELOS.map((m) => quadro(
          `${m.id.toUpperCase()} · ${m.nome}${m.id === ESCOLHIDO ? ' — escolhido' : ''}`,
          `shot_mini_${m.id}_${p.sfx}.jpg`,
          m.id === ESCOLHIDO ? 'escolhido' : 'modelo')).join('\n        ')}
      </div>
    </article>`;

const cartao = (m) => `<li class="cartao${m.id === ESCOLHIDO ? ' cartao--escolhido' : ''}">
        <span class="cartao__letra">${m.id.toUpperCase()}</span>
        ${m.id === ESCOLHIDO ? '<span class="selo">escolhido</span>' : ''}
        <h3>${m.nome}</h3>
        <p class="cartao__tese">${m.tese}</p>
        <dl>
          <dt>Ganha</dt><dd>${m.ganha}</dd>
          <dt>Perde</dt><dd>${m.perde}</dd>
        </dl>
      </li>`;

const page = `<title>Capa do carrossel — três modelos</title>
<style>
  :root{
    --ground:#F5F6F3; --surface:#FFFFFF; --sunken:#ECEEE8;
    --hairline:#D8DBD2; --ink:#14161B; --ink-mute:#5F6670;
    --verde:#4F8A00; --roxo:#6B2FD6; --marca-verde:#A6FF2E; --marca-roxo:#9A4DFF;
    --tinta-foto:#0B0C0F;
    --passo:clamp(14px,1.6vw,22px);
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#0B0C0F; --surface:#141720; --sunken:#0F1116;
      --hairline:#252A34; --ink:#E4E8EE; --ink-mute:#8A93A2;
      --verde:#A6FF2E; --roxo:#B98BFF;
    }
  }
  :root[data-theme="dark"]{
    --ground:#0B0C0F; --surface:#141720; --sunken:#0F1116;
    --hairline:#252A34; --ink:#E4E8EE; --ink-mute:#8A93A2;
    --verde:#A6FF2E; --roxo:#B98BFF;
  }

  *,*::before,*::after{box-sizing:border-box;}
  body{
    margin:0; background:var(--ground); color:var(--ink);
    font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .envelope{max-width:1180px; margin:0 auto; padding:clamp(28px,5vw,72px) clamp(18px,4vw,40px) 96px;}

  /* a régua verde/roxo é o mesmo elemento que abre todo slide do carrossel */
  .regua{display:flex; height:6px; margin-bottom:clamp(26px,4vw,44px);}
  .regua i{display:block; height:100%;}
  .regua i:first-child{width:62%; background:var(--marca-verde);}
  .regua i:last-child{width:38%; background:var(--marca-roxo);}

  .condensada,h1,h2,h3,.rotulo{
    font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;
    text-transform:uppercase; font-weight:700;
  }
  .capitular{font-size:12px; color:var(--ink-mute); letter-spacing:.18em;}
  h1{font-size:clamp(34px,6vw,60px); line-height:.98; margin:10px 0 14px; letter-spacing:.02em; text-wrap:balance;}
  .linha-fina{max-width:64ch; color:var(--ink-mute); margin:0;}
  .estado{
    display:inline-flex; align-items:center; gap:10px; margin-top:24px;
    border:1px solid var(--hairline); background:var(--surface); padding:9px 16px; font-size:13px;
  }
  .estado b{color:var(--ink);}
  .pisca{width:9px; height:9px; background:var(--marca-verde); flex:0 0 auto;}

  .legenda{margin-top:clamp(40px,6vw,64px); list-style:none; padding:0;
    display:grid; gap:var(--passo); grid-template-columns:repeat(auto-fit,minmax(260px,1fr));}
  .cartao{background:var(--surface); border:1px solid var(--hairline); padding:22px 24px 24px; position:relative;}
  .cartao--escolhido{border-color:var(--verde); box-shadow:inset 0 0 0 1px var(--verde);}
  .selo{
    position:absolute; top:24px; right:24px;
    font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif; text-transform:uppercase;
    letter-spacing:.16em; font-size:11px; font-weight:700; color:#0B0C0F;
    background:var(--marca-verde); padding:5px 10px;
  }
  .cartao__letra{
    display:inline-flex; align-items:center; justify-content:center;
    width:34px; height:34px; background:var(--marca-verde); color:#0B0C0F;
    font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif; font-weight:700; font-size:19px;
  }
  .cartao h3{font-size:19px; letter-spacing:.06em; margin:14px 0 8px;}
  .cartao__tese{margin:0 0 16px; font-size:15px;}
  .cartao dl{margin:0; display:grid; grid-template-columns:auto 1fr; gap:6px 12px; font-size:14px;}
  .cartao dt{
    font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif; text-transform:uppercase;
    letter-spacing:.14em; font-size:11px; color:var(--verde); padding-top:3px;
  }
  .cartao dd{margin:0; color:var(--ink-mute);}

  .pauta{margin-top:clamp(44px,6vw,76px);}
  .pauta__cab{max-width:66ch; margin-bottom:18px;}
  .pauta__cab h2{font-size:clamp(19px,2.4vw,26px); letter-spacing:.06em; margin:0 0 6px;}
  .pauta__cab p{margin:0; color:var(--ink-mute); font-size:15px;}

  .fileira{display:grid; gap:var(--passo); grid-template-columns:repeat(4,1fr);}
  @media (max-width:820px){ .fileira{grid-template-columns:repeat(2,1fr);} }
  .quadro{margin:0; display:flex; flex-direction:column; gap:9px; min-width:0;}
  .rotulo{letter-spacing:.16em; font-size:10px; color:var(--ink-mute);}
  .quadro--modelo .rotulo{color:var(--ink-mute);}
  .quadro--escolhido .rotulo{color:var(--verde);}
  .quadro img{display:block; width:100%; height:auto; background:var(--tinta-foto);
    border:1px solid var(--hairline);}
  .quadro--escolhido img{border-color:var(--verde); box-shadow:0 0 0 2px var(--verde);}
  .quadro--modelo img{opacity:.75;}
  .quadro--modelo:hover img{opacity:1;}
  .placa{aspect-ratio:1080/1350; border:1px dashed var(--hairline); background:var(--sunken);
    display:grid; place-items:center; color:var(--ink-mute); font-size:12px;}

  .comum{margin-top:clamp(52px,7vw,88px); border-top:1px solid var(--hairline); padding-top:clamp(26px,4vw,40px);}
  .comum h2{font-size:clamp(19px,2.4vw,26px); letter-spacing:.06em; margin:0 0 12px;}
  .comum p{max-width:66ch; color:var(--ink-mute); margin:0 0 20px;}
  .transformacao{
    overflow-x:auto; background:var(--sunken); border:1px solid var(--hairline);
    padding:16px 18px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
    font-size:13px; line-height:1.8; white-space:pre; color:var(--ink);
  }
  .transformacao b{color:var(--verde); font-weight:600;}
  .transformacao i{color:var(--roxo); font-style:normal;}
  .achados{list-style:none; padding:0; margin:26px 0 0; display:flex; flex-direction:column;}
  .achado{display:flex; gap:20px; align-items:flex-start; padding:20px 0; border-top:1px solid var(--hairline);}
  .achado__marca{flex:0 0 auto; min-width:100px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
    font-size:13px; color:var(--roxo);}
  .achado h3{font-size:15px; margin:0 0 5px; text-transform:none; letter-spacing:0; font-weight:600;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
  .achado p{margin:0; color:var(--ink-mute); font-size:14px;}
  .achado code, .comum code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.9em;
    background:var(--sunken); padding:1px 5px; border:1px solid var(--hairline);}
  @media (max-width:720px){ .achado{flex-direction:column; gap:6px;} }

  .rodape{margin-top:clamp(44px,6vw,72px); border-top:1px solid var(--hairline); padding-top:20px;
    color:var(--ink-mute); font-size:13px; display:flex; flex-wrap:wrap; gap:8px 24px;}
  .rodape code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;}
</style>

<div class="envelope">
  <div class="regua"><i></i><i></i></div>

  <p class="capitular condensada">PromoLiso · carrossel do Instagram</p>
  <h1>Três modelos<br>pra mesma capa</h1>
  <p class="linha-fina">Nos três, a capa deixa de repetir o layout do slide de notícia — hero recortado de 936&nbsp;×&nbsp;520 no topo, bloco de texto embaixo — e a foto passa a ocupar os 1080&nbsp;×&nbsp;1350. O que muda entre eles é como o texto se apoia na imagem. O gate de resolução e o corte são idênticos: moram na base compartilhada.</p>

  <p class="estado"><span class="pisca"></span><span>Escolhido: <b>${ESCOLHIDO.toUpperCase()} · ${(MODELOS.find((m) => m.id === ESCOLHIDO) || {}).nome}</b>. Os três seguem com harness verde e dry-run OK. <b>Nada foi publicado.</b></span></p>

  <ul class="legenda">
    ${MODELOS.map(cartao).join('\n      ')}
  </ul>

  ${PAUTAS.map(pauta).join('\n  ')}

  <section class="comum">
    <h2>O que os três compartilham</h2>
    <p>O full-bleed pede cerca de 4,3× mais pixel que o hero antigo. O filtro de imagem do fluxo só sabe medir quando a URL traz sufixo <code>-LARGURAxALTURA</code>, e deixa passar todo o resto. O teste de verdade acontece no Cloudinary, que conhece as dimensões da imagem buscada — então o corte virou parte da própria transformação: nenhum nó novo, nenhuma requisição a mais. Trocar de modelo não mexe nisso.</p>
    <div class="transformacao"><i>if_iw_gte_1000_and_ih_gte_800</i>/e_trim:10/<b>c_fill,g_auto,w_1728,h_2160</b>
  <i>/if_else/</i>e_trim:10/<b>c_pad,g_north,w_1728,h_2160,b_rgb:05060A</b>
  <i>/if_end/</i>f_auto,q_auto:best,e_sharpen:60</div>
    <ul class="achados">
      <li class="achado">
        <code class="achado__marca">o piso</code>
        <div><h3>1000 × 800, e quem não passa não é recusado</h3>
        <p>Acima do piso, recorte 4:5 cheio — a ampliação fica em 1,69×, que o sharpen segura. Abaixo, a foto aparece contida, no tamanho real, ancorada no topo, com o fundo da marca preenchendo o resto. Fica menor, nunca esticada. Recusar custaria a pauta.</p></div>
      </li>
      <li class="achado">
        <code class="achado__marca">f_auto</code>
        <div><h3>Flags de entrega não podem morar dentro do condicional</h3>
        <p>Com <code>f_auto</code> nos ramos do <code>if</code>, o Cloudinary responde <strong>400 para quem aceita AVIF/WebP</strong> — que é exatamente o Chrome do renderizador. Para <code>Accept: */*</code> responde 200, então o teste em node passava e a capa saía em branco. O harness agora cobra os dois <code>Accept</code>.</p></div>
      </li>
      <li class="achado">
        <code class="achado__marca">e_trim</code>
        <div><h3>O recorte 4:5 preserva a tarja cinematográfica</h3>
        <p>Screenshot de jogo vem com barra preta em cima e embaixo. O corte vertical tira as <em>laterais</em> e mantém as barras — a capa nascia com faixa morta no topo. <code>e_trim:10</code> roda antes do corte e resolve.</p></div>
      </li>
    </ul>
  </section>

  <div class="rodape">
    <span>Base <code>design/capa_base.src.js</code></span>
    <span>Modelos <code>design/capa_modelo_{a,b,c}.src.js</code></span>
    <span>Escolha em <code>design/capa_modelo_escolhido.txt</code></span>
  </div>
</div>
`;

const destino = path.join(OUT, 'ver_capas.html');
fs.writeFileSync(destino, page);
console.log('WROTE ver_capas.html', (page.length / 1e6).toFixed(1) + ' MB');

if (!process.argv.includes('--no-abrir')) {
  execFile('cmd', ['/c', 'start', '', destino], (e) => e && console.log('abra à mão:', destino));
}
