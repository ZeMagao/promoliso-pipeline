const created=$json||{};
if(!created.id) throw new Error('O Instagram não retornou o ID do contêiner');
const sel=$('Selecionar READY').item.json;
return [{ json:{ container_id:String(created.id), content_key:String(sel.content_key||''), story_url:String(sel.story_url||'') } }];