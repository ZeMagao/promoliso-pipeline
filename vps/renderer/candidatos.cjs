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

// APELIDO CURTO PARA A PONTE (02/10/2026). O Cloudinary recusa `image/fetch` cujo public_id passa
// de 255 caracteres ("public_id (...) is too long", HTTP 400). Imagem do Blogger (GameBlast) pela
// ponte passa de 330: em uma semana foram 7 URLs assim, e as 7 mataram a rodada — sempre a capa,
// que é obrigatória. Aqui a URL longa vira `…/img?a=<id>` (~65 caracteres) e o apelido é gravado
// em disco para a ponte achar a URL original. Abaixo do limite, a URL passa INTACTA: o caminho que
// funciona hoje não muda em nada.
const PONTE_U = 'https://n8n.promoliso.com.br/img?u=';
const PONTE_A = 'https://n8n.promoliso.com.br/img?a=';
const LIMITE_PUBLIC_ID = 230;   // o do Cloudinary é 255; folga para não morar na borda
const RE_FETCH = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/fetch\/.*?\/)(https?(?::|%3A).*)$/i;

const decodificar = (s) => { try { return decodeURIComponent(s); } catch (e) { return null; } };

// `registrar(id, urlOriginal)` é injetado: no servidor grava o arquivo, no harness só anota.
function encurtarPonte(url, registrar, hash) {
  const m = RE_FETCH.exec(String(url || ''));
  if (!m) return url;
  // Na URL a remota vem codificada uma vez (https%3A%2F%2F…); o Cloudinary mede depois de decodificar.
  const remota = /^https?%3A/i.test(m[2]) ? decodificar(m[2]) : m[2];
  if (!remota || remota.length <= LIMITE_PUBLIC_ID) return url;
  // Só a nossa ponte sabe servir apelido; URL longa de outro host segue como está.
  if (!remota.startsWith(PONTE_U)) return url;
  let original;
  try { original = new URL(remota).searchParams.get('u'); } catch (e) { return url; }
  if (!original || !/^https:\/\//i.test(original)) return url;
  const id = hash(original).slice(0, 32);
  registrar(id, original);
  // Codificada como a remota de antes: um `?` cru viraria query string da URL do Cloudinary.
  return m[1] + encodeURIComponent(PONTE_A + id);
}

module.exports = { candidatosDaTag, primeiraQueResponde, alvosDoHtml, encurtarPonte, LIMITE_PUBLIC_ID, PONTE_A, PONTE_U };
