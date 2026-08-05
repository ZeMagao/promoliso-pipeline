// PASSO 2 - VIRADA. Principal: para publish inline, so abastece fila (determinístico) + produtor 2/2h.
// Publicador: schedule nos slots + active=1 (unico publicador). --dry nao grava.
const sqlite3=require('sqlite3'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const DB='C:/Users/Magal/Documents/Codex/promoliso-n8n/data/.n8n/database.sqlite';
const MAIN='NL8eVLKErgnIXBQq'; const PUB='E27F7yVdsZRj';
const DRY=process.argv.includes('--dry');
const db=new sqlite3.Database(DB, DRY?sqlite3.OPEN_READONLY:sqlite3.OPEN_READWRITE);
function get(q,p){return new Promise((r,j)=>db.get(q,p||[],(e,x)=>e?j(e):r(x)));}
function run(q,p){return new Promise((r,j)=>db.run(q,p||[],function(e){e?j(e):r(this);}));}
function now(){const d=new Date();const p=(n,l=2)=>String(n).padStart(l,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}

(async()=>{
  // ===== MAIN =====
  const m=await get("SELECT nodes,connections,versionCounter FROM workflow_entity WHERE id=?",[MAIN]);
  const N=JSON.parse(m.nodes); const C=JSON.parse(m.connections);
  // asserts do estado esperado
  const ef=JSON.stringify(C['Edit Fields'].main);
  const da=JSON.stringify(C['Decisão aprovada?'].main);
  if(!ef.includes('Fila: render story')||!ef.includes('Split Out')) throw new Error('Edit Fields inesperado: '+ef);
  if(!da.includes('Create a carousel post')) throw new Error('Decisão aprovada? inesperado: '+da);
  // 1) Edit Fields -> só Split Out (tira fila do ramo paralelo)
  C['Edit Fields'].main=[[{node:'Split Out',type:'main',index:0}]];
  // 2) Decisão aprovada? out0: Create a carousel post -> Fila: render story (determinístico, pós-Aggregate)
  C['Decisão aprovada?'].main[0]=[{node:'Fila: render story',type:'main',index:0}];
  // 3) Schedule Trigger: produtor de 2 em 2h, 08-22
  const st=N.find(n=>n.name==='Schedule Trigger');
  st.parameters={ rule:{ interval:[{ field:'cronExpression', expression:'0 0 8-22/2 * * *' }] } };
  const mNodes=JSON.stringify(N), mConn=JSON.stringify(C);
  const mVer=crypto.randomUUID();

  // ===== PUBLICADOR =====
  const p=await get("SELECT nodes,connections,versionCounter FROM workflow_entity WHERE id=?",[PUB]);
  const PN=JSON.parse(p.nodes); const PC=JSON.parse(p.connections);
  if(!PN.find(n=>n.name==='Slots de publicação')){
    PN.push({ id:crypto.randomUUID(), name:'Slots de publicação', type:'n8n-nodes-base.scheduleTrigger', typeVersion:1.2, position:[0,180],
      parameters:{ rule:{ interval:[
        { field:'cronExpression', expression:'0 30 12 * * *' },
        { field:'cronExpression', expression:'0 0 20 * * *' },
        { field:'cronExpression', expression:'0 30 16 * * 2,3,5' },
      ] } } });
    PC['Slots de publicação']={ main:[[{node:'Ler fila',type:'main',index:0}]] };
  }
  const pNodes=JSON.stringify(PN), pConn=JSON.stringify(PC);
  const pVer=crypto.randomUUID();

  console.log('MAIN: Edit Fields.main ->',JSON.stringify(C['Edit Fields'].main));
  console.log('MAIN: Decisão aprovada?.main[0] ->',JSON.stringify(C['Decisão aprovada?'].main[0]));
  console.log('MAIN: cron ->',st.parameters.rule.interval[0].expression);
  console.log('PUB: tem Slots de publicação?',!!PN.find(n=>n.name==='Slots de publicação'),'| nós',PN.length);
  console.log('PUB: Slots -> Ler fila?',JSON.stringify(PC['Slots de publicação']));

  if(DRY){ console.log('\\nDRY — nada gravado.'); db.close(); return; }
  const t=now();
  await run("BEGIN");
  try{
    // main
    await run("UPDATE workflow_entity SET nodes=?,connections=?,versionId=?,activeVersionId=?,versionCounter=?,updatedAt=? WHERE id=?",
      [mNodes,mConn,mVer,mVer,(m.versionCounter||0)+1,t,MAIN]);
    await run("INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [mVer,MAIN,'Promo Liso',t,t,mNodes,mConn,'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4',1,'passo2 virada: publish inline OFF, so abastece fila (deterministico), produtor 2/2h',' []'.trim()||'[]']);
    // publicador
    await run("UPDATE workflow_entity SET nodes=?,connections=?,active=1,versionId=?,activeVersionId=?,versionCounter=?,updatedAt=?,triggerCount=1 WHERE id=?",
      [pNodes,pConn,pVer,pVer,(p.versionCounter||0)+1,t,PUB]);
    await run("INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [pVer,PUB,'Promo Liso',t,t,pNodes,pConn,'PromoLiso - Publicador (fila)',1,'passo2: schedule nos slots + active',_nodeGroups()]);
    await run("COMMIT");
  }catch(e){ await run("ROLLBACK"); throw e; }
  fs.writeFileSync(path.join(__dirname,'virada_versions.txt'), 'main='+mVer+'\\npub='+pVer);
  console.log('\\nOK gravado. main ver='+mVer+' | pub ver='+pVer);
  db.close();
})().catch(e=>{console.error('FAIL',e);try{db.close();}catch{}process.exit(1);});
function _nodeGroups(){return '[]';}
