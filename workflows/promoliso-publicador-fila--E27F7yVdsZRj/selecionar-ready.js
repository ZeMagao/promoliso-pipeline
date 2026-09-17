const rows = $input.all().map(i=>i.json);
// READY = nunca tentada. RETRY = falhou uma vez e ganhou nova chance (ver "Preparar FALHA").
const PUBLICAVEIS = ['READY','RETRY'];
const ready = rows.filter(r=>PUBLICAVEIS.includes(String(r.status||'').toUpperCase()));
if(!ready.length) return [];

const FRESCOR_MAX_H = 48;      // teto do que ainda vale publicar
const JANELA_DO_DIA_H = 12;    // o que conta como "notícia de hoje"

// O Instagram aceita de 2 a 10 imagens num carrossel. A conta de QUAL saída do
// "Quantas imagens?" recebe a peça vive aqui, em código testável, e não na expressão do
// Switch — de propósito: índice fora da faixa faz o Switch derrubar a execução, e aí a row
// fica presa em PUBLISHING, o único estado que nem publica nem alerta.
const MIN_IMAGENS = 2;
const MAX_IMAGENS = 10;
const idadeH = (row) => {
  const t = Date.parse(String(row.created_at || row.createdAt || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const porNota = (a,b) =>
  (Number(b.score||0) - Number(a.score||0)) || (idadeH(a) - idadeH(b));
const maisNovaPrimeiro = (a,b) =>
  (idadeH(a) - idadeH(b)) || (Number(b.score||0) - Number(a.score||0));

const doDia = ready.filter((row) => idadeH(row) <= JANELA_DO_DIA_H);
const frescas = ready.filter((row) => idadeH(row) <= FRESCOR_MAX_H);
// Ramo A (notícia do dia) e ramo B (12–48 h) ordenam os dois por NOTA. O ramo B ordenava por
// mais nova e respondia por 51% das publicações, o que jogava a nota no lixo em metade das
// escolhas: medido em 20/08, peça de nota 82 apodreceu e peça de nota 73 publicou. Quem
// protege a notícia fresca é o ramo A ter prioridade, não a ordem interna do ramo B — lá
// dentro tudo já é de ontem ou anteontem.
// O ramo C (> 48 h) continua por mais nova: nota não salva notícia vencida.
const fila = doDia.length
  ? doDia.slice().sort(porNota)
  : (frescas.length ? frescas.slice().sort(porNota) : ready.slice().sort(maisNovaPrimeiro));

const r = fila[0];
let urls=[]; try{ urls=JSON.parse(r.carousel_urls||'[]'); }catch(e){ urls=[]; }
if(!Array.isArray(urls)) urls=[];
// Só url https serve: é o Instagram que baixa a imagem, e um item quebrado no meio da coleção
// fazia o filho nascer sem image_url. Medido nas 61 rows da fila: nenhuma perde imagem por
// causa deste filtro — ele não muda nada hoje, só fecha a porta.
const validas = urls.filter((u) => typeof u === 'string' && /^https:\/\//.test(u));
if(validas.length < MIN_IMAGENS) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);
// HOST PRÓPRIO PARA A IMAGEM (17/09). O buscador do Meta falha ao baixar de res.cloudinary.com —
// medido em 16/09: 3/8 e 3/6 por imagem lá, 8/8 fora de lá. Com 6 filhos, publicar virava 0,8% e
// os três slots do dia falharam com "Bad request". Aqui a URL vira a do nosso host, que serve a
// mesma imagem de disco (serviço promo-cdn). O que não casa o padrão do nosso cloud passa intacto.
const CDN_BASE = 'https://n8n.promoliso.com.br';
const RE_CLOUDINARY = /^https:\/\/res\.cloudinary\.com\/fy2n2qvr\/image\/upload\/(v[0-9]+)\/([A-Za-z0-9_-]{4,128})\.jpg$/;
const paraCdn = (url) => {
  const m = RE_CLOUDINARY.exec(String(url || ''));
  return m ? CDN_BASE + '/cdn/' + m[1] + '/' + m[2] + '.jpg' : String(url || '');
};
const usadas = validas.slice(0, MAX_IMAGENS).map(paraCdn);
return [{ json: {
  content_key: String(r.content_key||''),
  topic: String(r.topic||''),
  cover: usadas[0],
  // era slice(1,6): jogava fora a 7a imagem em diante e obrigava a peça a ter exatamente 6
  slides: usadas.slice(1),
  caption: String(r.caption||''),
  story_url: paraCdn(r.story_url),
  primary_url: String(r.primary_url||''),
  status_anterior: String(r.status||'').toUpperCase(),
  created_at: String(r.created_at || r.createdAt || ''),
  idade_h: Math.round(idadeH(r) * 10) / 10,
  n_imagens: usadas.length,
  // Saída do Switch, zero-based: 2 imagens -> 0, 6 -> 4, 10 -> 8. Dentro da faixa por
  // construção, porque menos de MIN_IMAGENS virou erro acima e o slice corta em MAX_IMAGENS.
  saida_carrossel: usadas.length - MIN_IMAGENS,
  imagens_ignoradas: validas.length - usadas.length,
} }];