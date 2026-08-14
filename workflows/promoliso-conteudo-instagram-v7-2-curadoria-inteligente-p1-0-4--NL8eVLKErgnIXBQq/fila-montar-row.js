// runOnceForAllItems: usa .first() em nós single-run (sem depender de pairing do
// ramo do story). Story vem do upload (input atual). Nada de $('Validar...') (multi-run).
const prep = ($('Preparar registro pendente').first().json) || {};
const cover = (($('Obter URL primeira imagem').first().json) || {}).url || '';
const agg = (($('Aggregate').first().json) || {}).url || [];
const carousel = [cover, agg[0], agg[1], agg[2], agg[3], agg[4]].filter(Boolean);
const caption = (($('Edit Fields').first().json) || {}).legenda || '';
const storyUrl = (($input.first().json) || {}).secure_url || '';
const primary = String(prep.primary_url || '');
// Nota da curadoria: mesma fonte que o "Selecionar melhor pauta" usou para escolher esta pauta.
// Antes aqui ia 0 cravado, e o desempate por qualidade do publicador nascia morto.
const pauta = ($('Selecionar melhor pauta').first().json) || {};
const nota = Number(pauta.registro && pauta.registro.pontuacao_total);
return [{
  json: {
    content_key: String(prep.content_key || ''),
    topic: String(prep.topic || ''),
    category: String(prep.category || ''),
    caption: String(caption),
    carousel_urls: JSON.stringify(carousel),
    story_url: String(storyUrl),
    primary_url: primary,
    sources: JSON.stringify(primary ? [{ url: primary }] : []),
    status: 'READY',
    created_at: new Date().toISOString(),
    published_at: '',
    execution_id: String($execution.id || ''),
    score: Number.isFinite(nota) ? nota : 0,
  },
}];