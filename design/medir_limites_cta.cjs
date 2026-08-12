// PASSO 1 do plano editorial, aplicado ao CTA: MEDIR onde o texto estoura, em vez de chutar limite.
//
// Por que medir. O SDD proíbe limite arbitrário, e este projeto já pagou por número chutado (o piso
// de altura da capa saiu de 800 no chute e reprovava 1200x675, o formato mais comum). O bloco de
// texto do CTA é o pior caso do carrossel: coluna estreita (left:72 / right:470 -> 538 px), começa
// em y=250, cresce PARA BAIXO e tem o mascote (540x560, colado no canto) esperando embaixo à
// direita. Nada disso tem overflow:hidden — quando estoura, estoura visível.
//
// O que este script faz: renderiza o buildCta NOVO (design/cta_contextual.src.js) com o corte
// desligado, varre cada campo de 8 em 8 caracteres e devolve o maior tamanho que ainda respeita as
// três regras de layout abaixo. Depois confere o pior caso: todos os campos no limite ao mesmo
// tempo — é aí que o orçamento vertical, que é compartilhado, cobra a conta.
//
// Regras (medidas na página, não no olho):
//   R1  o bloco todo termina até y=1290 (60 px de respiro do rodapé de 1350)
//   R2  nenhum conteúdo passa de x=610, o fim da coluna declarada no CSS (left:72 / right:470).
//       Mede-se a TINTA (rect dos elementos e Range dos nós de texto), não a linha `display:flex`,
//       que sempre ocupa a coluna inteira e faria a régua responder 610 pra qualquer texto.
//   R3  nada chega a 12 px da TINTA do mascote. Tinta, não caixa: a caixa é 540x560, o desenho é
//       object-fit:contain com transparência, e usar a caixa reprovava texto que passa sobre pixel
//       vazio — a primeira rodada desta medição devolveu limite de corpo (60) MENOR que o texto
//       institucional que já está no ar (101), o que é a assinatura de régua errada, não de layout
//       apertado. A tinta sai do bbox de alfa no canvas.
//
//   node design/medir_limites_cta.cjs           mede e grava design/limites_cta.json
//   node design/medir_limites_cta.cjs --so-conferir   só confere os limites já gravados
const fs = require('fs');
const path = require('path');
const { chromium } = require('../node_modules/playwright-core');
const { NOVO, trocarRender } = require('./patch_cta_contextual.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');

const cands = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const exe = cands.find((p) => fs.existsSync(p));
if (!exe) { console.error('FAIL  nenhum Edge/Chrome achado'); process.exit(1); }

const SO_CONFERIR = process.argv.includes('--so-conferir');
const LIMITE_Y = 1290;
const LIMITE_X = 610;      // fim da coluna declarada no CSS (left:72 / right:470)
const FOLGA_MASCOTE = 12;  // texto não encosta na tinta do mascote

// Código do nó com o buildCta novo e o corte DESLIGADO — medir com corte é medir o corte.
const base = fs.readFileSync(path.join(WFDIR, 'code-in-javascript.js'), 'utf8');
const comCta = trocarRender(base, 'Code in JavaScript');
const SEM_CORTE = comCta.replace(/const CTA_LIM = \{[^}]*\};/, 'const CTA_LIM = { selo: 9999, titulo: 9999, destaque: 9999, texto: 9999 };');
if (SEM_CORTE === comCta) { console.error('FAIL  não consegui desligar o corte (CTA_LIM não achado)'); process.exit(1); }
const LIM_REAL = Function('return ' + comCta.match(/const CTA_LIM = (\{[^}]*\});/)[1])();
// mesma troca do SEM_CORTE, mas com um limite qualquer: serve pra provar o limite contra o corte
const codigoCom = (lim) => comCta.replace(/const CTA_LIM = \{[^}]*\};/, 'const CTA_LIM = ' + JSON.stringify(lim) + ';');

// Os limites dos outros slides são fonte ÚNICA no validador (patch_limites_unicos) e o
// verifica_limites.cjs guarda contra a terceira cópia. Aqui eles entram como candidato — não como
// número novo — pra medição responder "o CTA suporta os mesmos limites?".
const validador = fs.readFileSync(path.join(WFDIR, 'validar-antes-de-publicar.js'), 'utf8');
const declLim = validador.match(/const LIMITES = (\{[^}]*\});/);
if (!declLim) { console.error('FAIL  não achei `const LIMITES` no validador exportado'); process.exit(1); }
const { selo, titulo, destaque, texto } = Function('return ' + declLim[1])();
const LIMITES_VALIDADOR = { selo, titulo, destaque, texto };

function htmlDo(code, slide) {
  const $input = { first: () => ({ json: { slides: slide } }), all: () => [{ json: { slides: slide } }] };
  const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  return new Function('$input', '$', '$json', 'require', code)($input, $, {}, require)[0].json.html;
}

// Texto realista no comprimento pedido: palavras de português, cortadas na medida.
const PALAVRAS = ('promoções relâmpago no grupo de ofertas com cupom exclusivo para quem segue a conta '
  + 'e recebe alerta de preço antes de todo mundo nas lojas oficiais de games e hardware').split(' ');
function textoDe(n) {
  let s = '';
  for (let i = 0; s.length < n; i++) s += (s ? ' ' : '') + PALAVRAS[i % PALAVRAS.length];
  return s.slice(0, n).replace(/\s+$/, 'x');
}

const CAMPOS = ['selo', 'titulo', 'destaque', 'texto'];

async function medir(page, code, slide) {
  await page.setContent(htmlDo(code, slide), { waitUntil: 'load' });
  // setContent monta um documento com a margem default de 8 px do body, que o renderizador do n8n
  // não tem (ele fotografa a página do jeito que o HTML manda). Sem zerar, TODA medida sai 8 px
  // para a direita e a régua mente.
  await page.addStyleTag({ content: 'html,body{margin:0;padding:0;}' });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((cfg) => {
    // o bloco de texto é o único absolute com left:72px e top:250px
    const bloco = [...document.querySelectorAll('div')]
      .find((d) => d.style.left === '72px' && d.style.top === '250px');
    if (!bloco) return { erro: 'bloco de texto não achado' };
    const r = bloco.getBoundingClientRect();
    const filhos = [...bloco.children].map((c) => {
      const b = c.getBoundingClientRect();
      // cada filho é uma LINHA `display:flex` e por isso ocupa a largura inteira da coluna — medir
      // ela seria medir o CSS, não o texto. O que ocupa espaço de verdade é o conteúdo dentro dela
      // (o chip, o bloco do título, a strip). Onde não há elemento dentro (o corpo é texto solto),
      // a própria linha é o conteúdo.
      const tinta = [...c.querySelectorAll('*')].map((x) => x.getBoundingClientRect().right);
      // texto solto (o corpo e o @handle) não tem elemento: mede pelo Range, que dá o rect da tinta
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (!String(t.nodeValue || '').trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(t);
        for (const r2 of rg.getClientRects()) tinta.push(r2.right);
      }
      return { bottom: b.bottom, right: tinta.length ? Math.max(...tinta) : b.right };
    });
    const maiorX = Math.max(...filhos.map((f) => f.right));

    // A caixa do mascote é 540x560, mas o DESENHO não a preenche: é object-fit:contain com
    // object-position:right bottom e PNG com transparência. Usar a caixa reprovaria texto que passa
    // por cima de pixel vazio — foi o que aconteceu na primeira rodada desta medição, que devolveu
    // um limite de corpo (60) menor que o texto institucional que já está no ar (101). Então mede-se
    // a TINTA: bbox de alfa > 8 no canvas, mapeada de volta pras coordenadas da página.
    const img = document.querySelector('img[style*="object-position:right bottom"]');
    if (!img || !img.naturalWidth) return { erro: 'mascote não carregou' };
    const cx = img.getBoundingClientRect();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const escala = Math.min(cx.width / nw, cx.height / nh);
    const cv = document.createElement('canvas');
    cv.width = nw; cv.height = nh;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, nw, nh).data;
    let minX = nw, minY = nh, maxX = -1, maxY = -1;
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        if (px[(y * nw + x) * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { erro: 'mascote é 100% transparente' };
    // desenhado colado no canto inferior direito da caixa
    const dw = nw * escala, dh = nh * escala;
    const dLeft = cx.right - dw, dTop = cx.bottom - dh;
    const tinta = {
      left: dLeft + minX * escala, top: dTop + minY * escala,
      right: dLeft + (maxX + 1) * escala, bottom: dTop + (maxY + 1) * escala,
    };
    const folga = cfg.FOLGA_MASCOTE;
    filhos.forEach((f) => {
      f.viola = (f.right > tinta.left - folga && f.bottom > tinta.top - folga) || f.right > cfg.LIMITE_X;
    });
    const invade = filhos.some((f) => f.right > tinta.left - folga && f.bottom > tinta.top - folga);

    return {
      bottom: Math.round(r.bottom), maiorX: Math.round(maiorX), invade,
      porFilho: filhos.map((f) => Math.round(f.right)),
      culpados: filhos.map((f, i) => (f.viola ? i : -1)).filter((i) => i >= 0),
      mascote: { left: Math.round(tinta.left), top: Math.round(tinta.top), right: Math.round(tinta.right), bottom: Math.round(tinta.bottom) },
      R1: r.bottom <= cfg.LIMITE_Y, R2: maiorX <= cfg.LIMITE_X, R3: !invade,
    };
  }, { LIMITE_Y, LIMITE_X, FOLGA_MASCOTE });
}

const cabe = (m) => Boolean(m && !m.erro && m.R1 && m.R2 && m.R3);

(async () => {
  const b = await chromium.launch({ executablePath: exe });
  const page = await b.newPage({ viewport: { width: 1080, height: 1350 } });

  const padrao = { tipo: 'cta', pagina: 6, total: 6 };
  const mDefault = await medir(page, SEM_CORTE, padrao);
  console.log(`default de hoje: bottom=${mDefault.bottom} maiorX=${mDefault.maiorX} cabe=${cabe(mDefault)}`
    + `  (direita de cada filho: ${JSON.stringify(mDefault.porFilho)} = selo,titulo,texto,destaque,handle)`);
  if (!cabe(mDefault)) { console.error('FAIL  o CTA de HOJE já viola as regras — revisar as regras antes de medir'); await b.close(); process.exit(1); }

  const achados = {};
  if (!SO_CONFERIR) {
    // O teto de LAYOUT não serve de limite editorial: um selo de 400 caracteres "cabe" (a linha
    // quebra e o bloco só cresce pra baixo) e é lixo. Então a régua parte dos limites que o projeto
    // já usa nos outros slides — lidos do validador, que é a fonte única desses números — e a
    // medição serve pra dizer quais deles o CTA NÃO suporta.
    const candidato = { ...LIMITES_VALIDADOR };
    console.log(`candidato (LIMITES do validador): ${JSON.stringify(candidato)}`);

    for (const campo of CAMPOS) {
      // varre até 1,5x o candidato: interessa saber se o candidato cabe e com quanta folga, não
      // qual é o absurdo máximo que o layout tolera
      const teto = Math.ceil(candidato[campo] * 1.5);
      let ultimoOk = 0, primeiroRuim = null;
      for (let n = 4; n <= teto; n += 2) {
        const m = await medir(page, SEM_CORTE, { ...padrao, [campo]: textoDe(n) });
        if (cabe(m)) ultimoOk = n;
        else { primeiroRuim = { n, m }; break; }
      }
      if (primeiroRuim) {
        for (let n = ultimoOk + 1; n < primeiroRuim.n; n++) {
          const m = await medir(page, SEM_CORTE, { ...padrao, [campo]: textoDe(n) });
          if (!cabe(m)) break;
          ultimoOk = n;
        }
      }
      achados[campo] = ultimoOk;
      const qual = primeiroRuim ? Object.entries(primeiroRuim.m).filter(([k, v]) => /^R\d$/.test(k) && !v).map(([k]) => k).join('+') : 'nenhuma';
      const veredito = ultimoOk >= candidato[campo] ? `suporta o candidato ${candidato[campo]}`
        : `NÃO suporta o candidato ${candidato[campo]} — o CTA tem que cortar em ${ultimoOk}`;
      console.log(`${campo.padEnd(9)} isolado cabe até ${String(ultimoOk).padStart(3)} chars `
        + `(quebra em ${primeiroRuim ? primeiroRuim.n : '>' + teto}, regra ${qual})  ${veredito}`);
    }

    // PIOR CASO: os tetos individuais não somam, porque o orçamento vertical é compartilhado e um
    // elemento largo passa a violar R3 quando outro campo o empurra para baixo.
    //
    // Encolher "o mais elástico" seria injusto e foi o primeiro erro desta medição: com todos no
    // teto, quem viola é a STRIP do destaque (larga: 22 chars = x até 595, e a tinta do mascote
    // começa em x=580), e a régua respondia cortando o CORPO até 60 — punindo o campo inocente.
    // Aqui encolhe quem viola; só quando o culpado é o @handle (que é fixo) é que o corpo paga,
    // porque é o corpo que o empurrou para baixo.
    const DE_QUEM = ['selo', 'titulo', 'texto', 'destaque', null]; // ordem dos filhos no bloco
    const PASSO = { selo: 2, titulo: 2, destaque: 1, texto: 10 };
    const PISO = { selo: 8, titulo: 12, destaque: 6, texto: 60 };
    const combinado = {};
    for (const c of CAMPOS) combinado[c] = Math.min(candidato[c], achados[c]);
    let ok = false;
    for (let volta = 0; volta < 120 && !ok; volta++) {
      const slide = { ...padrao };
      for (const c of CAMPOS) slide[c] = textoDe(combinado[c]);
      const m = await medir(page, SEM_CORTE, slide);
      if (cabe(m)) { ok = true; console.log(`pior caso junto: bottom=${m.bottom} maiorX=${m.maiorX} OK com ${JSON.stringify(combinado)}`); break; }
      // R1 é altura do bloco todo: só o corpo (e depois o título) devolvem altura
      let alvo = null;
      if (!m.R1) alvo = combinado.texto > PISO.texto ? 'texto' : 'titulo';
      else {
        for (const i of m.culpados || []) { if (DE_QUEM[i] && combinado[DE_QUEM[i]] > PISO[DE_QUEM[i]]) { alvo = DE_QUEM[i]; break; } }
        if (!alvo) alvo = 'texto';                         // culpado é o @handle fixo
      }
      if (!alvo || combinado[alvo] <= PISO[alvo]) break;
      combinado[alvo] -= PASSO[alvo];
    }
    if (!ok) { console.error('FAIL  não achei combinação que caiba — layout precisa mudar, não o limite'); await b.close(); process.exit(1); }

    // FECHAR O CICLO. Até aqui a medição usou strings de exatamente N caracteres; o que vai pro ar é
    // a SAÍDA DO CORTE, que troca o fim por '…' e para numa fronteira de palavra. Caractere não é
    // pixel: a saída cortada em 20 mediu 575 px onde a string crua de 20 mediu 563 — e 575 encosta
    // no mascote. Então o limite só vale depois de provado contra o próprio corte.
    for (let volta = 0; volta < 120; volta++) {
      const alvoAbsurdo = { ...padrao };
      for (const c of CAMPOS) alvoAbsurdo[c] = textoDe(600);
      const m = await medir(page, codigoCom(combinado), alvoAbsurdo);
      if (cabe(m)) { console.log(`corte provado: 600 chars em tudo -> bottom=${m.bottom} maiorX=${m.maiorX} com ${JSON.stringify(combinado)}`); break; }
      let alvo = null;
      if (!m.R1) alvo = combinado.texto > PISO.texto ? 'texto' : 'titulo';
      else {
        for (const i of m.culpados || []) { if (DE_QUEM[i] && combinado[DE_QUEM[i]] > PISO[DE_QUEM[i]]) { alvo = DE_QUEM[i]; break; } }
        if (!alvo) alvo = 'texto';
      }
      if (!alvo || combinado[alvo] <= PISO[alvo]) { console.error('FAIL  o corte não segura nem no piso'); await b.close(); process.exit(1); }
      combinado[alvo] -= PASSO[alvo];
    }

    const saida = {
      medido_em: '2026-08-12',
      como: 'design/medir_limites_cta.cjs — Edge headless, viewport 1080x1350, fontes carregadas',
      regras: {
        R1: `bloco termina até y=${LIMITE_Y}`,
        R2: `nenhum conteúdo passa de x=${LIMITE_X}`,
        R3: `nada chega a ${FOLGA_MASCOTE}px da tinta do mascote (bbox de alfa, medida no canvas)`,
      },
      mascote_tinta: mDefault.mascote,
      candidato_do_validador: LIMITES_VALIDADOR,
      maximo_isolado: achados,
      limite_adotado: LIM_REAL,
      combinacao_encontrada_pela_busca: combinado,
      observacao: 'candidato_do_validador sao os LIMITES que os outros slides ja usam (fonte unica, '
        + 'lida de validar-antes-de-publicar.js). maximo_isolado e o teto de cada campo com os outros '
        + 'no default. NAO EXISTE combinacao unica: os campos dividem a altura, entao destaque 38 + '
        + 'texto 250 e destaque 19 + texto 300 sao as duas validas. combinacao_encontrada_pela_busca '
        + 'e a que a busca acha partindo do candidato; limite_adotado e a que o CTA_LIM do render usa '
        + '(destaque de 1 linha: a strip e um botao, 2 linhas ficam feias) e e provada a parte pelo '
        + 'teste de corte no fim do script.',
    };
    fs.writeFileSync(path.join(__dirname, 'limites_cta.json'), JSON.stringify(saida, null, 2) + '\n');
    console.log('\ngravado design/limites_cta.json');
    console.log('CTA_LIM adotado no src.js = ' + JSON.stringify(LIM_REAL));
    console.log('combinacao da busca       = ' + JSON.stringify(combinado));
    // Divergir aqui NÃO é erro: os campos dividem a altura, então há mais de uma combinação válida.
    // Erro é o adotado passar do teto ISOLADO de um campo — aí nem sozinho ele cabe.
    for (const c of CAMPOS) {
      if (LIM_REAL[c] > achados[c]) {
        console.error(`FAIL  CTA_LIM.${c}=${LIM_REAL[c]} passa do teto isolado medido (${achados[c]})`);
        await b.close(); process.exit(1);
      }
    }
    console.log('(o adotado cabe em todos os tetos isolados; o pior caso dele é provado no teste de corte abaixo)');
  }

  // ---- O RENDER NÃO PODE MUDAR HOJE, e "byte a byte" não prova isso: o buildCta novo tem duas
  // travas de CSS (overflow-wrap e max-width na strip) que o de hoje não tem. Elas não mexem no
  // texto institucional — mas quem garante é o PIXEL, não a string. Aqui compara-se a foto.
  {
    const cru = fs.readFileSync(path.join(WFDIR, 'code-in-javascript.js'), 'utf8');
    const foto = async (code) => {
      await page.setContent(htmlDo(code, { tipo: 'cta', pagina: 6, total: 6 }), { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html,body{margin:0;padding:0;}' });
      await page.evaluate(() => document.fonts.ready);
      return page.screenshot();
    };
    const a = await foto(cru), b2 = await foto(comCta);
    const iguais = a.equals(b2);
    console.log(`render do CTA padrão: ${iguais ? 'PIXEL A PIXEL IGUAL ao de hoje' : 'MUDOU — investigar antes de deployar'}`);
    if (!iguais) { await b.close(); process.exit(1); }
  }

  // ---- Adversário: contagem de caractere é proxy ruim de pixel. Estes casos existem porque a
  // primeira versão do corte deixava passar 753 px de strip (19 letras "W") e 8567 px de corpo
  // (token sem espaço, tipo uma URL). As travas de CSS fecharam os dois.
  {
    const CASOS = {
      'destaque de hoje (13)': { destaque: 'LINK NA BIO ↗' },
      'destaque largo (19 W/M)': { destaque: 'WHATSAPP MMM WWW W' },
      'destaque patológico (19 W)': { destaque: 'WWWWWWWWWWWWWWWWWWW' },
      'corpo com URL sem espaço': { texto: 'Acesse https://promoliso.com.br/ofertas-de-agosto-de-2026-com-cupom-exclusivo agora' },
      'título de token único': { titulo: 'PROMOÇÃOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO' },
    };
    for (const [nome, campos] of Object.entries(CASOS)) {
      const m = await medir(page, comCta, { tipo: 'cta', pagina: 6, total: 6, ...campos });
      console.log(`${cabe(m) ? 'ok     ' : 'ESTOURA'} ${nome.padEnd(28)} bottom=${m.bottom} maiorX=${m.maiorX}`);
      if (!cabe(m)) { await b.close(); process.exit(1); }
    }
  }

  // --fotos: as três situações em PNG, pra conferir no olho o que a régua disse em número.
  if (process.argv.includes('--fotos')) {
    const cenas = {
      cta_hoje: { tipo: 'cta', pagina: 6, total: 6 },
      cta_agente: { tipo: 'cta', pagina: 6, total: 6, selo: 'OFERTA RELÂMPAGO', titulo: 'Corre que acaba hoje', destaque: 'CUPOM NA BIO', texto: 'O preço volta ao normal à meia-noite e o estoque some antes disso. Quem está no grupo recebe o aviso primeiro.' },
      cta_limite: { tipo: 'cta', pagina: 6, total: 6, selo: textoDe(600), titulo: textoDe(600), destaque: textoDe(600), texto: textoDe(600) },
    };
    for (const [nome, slide] of Object.entries(cenas)) {
      await page.setContent(htmlDo(comCta, slide), { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html,body{margin:0;padding:0;}' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(__dirname, 'shot_' + nome + '.png') });
      console.log('shot_' + nome + '.png');
    }
  }

  // Conferência final: com o corte LIGADO, texto absurdo tem que caber de qualquer jeito.
  const absurdo = { ...padrao };
  for (const c of CAMPOS) absurdo[c] = textoDe(600);
  const mCortado = await medir(page, comCta, absurdo);
  console.log(`\ncom corte ligado e 600 chars em tudo: bottom=${mCortado.bottom} maiorX=${mCortado.maiorX} cabe=${cabe(mCortado)}`);
  await b.close();
  process.exit(cabe(mCortado) ? 0 : 1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
