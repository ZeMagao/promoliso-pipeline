// Formata a legenda de forma determinística: hook / corpo / CTA em blocos
// separados + todas as hashtags juntas no fim. Não confia no LLM pra layout.
let out;
try {
  const raw = String($('Validar antes de publicar').item.json.output.legenda || '');
  const tags = [];
  (raw.match(/#[0-9A-Za-zÀ-ÿ_]+/g) || []).forEach((t) => {
    let dup = false;
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].toLowerCase() === t.toLowerCase()) { dup = true; break; }
    }
    if (!dup) tags.push(t);
  });
  let body = raw
    .replace(/#[0-9A-Za-zÀ-ÿ_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const frases = (body.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [body])
    .map((x) => x.trim())
    .filter(Boolean);
  let blocos;
  if (frases.length >= 3) {
    const hook = frases[0];
    const cta = frases[frases.length - 1];
    const meio = frases.slice(1, -1).join(' ');
    blocos = [hook, meio, cta].filter(Boolean);
  } else {
    blocos = [body];
  }
  out = blocos.join('\n\n');
  if (tags.length) out += '\n\n' + tags.join(' ');
  if (!out) out = raw;
} catch (e) {
  out = String(($('Validar antes de publicar').item.json.output || {}).legenda || '');
}
const item = $input.item;
item.json.legenda_formatada = out;
return item;