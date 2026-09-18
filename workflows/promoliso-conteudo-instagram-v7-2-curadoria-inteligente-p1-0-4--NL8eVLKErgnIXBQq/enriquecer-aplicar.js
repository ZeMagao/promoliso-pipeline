// zip por POSIÇÃO: o nó HTTP descarta __idx, mas preserva a ordem 1:1 dos itens.
// alvos vêm de $('Enriquecer: separar'); respostas de $input (mesma ordem).
let pool;
try { pool = JSON.parse(JSON.stringify($('Preparar candidatos').first().json.candidatos || [])); }
catch (e) { pool = null; }
if (!Array.isArray(pool)) {
  try { return [{ json: { candidatos: $('Preparar candidatos').first().json.candidatos || [] } }]; }
  catch (e2) { return [{ json: { candidatos: [] } }]; }
}
try {
  const ogRe = /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i;
  const twRe = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i;
  const temImg = (c) => c && c.imagem_principal && /^https:\/\//i.test(c.imagem_principal);
  const alvos = $('Enriquecer: separar').all().map((it) => (it && it.json) || {});
  const respostas = $input.all().map((it) => (it && it.json) || {});
  for (let k = 0; k < alvos.length; k++) {
    const idx = alvos[k].__idx;
    if (typeof idx !== 'number' || idx < 0) continue;
    const html = String((respostas[k] && respostas[k].data) || '');
    if (!html) continue;

    // Resposta do nosso serviço de fotos do jogo: JSON, não HTML. Guardamos a lista na candidata;
    // quem decide o que fazer com ela é o "Normalizar notícias", junto das fotos da matéria.
    if (alvos[k].__tipo === 'jogo') {
      try {
        const ficha = JSON.parse(html);
        const fotos = (ficha && Array.isArray(ficha.fotos)) ? ficha.fotos.filter((u) => /^https:\/\//i.test(u)) : [];
        const cand = pool[idx];
        if (cand && fotos.length) {
          cand.fotos_do_jogo = fotos.slice(0, 8);
          cand.jogo_identificado = String((ficha && ficha.jogo) || '');
        }
      } catch (e) { /* serviço fora do ar ou resposta estranha: a pauta segue com o que tem */ }
      continue;
    }
    const m = html.match(ogRe) || html.match(twRe);
    const og = m ? String(m[1]).trim() : '';
    const cand = pool[idx];
    if (cand && og && /^https:\/\//i.test(og) && !temImg(cand)) {
      cand.imagem_principal = og;
      cand.imagens_oficiais =
        (Array.isArray(cand.imagens_oficiais) && cand.imagens_oficiais.length)
          ? cand.imagens_oficiais : [og];
      cand.capa_enriquecida = true;
    }
  }
} catch (e) { /* mantém pool */ }
return [{ json: { candidatos: pool } }];