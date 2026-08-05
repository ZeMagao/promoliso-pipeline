// Harness offline do patch_mensagens_validador.cjs.
// Compara a logica ANTIGA (a que esta no ar) com a NOVA (a do patch) contra os
// slides REAIS das execucoes 179/180 + casos sinteticos. O patch so pode ir pro ar
// se o veredito for IDENTICO em todos os casos -- ele muda mensagem, nao comportamento.
// Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_validador_mensagens.cjs
// (so leitura; nao grava nada)

const {execSync}=require("child_process");
const flatted=require("/opt/promoliso/node_modules/flatted");
const DB="/opt/promoliso/data/.n8n/database.sqlite";
const tipos=['capa','contexto','evidencia','impacto','acao'];
const limitar=(v,m)=>typeof v==="string"?v.slice(0,m):v;

// ANTIGA (como está no ar hoje, ja com caps 42/38)
function antiga(output){
  return Array.isArray(output.slides) && output.slides.length===5 &&
    output.slides.every((slide,index)=>
      slide?.tipo===tipos[index] &&
      typeof slide.titulo==='string' && slide.titulo.length>0 && slide.titulo.length<=42 &&
      typeof slide.destaque==='string' && slide.destaque.length>0 && slide.destaque.length<=38 &&
      typeof slide.texto==='string' && slide.texto.length<=300);
}
// NOVA (a do patch)
function nova(output){
  const p=[];
  if(!Array.isArray(output.slides)) p.push('slides não veio como lista');
  else if(output.slides.length!==5) p.push('esperava 5 slides e vieram '+output.slides.length);
  else output.slides.forEach((slide,index)=>{
    const onde='slide '+(index+1)+' ('+tipos[index]+')';
    if(slide?.tipo!==tipos[index]) p.push(onde+': tipo veio "'+(slide?.tipo??'ausente')+'"');
    if(typeof slide?.titulo!=='string'||slide.titulo.length===0) p.push(onde+': titulo vazio');
    else if(slide.titulo.length>42) p.push(onde+': titulo com '+slide.titulo.length+' chars (max 42)');
    if(typeof slide?.destaque!=='string'||slide.destaque.length===0) p.push(onde+': destaque vazio');
    else if(slide.destaque.length>38) p.push(onde+': destaque com '+slide.destaque.length+' chars (max 38)');
    if(typeof slide?.texto!=='string') p.push(onde+': texto ausente');
    else if(slide.texto.length>300) p.push(onde+': texto com '+slide.texto.length+' chars (max 300)');
  });
  return {valido:p.length===0, msg:p.length?('Estrutura dos cinco slides inválida -> '+p.join('; ')):null};
}

function slidesDaExec(id){
  const raw=execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=${id};"`,{maxBuffer:1024*1024*400}).toString();
  if(!raw.trim()) return null;
  const rd=flatted.parse(raw)?.resultData?.runData;
  const j=rd?.["Validar antes de publicar"]?.slice(-1)[0]?.data?.main?.[0]?.[0]?.json;
  const acha=(o)=>{ if(!o||typeof o!=="object") return null; if(Array.isArray(o.slides)) return o.slides;
    for(const k of Object.keys(o)){ const r=acha(o[k]); if(r) return r; } return null; };
  return acha(j);
}

const casos=[];
for(const id of [179,180]){
  const sl=slidesDaExec(id);
  if(sl) casos.push({nome:"exec "+id+" (dado REAL, ja normalizado por limitar)", output:{slides:sl}});
}
// sintetico: pauta perfeita -> tem que passar nas duas
casos.push({nome:"sintetico VALIDO", output:{slides:tipos.map(t=>({tipo:t,titulo:"T".repeat(30),destaque:"D".repeat(25),texto:"x".repeat(200)}))}});
// sintetico: destaque vazio no slide 3 -> tem que reprovar nas duas
casos.push({nome:"sintetico destaque vazio no slide 3", output:{slides:tipos.map((t,i)=>({tipo:t,titulo:"T".repeat(30),destaque:i===2?"":"D".repeat(25),texto:"x".repeat(200)}))}});
// sintetico: 4 slides -> reprova nas duas
casos.push({nome:"sintetico so 4 slides", output:{slides:tipos.slice(0,4).map(t=>({tipo:t,titulo:"T",destaque:"D",texto:"x"}))}});
// sintetico: ordem trocada -> reprova nas duas (comportamento preservado de proposito)
casos.push({nome:"sintetico ordem trocada (impacto antes de evidencia)", output:{slides:['capa','contexto','impacto','evidencia','acao'].map(t=>({tipo:t,titulo:"T",destaque:"D",texto:"x"}))}});

let divergencias=0;
for(const c of casos){
  const a=antiga(c.output), n=nova(c.output);
  const bate=(a===n.valido);
  if(!bate) divergencias++;
  console.log((bate?"IGUAL  ":"DIVERGE")+"  antiga="+String(a).padEnd(5)+" nova="+String(n.valido).padEnd(5)+"  "+c.nome);
  if(n.msg) console.log("         msg nova: "+n.msg.slice(0,300));
}
console.log("");
console.log(divergencias===0 ? "VEREDITO IDENTICO EM TODOS OS CASOS — so a mensagem muda." : ("ATENCAO: "+divergencias+" divergencia(s)!"));
