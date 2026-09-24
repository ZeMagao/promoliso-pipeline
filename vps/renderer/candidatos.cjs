// CANDIDATOS DE IMAGEM — a peça deixa de morrer por causa de UMA foto (24/09/2026).
//
// Antes disto, uma imagem remota que falhasse derrubava o render inteiro; como a capa é
// obrigatória, derrubava a execução inteira do produtor. Aconteceu em 24/09 com uma URL do
// `news.xbox.com` que redireciona para si mesma (50 saltos, zero byte): a rodada morreu e a pauta
// se perdeu, porque já estava marcada como processada na curadoria. Os slides tinham fallback no
// fluxo do n8n; a capa não tinha nenhum.
//
// Agora cada `<img>` pode trazer `data-fallback` com outras URLs da MESMA peça (a capa e as fotos
// dos slides). Tenta em ordem e só falha se todas falharem.
//
// Este arquivo é separado do `server.cjs` de propósito: ele não depende de Chrome nem de sharp,
// então o harness roda offline, em qualquer máquina, sem instalar nada. Lógica pura em arquivo
// próprio é o que torna a prova barata.

// Lê uma tag <img> e devolve a primária e a lista de candidatos, em ordem.
function candidatosDaTag(tag) {
  const src = /\bsrc=(["'])(https:\/\/[^"']+)\1/i.exec(String(tag || ''));
  if (!src) return null;
  const fb = /\bdata-fallback=(["'])([^"']*)\1/i.exec(String(tag));
  const extras = fb ? fb[2].split(/\s+/).filter((u) => /^https:\/\//i.test(u)) : [];
  return { primaria: src[2], candidatos: [...new Set([src[2], ...extras])] };
}

// Tenta os candidatos em ordem com o buscador que vier. O buscador é injetado para o harness
// poder medir a REGRA sem depender da internet.
async function primeiraQueResponde(candidatos, buscar) {
  const erros = [];
  for (const url of candidatos) {
    try {
      return { url, dataUri: await buscar(url) };
    } catch (e) {
      erros.push(url.slice(0, 60) + ': ' + (e && e.message ? e.message : e));
    }
  }
  // A lista do que foi tentado vai na mensagem: sem isso o diagnóstico vira adivinhação, que é
  // exatamente o que custou horas em 24/09.
  throw new Error('nenhuma imagem candidata respondeu — ' + erros.join(' | '));
}

// Encontra as tags de imagem do nosso Cloudinary dentro do HTML. Mantém o escopo de antes: nesta
// altura do fluxo toda imagem legítima já é URL do Cloudinary.
function alvosDoHtml(html) {
  const tags = String(html || '').match(/<img\b[^>]*>/gi) || [];
  const alvos = [];
  for (const tag of tags) {
    const c = candidatosDaTag(tag);
    if (c && /^https:\/\/res\.cloudinary\.com\//i.test(c.primaria)) alvos.push(c);
  }
  return alvos;
}

module.exports = { candidatosDaTag, primeiraQueResponde, alvosDoHtml };
