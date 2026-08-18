// Harness do carrossel de quantidade variável — metade do publicador. Offline, sem VPS.
//
//   node design/test_carrossel_variavel_publicador.cjs
//
// Quatro metades, e cada uma existe por causa de um erro que já aconteceu neste projeto:
//
//   A) O CÓDIGO do "Selecionar READY", rodado de verdade contra as 61 rows REAIS da fila. Tem que
//      escolher a MESMA peça de antes e devolver as MESMAS 6 imagens — senão este patch mudaria o
//      próximo post, e a promessa é que não muda.
//   B) A TOPOLOGIA: nove nós, um Switch, ninguém órfão, ninguém apontando pro vazio, índice de saída
//      casando com o tamanho. Índice trocado aqui faz uma peça de 4 imagens ir pro nó de 7 e o
//      Instagram recusar — falha muda e barata de cometer.
//   C) A IDENTIDADE do caminho de 6: as urls do "Carrossel 06" têm de ser as mesmas, na mesma ordem,
//      do nó que roda hoje. É o que garante "não muda nada hoje".
//   D) A VOLTA: reverter tem de devolver o publicador ao estado exato de antes.
const fs = require('fs');
const path = require('path');
const P = require('./patch_carrossel_variavel_publicador.cjs');
const G = require('./selecionar_ready_variavel.gen.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}
const lf = (s) => String(s).split('\r\n').join('\n');
const clonar = (x) => JSON.parse(JSON.stringify(x));

const ANTES = lf(fs.readFileSync(path.join(__dirname, 'selecionar_ready_antes_variavel.txt'), 'utf8'));
const NOVO = lf(fs.readFileSync(path.join(__dirname, 'selecionar_ready_variavel.src.js'), 'utf8'));
const FILA = JSON.parse(fs.readFileSync(path.join(__dirname, 'fila_amostra.json'), 'utf8'));

// =============================================================== A. o código, contra a fila real
console.log('# A. Selecionar READY');
{
  ok('o novo é gerado do que está no ar, por substituição', G.gerar(ANTES) === NOVO);
  ok('o fixture do "antes" é o que o export mostra em produção',
    ANTES === lf(fs.readFileSync(path.join(__dirname, '..', 'workflows',
      'promoliso-publicador-fila--E27F7yVdsZRj', 'selecionar-ready.js'), 'utf8')));

  const rodar = (codigo, rows) => {
    const $input = { all: () => rows.map((json) => ({ json })) };
    return new Function('$input', '$', '$json', codigo)($input, () => ({}), {});
  };
  const publicaveis = FILA.filter((r) => ['READY', 'RETRY'].includes(String(r.status).toUpperCase()));
  ok('a fila de amostra tem peça publicável (senão o teste não testa nada)', publicaveis.length > 0,
    String(publicaveis.length));

  const a = rodar(ANTES, FILA)[0].json;
  const b = rodar(NOVO, FILA)[0].json;
  console.log('   escolhida: ' + b.content_key.slice(0, 60) + '  (' + b.n_imagens + ' imagens)');
  ok('escolhe a MESMA peça de antes', a.content_key === b.content_key, a.content_key + ' != ' + b.content_key);
  ok('mesma capa', a.cover === b.cover);
  ok('mesmos slides, na mesma ordem', JSON.stringify(a.slides) === JSON.stringify(b.slides),
    JSON.stringify(b.slides));
  for (const campo of ['topic', 'caption', 'story_url', 'primary_url', 'status_anterior', 'created_at']) {
    ok('campo "' + campo + '" intacto', a[campo] === b[campo]);
  }
  ok('nenhum campo antigo desapareceu',
    Object.keys(a).every((k) => Object.prototype.hasOwnProperty.call(b, k)),
    Object.keys(a).filter((k) => !(k in b)).join(','));
  ok('n_imagens = 6 na fila de hoje', b.n_imagens === 6, String(b.n_imagens));
  ok('saida_carrossel = 4 (índice do nó de 6)', b.saida_carrossel === 4, String(b.saida_carrossel));

  // as 61 rows, uma por uma: a saída nunca pode sair da faixa nem discordar da contagem
  let confereTodas = 0;
  for (const row of FILA) {
    const so = [{ ...row, status: 'READY' }];
    let r; try { r = rodar(NOVO, so)[0].json; } catch (e) { ok('row ' + row.id + ' quebrou', false, e.message); continue; }
    const urls = JSON.parse(row.carousel_urls || '[]');
    const bate = r.n_imagens === Math.min(10, urls.length)
      && r.saida_carrossel === r.n_imagens - 2
      && r.saida_carrossel >= 0 && r.saida_carrossel <= 8
      && r.slides.length === r.n_imagens - 1;
    if (!bate) ok('row ' + row.id + ' com contagem coerente', false, JSON.stringify(r).slice(0, 120));
    else confereTodas++;
  }
  ok('todas as ' + FILA.length + ' rows reais dão contagem coerente e dentro da faixa',
    confereTodas === FILA.length, confereTodas + '/' + FILA.length);

  // tamanhos sintéticos: é aqui que o patch tem valor, e é aqui que ninguém publicou ainda
  const comN = (n) => rodar(NOVO, [{
    status: 'READY', content_key: 'k', created_at: new Date().toISOString(),
    carousel_urls: JSON.stringify(Array.from({ length: n }, (_, i) => 'https://x/' + i)),
  }])[0].json;
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const r = comN(n);
    ok(n + ' imagens -> saída ' + (n - 2) + ', ' + (n - 1) + ' slides',
      r.n_imagens === n && r.saida_carrossel === n - 2 && r.slides.length === n - 1,
      JSON.stringify({ n: r.n_imagens, s: r.saida_carrossel, l: r.slides.length }));
  }
  const r11 = comN(11);
  ok('11 imagens são cortadas em 10 (teto do Instagram), sem estourar o Switch',
    r11.n_imagens === 10 && r11.saida_carrossel === 8 && r11.imagens_ignoradas === 1,
    JSON.stringify({ n: r11.n_imagens, s: r11.saida_carrossel, i: r11.imagens_ignoradas }));
  const r30 = comN(30);
  ok('30 imagens também param em 10', r30.n_imagens === 10 && r30.saida_carrossel === 8);

  let erro1 = null;
  try { comN(1); } catch (e) { erro1 = e.message; }
  ok('1 imagem é erro, não carrossel de 1', /insuficiente/.test(String(erro1)), String(erro1));

  // url quebrada no meio: hoje ela viraria filho sem image_url
  const misto = rodar(NOVO, [{
    status: 'READY', content_key: 'k', created_at: new Date().toISOString(),
    carousel_urls: JSON.stringify(['https://a', null, 'https://b', 'http://inseguro', 'https://c']),
  }])[0].json;
  ok('descarta null e http, e recalcula a saída', misto.n_imagens === 3 && misto.saida_carrossel === 1,
    JSON.stringify(misto.slides));

  ok('fila vazia continua devolvendo nada', rodar(NOVO, []).length === 0);
  ok('só peças já publicadas continuam devolvendo nada',
    rodar(NOVO, FILA.filter((r) => r.status === 'PUBLISHED')).length === 0);
}

// =============================================================== B/C. topologia e identidade
console.log('\n# B. topologia');
const mundo = () => {
  const nodes = [
    { id: 'a', name: 'Slots de publicação', type: 'n8n-nodes-base.scheduleTrigger', position: [0, 180], parameters: {} },
    { id: 'b', name: 'Ler fila', type: 'n8n-nodes-base.dataTable', position: [240, 0], parameters: {} },
    { id: 'c', name: P.NO_SELECIONAR, type: 'n8n-nodes-base.code', position: [480, 0], parameters: { jsCode: ANTES } },
    { id: 'd', name: P.NO_ANTES, type: 'n8n-nodes-base.dataTable', position: [720, 0], parameters: {} },
    { id: 'e', name: P.NO_ANTIGO, type: 'n8n-nodes-instagram-integrations.instagram', typeVersion: 1,
      position: [960, 0],
      parameters: { resource: 'post', operation: 'createCarouselPost',
        carouselChildren: clonar(P.FILHOS_HOJE),
        carouselCaption: "={{ $('Selecionar READY').item.json.caption }}",
        carouselAdditionalOptions: {} },
      credentials: { instagramOAuth2Api: { id: 'Gdjo89AicVj0L64v', name: 'Instagram account' } },
      onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    { id: 'f', name: P.NO_VERIFICACAO, type: 'n8n-nodes-base.code', position: [1200, 0],
      parameters: { jsCode: "const created=$json||{};\nif(!created.id) throw new Error('x');\nconst sel=$('Selecionar READY').item.json;" } },
    { id: 'g', name: P.NO_FALHA, type: 'n8n-nodes-base.code', position: [3000, 480],
      parameters: { jsCode: "const sel = $('Selecionar READY').item.json;" } },
  ];
  const connections = {
    'Slots de publicação': { main: [[{ node: 'Ler fila', type: 'main', index: 0 }]] },
    'Ler fila': { main: [[{ node: P.NO_SELECIONAR, type: 'main', index: 0 }]] },
    [P.NO_SELECIONAR]: { main: [[{ node: P.NO_ANTES, type: 'main', index: 0 }]] },
    [P.NO_ANTES]: { main: [[{ node: P.NO_ANTIGO, type: 'main', index: 0 }]] },
    [P.NO_ANTIGO]: { main: [
      [{ node: P.NO_VERIFICACAO, type: 'main', index: 0 }],
      [{ node: P.NO_FALHA, type: 'main', index: 0 }],
    ] },
  };
  return { nodes, connections };
};

{
  const m = mundo();
  let seq = 0, erro = null;
  try { P.aplicar(m.nodes, m.connections, NOVO, () => 'novo-' + (++seq)); } catch (e) { erro = e.message; }
  ok('o patch aplica', !erro, erro);
  if (!erro) {
    const nomes = m.nodes.map((n) => n.name);
    ok('o nó antigo saiu', !nomes.includes(P.NO_ANTIGO));
    ok('o Switch entrou', nomes.includes(P.NO_SWITCH));
    ok('nasceram os 9 tamanhos', P.TAMANHOS.every((n) => nomes.includes(P.nomeCarrossel(n))),
      P.TAMANHOS.filter((n) => !nomes.includes(P.nomeCarrossel(n))).join(','));

    const sw = m.nodes.find((n) => n.name === P.NO_SWITCH);
    ok('Switch em modo expressão', sw.parameters.mode === 'expression');
    ok('Switch com 9 saídas', sw.parameters.numberOutputs === 9, String(sw.parameters.numberOutputs));
    ok('o índice do Switch vem do Selecionar READY, já calculado',
      sw.parameters.output === "={{ $('Selecionar READY').item.json.saida_carrossel }}", sw.parameters.output);
    ok('a expressão do Switch é JS válido',
      (() => { try { new Function('return (' + sw.parameters.output.replace(/^=\{\{/, '').replace(/\}\}$/, '') + ')'); return true; } catch (e) { return false; } })());

    ok('Marcar PUBLISHING passou a apontar pro Switch',
      m.connections[P.NO_ANTES].main[0][0].node === P.NO_SWITCH);
    ok('nada mais aponta pro nó antigo',
      !JSON.stringify(m.connections).includes('"' + P.NO_ANTIGO + '"'));

    P.TAMANHOS.forEach((n, i) => {
      const alvo = m.connections[P.NO_SWITCH].main[i][0].node;
      ok('saída ' + i + ' do Switch vai pro ' + P.nomeCarrossel(n), alvo === P.nomeCarrossel(n), alvo);
      const no = m.nodes.find((x) => x.name === P.nomeCarrossel(n));
      ok(P.nomeCarrossel(n) + ' tem ' + n + ' filhos', no.parameters.carouselChildren.child.length === n);
      ok(P.nomeCarrossel(n) + ': todo filho é IMAGE explícito',
        no.parameters.carouselChildren.child.every((c) => c.media_type === 'IMAGE'));
      ok(P.nomeCarrossel(n) + ': saída boa -> ' + P.NO_VERIFICACAO,
        m.connections[P.nomeCarrossel(n)].main[0][0].node === P.NO_VERIFICACAO);
      ok(P.nomeCarrossel(n) + ': saída de erro -> ' + P.NO_FALHA,
        m.connections[P.nomeCarrossel(n)].main[1][0].node === P.NO_FALHA);
      ok(P.nomeCarrossel(n) + ': herdou credencial, retry e onError',
        no.credentials.instagramOAuth2Api.id === 'Gdjo89AicVj0L64v' && no.retryOnFail === true
        && no.maxTries === 3 && no.waitBetweenTries === 5000 && no.onError === 'continueErrorOutput');
      ok(P.nomeCarrossel(n) + ': legenda igual à de hoje',
        no.parameters.carouselCaption === "={{ $('Selecionar READY').item.json.caption }}");
    });

    // C. identidade do caminho de 6 — a promessa "hoje não muda nada"
    console.log('\n# C. identidade do caminho de 6');
    const seis = m.nodes.find((n) => n.name === P.nomeCarrossel(6));
    const urlsHoje = P.FILHOS_HOJE.child.map((c) => c.image_url);
    const urlsNovas = seis.parameters.carouselChildren.child.map((c) => c.image_url);
    ok('as 6 urls, na mesma ordem, byte a byte',
      JSON.stringify(urlsHoje) === JSON.stringify(urlsNovas),
      JSON.stringify(urlsNovas));
    ok('a única diferença nos filhos é o media_type explícito',
      JSON.stringify(seis.parameters.carouselChildren.child)
        === JSON.stringify(P.FILHOS_HOJE.child.map((c) => ({ media_type: 'IMAGE', image_url: c.image_url }))));
    ok('a peça de hoje (6 imagens) cai na saída 4, que é o Carrossel 06',
      m.connections[P.NO_SWITCH].main[4][0].node === P.nomeCarrossel(6));

    console.log('\n# B2. guardas');
    ok('nenhum nó em cima do outro',
      new Set(m.nodes.map((n) => n.position.join(','))).size === m.nodes.length);
    let re = null;
    try { P.aplicar(m.nodes, m.connections, NOVO, () => 'x'); } catch (e) { re = e.message; }
    ok('recusa reaplicação', /já existe/.test(String(re)), re);
  }
}

{
  // se alguém mexeu nos filhos em produção, o patch não pode sobrescrever
  const torto = mundo();
  torto.nodes.find((n) => n.name === P.NO_ANTIGO).parameters.carouselChildren.child.push({ image_url: '={{ 1 }}' });
  let e1 = null;
  try { P.aplicar(torto.nodes, torto.connections, NOVO, () => 'x'); } catch (e) { e1 = e.message; }
  ok('aborta se os filhos em produção não são os conhecidos', /alguém mexeu/.test(String(e1)), e1);

  // se o nó de verificação passar a citar o carrossel pelo nome, a fan-in de 9 quebra
  const cita = mundo();
  cita.nodes.find((n) => n.name === P.NO_VERIFICACAO).parameters.jsCode = "$('" + P.NO_ANTIGO + "').item.json.id";
  let e2 = null;
  try { P.aplicar(cita.nodes, cita.connections, NOVO, () => 'x'); } catch (e) { e2 = e.message; }
  ok('aborta se alguém lê o carrossel pelo nome', /cita/.test(String(e2)), e2);

  const semFalha = mundo();
  semFalha.nodes = semFalha.nodes.filter((n) => n.name !== P.NO_FALHA);
  let e3 = null;
  try { P.aplicar(semFalha.nodes, semFalha.connections, NOVO, () => 'x'); } catch (e) { e3 = e.message; }
  ok('aborta sem o nó de falha', /não achado/.test(String(e3)), e3);

  const duasEntradas = mundo();
  duasEntradas.connections['Ler fila'].main[0].push({ node: P.NO_ANTIGO, type: 'main', index: 0 });
  let e4 = null;
  try { P.aplicar(duasEntradas.nodes, duasEntradas.connections, NOVO, () => 'x'); } catch (e) { e4 = e.message; }
  ok('aborta se mais de uma ligação chega no carrossel', /esperava 1 ligação/.test(String(e4)), e4);
}

// =============================================================== D. a volta
console.log('\n# D. reverter');
{
  const m = mundo();
  const original = JSON.stringify({ nodes: m.nodes, connections: m.connections });
  P.aplicar(m.nodes, m.connections, NOVO, () => 'novo');
  P.reverter(m.nodes, m.connections, ANTES, () => 'velho');

  const ordenar = (o) => {
    const n = clonar(o.nodes).sort((a, b) => a.name.localeCompare(b.name)).map((x) => { delete x.id; return x; });
    return JSON.stringify({ nodes: n, connections: o.connections });
  };
  const antes = JSON.parse(original);
  ok('reverter devolve o publicador ao estado de antes (fora os ids)',
    ordenar(antes) === ordenar({ nodes: m.nodes, connections: m.connections }));
  ok('o jsCode volta a ser exatamente o que estava no ar',
    m.nodes.find((n) => n.name === P.NO_SELECIONAR).parameters.jsCode === ANTES);

  let re = null;
  try { P.reverter(m.nodes, m.connections, ANTES, () => 'x'); } catch (e) { re = e.message; }
  ok('recusa reverter duas vezes', /não existe/.test(String(re)), re);
}

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
