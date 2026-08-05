// Remove a linha "Arraste pra ver." do story (imagem única, não faz sentido). --dry nao grava.
const sqlite3=require('sqlite3'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const DB='C:/Users/Magal/Documents/Codex/promoliso-n8n/data/.n8n/database.sqlite';
const WF='NL8eVLKErgnIXBQq';
const DRY=process.argv.includes('--dry');
const RE=/<div style="display:flex;color:#9BFF25;font-family:PLDisplay[^>]*>Arraste pra ver\.<\/div>/g;
const db=new sqlite3.Database(DB, DRY?sqlite3.OPEN_READONLY:sqlite3.OPEN_READWRITE);
function get(q,p){return new Promise((r,j)=>db.get(q,p||[],(e,x)=>e?j(e):r(x)));}
function run(q,p){return new Promise((r,j)=>db.run(q,p||[],function(e){e?j(e):r(this);}));}
function now(){const d=new Date();const p=(n,l=2)=>String(n).padStart(l,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}
(async()=>{
  const w=await get("SELECT nodes,connections,versionCounter FROM workflow_entity WHERE id=?",[WF]);
  const N=JSON.parse(w.nodes);
  let total=0;
  ['Fila: render story','Criar imagem do story'].forEach(nm=>{
    const n=N.find(x=>x.name===nm); if(!n) throw new Error('sem '+nm);
    const key = n.parameters.jsonBody!==undefined?'jsonBody':(n.parameters.body!==undefined?'body':null);
    if(!key) throw new Error(nm+' sem jsonBody/body');
    const before=n.parameters[key];
    const m=(before.match(RE)||[]).length;
    n.parameters[key]=before.replace(RE,'');
    total+=m;
    console.log(nm+': removidos '+m+' | tem "Arraste" ainda?', /Arraste pra ver/.test(n.parameters[key]));
  });
  if(total<2) throw new Error('esperava 2 remoções, deu '+total);
  const nodesStr=JSON.stringify(N);
  console.log('total removido:',total);
  if(DRY){console.log('DRY — nada gravado');db.close();return;}
  const V=crypto.randomUUID(); const t=now();
  await run("BEGIN");
  try{
    await run("UPDATE workflow_entity SET nodes=?,versionId=?,activeVersionId=?,versionCounter=?,updatedAt=? WHERE id=?",
      [nodesStr,V,V,(w.versionCounter||0)+1,t,WF]);
    await run("INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [V,WF,'Promo Liso',t,t,nodesStr,w.connections,'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4',1,'story: remove Arraste pra ver (imagem unica)','[]']);
    await run("COMMIT");
  }catch(e){await run("ROLLBACK");throw e;}
  fs.writeFileSync(path.join(__dirname,'newversion.txt'),V);
  console.log('OK ver='+V);
  db.close();
})().catch(e=>{console.error('FAIL',e);try{db.close();}catch{}process.exit(1);});
