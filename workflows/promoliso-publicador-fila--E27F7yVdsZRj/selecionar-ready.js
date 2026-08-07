const rows = $input.all().map(i=>i.json);
const ready = rows.filter(r=>String(r.status||'').toUpperCase()==='READY');
if(!ready.length) return [];
// Antes: score DESC + created_at DESC = sempre a MAIS NOVA. Com a fila tendo estoque isso
// condena as antigas — entre dois slots quase sempre nasce uma row mais nova, então a de ontem
// nunca era escolhida (06/08: row 12 parada desde 05/08 com 3 mais novas na frente).
// Agora: entre as FRESCAS, publica a que está mais perto de vencer (earliest deadline first).
// Posta o que se perderia e deixa esperando o que continua válido no próximo slot.
const FRESCOR_MAX_H = 48;
const idadeH = (row) => {
  const t = Date.parse(String(row.created_at || row.createdAt || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const porVencerPrimeiro = (a,b) =>
  (idadeH(b) - idadeH(a)) || (Number(b.score||0) - Number(a.score||0));
const maisNovaPrimeiro = (a,b) =>
  (Number(b.score||0)-Number(a.score||0)) || String(b.created_at||'').localeCompare(String(a.created_at||''));
const frescas = ready.filter((row) => idadeH(row) <= FRESCOR_MAX_H);
// Se nada está fresco, mantém o comportamento antigo. Pauta velha é pior que pauta nova, mas
// melhor que slot vazio — e assim esta mudança nunca reduz publicação.
const fila = frescas.length
  ? frescas.slice().sort(porVencerPrimeiro)
  : ready.slice().sort(maisNovaPrimeiro);
const r = fila[0];
let urls=[]; try{ urls=JSON.parse(r.carousel_urls||'[]'); }catch(e){ urls=[]; }
if(!Array.isArray(urls) || urls.length<2) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);
return [{ json: {
  content_key: String(r.content_key||''),
  topic: String(r.topic||''),
  cover: urls[0],
  slides: urls.slice(1,6),
  caption: String(r.caption||''),
  story_url: String(r.story_url||''),
  primary_url: String(r.primary_url||''),
} }];