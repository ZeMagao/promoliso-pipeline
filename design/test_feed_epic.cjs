// Harness da fonte de ofertas da Epic. Offline (usa o retorno REAL guardado em epic_amostra.json).
//
// Duas metades:
//   A) o CÓDIGO: converte o JSON da Epic em item de feed, com URL de loja, imagem grande, janela
//      de validade e preço original — e descarta o que não serve (promoção futura, sem slug, sem
//      imagem, desconto que não é 100%).
//   B) a TOPOLOGIA: os dois nós entram ligados no lugar certo, com o mesmo retry dos feeds, num
//      índice livre do merge. Índice repetido faz uma fonte engolir a outra em silêncio.
//
//   node design/test_feed_epic.cjs
const fs = require('fs');
const path = require('path');
const { aplicar, CODIGO, NO_HTTP, NO_CODE, MERGE, GATILHOS, MODELO_FEED, URL_EPIC } = require('./patch_feed_epic.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const rodar = (payload) => {
  const $input = { first: () => ({ json: payload }), all: () => [{ json: payload }] };
  return new Function('$input', '$', '$json', CODIGO)($input, () => ({}), {});
};

// ---- A. contra o retorno REAL da Epic ----
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'epic_amostra.json'), 'utf8'));
{
  const itens = rodar(real).map((i) => i.json);
  ok('extrai exatamente os jogos grátis AGORA (1 na amostra)', itens.length === 1, JSON.stringify(itens.length));
  const i = itens[0];
  console.log('   título gerado: ' + i.title);
  ok('título traz o jogo e o prazo', /Caravan SandWitch/.test(i.title) && /até \d{2}\/\d{2}/.test(i.title));
  ok('link é a página da loja', /^https:\/\/store\.epicgames\.com\/pt-BR\/p\/caravan-sandwitch/.test(i.link), i.link);
  ok('o host é primário no "Preparar candidatos"', /epicgames\.com/.test(i.link));
  ok('tem imagem em enclosure e no corpo', /^https:\/\//.test(i.enclosure.url) && i['content:encoded'].includes(i.enclosure.url));
  // a URL da Epic é um hash opaco: não dá para saber o tipo pelo texto. Compara-se com a entrada
  // OfferImageWide da própria amostra — que foi medida em 2560x1440, acima do gate da capa.
  {
    const elemento = real.data.Catalog.searchStore.elements.find((e) => /Caravan SandWitch/.test(e.title || ''));
    const wide = (elemento.keyImages || []).find((k) => k.type === 'OfferImageWide');
    ok('a imagem escolhida é a OfferImageWide (2560x1440 medidos)',
      i.enclosure.url === String(wide.url).split('?')[0], i.enclosure.url);
  }
  ok('o corpo cita o preço original', /R\$/.test(i.contentSnippet), i.contentSnippet.slice(0, 80));
  ok('a validade vai junto, para a forma EVENTO/produto', Boolean(i.epic_validade));
  ok('vem marcado como OFERTA nas categorias', (i.categories || []).includes('OFERTA'));
  ok('tem data para o normalizador', Boolean(Date.parse(i.isoDate)));
}

// ---- A2. o que TEM que ser descartado ----
{
  const molde = (over) => ({
    data: { Catalog: { searchStore: { elements: [Object.assign({
      title: 'Jogo X',
      description: 'desc',
      keyImages: [{ type: 'OfferImageWide', url: 'https://cdn.epic/img.jpg' }],
      catalogNs: { mappings: [{ pageSlug: 'jogo-x' }] },
      price: { totalPrice: { fmtPrice: { originalPrice: 'R$ 50,00' } } },
      promotions: { promotionalOffers: [{ promotionalOffers: [{
        startDate: new Date(Date.now() - 3600000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        discountSetting: { discountPercentage: 0 },
      }] }] },
    }, over)] } } },
  });
  ok('caso bom passa', rodar(molde({})).length === 1);
  ok('promoção FUTURA é descartada', rodar(molde({
    promotions: { promotionalOffers: [{ promotionalOffers: [{
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 172800000).toISOString(),
      discountSetting: { discountPercentage: 0 },
    }] }] },
  })).length === 0);
  ok('promoção JÁ ENCERRADA é descartada', rodar(molde({
    promotions: { promotionalOffers: [{ promotionalOffers: [{
      startDate: new Date(Date.now() - 172800000).toISOString(),
      endDate: new Date(Date.now() - 3600000).toISOString(),
      discountSetting: { discountPercentage: 0 },
    }] }] },
  })).length === 0);
  ok('desconto que não é 100% é descartado', rodar(molde({
    promotions: { promotionalOffers: [{ promotionalOffers: [{
      startDate: new Date(Date.now() - 3600000).toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      discountSetting: { discountPercentage: 25 },
    }] }] },
  })).length === 0);
  ok('sem slug é descartado (sem URL de loja o validador reprova)',
    rodar(molde({ catalogNs: {}, productSlug: '', urlSlug: '' })).length === 0);
  ok('sem imagem é descartado', rodar(molde({ keyImages: [] })).length === 0);
  ok('sem promoção nenhuma é descartado', rodar(molde({ promotions: null })).length === 0);
  ok('resposta vazia não quebra', rodar({}).length === 0);
  ok('resposta lixo não quebra', rodar({ data: { Catalog: {} } }).length === 0);
}

// ---- B. topologia ----
{
  const FEEDS = ['Feed oficial PlayStation', 'Feed Adrenaline', 'Feed GG.deals'];
  const mundo = () => {
    const nodes = [
      { name: GATILHOS[0], type: 'n8n-nodes-base.scheduleTrigger', position: [-2560, 400], id: 'g1', parameters: {} },
      { name: GATILHOS[1], type: 'n8n-nodes-base.manualTrigger', position: [-2560, 200], id: 'g2', parameters: {} },
      { name: MERGE, type: 'n8n-nodes-base.merge', position: [-2064, 384], id: 'm1', parameters: { numberInputs: FEEDS.length } },
    ];
    const connections = { [GATILHOS[0]]: { main: [[]] }, [GATILHOS[1]]: { main: [[]] } };
    FEEDS.forEach((nome, i) => {
      nodes.push({ name: nome, type: 'n8n-nodes-base.rssFeedRead', position: [-2320, 128 * (i + 1)], id: 'f' + i,
        parameters: { url: 'https://x/' + i }, retryOnFail: true, maxTries: 2, waitBetweenTries: 1500, onError: 'continueRegularOutput' });
      connections[nome] = { main: [[{ node: MERGE, type: 'main', index: i }]] };
      for (const g of GATILHOS) connections[g].main[0].push({ node: nome, type: 'main', index: 0 });
    });
    return { nodes, connections };
  };

  const m = mundo();
  let seq = 0, erro = null;
  try { aplicar(m.nodes, m.connections, () => 'novo-' + (++seq)); } catch (e) { erro = e.message; }
  ok('o patch aplica na topologia', !erro, erro);
  if (!erro) {
    const http = m.nodes.find((n) => n.name === NO_HTTP);
    const code = m.nodes.find((n) => n.name === NO_CODE);
    ok('o nó HTTP aponta para a Epic', http.parameters.url === URL_EPIC);
    ok('o HTTP herdou retry e onError dos feeds',
      http.retryOnFail === true && http.maxTries === 2 && http.onError === 'continueRegularOutput');
    ok('HTTP -> Normalizar Epic', m.connections[NO_HTTP].main[0][0].node === NO_CODE);
    ok('Normalizar Epic -> merge', m.connections[NO_CODE].main[0][0].node === MERGE);
    ok('entrou no índice livre (3), sem pisar nos feeds', m.connections[NO_CODE].main[0][0].index === 3);
    ok('o merge subiu de 3 para 4 entradas', m.nodes.find((n) => n.name === MERGE).parameters.numberInputs === 4);
    ok('os dois gatilhos disparam a Epic',
      GATILHOS.every((g) => m.connections[g].main[0].some((c) => c.node === NO_HTTP)));
    ok('os feeds antigos seguem nos mesmos índices',
      FEEDS.every((nome, i) => m.connections[nome].main[0][0].index === i));
    ok('nenhum nó em cima do outro',
      new Set(m.nodes.map((n) => n.position.join(','))).size === m.nodes.length);
    let re = null;
    try { aplicar(m.nodes, m.connections, () => 'x'); } catch (e) { re = e.message; }
    ok('recusa reaplicação', /já existe/.test(String(re)), re);
  }

  const torto = mundo();
  torto.nodes.find((n) => n.name === MERGE).parameters.numberInputs = 9;
  let e2 = null;
  try { aplicar(torto.nodes, torto.connections, () => 'y'); } catch (e) { e2 = e.message; }
  ok('aborta se o merge não bate com as ligações', /estão ligadas/.test(String(e2)), e2);

  const semModelo = mundo();
  semModelo.nodes = semModelo.nodes.filter((n) => n.name !== MODELO_FEED);
  let e3 = null;
  try { aplicar(semModelo.nodes, semModelo.connections, () => 'z'); } catch (e) { e3 = e.message; }
  ok('aborta sem o feed modelo', /modelo não achado/.test(String(e3)), e3);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
