// Frases pequenas: solta os caps de truncamento no "Validar antes de publicar"
// (limitar titulo 34->42, destaque 30->38, texto 110->300; check texto.length<=190 -> 300).
// Bate com o prompt (300) e com o layout TITAN (que cabe 300). Versiona igual. --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE = 'Validar antes de publicar';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q,p)=>new Promise((r,j)=>db.get(q,p||[],(e,x)=>e?j(e):r(x)));
const run = (q,p)=>new Promise((r,j)=>db.run(q,p||[],function(e){e?j(e):r(this);}));
function now(){const d=new Date();const p=(n,l=2)=>String(n).padStart(l,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}

(async()=>{
  const row = await get("SELECT nodes, connections, versionCounter FROM workflow_entity WHERE id=?", [WF]);
  const nodes = JSON.parse(row.nodes);
  const n = nodes.find(x=>x.name===NODE);
  if(!n) throw new Error('nó não achado: '+NODE);
  let code = n.parameters.jsCode;
  const before = code;
  const edits = [
    [/limitar\(slide\.titulo,\s*34\)/, 'limitar(slide.titulo, 42)'],
    [/limitar\(slide\.destaque,\s*30\)/, 'limitar(slide.destaque, 38)'],
    [/limitar\(slide\.texto,\s*110\)/, 'limitar(slide.texto, 300)'],
    [/slide\.texto\.length\s*<=\s*190/, 'slide.texto.length <= 300'],
  ];
  const report = [];
  for(const [re,rep] of edits){
    const hit = re.test(code);
    if(hit) code = code.replace(re, rep);
    report.push((hit?'OK  ':'FALTA ')+rep);
  }
  n.parameters.jsCode = code;
  console.log(report.join('\n'));
  const changed = code !== before;
  console.log('mudou:', changed);
  if(DRY){ console.log('DRY — nada gravado.'); db.close(); return; }
  if(!changed){ console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID(); const t = now();
  await run("BEGIN");
  try{
    await run("UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?",
      [nodesStr, V, V, (row.versionCounter||0)+1, t, WF]);
    await run("INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, 'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4', 1, 'frases: caps de truncamento 34/30/110/190 -> 42/38/300/300', '[]']);
    await run("COMMIT");
  }catch(e){ await run("ROLLBACK"); throw e; }
  fs.writeFileSync(path.join(__dirname,'..','newversion-frases.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch(e=>{console.error('FAIL',e.message);try{db.close();}catch{};process.exit(1);});
