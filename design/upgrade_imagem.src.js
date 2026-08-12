// Recupera a foto GRANDE quando a URL raspada pede uma cópia reduzida.
//
// O site guarda a foto original e serve cópias menores acrescentando uma instrução no fim do
// endereço (`...-scaled.jpg?resize=1024%2C576&zoom=1`). Nós copiamos o endereço como está na
// matéria — com a instrução junto — e recebemos a cópia pequena. Aí o gate da capa (>=1000x675)
// reprova e a capa vira foto contida sobre preto.
//
// MEDIDO em 12/08/2026 (design/medir_upgrade_imagem.cjs, 140 URLs reais de 9 hosts):
//   29 de 31 URLs com parâmetro ficaram MAIORES tirando a instrução; 27 delas passam a servir de
//   capa. Nenhuma quebrou. Todo o ganho está no blog.playstation.com, que é a maior fonte da base.
//
// POR QUE A LISTA É FECHADA. Tirar query às cegas quebra CDN de URL assinada: a assinatura cobre
// os parâmetros, e mexer devolve 403. Foi o que a medição pegou — `s` estava na lista como
// "size" e as URLs do preview.redd.it responderam 403, porque lá `s` é a ASSINATURA. Regra: se
// sobrar UM parâmetro que não sabemos o que é, não mexe na URL.
//
// De brinde, some duplicata: a mesma foto aparecia na lista uma vez por variante de zoom.
const PARAMS_DE_TAMANHO = new Set([
  'fit', 'resize', 'w', 'width', 'h', 'height', 'size', 'quality', 'q', 'crop',
  'strip', 'zoom', 'ssl', 'auto', 'format', 'fm', 'dpr', 'cs', 'compress', 'fill',
]);

function semRedimensionar(url) {
  const u = String(url || '');
  if (!u) return u;
  const corte = u.indexOf('?');
  if (corte < 0) return u;
  const consulta = u.slice(corte + 1).split('#')[0];
  if (!consulta) return u;
  const chaves = consulta.split('&').filter(Boolean).map((par) => par.split('=')[0].toLowerCase());
  if (!chaves.length) return u;
  if (chaves.some((k) => !PARAMS_DE_TAMANHO.has(k))) return u;   // pode ser assinatura: não mexe
  return u.slice(0, corte);
}
