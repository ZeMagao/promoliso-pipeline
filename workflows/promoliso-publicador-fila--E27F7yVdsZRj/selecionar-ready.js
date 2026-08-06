const rows = $input.all().map(i=>i.json);
const ready = rows.filter(r=>String(r.status||'').toUpperCase()==='READY');
if(!ready.length) return [];
ready.sort((a,b)=> (Number(b.score||0)-Number(a.score||0)) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
const r = ready[0];
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