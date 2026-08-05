// Alta resolução: nos 5 nós de render (:5680) do principal, injeta scale:2 e quality:95
// no payload (troca o único `quality: <n>` por `quality: 95, scale: 2`).
// Versiona igual writer_claude_editorial.cjs (versionId=activeVersionId + workflow_history). --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const TARGETS = ['Convert HTML to JPEG image','Criar imagem do story','Convert HTML to JPEG image1','Renderizar slide com fallback','Fila: render story'];
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q,p)=>new Promise((r,j)=>db.get(q,p||[],(e,x)=>e?j(e):r(x)));
const run = (q,p)=>new Promise((r,j)=>db.run(q,p||[],function(e){e?j(e):r(this);}));
function now(){const d=new Date();const p=(n,l=2)=>String(n).padStart(l,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}

(async()=>{
  const row = await get("SELECT nodes, connections, versionCounter FROM workflow_entity WHERE id=?",[WF]);
  const nodes = JSON.parse(row.nodes);
  let changed = 0;
  for (const name of TARGETS){
    const n = nodes.find(x=>x.name===name);
    if(!n){ console.log('  FALTA nó:',name); continue; }
    const body = String(n.parameters.jsonBody||'');
    const matches = [...body.matchAll(/quality:\s*\d+/g)];
    if(matches.length !== 1){ console.log('  PULADO (',matches.length,'matches quality):',name); continue; }
    if(/scale:\s*\d+/.test(body)){ console.log('  já tem scale, pulo:',name); continue; }
    n.parameters.jsonBody = body.replace(/quality:\s*\d+/, 'quality: 95, scale: 2');
    console.log('  OK',name,'-> quality:95, scale:2');
    changed++;
  }
  console.log('nós alterados:',changed,'/',TARGETS.length);
  if(DRY){ console.log('DRY — nada gravado.'); db.close(); return; }
  if(changed===0){ console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID(); const t = now();
  await run("BEGIN");
  try{
    await run("UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?",
      [nodesStr, V, V, (row.versionCounter||0)+1, t, WF]);
    await run("INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, 'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4', 1, 'render hi-res: scale 2 + quality 95 nos nós de render', '[]']);
    await run("COMMIT");
  }catch(e){ await run("ROLLBACK"); throw e; }
  fs.writeFileSync(path.join(__dirname,'..','newversion-render-hires.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch(e=>{console.error('FAIL',e.message);try{db.close();}catch{};process.exit(1);});
