// Harness do passo A. Não consegue provar que o n8n RESOLVE a expressão (isso só a execução em
// produção prova). O que ele prova é o resto: que a saída é idêntica à de hoje, que o media_type
// não sumiu, e que o rollback devolve exatamente o estado anterior.
//
//   node design/test_carousel_expr_passoA.cjs
const { ANTES, DEPOIS, trocar, avaliar, simularNo } = require('./patch_carousel_expr_passoA.cjs');

let falhas = 0;
const ok = (nome, cond, det) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !det ? '' : '  -> ' + det));
  if (!cond) falhas++;
};
const tenta = (fn) => { try { return { v: fn() }; } catch (e) { return { erro: e.message }; } };

const PARAMS_HOJE = {
  resource: 'post',
  operation: 'createCarouselPost',
  carouselChildren: ANTES,
  carouselCaption: "={{ $('Selecionar READY').item.json.caption }}",
  carouselAdditionalOptions: {},
};

// dados como o "Selecionar READY" entrega
const DADOS = {
  cover: 'https://res.cloudinary.com/fy2n2qvr/image/upload/capa.jpg',
  slides: ['https://x/s1.jpg', 'https://x/s2.jpg', 'https://x/s3.jpg', 'https://x/s4.jpg', 'https://x/s5.jpg'],
  caption: 'legenda',
};

// Como o n8n monta os filhos HOJE: lista estática + default media_type='IMAGE' aplicado pelo n8n
const hojeResolvido = {
  child: [DADOS.cover, ...DADOS.slides].map((u) => ({ media_type: 'IMAGE', image_url: u })),
};

// ---- 1. a troca acontece e é reversível ----
{
  const r = tenta(() => trocar(PARAMS_HOJE, false));
  ok('patch aplica', Boolean(r.v), r.erro);
  ok('carouselChildren vira string de expressão', typeof r.v.carouselChildren === 'string');
  ok('legenda intocada', r.v.carouselCaption === PARAMS_HOJE.carouselCaption);
  ok('resource/operation intocados', r.v.resource === 'post' && r.v.operation === 'createCarouselPost');

  const volta = tenta(() => trocar(r.v, true));
  ok('rollback aplica', Boolean(volta.v), volta.erro);
  ok('rollback devolve EXATAMENTE o estado anterior',
    JSON.stringify(volta.v) === JSON.stringify(PARAMS_HOJE));

  ok('recusa reaplicar por cima de si mesmo', /já é expressão/.test(String(tenta(() => trocar(r.v, false)).erro)));
  ok('recusa reverter o que já é estático', /nada a reverter/.test(String(tenta(() => trocar(PARAMS_HOJE, true)).erro)));
}

// ---- 2. guarda: produção diferente do esperado aborta ----
{
  const mexido = JSON.parse(JSON.stringify(PARAMS_HOJE));
  mexido.carouselChildren.child.push({ image_url: '={{ 1 }}' });
  ok('aborta se os filhos em produção não forem os conhecidos',
    /não são os que este patch conhece/.test(String(tenta(() => trocar(mexido, false)).erro)));
}

// ---- 3. o CORAÇÃO: a saída da expressão é idêntica à de hoje ----
{
  const saida = tenta(() => avaliar(DEPOIS, DADOS));
  ok('expressão avalia sem erro', Boolean(saida.v), saida.erro);
  if (saida.v) {
    ok('produz 6 filhos', saida.v.child.length === 6, String(saida.v.child.length));
    ok('ordem e urls idênticas às de hoje',
      JSON.stringify(saida.v) === JSON.stringify(hojeResolvido),
      JSON.stringify(saida.v).slice(0, 120));
    ok('primeiro filho é a capa', saida.v.child[0].image_url === DADOS.cover);
    ok('último filho é o slide 5', saida.v.child[5].image_url === DADOS.slides[4]);
  }
}

// ---- 4. a armadilha do media_type ----
{
  const saida = avaliar(DEPOIS, DADOS);
  ok('TODO filho traz media_type IMAGE explícito',
    saida.child.every((c) => c.media_type === 'IMAGE'));

  const corpos = simularNo(saida);
  ok('o nó montaria 6 chamadas de imagem', corpos.length === 6 && corpos.every((c) => c.media_type === 'IMAGE'));
  ok('nenhuma chamada cai no ramo VIDEO', !corpos.some((c) => c.media_type === 'VIDEO'));
  ok('nenhuma url indefinida', corpos.every((c) => typeof c.image_url === 'string' && c.image_url.startsWith('http')));

  // prova de que a armadilha é real: sem media_type, o nó viraria VIDEO
  const semTipo = { child: [{ image_url: 'https://x/1.jpg' }] };
  const ruim = simularNo(semTipo);
  ok('[prova da armadilha] filho sem media_type viraria VIDEO com url indefinida',
    ruim[0].media_type === 'VIDEO' && ruim[0].video_url === undefined);
}

// ---- 5. o passo B já funcionaria (mas NÃO é o que este patch faz) ----
{
  const exprB = "={{ ({ child: [$('Selecionar READY').item.json.cover, ...$('Selecionar READY').item.json.slides]"
    + ".filter(Boolean).map(u => ({ media_type: 'IMAGE', image_url: u })) }) }}";
  for (const n of [1, 3, 7]) {
    const d = { cover: DADOS.cover, slides: Array.from({ length: n }, (_, i) => 'https://x/s' + i + '.jpg') };
    const r = avaliar(exprB, d);
    ok(`[passo B, ainda não aplicado] ${n} slides -> ${n + 1} filhos`, r.child.length === n + 1, String(r.child.length));
  }
  ok('[passo B] respeitaria o mínimo de 2 do Instagram',
    avaliar(exprB, { cover: DADOS.cover, slides: [] }).child.length < 2);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
