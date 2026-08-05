// Insere o workflow Publicador + seed de 1 row READY na fila. RODAR COM n8n PARADO.
const sqlite3=require('sqlite3'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const OUT=__dirname;
const DB='C:/Users/Magal/Documents/Codex/promoliso-n8n/data/.n8n/database.sqlite';
const PROJECT='UMEgamUOb3MlN67m';
const FILA_TBL='data_table_user_i2e8ZwnL9kwOV6OG';

const wf=JSON.parse(fs.readFileSync(path.join(OUT,'publicador_wf.json'),'utf8'));
const pub=JSON.parse(fs.readFileSync(path.join(OUT,'exec87_publish.json'),'utf8'));
const cover=pub.cover[0].json.url;
const slides=pub.aggregate[0].json.url;
const caption=pub.editFields[0].json.legenda;
const storyUrl=pub.story[0].json.secure_url;
const carousel=[cover,...slides];
if(carousel.length!==6) throw new Error('esperava 6 urls, veio '+carousel.length);

function fmt(d){const p=(n,l=2)=>String(n).padStart(l,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}
const now=fmt(new Date()); const nowIso=new Date().toISOString();
const WFID=Array.from(crypto.randomBytes(12)).map(b=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b%62]).join('').slice(0,16);
const VER=crypto.randomUUID();
const CKEY='test-publicador:gmktec-neo-x1';

const db=new sqlite3.Database(DB,sqlite3.OPEN_READWRITE);
function get(q,p){return new Promise((r,j)=>db.get(q,p||[],(e,x)=>e?j(e):r(x)));}
function run(q,p){return new Promise((r,j)=>db.run(q,p||[],function(e){e?j(e):r(this);}));}
(async()=>{
  const exists=await get("SELECT id FROM workflow_entity WHERE name=?",[wf.name]);
  if(exists){ console.log('JÁ EXISTE workflow', wf.name, 'id='+exists.id, '— pulando insert do WF'); }
  else {
    await run("BEGIN");
    try{
      await run(`INSERT INTO workflow_entity
        (id,name,active,nodes,connections,settings,staticData,pinData,versionId,triggerCount,meta,parentFolderId,createdAt,updatedAt,isArchived,versionCounter,description,activeVersionId,nodeGroups,sourceWorkflowId)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [WFID, wf.name, 0, JSON.stringify(wf.nodes), JSON.stringify(wf.connections), JSON.stringify(wf.settings), null, null, VER, 0, null, null, now, now, 0, 1, null, null, '[]', null]);
      await run("INSERT INTO shared_workflow (workflowId,projectId,role,createdAt,updatedAt) VALUES (?,?,?,?,?)",
        [WFID, PROJECT, 'workflow:owner', now, now]);
      await run(`INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [VER, WFID, 'Promo Liso', now, now, JSON.stringify(wf.nodes), JSON.stringify(wf.connections), wf.name, 0, null, '[]']);
      await run("COMMIT");
      console.log('WF inserido id='+WFID, 'ver='+VER);
    }catch(e){ await run("ROLLBACK"); throw e; }
  }

  // seed fila
  const seeded=await get(`SELECT id FROM ${FILA_TBL} WHERE content_key=?`,[CKEY]);
  if(seeded){ console.log('seed já existe (id='+seeded.id+') — pulando'); }
  else {
    await run(`INSERT INTO ${FILA_TBL} (createdAt,updatedAt,content_key,topic,category,caption,carousel_urls,story_url,primary_url,sources,status,created_at,published_at,execution_id,score)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [now,now,CKEY,'TESTE Publicador - GMKtec Neo X1 Pro','NOTICIA',caption,JSON.stringify(carousel),storyUrl,'','[]','READY',nowIso,'','seed-test',100]);
    console.log('seed READY inserido na fila (content_key='+CKEY+', 6 urls, story ok)');
  }
  fs.writeFileSync(path.join(OUT,'publicador_id.txt'), (exists?exists.id:WFID));
  console.log('DONE. workflow id =', (exists?exists.id:WFID));
  db.close();
})().catch(e=>{console.error('FAIL',e);try{db.close();}catch{}process.exit(1);});
