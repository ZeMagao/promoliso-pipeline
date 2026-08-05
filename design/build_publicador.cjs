// Constrói o workflow "PromoLiso - Publicador (fila)" (Passo 1: só manual, active=0).
// Núcleo carrossel+poll+publish clonado do molde exec71 (provado). + fila get/select/update + story.
const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const OUT=__dirname;
const CRED={ instagramOAuth2Api:{ id:'Gdjo89AicVj0L64v', name:'Instagram account' } };
const IGT='n8n-nodes-instagram-integrations.instagram';
const FILA={ __rl:true, value:'i2e8ZwnL9kwOV6OG', mode:'id', cachedResultName:'promoliso_fila' };
let X=0; const col=(y=0)=>{const p=[X,y];X+=240;return p;};
const uid=()=>crypto.randomUUID();
const N=[]; const push=(o)=>{N.push(o);return o.name;};
function readyIf(name,y){ return { id:uid(), name, type:'n8n-nodes-base.if', typeVersion:2.3, position:col(y), parameters:{ conditions:{ options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2}, conditions:[{ id:uid(), leftValue:"={{ String($json.status_code || '').toUpperCase() === 'FINISHED' }}", rightValue:'', operator:{type:'boolean',operation:'true',singleValue:true} }], combinator:'and' }, options:{} } }; }
function sleepNode(name,y){ return { id:uid(), name, type:'n8n-nodes-base.code', typeVersion:2, position:col(y), parameters:{ jsCode:'await new Promise((r)=>setTimeout(r,12000));\nreturn $input.all();' } }; }
function statusNode(name,y){ return { id:uid(), name, type:IGT, typeVersion:1, position:col(y), parameters:{ resource:'media', operation:'getMedia', mediaId:"={{ $('Preparar verificação').item.json.container_id }}", mediaDetailFields:['status_code'] }, credentials:CRED }; }

// 1. trigger
push({ id:uid(), name:'Executar Publicador', type:'n8n-nodes-base.manualTrigger', typeVersion:1, position:col() , parameters:{} });
// 2. ler fila
push({ id:uid(), name:'Ler fila', type:'n8n-nodes-base.dataTable', typeVersion:1, position:col(), parameters:{ operation:'get', dataTableId:FILA, limit:500, orderBy:true } });
// 3. selecionar READY
push({ id:uid(), name:'Selecionar READY', type:'n8n-nodes-base.code', typeVersion:2, position:col(), parameters:{ jsCode:
`const rows = $input.all().map(i=>i.json);
const ready = rows.filter(r=>String(r.status||'').toUpperCase()==='READY');
if(!ready.length) return [];
ready.sort((a,b)=> (Number(b.score||0)-Number(a.score||0)) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
const r = ready[0];
let urls=[]; try{ urls=JSON.parse(r.carousel_urls||'[]'); }catch(e){ urls=[]; }
if(!Array.isArray(urls) || urls.length<2) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);
return [{ json: {
  content_key: String(r.content_key||''),
  topic: String(r.topic||''),
  cover: urls[0],
  slides: urls.slice(1,6),
  caption: String(r.caption||''),
  story_url: String(r.story_url||''),
  primary_url: String(r.primary_url||''),
} }];` } });
// 4. marcar PUBLISHING
push({ id:uid(), name:'Marcar PUBLISHING', type:'n8n-nodes-base.dataTable', typeVersion:1, position:col(), parameters:{ operation:'update', dataTableId:FILA, matchType:'allConditions', filters:{ conditions:[{ keyName:'content_key', keyValue:'={{ $json.content_key }}' }] }, columns:{ mappingMode:'defineBelow', value:{ status:'PUBLISHING' }, matchingColumns:[], schema:[{id:'status',displayName:'status',required:false,defaultMatch:false,display:true,type:'string',canBeUsedToMatch:true,removed:false}] } } });
// 5. create carousel
push({ id:uid(), name:'Create a carousel post', type:IGT, typeVersion:1, position:col(), parameters:{ resource:'post', operation:'createCarouselPost', carouselChildren:{ child:[
  { image_url:"={{ $('Selecionar READY').item.json.cover }}" },
  { image_url:"={{ $('Selecionar READY').item.json.slides[0] }}" },
  { image_url:"={{ $('Selecionar READY').item.json.slides[1] }}" },
  { image_url:"={{ $('Selecionar READY').item.json.slides[2] }}" },
  { image_url:"={{ $('Selecionar READY').item.json.slides[3] }}" },
  { image_url:"={{ $('Selecionar READY').item.json.slides[4] }}" },
] }, carouselCaption:"={{ $('Selecionar READY').item.json.caption }}", carouselAdditionalOptions:{} }, credentials:CRED });
// 6. preparar verificação
push({ id:uid(), name:'Preparar verificação', type:'n8n-nodes-base.code', typeVersion:2, position:col(), parameters:{ jsCode:
`const created=$json||{};
if(!created.id) throw new Error('O Instagram não retornou o ID do contêiner');
const sel=$('Selecionar READY').item.json;
return [{ json:{ container_id:String(created.id), content_key:String(sel.content_key||''), story_url:String(sel.story_url||'') } }];` } });
// 7-12 poll
push(sleepNode('Aguardar processamento 1',0));
push(statusNode('Consultar status 1',0));
push(readyIf('Carrossel pronto 1?',0));
push(sleepNode('Aguardar processamento 2',160));
push(statusNode('Consultar status 2',160));
push(readyIf('Carrossel pronto 2?',160));
push(sleepNode('Aguardar processamento 3',320));
push(statusNode('Consultar status 3',320));
push(readyIf('Carrossel pronto 3?',320));
// 13. publish
push({ id:uid(), name:'Publish a post', type:IGT, typeVersion:1, position:col(), parameters:{ resource:'post', operation:'publishPost', creationId:"={{ $('Preparar verificação').item.json.container_id }}" }, credentials:CRED });
// 14. story (falha não bloqueia)
push({ id:uid(), name:'Create a story', type:IGT, typeVersion:1, position:col(), parameters:{ resource:'story', storyImageUrl:"={{ $('Preparar verificação').item.json.story_url }}", storyAdditionalOptions:{} }, credentials:CRED, onError:'continueRegularOutput' });
// 15. preparar PUBLISHED
push({ id:uid(), name:'Preparar PUBLISHED', type:'n8n-nodes-base.code', typeVersion:2, position:col(), parameters:{ jsCode:
`const pub=$('Publish a post').item.json||{};
return [{ json:{ content_key:$('Preparar verificação').item.json.content_key, status:'PUBLISHED', published_at:new Date().toISOString(), instagram_post_id:String(pub.id||pub.media_id||pub.post_id||'') } }];` } });
// 16. marcar PUBLISHED
push({ id:uid(), name:'Marcar PUBLISHED', type:'n8n-nodes-base.dataTable', typeVersion:1, position:col(), parameters:{ operation:'update', dataTableId:FILA, matchType:'allConditions', filters:{ conditions:[{ keyName:'content_key', keyValue:'={{ $json.content_key }}' }] }, columns:{ mappingMode:'defineBelow', value:{ status:'={{ $json.status }}', published_at:'={{ $json.published_at }}' }, matchingColumns:[], schema:[
  {id:'status',displayName:'status',required:false,defaultMatch:false,display:true,type:'string',canBeUsedToMatch:true,removed:false},
  {id:'published_at',displayName:'published_at',required:false,defaultMatch:false,display:true,type:'string',canBeUsedToMatch:true,removed:false},
] } } });
// 17. falha -> marcar FAILED
push({ id:uid(), name:'Preparar FALHA', type:'n8n-nodes-base.code', typeVersion:2, position:[3000,480], parameters:{ jsCode:
`return [{ json:{ content_key:$('Preparar verificação').item.json.content_key, status:'FAILED' } }];` } });
push({ id:uid(), name:'Marcar FALHA', type:'n8n-nodes-base.dataTable', typeVersion:1, position:[3240,480], parameters:{ operation:'update', dataTableId:FILA, matchType:'allConditions', filters:{ conditions:[{ keyName:'content_key', keyValue:'={{ $json.content_key }}' }] }, columns:{ mappingMode:'defineBelow', value:{ status:'={{ $json.status }}' }, matchingColumns:[], schema:[{id:'status',displayName:'status',required:false,defaultMatch:false,display:true,type:'string',canBeUsedToMatch:true,removed:false}] } } });

// ---- conexões ----
const one=(to)=>[[{node:to,type:'main',index:0}]];
const C={};
C['Executar Publicador']={main:one('Ler fila')};
C['Ler fila']={main:one('Selecionar READY')};
C['Selecionar READY']={main:one('Marcar PUBLISHING')};
C['Marcar PUBLISHING']={main:one('Create a carousel post')};
C['Create a carousel post']={main:one('Preparar verificação')};
C['Preparar verificação']={main:one('Aguardar processamento 1')};
C['Aguardar processamento 1']={main:one('Consultar status 1')};
C['Consultar status 1']={main:one('Carrossel pronto 1?')};
C['Carrossel pronto 1?']={main:[[{node:'Publish a post',type:'main',index:0}],[{node:'Aguardar processamento 2',type:'main',index:0}]]};
C['Aguardar processamento 2']={main:one('Consultar status 2')};
C['Consultar status 2']={main:one('Carrossel pronto 2?')};
C['Carrossel pronto 2?']={main:[[{node:'Publish a post',type:'main',index:0}],[{node:'Aguardar processamento 3',type:'main',index:0}]]};
C['Aguardar processamento 3']={main:one('Consultar status 3')};
C['Consultar status 3']={main:one('Carrossel pronto 3?')};
C['Carrossel pronto 3?']={main:[[{node:'Publish a post',type:'main',index:0}],[{node:'Preparar FALHA',type:'main',index:0}]]};
C['Publish a post']={main:one('Create a story')};
C['Create a story']={main:one('Preparar PUBLISHED')};
C['Preparar PUBLISHED']={main:one('Marcar PUBLISHED')};
C['Preparar FALHA']={main:one('Marcar FALHA')};

const wf={ name:'PromoLiso - Publicador (fila)', nodes:N, connections:C, settings:{ executionOrder:'v1', timezone:'America/Sao_Paulo' } };
fs.writeFileSync(path.join(OUT,'publicador_wf.json'), JSON.stringify(wf,null,2));
console.log('nós:',N.length,'| conexões:',Object.keys(C).length);
console.log('nomes:', N.map(n=>n.name).join(' | '));
