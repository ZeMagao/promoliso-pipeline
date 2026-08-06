let output = $json.output ?? $json;

if (typeof output === 'string') {
  const limpo = output
    .replace(/^\s*\x60{3}(?:json)?\s*/i, '')
    .replace(/\s*\x60{3}\s*$/i, '')
    .trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) {
    return [{
      json: {
        pauta_validada: false,
        motivo_reprovacao: 'A IA não retornou um JSON editorial válido',
        relatorio_validacao: { erros: ['JSON editorial ausente'] },
        output: null,
      },
    }];
  }
  const jsonEditorial = limpo.slice(inicio, fim + 1);
  try {
    output = JSON.parse(jsonEditorial);
  } catch (error) {
    const jsonEditorialReparado = jsonEditorial
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    try {
      output = JSON.parse(jsonEditorialReparado);
    } catch (repairError) {
      return [{
        json: {
          pauta_validada: false,
          motivo_reprovacao: 'A IA retornou um JSON editorial malformado',
          relatorio_validacao: { erros: ['JSON editorial malformado'] },
          output: null,
        },
      }];
    }
  }
}

if (output?.output && typeof output.output === 'object') output = output.output;
if (!output || typeof output !== 'object') {
  return [{
    json: {
      pauta_validada: false,
      motivo_reprovacao: 'A IA não retornou uma pauta estruturada',
      relatorio_validacao: { erros: ['Pauta estruturada ausente'] },
      output: null,
    },
  }];
}

function limitar(value, maximo) {
  const texto = String(value || '').trim();
  if (texto.length <= maximo) return texto;
  // Preferir terminar numa fronteira de frase dentro do limite, para não deixar
  // um fragmento da frase seguinte pendurado (ex.: "...O impacto." / "...Se.").
  const janela = texto.slice(0, maximo);
  const fimFrase = Math.max(
    janela.lastIndexOf('. '),
    janela.lastIndexOf('! '),
    janela.lastIndexOf('? '),
  );
  if (fimFrase >= Math.floor(maximo * 0.5)) {
    return texto.slice(0, fimFrase + 1).trim();
  }
  // Fallback: corta em palavra e remove conjunção/preposição pendurada.
  const limiteDoCorpo = Math.max(1, maximo - 1);
  const recorte = texto.slice(0, limiteDoCorpo + 1);
  const ultimaPalavra = recorte.lastIndexOf(' ');
  let resultado = (ultimaPalavra >= Math.floor(limiteDoCorpo * 0.65)
    ? recorte.slice(0, ultimaPalavra)
    : texto.slice(0, limiteDoCorpo)).replace(/[,:;\s.]+$/, '');
  const palavrasPendentes = /\s+(?:a|as|o|os|e|de|da|das|do|dos|em|na|nas|no|nos|para|por|que|se|com|ou|mas|um|uma)$/i;
  while (palavrasPendentes.test(resultado)) {
    resultado = resultado.replace(palavrasPendentes, '').trim();
  }
  return resultado.replace(/[,:;\s.]+$/, '') + '.';
}

function urlInfo(value) {
  const url = String(value || '').trim();
  const match = url.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match) return null;
  const host = match[1]
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '0.0.0.0' ||
    host === '::1'
  ) return null;
  return { url, host };
}

function hostIn(host, domains) {
  return domains.some(
    (domain) => host === domain || host.endsWith('.' + domain),
  );
}

function dataRecente(value, dias) {
  const texto = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(texto)) return false;
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) return false;
  const idade = Date.now() - data.getTime();
  return idade >= -86400000 && idade <= dias * 86400000;
}


function normalizarTexto(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const palavrasGenericas = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos',
  'e', 'em', 'entre', 'essa', 'esse', 'esta', 'este', 'foi', 'mais', 'na',
  'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelo', 'por',
  'que', 'se', 'sem', 'sobre', 'sua', 'suas', 'um', 'uma', 'the', 'and',
  'for', 'from', 'how', 'into', 'new', 'news', 'of', 'on', 'to', 'with',
  'games', 'game', 'gaming', 'noticia', 'noticias', 'oficial', 'official',
]);

function tokensSemanticos(value) {
  return [...new Set(
    normalizarTexto(value)
      .split(/\s+/)
      .filter((token) =>
        token.length >= 3 &&
        !palavrasGenericas.has(token) &&
        !/^\d+$/.test(token),
      ),
  )];
}

function urlCanonica(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

function tokensDaUrl(value) {
  return tokensSemanticos(
    String(value || '')
      .replace(/^https?:\/\/[^/]+/i, ' ')
      .replace(/[?#].*$/, ' '),
  );
}

function sobreposicaoSemantica(tokensPauta, tokensFonte) {
  const fonte = new Set(tokensFonte);
  return tokensPauta.filter((token) => fonte.has(token));
}

function valorNumerico(value) {
  const texto = String(value || '').replace(/[^\d,.-]/g, '').trim();
  if (!texto) return 0;
  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

const dominiosPrimarios = [
  'playstation.com',
  'sony.com',
  'xbox.com',
  'microsoft.com',
  'halowaypoint.com',
  'xboxwire.thesourcemediaassets.com',
  'nintendo.com',
  'nintendo.com.au',
  'nintendo-europe.com',
  'nvidia.com',
  'amd.com',
  'intel.com',
  'samsung.com',
  'lg.com',
  'asus.com',
  'msi.com',
  'gigabyte.com',
  'aorus.com',
  'acer.com',
  'dell.com',
  'alienware.com',
  'lenovo.com',
  'corsair.com',
  'logitechg.com',
  'razer.com',
  'ea.com',
  'ubisoft.com',
  'rockstargames.com',
  'take2games.com',
  'bethesda.net',
  'bandainamcoent.com',
  'capcom.com',
  'capcom.co.jp',
  'konami.com',
  'konami.jp',
  'square-enix.com',
  'square-enix-holdings.com',
  'sonyinteractive.com',
  'activision.com',
  'blizzard.com',
  'riotgames.com',
  'nintendo.co.jp',
  'sega.jp',
  'sega.com',
  'square-enix-games.com',
  'cdprojektred.com',
  'epicgames.com',
  'steampowered.com',
  'steamcommunity.com',
  'gog.com',
  'unity.com',
  'unrealengine.com',
];
const dominiosLojas = [
  'amazon.com.br',
  'kabum.com.br',
  'magazineluiza.com.br',
  'mercadolivre.com.br',
  'terabyteshop.com.br',
  'pichau.com.br',
  'nuuvem.com',
  'greenmangaming.com',
  'gog.com',
  'steampowered.com',
  'playstation.com',
  'xbox.com',
  'nintendo.com',
  'epicgames.com',
];
const dominiosBloqueados = [
  'google.com',
  'googleusercontent.com',
  'bing.com',
  'brave.com',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'pinterest.com',
  'x.com',
  'twitter.com',
  'example.com',
  'localhost',
];
const imagensBloqueadas = [
  ...dominiosBloqueados,
  'ytimg.com',
  'twimg.com',
  'fbcdn.net',
];


let candidatoEditorialAprovado = null;
try {
  const referenciaContexto = $('Montar contexto editorial');
  const itensContexto =
    typeof referenciaContexto.all === 'function'
      ? referenciaContexto.all()
      : [referenciaContexto.item];
  candidatoEditorialAprovado =
    itensContexto
      .flatMap((item) => item?.json?.candidatos || [])
      .filter(Boolean)[0] || null;
} catch (error) {
  candidatoEditorialAprovado = null;
}

const imagensOficiaisDoCandidato = [
  candidatoEditorialAprovado?.imagem_principal,
  ...(Array.isArray(candidatoEditorialAprovado?.imagens_oficiais)
    ? candidatoEditorialAprovado.imagens_oficiais
    : []),
]
  .map((url) => String(url || '').trim())
  .filter((url) => /^https:\/\//i.test(url))
  .filter((url, index, array) => array.indexOf(url) === index);

const urlCandidato = String(candidatoEditorialAprovado?.url || '').trim();
const fonteCandidataOriginal = (Array.isArray(output.fontes)
  ? output.fontes
  : []
).find(
  (fonte) =>
    urlCanonica(fonte?.url) === urlCanonica(urlCandidato),
);
const fonteDoCandidatoPresente = (Array.isArray(output.fontes)
  ? output.fontes
  : []
).some(
  (fonte) =>
    urlCanonica(fonte?.url) === urlCanonica(urlCandidato),
);
// O artigo que originou a pauta é recente, relevante e veio do RSS, mas o
// agente costuma esquecer de citá-lo — e aí sobra uma única confirmação e a
// validação reprova. Injetamos em código para não depender do comportamento
// do modelo. Entra no fim: as fontes que o agente escolheu seguem em primeiro.
if (urlCandidato && !fonteDoCandidatoPresente) {
  if (!Array.isArray(output.fontes)) output.fontes = [];
  output.fontes.push({
    nome: candidatoEditorialAprovado?.fonte || 'Fonte original',
    titulo: candidatoEditorialAprovado?.titulo || '',
    descricao: candidatoEditorialAprovado?.resumo || '',
    url: urlCandidato,
    data_publicacao: candidatoEditorialAprovado?.publicado_em || '',
    origem_automatica: true,
  });
}

const estruturaEditorialCompleta =
  Array.isArray(output.slides) &&
  output.slides.length === 5 &&
  output.slides.every(
    (slide) =>
      slide &&
      typeof slide.titulo === 'string' &&
      typeof slide.destaque === 'string' &&
      typeof slide.texto === 'string',
  );
const reprovacaoSomentePorRecuperacao =
  output.aprovado_para_publicar !== true &&
  /(?:imagem|fonte prim.ria|busca|acess.vel|visual)/i.test(
    String(output.motivo_reprovacao || ''),
  );
const recuperacaoSeguraDeMidia =
  output.aprovado_para_publicar === true ||
  reprovacaoSomentePorRecuperacao;
const textoEditorialRecuperavel = [
  output.legenda,
  ...(Array.isArray(output.slides)
    ? output.slides.flatMap((slide) => [
        slide?.titulo,
        slide?.destaque,
        slide?.texto,
      ])
    : []),
].join(' ');
// Dúvida/hedge editorial: desistência de IMAGEM (semana1c) + dúvida de
// FONTE/confirmação (semana1f). Se aparecer no texto, a pauta não é publicável
// — bloqueia o recovery e reprova mais abaixo.
const regexDuvidaEditorial =
  /(?:n.o d. para postar|refazer a checagem|aguardar nova base|n.o deu para aprovar|melhor segurar|preferimos segurar|o que faltou fechar|risco de ru.do|espere a arte|espere a valida|quando houver (?:a )?(?:arte|imagem|fonte|confirma)|s. fica segur\w* quando|aguard\w* (?:a )?(?:arte|imagem|confirma|valida|fonte)|imagem oficial direta|sem prova oficial|sem p.gina oficial|sem fonte prim.ria|faltou a origem oficial|n.o localiz\w+ .{0,30}fonte prim.ria|n.o fechou com a confirma|confirma..o oficial que a promoliso|antes de tratar isso como novidade)/i;
const conteudoDeBloqueioEditorial = regexDuvidaEditorial.test(
  textoEditorialRecuperavel,
);
const candidatoPrimario =
  String(candidatoEditorialAprovado?.tipo_fonte || '').toLowerCase() ===
  'primaria';

// A recuperação de imagem não depende mais de o candidato-semente ser
// primário. A confirmação de fonte é checada à parte em output.fontes (exige
// fonte primária relevante OU duas confirmações independentes). O que basta
// aqui: o candidato traz as próprias imagens oficiais — extraídas da fonte pelo
// Normalizar — e o agente só reprovou por mídia. Sem isso, pauta da imprensa BR
// (tipo_fonte=editorial) com imagem boa era descartada porque o agente colava a
// URL .html da release notes no lugar da imagem.
// fonteDoCandidatoPresente reflete se o AGENTE citou o candidato e é calculado
// antes da injeção automática de fonte — quando o agente esquece de citá-lo
// (comum), fica false mesmo já tendo sido injetado logo acima. Para o recovery
// de imagem, o que importa é que a fonte do candidato esteja disponível DEPOIS
// da injeção, não que o agente a tenha citado.
const fonteDoCandidatoDisponivel =
  Boolean(urlCandidato) &&
  (Array.isArray(output.fontes) ? output.fontes : []).some(
    (fonte) => urlCanonica(fonte?.url) === urlCanonica(urlCandidato),
  );
const recuperacaoDeImagemHabilitada =
  fonteDoCandidatoDisponivel &&
  estruturaEditorialCompleta &&
  imagensOficiaisDoCandidato.length > 0 &&
  recuperacaoSeguraDeMidia &&
  !conteudoDeBloqueioEditorial;

if (recuperacaoDeImagemHabilitada) {
  output.capa = imagensOficiaisDoCandidato[0];
  output.slides = output.slides.map((slide, index) => ({
    ...slide,
    imagem:
      imagensOficiaisDoCandidato[index % imagensOficiaisDoCandidato.length],
    fonte_imagem:
      String(slide.fonte_imagem || '').trim() ||
      String(candidatoEditorialAprovado.fonte || 'FONTE OFICIAL'),
  }));
  // Colapsar para uma única fonte só quando o semente é primário: aí a própria
  // URL do candidato já é a confirmação. Para pauta editorial, preservamos as
  // fontes que o agente reuniu (validadas abaixo) — senão perderíamos a
  // confirmação primária independente (ex.: amd.com) e sobraria só o portal.
  if (candidatoPrimario) {
    output.fontes = [{
      nome: String(candidatoEditorialAprovado.fonte || 'FONTE OFICIAL'),
      url: urlCandidato,
      data_publicacao: String(
        candidatoEditorialAprovado.publicado_em ||
        candidatoEditorialAprovado.data_publicacao ||
        fonteCandidataOriginal?.data_publicacao ||
        '',
      ).slice(0, 10),
    }];
  }
  output.aprovado_para_publicar = true;
  output.motivo_reprovacao = '';
  output.recuperacao_midias_oficiais = true;
}

if (Array.isArray(output.slides)) {
  output.slides = output.slides.map((slide) => ({
    ...slide,
    selo: limitar(slide.selo, 22),
    titulo: limitar(slide.titulo, 42),
    destaque: limitar(slide.destaque, 38),
    texto: limitar(slide.texto, 300),
  }));
}

const erros = [];
const categorias = ['OFERTA', 'ALERTA', 'GUIA', 'NOTICIA'];
const tipos = ['capa', 'contexto', 'evidencia', 'impacto', 'acao'];

if (output.aprovado_para_publicar !== true) {
  // o texto do agente vai pro corpo do e-mail de alerta; sem truncar, vira ensaio
  const motivoDoAgente = String(output.motivo_reprovacao || '').trim();
  erros.push(
    motivoDoAgente
      ? 'A própria análise editorial reprovou a pauta: ' +
        (motivoDoAgente.length > 200
          ? motivoDoAgente.slice(0, 200) + '…'
          : motivoDoAgente)
      : 'A própria análise editorial reprovou a pauta',
  );
}
if (!categorias.includes(output.categoria)) {
  erros.push('Categoria editorial inválida');
}
if (!String(output.tema || '').trim()) {
  erros.push('Tema ausente');
}

const textosPrincipais = [
  output.tema,
  ...(Array.isArray(output.slides)
    ? output.slides.flatMap((slide) => [slide?.titulo, slide?.destaque])
    : []),
].join(' ');
if (/\b(bomba|chocante|você não vai acreditar)\b/i.test(textosPrincipais)) {
  erros.push('Título com sensacionalismo genérico');
}
// O agente às vezes escreve a própria incerteza como conteúdo ("espere a
// validação", "sem prova oficial", "aguardar confirmação"). Isso é
// impublicável e vence qualquer aprovação (do agente ou do recovery): reprova
// para o fluxo trocar de pauta em vez de postar dúvida.
if (regexDuvidaEditorial.test(textoEditorialRecuperavel)) {
  erros.push('Texto dos slides ou legenda expõe dúvida/hedge editorial (ex.: "aguardar confirmação", "sem prova oficial", "espere a validação") — não publicável');
}

const fontesBrutas = (Array.isArray(output.fontes) ? output.fontes : [])
  .map((fonte) => {
    const info = urlInfo(fonte?.url);
    return info ? { ...fonte, ...info } : null;
  })
  .filter(Boolean)
  .filter((fonte) => !hostIn(fonte.host, dominiosBloqueados));
const fontes = [];
const urlsFontesVistas = new Set();
for (const fonte of fontesBrutas) {
  const canonica = urlCanonica(fonte.url);
  if (urlsFontesVistas.has(canonica)) continue;
  urlsFontesVistas.add(canonica);
  fontes.push(fonte);
}
const hostsFontes = [...new Set(fontes.map((fonte) => fonte.host))];
const fontesPrimarias = fontes.filter((fonte) =>
  hostIn(fonte.host, dominiosPrimarios),
);
const janelaDias = output.categoria === 'GUIA' ? 30 : 14;
const fontesRecentes = fontes.filter((fonte) =>
  dataRecente(fonte.data_publicacao, janelaDias),
);

let candidatosContexto = [];
try {
  candidatosContexto =
    $('Montar contexto editorial').item.json.candidatos || [];
} catch (error) {
  candidatosContexto = [];
}

const tokensPauta = tokensSemanticos([
  output.tema,
  ...(Array.isArray(output.slides)
    ? output.slides.flatMap((slide) => [
        slide?.titulo,
        slide?.destaque,
        slide?.texto,
      ])
    : []),
].join(' '));

const fontesComRelevancia = fontes.map((fonte) => {
  const canonica = urlCanonica(fonte.url);
  const candidato = candidatosContexto.find(
    (item) => urlCanonica(item?.url) === canonica,
  );
  const materialFonte = [
    fonte.nome,
    // Fonte descoberta por busca não casa com nenhum candidato do RSS, então
    // só sobrava o nome do arquivo para julgar relevância.
    fonte.titulo,
    fonte.descricao,
    ...tokensDaUrl(fonte.url),
    candidato?.titulo,
    candidato?.resumo,
  ].join(' ');
  const coincidencias = sobreposicaoSemantica(
    tokensPauta,
    tokensSemanticos(materialFonte),
  );
  return {
    ...fonte,
    coincidencias,
    relevante: coincidencias.length >= 2,
  };
});
const fontesRelevantes = fontesComRelevancia.filter(
  (fonte) => fonte.relevante,
);
const fontesPrimariasRelevantes = fontesRelevantes.filter((fonte) =>
  hostIn(fonte.host, dominiosPrimarios),
);
const fontesRecentesRelevantes = fontesRelevantes.filter((fonte) =>
  dataRecente(fonte.data_publicacao, janelaDias),
);
const hostsRelevantes = [
  ...new Set(fontesRelevantes.map((fonte) => fonte.host)),
];
const urlsFontesUnicas = [
  ...new Set(fontes.map((fonte) => urlCanonica(fonte.url))),
];

if (!fontes.length) {
  erros.push('Nenhuma fonte HTTPS confiável');
}
if (urlsFontesUnicas.length !== fontes.length) {
  erros.push('Uma mesma fonte foi citada mais de uma vez');
}
if (output.categoria !== 'OFERTA') {
  if (!fontesRecentesRelevantes.length) {
    erros.push('Nenhuma fonte recente tem relação verificável com a pauta');
  }
  // Fontes auxiliares sem relação são registradas no relatório, mas não
  // invalidam uma pauta que já tenha fonte primária recente e relevante.
  // A publicação continua bloqueada quando não há confirmação segura.
  if (!fontesPrimariasRelevantes.length && hostsRelevantes.length < 2) {
    erros.push('Sem fonte primária relevante ou duas confirmações independentes relevantes');
  }
}

const problemasSlides = [];
if (!Array.isArray(output.slides)) {
  problemasSlides.push('slides não veio como lista');
} else if (output.slides.length !== 5) {
  problemasSlides.push('esperava 5 slides e vieram ' + output.slides.length);
} else {
  output.slides.forEach((slide, index) => {
    const onde = 'slide ' + (index + 1) + ' (' + tipos[index] + ')';
    if (slide?.tipo !== tipos[index]) {
      problemasSlides.push(onde + ': tipo veio "' + (slide?.tipo ?? 'ausente') + '"');
    }
    if (typeof slide?.titulo !== 'string' || slide.titulo.length === 0) {
      problemasSlides.push(onde + ': titulo vazio');
    } else if (slide.titulo.length > 42) {
      problemasSlides.push(onde + ': titulo com ' + slide.titulo.length + ' chars (max 42)');
    }
    if (typeof slide?.destaque !== 'string' || slide.destaque.length === 0) {
      problemasSlides.push(onde + ': destaque vazio');
    } else if (slide.destaque.length > 38) {
      problemasSlides.push(onde + ': destaque com ' + slide.destaque.length + ' chars (max 38)');
    }
    if (typeof slide?.texto !== 'string') {
      problemasSlides.push(onde + ': texto ausente');
    } else if (slide.texto.length > 300) {
      problemasSlides.push(onde + ': texto com ' + slide.texto.length + ' chars (max 300)');
    }
  });
}
const slidesValidos = problemasSlides.length === 0;
if (!slidesValidos) {
  erros.push('Estrutura dos cinco slides inválida -> ' + problemasSlides.join('; '));
}

const imagemCapa = urlInfo(output.capa);
const imagens = [
  output.capa,
  ...(Array.isArray(output.slides)
    ? output.slides.map((slide) => slide?.imagem)
    : []),
].map(urlInfo);
const hostsImagemConhecidos = [
  'image.mux.com', 'res.cloudinary.com', 'thesourcemediaassets.com',
];
const pareceImagemUrl = (u) =>
  /\.(?:jpe?g|png|webp|gif|avif)$/.test(String(u).split(/[?#]/)[0].toLowerCase());
const imagensValidas = imagens.filter((imagem) => {
  if (!imagem || hostIn(imagem.host, imagensBloqueadas)) return false;
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\.(?:html?|php|asp|aspx)$/.test(caminho)) return false;
  if (/\/(?:search|busca)(?:\/|$)/.test(caminho)) return false;
  // precisa parecer imagem (extensao) OU vir de host de imagem conhecido —
  // barra capa fabricada tipo xbox.com/games/... (pagina HTML, nao imagem)
  return pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos);
});
const urlsImagens = [...new Set(imagensValidas.map((imagem) => urlCanonica(imagem.url)))];
const hostsImagens = [...new Set(imagensValidas.map((imagem) => imagem.host))];

const tokensVisuaisDaPauta = tokensSemanticos([
  output.tema,
  ...(Array.isArray(output.fontes)
    ? output.fontes.flatMap((fonte) => [
        fonte?.nome,
        ...tokensDaUrl(fonte?.url),
      ])
    : []),
  ...(Array.isArray(output.slides)
    ? output.slides.flatMap((slide) => [
        slide?.titulo,
        slide?.destaque,
        slide?.texto,
      ])
    : []),
].join(' '));
const plataformasGenericas = new Set([
  'xbox',
  'playstation',
  'nintendo',
  'steam',
  'epic',
  'gaming',
]);
const imagensAuditadas = imagensValidas.map((imagem, index) => {
  const slideIndex = index === 0 ? 0 : index - 1;
  const slide = Array.isArray(output.slides)
    ? output.slides[slideIndex] || {}
    : {};
  const tokensImagem = tokensSemanticos([
    imagem.host,
    ...tokensDaUrl(imagem.url),
    slide?.fonte_imagem,
  ].join(' '));
  const coincidencias = sobreposicaoSemantica(
    tokensVisuaisDaPauta,
    tokensImagem,
  );
  const coincidenciaEspecifica = coincidencias.some(
    (token) => token.length >= 6 && !plataformasGenericas.has(token),
  );
  const dimensaoX = imagem.url.match(
    /(?:^|[\/_-])(\d{2,4})x(\d{2,4})(?:[.\/_?&-]|$)/i,
  );
  const dimensaoSamsung = imagem.url.match(
    /\$(\d{2,4})_(\d{2,4})_[a-z]+\$/i,
  );
  const dimensaoQueryWH = imagem.url.match(
    /[?&](?:w|width)=(\d{2,4}).{0,80}[?&](?:h|height)=(\d{2,4})/i,
  );
  const dimensaoQueryHW = imagem.url.match(
    /[?&](?:h|height)=(\d{2,4}).{0,80}[?&](?:w|width)=(\d{2,4})/i,
  );
  const dimensaoQuadrada = imagem.url.match(
    /[?&]size=(\d{2,4})(?:[&#]|$)/i,
  );
  const dimensaoNaUrl =
    dimensaoX ||
    dimensaoSamsung ||
    dimensaoQueryWH ||
    (dimensaoQueryHW
      ? [dimensaoQueryHW[0], dimensaoQueryHW[2], dimensaoQueryHW[1]]
      : null) ||
    (dimensaoQuadrada
      ? [dimensaoQuadrada[0], dimensaoQuadrada[1], dimensaoQuadrada[1]]
      : null);
  const larguraIndicada = Number(dimensaoNaUrl?.[1] || 0);
  const alturaIndicada = Number(dimensaoNaUrl?.[2] || 0);
  const baixaResolucao =
    Boolean(dimensaoNaUrl) &&
    (larguraIndicada < 900 || alturaIndicada < 500);

  const cdnXboxWireOficial =
    hostIn(imagem.host, ['xboxwire.thesourcemediaassets.com']) &&
    fontesPrimariasRelevantes.some((fonte) =>
      hostIn(fonte.host, ['xbox.com'])
    );
  // imagem servida por host oficial de fonte primaria confirmada e' confiavel como
  // relevante mesmo com URL opaca (ex.: AdobeStock_123.jpeg da newsroom.intel.com)
  const imagemDeHostOficial =
    hostIn(imagem.host, dominiosPrimarios) &&
    fontesPrimariasRelevantes.length > 0;
  return {
    url: imagem.url,
    host: imagem.host,
    fonte_imagem: String(slide?.fonte_imagem || ''),
    coincidencias,
    relevante:
      imagemDeHostOficial ||
      cdnXboxWireOficial ||
      coincidencias.length >= 2 ||
      coincidenciaEspecifica,
    baixa_resolucao: baixaResolucao,
    largura_indicada: larguraIndicada,
    altura_indicada: alturaIndicada,
  };
});
const imagensSemRelacao = imagensAuditadas.filter(
  (imagem) => !imagem.relevante,
);
const imagensBaixaResolucao = imagensAuditadas.filter(
  (imagem) => imagem.baixa_resolucao,
);

if (!imagemCapa) {
  erros.push('Imagem de capa ausente ou sem URL HTTPS direta e segura');
}
if (imagensValidas.length !== 6) {
  erros.push(
    'Esperava 6 imagens válidas (capa + 5 slides) e passaram ' + imagensValidas.length,
  );
}
if (urlsImagens.length === 0) {
  erros.push('Nenhuma imagem válida');
}
const imagemUnicaInfo =
  urlsImagens.length === 1 ? urlInfo(urlsImagens[0]) : null;
const imagemUnicaOficial =
  Boolean(imagemUnicaInfo) &&
  hostIn(imagemUnicaInfo.host, dominiosPrimarios);
// Portais como gamevicio.com e flowgames.gg publicam UMA imagem por artigo (medido em
// 28 execuções); adrenaline/playstation/xbox trazem 5-11. Reprovar por isso descarta
// pauta boa por causa da diagramação do portal. Aceitamos a arte repetida quando o FATO
// está provado pela mesma barra que o resto do validador usa: fonte primária relevante
// ou duas confirmações independentes relevantes.
const pautaBemConfirmada =
  fontesPrimariasRelevantes.length > 0 || hostsRelevantes.length >= 2;
if (
  urlsImagens.length === 1 &&
  !imagemUnicaOficial &&
  !pautaBemConfirmada
) {
  erros.push('Carrossel sem variedade visual confiável: imagem editorial repetida e pauta sem confirmação forte');
}
if (imagensSemRelacao.length > 0) {
  erros.push('Uma ou mais imagens não têm relação verificável com a pauta');
}
if (imagensBaixaResolucao.length > 0) {
  erros.push('Uma ou mais imagens são miniaturas de baixa resolução');
}

if (
  typeof output.legenda !== 'string' ||
  output.legenda.length === 0 ||
  output.legenda.length > 1800 ||
  /\*\*|\x60{3}/.test(output.legenda)
) {
  erros.push('Legenda ausente, longa demais ou com Markdown');
}

let ofertaAuditada = null;
if (output.categoria === 'OFERTA') {
  const oferta = output.oferta || {};
  const urlOferta = urlInfo(oferta.url);
  const precoAtual = valorNumerico(oferta.preco_atual);
  const precoReferencia = valorNumerico(oferta.preco_referencia);
  const camposObrigatorios = [
    oferta.produto,
    oferta.variante,
    oferta.loja,
    oferta.preco_atual,
    oferta.condicao_pagamento,
    oferta.disponibilidade,
  ].every((value) => String(value || '').trim());

  if (!camposObrigatorios) erros.push('Oferta sem todos os dados obrigatórios');
  if (!urlOferta || !hostIn(urlOferta.host, dominiosLojas)) {
    erros.push('Oferta sem URL direta de uma loja conhecida');
  }
  if (precoAtual <= 0) erros.push('Preço atual inválido');
  if (precoReferencia > 0 && precoReferencia < precoAtual) {
    erros.push('Preço de referência menor que o preço atual');
  }
  if (/\b(esgotad[oa]|indisponível|encerrad[oa])\b/i.test(oferta.disponibilidade || '')) {
    erros.push('Oferta marcada como indisponível');
  }
  ofertaAuditada = {
    host: urlOferta?.host || '',
    preco_atual: precoAtual,
    preco_referencia: precoReferencia,
  };
}

const executionMode =
  typeof $execution !== 'undefined'
    ? String($execution.mode || '')
    : 'manual';
const workflowClock =
  typeof $now !== 'undefined' ? $now : null;
const currentHour = Number(
  workflowClock?.hour ?? new Date().getHours(),
);
const currentWeekday = Number(
  workflowClock?.weekday ??
    (() => {
      const weekday = new Date().getDay();
      return weekday === 0 ? 7 : weekday;
    })(),
);
const currentDate = String(
  typeof workflowClock?.toISODate === 'function'
    ? workflowClock.toISODate()
    : new Date().toISOString().slice(0, 10),
);
const janelaExtra =
  executionMode === 'production' &&
  currentHour === 16 &&
  [2, 3, 5].includes(currentWeekday);
let extraAprovada = true;
let criterioExtra = '';

if (janelaExtra) {
  const fontesDoDia = fontesRelevantes.filter(
    (fonte) =>
      String(fonte.data_publicacao || '').slice(0, 10) === currentDate,
  );
  const fontesPrimariasDoDia = fontesDoDia.filter((fonte) =>
    hostIn(fonte.host, dominiosPrimarios),
  );
  const hostsDoDia = [
    ...new Set(fontesDoDia.map((fonte) => fonte.host)),
  ];
  const noticiaOuAlertaDoDia =
    ['NOTICIA', 'ALERTA'].includes(output.categoria) &&
    (
      fontesPrimariasDoDia.length >= 1 ||
      hostsDoDia.length >= 2
    );
  const oferta = output.oferta || {};
  const precoAtualExtra = valorNumerico(oferta.preco_atual);
  const precoReferenciaExtra = valorNumerico(
    oferta.preco_referencia,
  );
  const descontoExtra =
    precoAtualExtra > 0 &&
    precoReferenciaExtra >= precoAtualExtra * 1.1;
  const cupomExtra = String(oferta.cupom || '').trim().length > 0;
  const ofertaExcepcional =
    output.categoria === 'OFERTA' &&
    Boolean(ofertaAuditada) &&
    (descontoExtra || cupomExtra);

  extraAprovada = noticiaOuAlertaDoDia || ofertaExcepcional;
  criterioExtra = noticiaOuAlertaDoDia
    ? 'NOTICIA_OU_ALERTA_DO_DIA'
    : ofertaExcepcional
      ? 'OFERTA_EXCEPCIONAL'
      : 'SEM_PAUTA_EXCEPCIONAL';

  if (!extraAprovada) {
    erros.push(
      'Janela extra exige notícia ou alerta confirmado do dia, ou oferta excepcional disponível',
    );
  }
}

const pautaValidada = erros.length === 0;
return [{
  json: {
    pauta_validada: pautaValidada,
    motivo_reprovacao: pautaValidada
      ? ''
      : erros.join('; '),
    relatorio_validacao: {
      categoria: output.categoria || '',
      janela_editorial: janelaExtra ? 'EXTRA' : 'REGULAR',
      extra_aprovada: janelaExtra ? extraAprovada : null,
      criterio_extra: janelaExtra ? criterioExtra : '',
      fontes_validas: fontes.length,
      fontes_unicas: urlsFontesUnicas.length,
      fontes_primarias: fontesPrimarias.length,
      fontes_recentes: fontesRecentes.length,
      fontes_relevantes: fontesRelevantes.length,
      fontes_primarias_relevantes: fontesPrimariasRelevantes.length,
      fontes_recentes_relevantes: fontesRecentesRelevantes.length,
      fontes_sem_relacao: fontesComRelevancia
        .filter((fonte) => !fonte.relevante)
        .map((fonte) => ({
          url: fonte.url,
          host: fonte.host,
          coincidencias: fonte.coincidencias,
        })),
      hosts_fontes: hostsFontes,
      imagens_validas: imagensValidas.length,
      imagens_unicas: urlsImagens.length,
      imagens_sem_relacao: imagensSemRelacao,
      imagens_baixa_resolucao: imagensBaixaResolucao,
      hosts_imagens: hostsImagens,
      oferta: ofertaAuditada,
      erros,
    },
    output,
  },
}];