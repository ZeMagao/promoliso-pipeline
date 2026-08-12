// Testa candidatos a feed ANTES de adicionar qualquer um no workflow.
//
// Nome numa lista de "melhores sites" não serve de critério: o que importa aqui é se o feed
// existe, se está vivo, e principalmente **se os itens trazem imagem** — sem imagem a pauta morre
// no validador e o feed só gasta execução. Este script mede isso.
//
// Colunas: HTTP, itens, idade do mais novo, % de itens com imagem, e se há corpo em HTML (de onde
// o normalizador raspa as fotos extras do carrossel).
//
//   node design/testar_feeds.cjs                 usa a lista de candidatos abaixo
//   node design/testar_feeds.cjs lista.txt       um feed por linha
const fs = require('fs');
const path = require('path');

const CANDIDATOS = [
  // --- promoção / desconto: a conta se chama PromoLiso e hoje NÃO tem nenhuma fonte dessas ---
  ['Promobit', 'https://www.promobit.com.br/blog/feed/'],
  ['Pelando', 'https://www.pelando.com.br/rss'],
  ['Hardmob promoções', 'https://www.hardmob.com.br/external.php?type=RSS2&forumids=248'],
  ['Steam News', 'https://store.steampowered.com/feeds/news.xml'],
  ['GG.deals', 'https://gg.deals/news/feed/'],
  ['Promobit (raiz)', 'https://www.promobit.com.br/feed/'],
  ['Nuuvem', 'https://www.nuuvem.com/br-pt/feed'],
  // --- notícia BR de games ---
  ['The Enemy', 'https://www.theenemy.com.br/feed'],
  ['Voxel (TecMundo games)', 'https://www.voxel.com.br/rss'],
  ['TecMundo', 'https://www.tecmundo.com.br/rss'],
  ['Canaltech', 'https://canaltech.com.br/rss/'],
  ['Olhar Digital', 'https://olhardigital.com.br/feed/'],
  ['MeUPS', 'https://meups.com.br/feed/'],
  ['Arkade', 'https://arkade.com.br/feed/'],
  ['Combo Infinito', 'https://comboinfinito.com.br/feed/'],
  ['GameHall', 'https://gamehall.com.br/feed/'],
  ['ND Games', 'https://www.ndgames.com.br/feed/'],
  ['Drops de Jogos', 'https://dropsdejogos.uai.com.br/feed/'],
  ['IGN Brasil', 'https://br.ign.com/feed.xml'],
  ['Nintendo Blast', 'https://www.nintendoblast.com.br/feeds/posts/default?alt=rss'],
  ['GameBlast', 'https://www.gameblast.com.br/feeds/posts/default?alt=rss'],
  ['Tecnoblog', 'https://tecnoblog.net/feed/'],
  ['Mundo Conectado', 'https://mundoconectado.com.br/feed'],
  ['Game Rant (EN)', 'https://gamerant.com/feed/'],
  ['Terra Games', 'https://www.terra.com.br/rss/games.xml'],
  ['TudoCelular', 'https://www.tudocelular.com/rss.xml'],
  ['IGN BR (alt)', 'https://br.ign.com/rss/feed.xml'],
  // --- oficiais que faltam (já temos PS, Xbox, Nintendo JP, NVIDIA, Intel) ---
  ['AMD Gaming', 'https://www.amd.com/en/newsroom/press-releases.rss'],
  ['Epic Games', 'https://store.epicgames.com/pt-BR/news'],
  ['Nintendo BR', 'https://www.nintendo.com/pt-br/whatsnew/rss/'],
];

const lista = process.argv[2] && fs.existsSync(process.argv[2])
  ? fs.readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((u) => [new URL(u).host, u])
  : CANDIDATOS;

const conta = (txt, re) => (txt.match(re) || []).length;

async function testar(nome, url) {
  let r;
  try {
    r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; PromoLisoBot/1.0)', accept: 'application/rss+xml,application/xml,text/xml,*/*' }, redirect: 'follow' });
  } catch (e) { return { nome, url, erro: String(e.message).slice(0, 45) }; }
  const txt = await r.text();
  if (!r.ok) return { nome, url, erro: 'http ' + r.status };
  const ehXml = /<rss|<feed|<rdf:RDF/i.test(txt.slice(0, 800));
  if (!ehXml) return { nome, url, erro: 'não é RSS (veio HTML?)' };

  const itens = txt.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  // imagem: enclosure, media:content/thumbnail, ou <img> dentro do corpo
  let comImagem = 0, comHtml = 0;
  for (const it of itens) {
    if (/<enclosure[^>]+url=|<media:(content|thumbnail)[^>]+url=|<img[^>]+src=|&lt;img[^&]+src=/i.test(it)) comImagem++;
    if (/<content:encoded|&lt;p&gt;|<description>[^<]*&lt;/i.test(it)) comHtml++;
  }
  const datas = [...txt.matchAll(/<(?:pubDate|updated|published)>([^<]+)</gi)]
    .map((m) => Date.parse(m[1])).filter(Number.isFinite);
  const maisNovo = datas.length ? Math.max(...datas) : null;
  const idadeH = maisNovo ? Math.round((Date.now() - maisNovo) / 3600000) : null;
  return {
    nome, url, itens: itens.length,
    idadeH,
    pctImagem: itens.length ? Math.round((comImagem / itens.length) * 100) : 0,
    pctHtml: itens.length ? Math.round((comHtml / itens.length) * 100) : 0,
  };
}

(async () => {
  const resultados = [];
  for (const [nome, url] of lista) resultados.push(await testar(nome, url));

  const bons = resultados.filter((x) => !x.erro && x.itens > 3 && x.pctImagem >= 50 && x.idadeH !== null && x.idadeH < 96);
  console.log('feed                          itens  novo(h)  img%  html%   veredito');
  console.log('-'.repeat(78));
  for (const x of resultados) {
    if (x.erro) { console.log(x.nome.padEnd(28), '  —      —       —     —     FORA: ' + x.erro); continue; }
    const bom = bons.includes(x);
    const motivo = bom ? 'SERVE'
      : x.itens <= 3 ? 'FORA: quase sem item'
        : x.pctImagem < 50 ? 'FORA: pouca imagem (a pauta morre no validador)'
          : x.idadeH === null ? 'FORA: sem data' : 'FORA: parado há ' + x.idadeH + 'h';
    console.log(x.nome.padEnd(28), String(x.itens).padStart(5), String(x.idadeH ?? '—').padStart(8),
      String(x.pctImagem).padStart(5), String(x.pctHtml).padStart(6), '  ' + motivo);
  }
  console.log(`\n${bons.length} de ${resultados.length} candidatos servem.`);
  fs.writeFileSync(path.join(__dirname, 'feeds_candidatos.json'),
    JSON.stringify({ testado_em: '2026-08-12', resultados }, null, 2) + '\n');
  console.log('gravado design/feeds_candidatos.json');
})();
