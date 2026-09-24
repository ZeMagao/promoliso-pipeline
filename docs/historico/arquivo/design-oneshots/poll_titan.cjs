// Poller: espera nova row na fila (promoliso_fila) id > BASELINE = novo carrossel produzido
// com TITAN + Sonnet + hi-res. Ao achar, dumpa detalhes e sai. Timeout ~6h.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const DB = 'C:/Users/Magal/Documents/Codex/promoliso-n8n/data/.n8n/database.sqlite';
const T = 'data_table_user_i2e8ZwnL9kwOV6OG';
const OUTFILE = 'C:/Users/Magal/AppData/Local/Temp/claude/C--Users-Magal-Documents-Codex-promoliso-n8n/1f68a13c-ea1b-4bd1-b9ee-d43dd52318ec/scratchpad/titan_first_post.json';
const BASELINE = Number(process.argv[2] || 4);
const INTERVAL_MS = 8 * 60 * 1000;   // 8 min
const MAX_ITERS = 100;                // ~13h

function query(sql){
  return new Promise((res, rej)=>{
    const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY, (e)=>{ if(e) return rej(e); });
    db.all(sql, [], (e, rows)=>{ db.close(); e ? rej(e) : res(rows); });
  });
}
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

(async ()=>{
  for (let i=0; i<MAX_ITERS; i++){
    let rows;
    try { rows = await query(`SELECT id, topic, category, caption, carousel_urls, story_url, execution_id, status, created_at FROM ${T} WHERE id > ${BASELINE} ORDER BY id ASC`); }
    catch(e){ console.log(new Date().toISOString(), 'poll err:', e.message); await sleep(INTERVAL_MS); continue; }
    if (rows && rows.length){
      const r = rows[rows.length-1]; // mais recente
      let urls=[]; try{ urls = JSON.parse(r.carousel_urls||'[]'); }catch{}
      const out = { detectedAt: new Date().toISOString(), filaId: r.id, topic: r.topic, category: r.category,
        status: r.status, execution_id: r.execution_id, created_at: r.created_at,
        caption: r.caption, carousel_urls: urls, story_url: r.story_url, totalNovas: rows.length };
      fs.writeFileSync(OUTFILE, JSON.stringify(out, null, 2));
      console.log('NOVO POST NA FILA. id='+r.id+' topic="'+r.topic+'" urls='+urls.length);
      console.log('detalhes em', OUTFILE);
      process.exit(0);
    }
    console.log(new Date().toISOString(), `sem post novo (fila<=${BASELINE}); tentativa ${i+1}/${MAX_ITERS}`);
    await sleep(INTERVAL_MS);
  }
  console.log('TIMEOUT ~6h sem post novo. Rode de novo se quiser continuar.');
  process.exit(2);
})();
