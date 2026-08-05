// Grava o redesign no DB. RODAR COM O n8n PARADO. Idempotente-ish (gera novo versionId sempre).
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OUT = __dirname;
const DB = 'C:/Users/Magal/Documents/Codex/promoliso-n8n/data/.n8n/database.sqlite';
const WF = 'NL8eVLKErgnIXBQq';

const slideCode = fs.readFileSync(path.join(OUT, 'node_slide.js'), 'utf8');
const capaCode  = fs.readFileSync(path.join(OUT, 'node_capa.js'), 'utf8');
if (slideCode.length < 100000 || capaCode.length < 100000) throw new Error('node code suspeitosamente curto');

function fmt(d){
  const p=(n,l=2)=>String(n).padStart(l,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;
}

const db = new sqlite3.Database(DB, sqlite3.OPEN_READWRITE);
function get(q,p){return new Promise((res,rej)=>db.get(q,p||[],(e,r)=>e?rej(e):res(r)));}
function run(q,p){return new Promise((res,rej)=>db.run(q,p||[],function(e){e?rej(e):res(this);}));}

(async()=>{
  const row = await get("SELECT nodes, connections, name, versionCounter FROM workflow_entity WHERE id=?",[WF]);
  const nodes = JSON.parse(row.nodes);
  let patchedSlide=0, patchedCapa=0;
  for (const n of nodes){
    if (n.name==='Code in JavaScript'){ n.parameters = n.parameters||{}; n.parameters.jsCode = slideCode; patchedSlide++; }
    if (n.name==='Code in JavaScript1'){ n.parameters = n.parameters||{}; n.parameters.jsCode = capaCode; patchedCapa++; }
  }
  if (patchedSlide!==1 || patchedCapa!==1) throw new Error(`patch inesperado: slide=${patchedSlide} capa=${patchedCapa}`);
  // re-verifica
  for (const n of nodes){
    if (n.name==='Code in JavaScript' && n.parameters.jsCode!==slideCode) throw new Error('slide não bateu');
    if (n.name==='Code in JavaScript1' && n.parameters.jsCode!==capaCode) throw new Error('capa não bateu');
  }
  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const now = fmt(new Date());
  const desc = 'redesign estrutural: layout despoluido, hero variado por slide, capa com gancho+subtitulo, rotulos editoriais, CTA grupo/bio (v final B+A)';

  await run("BEGIN");
  try {
    await run("UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?",
      [nodesStr, V, V, (row.versionCounter||0)+1, now, WF]);
    await run("INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [V, WF, 'Promo Liso', now, now, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run("COMMIT");
  } catch(e){ await run("ROLLBACK"); throw e; }

  fs.writeFileSync(path.join(OUT,'newversion.txt'), V);
  console.log('OK versionId novo =', V);
  console.log('nodes len =', nodesStr.length, '| slideCode', slideCode.length, '| capaCode', capaCode.length);
  db.close();
})().catch(e=>{console.error('WRITER FAIL', e); try{db.close();}catch{} process.exit(1);});
