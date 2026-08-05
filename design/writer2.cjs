// Adiciona campo `subtitulo` ao schema do parser + prompt do agente.
// --dry: só computa e grava previews em scratchpad, NÃO toca no DB.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OUT = __dirname;
const DB = 'C:/Users/Magal/Documents/Codex/promoliso-n8n/data/.n8n/database.sqlite';
const WF = 'NL8eVLKErgnIXBQq';
const DRY = process.argv.includes('--dry');

const SUB_EX = {
  capa: 'Resumo do gancho em uma frase, sem cortar.',
  contexto: 'O pano de fundo em uma linha.',
  evidencia: 'O dado que sustenta a noticia.',
  impacto: 'O efeito pratico pra quem acompanha.',
  acao: 'O proximo passo, direto.'
};
const CAMPO_BULLET = '\n- subtitulo: frase curta, ate 90 caracteres, que fecha a ideia (e exibida como subtitulo na capa). Complementa o titulo e o destaque sem repeti-los e sem cortar no meio.';

function addSubtitulo(exampleStr){
  const obj = JSON.parse(exampleStr);
  if (!Array.isArray(obj.slides)) throw new Error('exemplo sem slides[]');
  for (const s of obj.slides){
    if ('subtitulo' in s) continue;
    // insere subtitulo logo apos "texto" mantendo ordem legivel
    const ns = {};
    for (const k of Object.keys(s)){ ns[k]=s[k]; if(k==='texto') ns.subtitulo = SUB_EX[s.tipo] || 'Frase curta que fecha a ideia.'; }
    if (!('subtitulo' in ns)) ns.subtitulo = SUB_EX[s.tipo] || 'Frase curta que fecha a ideia.';
    Object.keys(s).forEach(k=>delete s[k]);
    Object.assign(s, ns);
  }
  return JSON.stringify(obj, null, 2);
}

const db = new sqlite3.Database(DB, DRY?sqlite3.OPEN_READONLY:sqlite3.OPEN_READWRITE);
function get(q,p){return new Promise((res,rej)=>db.get(q,p||[],(e,r)=>e?rej(e):res(r)));}
function run(q,p){return new Promise((res,rej)=>db.run(q,p||[],function(e){e?rej(e):res(this);}));}

(async()=>{
  const row = await get("SELECT nodes, connections, name, versionCounter FROM workflow_entity WHERE id=?",[WF]);
  const nodes = JSON.parse(row.nodes);
  const parser = nodes.find(n=>n.name==='Estruturar Saída');
  const agent  = nodes.find(n=>n.name==='AI Agent');
  if(!parser||!agent) throw new Error('parser/agent não encontrados');

  const origExample = parser.parameters.jsonSchemaExample;
  const newExample = addSubtitulo(origExample);

  // valida JSON
  JSON.parse(newExample);
  if (!/"subtitulo"/.test(newExample)) throw new Error('subtitulo não entrou no exemplo');

  // systemMessage: (1) trocar o JSON embutido pelo novo; (2) bullet em Campos visuais
  let sys = agent.parameters.options.systemMessage;
  let swapped = false;
  if (sys.includes(origExample)){ sys = sys.split(origExample).join(newExample); swapped = true; }
  else {
    // fallback: insere subtitulo na capa do JSON embutido, se o exemplo diferir
    console.warn('AVISO: systemMessage não contém o exemplo idêntico; tentando insert por âncora.');
    sys = sys.replace('"texto": "Resumo curto da pauta.",', '"texto": "Resumo curto da pauta.",\n      "subtitulo": "'+SUB_EX.capa+'",');
  }
  const bulletAnchor = '- texto: até 190 caracteres.';
  let bulletAdded=false;
  if (sys.includes(bulletAnchor)){ sys = sys.replace(bulletAnchor, bulletAnchor+CAMPO_BULLET); bulletAdded=true; }

  console.log('swap JSON embutido:', swapped, '| bullet Campos visuais:', bulletAdded);
  console.log('exemplo:', origExample.length, '->', newExample.length);
  console.log('systemMessage:', agent.parameters.options.systemMessage.length, '->', sys.length);

  // previews
  fs.writeFileSync(path.join(OUT,'new_example.json'), newExample);
  fs.writeFileSync(path.join(OUT,'new_systemMessage.txt'), sys);

  if (DRY){ console.log('DRY — nada gravado. Confira new_example.json e new_systemMessage.txt'); db.close(); return; }

  if(!swapped || !bulletAdded) throw new Error('patch incompleto (swap='+swapped+' bullet='+bulletAdded+') — abortando');

  parser.parameters.jsonSchemaExample = newExample;
  agent.parameters.options.systemMessage = sys;

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const p=(n,l=2)=>String(n).padStart(l,'0'); const d=new Date();
  const now = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;
  const desc = 'agente: campo subtitulo por slide (usado na capa)';
  await run("BEGIN");
  try{
    await run("UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?",
      [nodesStr, V, V, (row.versionCounter||0)+1, now, WF]);
    await run("INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [V, WF, 'Promo Liso', now, now, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run("COMMIT");
  }catch(e){ await run("ROLLBACK"); throw e; }
  fs.writeFileSync(path.join(OUT,'newversion.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch(e=>{console.error('FAIL',e); try{db.close();}catch{} process.exit(1);});
