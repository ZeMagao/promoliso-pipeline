// Roda o jsCode gerado de cada nó com um $input simulado (como o n8n faria) e renderiza.
const fs = require('fs');
const path = require('path');
const http = require('http');
const OUT = __dirname;

function runNodeCode(file, inputJson){
  const code = fs.readFileSync(path.join(OUT, file), 'utf8');
  const $input = { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] };
  const fn = new Function('$input', code);   // top-level return é permitido no corpo de Function
  const ret = fn($input);
  if (Array.isArray(ret) && ret[0] && ret[0].json && ret[0].json.html) return ret[0].json.html;
  throw new Error('sem html: ' + file);
}
function render(html, outFile){
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({html,width:1080,height:1350,quality:95});
    const req=http.request({host:'127.0.0.1',port:5680,path:'/render',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
      const ch=[];res.on('data',c=>ch.push(c));res.on('end',()=>{const b=Buffer.concat(ch);if(res.statusCode!==200){reject(new Error('HTTP '+res.statusCode+' '+b.toString().slice(0,300)));return;}fs.writeFileSync(path.join(OUT,outFile),b);console.log('OK',outFile,b.length,'bytes');resolve();});
    });
    req.on('error',reject);req.write(body);req.end();
  });
}
(async()=>{
  const output=JSON.parse(fs.readFileSync(path.join(OUT,'exec87_output.json'),'utf8'));
  // CAPA: input.json.output
  await render(runNodeCode('node_capa.js', { output }), 'NODE_capa.jpg');
  // SLIDE: input.json.slides (objeto único) — simula 4 conteúdos + cta como o pipeline
  const tipos=['contexto','evidencia','impacto','acao'];
  for(let i=0;i<4;i++){
    const s={...output.slides[i+1],selo:(output.categoria||'NOTICIA'),pagina:i+2,total:6,capaFallback:output.capa,tipo:tipos[i]};
    await render(runNodeCode('node_slide.js', { slides: s }), `NODE_${i+2}_slide.jpg`);
  }
  await render(runNodeCode('node_slide.js', { slides:{tipo:'cta',total:6} }), 'NODE_6_cta.jpg');
  console.log('VERIFY OK — nós geram HTML e renderizam');
})().catch(e=>{console.error('VERIFY FAIL',e);process.exit(1);});
