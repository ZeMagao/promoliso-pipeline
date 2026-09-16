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

// Limites de texto dos slides em UM lugar. Estavam em três: aqui no limitar(), na checagem de
// estrutura, e no prompt do agente. Em 2026-08-05 um rollback reverteu só uma cópia — o validador
// truncava em 42/38 e reprovava acima de 34/30, e quase nenhuma pauta passou por semanas.
// A cópia do prompt é texto estático de outro nó; `design/verifica_limites.cjs` compara os dois.
const LIMITES = { selo: 22, titulo: 42, destaque: 38, texto: 300, legenda: 1800 };
// Quantos slides o carrossel pode ter. O publicador aceita de 2 a 10 IMAGENS (versão
// 4bb8c077, um nó por tamanho); aqui a faixa é mais estreita por motivo editorial: cada
// slide do meio come uma imagem única, e a média medida é 3,4 por pauta.
const MIN_SLIDES = 3;
const MAX_SLIDES = 7;
const slidesNaFaixa = (n) => n >= MIN_SLIDES && n <= MAX_SLIDES;

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
  const texto = String(value || '');
  // Antes: replace(/[^\d,.-]/g,'') colava números distintos —
  // "R$ 3.989,05 (ou 12x de R$ 332,43 sem juros)" virava "3.989,0512332,43" -> NaN -> 0, e a
  // oferta legítima da exec 168 foi reprovada com "Preço atual inválido".
  // Agora pega UM valor: de preferência o que vem logo depois de um "R$" (assim "12x de R$ 332,43"
  // não devolve 12). Formato BR: ponto separa milhar, vírgula é decimal.
  const NUM = '\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+,\\d{1,2}|\\d+\\.\\d{1,2}|\\d+';
  const comMoeda = texto.match(new RegExp('R\\$\\s*(' + NUM + ')', 'i'));
  const bruto = comMoeda
    ? comMoeda[1]
    : (texto.match(new RegExp(NUM)) || [])[0];
  if (!bruto) return 0;
  // Com vírgula, o ponto é separador de milhar. SEM vírgula, "1.299" também é milhar e não
  // 1,299 — tratar como decimal devolvia 1.299 para "R$ 1.299" (pego pelo harness).
  const soMilhar = /^\d{1,3}(?:\.\d{3})+$/.test(bruto);
  const normalizado = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : (soMilhar ? bruto.replace(/\./g, '') : bruto);
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
// Loja de eletrônico: vende produto físico. Promoção daqui NÃO é pauta desta conta (pedido do
// dono em 16/08, depois de um post de monitor em promoção). Continuam na lista porque a URL ainda
// precisa ser reconhecida como loja — o que muda é o veredito, não o reconhecimento.
const lojasDeEletronicos = [
  'amazon.com.br',
  'kabum.com.br',
  'magazineluiza.com.br',
  'mercadolivre.com.br',
  'terabyteshop.com.br',
  'pichau.com.br',
];
// Loja de jogo: é daqui que sai promoção publicável.
const lojasDeJogos = [
  'nuuvem.com',
  'greenmangaming.com',
  'gog.com',
  'steampowered.com',
  'playstation.com',
  'xbox.com',
  'nintendo.com',
  'epicgames.com',
];
// União: quem só precisa saber "isto é uma loja?" continua usando esta.
const dominiosLojas = [...lojasDeEletronicos, ...lojasDeJogos];
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

// Regra ÚNICA de "imagem utilizável". Antes ela existia só lá embaixo, dentro do filtro de
// imagensValidas, e o bloco de recuperação de mídia (mais acima) escolhia imagens sem consultá-la:
// foi assim que a exec 199 recebeu uma thumbnail de i.ytimg.com como capa e em seguida se reprovou
// por ela. Declarada aqui pra que os DOIS lados usem a mesma definição.
const hostsImagemConhecidos = [
  'image.mux.com', 'res.cloudinary.com', 'thesourcemediaassets.com',
];
const pareceImagemUrl = (u) =>
  /\.(?:jpe?g|png|webp|gif|avif)$/.test(String(u).split(/[?#]/)[0].toLowerCase());
// blogger.googleusercontent.com é a CDN do BLOGGER (o GameBlast roda nele), não a do Google
// Imagens. Ela casa com 'googleusercontent.com' por sufixo e morria aqui — 150 de ~152 imagens
// daquele feed, em silêncio. Liberada por host EXATO; lh3.googleusercontent.com e afins seguem
// bloqueados. Medido na exec 598 (15/09/2026).
const hostsImagemLiberados = ['blogger.googleusercontent.com'];
// Motivo do descarte em vez de um booleano: sem isto, imagem morta pela lista de bloqueio não
// deixa rastro nenhum no relatório e "passaram 0" não diz a causa.
function motivoDescarteImagem(imagem) {
  if (!imagem || !imagem.url) return 'sem URL utilizável';
  if (!hostsImagemLiberados.includes(imagem.host)
      && hostIn(imagem.host, imagensBloqueadas)) return 'host bloqueado';
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\.(?:html?|php|asp|aspx)$/.test(caminho)) return 'é página, não imagem';
  if (/\/(?:search|busca)(?:\/|$)/.test(caminho)) return 'veio de busca';
  if (!(pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos))) {
    return 'não parece URL de imagem';
  }
  return null;
}
function imagemUtilizavel(imagem) {
  return motivoDescarteImagem(imagem) === null;
}
function imagemUtilizavelAntiga(imagem) {
  if (!imagem || !imagem.url) return false;
  if (hostIn(imagem.host, imagensBloqueadas)) return false;
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\.(?:html?|php|asp|aspx)$/.test(caminho)) return false;
  if (/\/(?:search|busca)(?:\/|$)/.test(caminho)) return false;
  // precisa parecer imagem (extensao) OU vir de host de imagem conhecido —
  // barra capa fabricada tipo xbox.com/games/... (pagina HTML, nao imagem)
  return pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos);
}
const urlUtilizavel = (url) => imagemUtilizavel(urlInfo(url));


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
  // MESMA regra que o gate aplica. Sem isto o recovery distribuía imagem que o próprio
  // validador rejeita depois (exec 199: i.ytimg.com virou capa e reprovou a pauta).
  .filter(urlUtilizavel)
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
  slidesNaFaixa(output.slides.length) &&
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
    selo: limitar(slide.selo, LIMITES.selo),
    titulo: limitar(slide.titulo, LIMITES.titulo),
    destaque: limitar(slide.destaque, LIMITES.destaque),
    texto: limitar(slide.texto, LIMITES.texto),
  }));
}

const erros = [];
const categorias = ['OFERTA', 'ALERTA', 'GUIA', 'NOTICIA'];
// A ordem deixou de ser fixa. Obrigatório: o PRIMEIRO slide é a capa e o ÚLTIMO é a ação
// (onde mora o pedido ao leitor). No meio, qualquer um destes três, em qualquer ordem e
// podendo repetir — o layout dos três é o mesmo, o que muda é o papel no texto.
const TIPO_PRIMEIRO = 'capa';
const TIPO_ULTIMO = 'acao';
const TIPOS_DO_MEIO = ['contexto', 'evidencia', 'impacto'];
const tiposAceitos = (index, total) => (index === 0
  ? [TIPO_PRIMEIRO]
  : (index === total - 1 ? [TIPO_ULTIMO] : TIPOS_DO_MEIO));

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
} else if (!slidesNaFaixa(output.slides.length)) {
  problemasSlides.push('esperava de ' + MIN_SLIDES + ' a ' + MAX_SLIDES + ' slides e vieram ' + output.slides.length);
} else {
  output.slides.forEach((slide, index) => {
    const aceitos = tiposAceitos(index, output.slides.length);
    const onde = 'slide ' + (index + 1) + ' (' + aceitos.join('|') + ')';
    if (!aceitos.includes(slide?.tipo)) {
      problemasSlides.push(onde + ': tipo veio "' + (slide?.tipo ?? 'ausente') + '"');
    }
    if (typeof slide?.titulo !== 'string' || slide.titulo.length === 0) {
      problemasSlides.push(onde + ': titulo vazio');
    } else if (slide.titulo.length > LIMITES.titulo) {
      problemasSlides.push(onde + ': titulo com ' + slide.titulo.length + ' chars (max ' + LIMITES.titulo + ')');
    }
    if (typeof slide?.destaque !== 'string' || slide.destaque.length === 0) {
      problemasSlides.push(onde + ': destaque vazio');
    } else if (slide.destaque.length > LIMITES.destaque) {
      problemasSlides.push(onde + ': destaque com ' + slide.destaque.length + ' chars (max ' + LIMITES.destaque + ')');
    }
    if (typeof slide?.texto !== 'string') {
      problemasSlides.push(onde + ': texto ausente');
    } else if (slide.texto.length > LIMITES.texto) {
      problemasSlides.push(onde + ': texto com ' + slide.texto.length + ' chars (max ' + LIMITES.texto + ')');
    }
  });
}
const slidesValidos = problemasSlides.length === 0;
if (!slidesValidos) {
  erros.push('Estrutura dos slides inválida -> ' + problemasSlides.join('; '));
}

// O Blogger carrega o tamanho no CAMINHO (/w640-h360/, /s680/, /s72-w640-h360-c/). Trocar o
// segmento por /s0/ devolve o original. Medido em 14 URLs reais do feed do GameBlast: 0 quebram,
// e os 5 thumbs w640-h360 subiram de 52k para 230k, de 33k para 109k, de 52k para 844k.
// Só troca quando o segmento indica coisa PEQUENA: dois /s1920/ medidos ficaram MENORES com /s0/,
// então reescrever tudo seria regressão. Reescreve o próprio `output`, que é o que segue para o
// renderizador — trocar só na cópia da validação deixaria a peça renderizando o thumb.
const RE_TAMANHO_BLOGGER = /\/(s\d+(?:-[a-z0-9-]+)*|w\d+-h\d+(?:-[a-z0-9-]+)*)\/([^/]+)$/i;
function blateralMaximo(segmento) {
  const numeros = String(segmento).match(/\d+/g) || [];
  return numeros.reduce((maior, n) => Math.max(maior, Number(n)), 0);
}
function originalDoBlogger(url) {
  const bruta = String(url || '');
  if (!/^https:\/\/blogger\.googleusercontent\.com\//i.test(bruta)) return bruta;
  const caminho = bruta.split(/[?#]/)[0];
  const casou = caminho.match(RE_TAMANHO_BLOGGER);
  if (!casou) return bruta;
  if (blateralMaximo(casou[1]) >= 1200) return bruta;
  return caminho.replace(RE_TAMANHO_BLOGGER, '/s0/$2');
}
if (typeof output.capa === 'string') output.capa = originalDoBlogger(output.capa);
if (Array.isArray(output.slides)) {
  output.slides.forEach((slide) => {
    if (slide && typeof slide.imagem === 'string') {
      slide.imagem = originalDoBlogger(slide.imagem);
    }
  });
}
const imagemCapa = urlInfo(output.capa);
const imagens = [
  output.capa,
  ...(Array.isArray(output.slides)
    ? output.slides.map((slide) => slide?.imagem)
    : []),
].map(urlInfo);
// usa a definição única declarada no topo (antes havia uma cópia da regra aqui, e o
// bloco de recuperação de mídia não a consultava)
const imagensValidas = imagens.filter(imagemUtilizavel);
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
// Balde que faltava: imagem que o filtro matou antes de qualquer auditoria. Sem ele o relatório
// mostra os dois outros baldes vazios e ninguém descobre a causa sem abrir a execução no banco.
const imagensBloqueadasDetalhe = imagens
  .map((imagem) => ({ imagem, motivo: motivoDescarteImagem(imagem) }))
  .filter((x) => x.motivo !== null)
  .map((x) => ({
    url: (x.imagem && x.imagem.url) || '',
    host: (x.imagem && x.imagem.host) || '',
    motivo: x.motivo,
  }));

if (!imagemCapa) {
  erros.push('Imagem de capa ausente ou sem URL HTTPS direta e segura');
}
// Uma imagem por slide, mais a capa. Antes era 6 cravado, que só valia pra 5 slides.
const imagensEsperadas = Array.isArray(output.slides) ? output.slides.length + 1 : 0;
if (imagensValidas.length !== imagensEsperadas) {
  erros.push(
    'Esperava ' + imagensEsperadas + ' imagens válidas (capa + ' + output.slides.length
      + ' slides) e passaram ' + imagensValidas.length,
  );
}
if (urlsImagens.length === 0) {
  erros.push(
    imagensBloqueadasDetalhe.length
      ? 'Nenhuma imagem válida -> ' + imagensBloqueadasDetalhe
        .map((x) => (x.host || '(sem host)') + ': ' + x.motivo)
        .filter((texto, i, todas) => todas.indexOf(texto) === i)
        .join('; ')
      : 'Nenhuma imagem válida',
  );
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
  output.legenda.length > LIMITES.legenda ||
  /\*\*|\x60{3}/.test(output.legenda)
) {
  erros.push('Legenda ausente, longa demais ou com Markdown');
}

function fimDaPromocao(texto) {
  const t = String(texto || '').toLowerCase();
  if (!t.trim()) return null;
  const MESES = {
    janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  };
  let dia = 0, mes = 0, ano = 0;
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { ano = Number(m[1]); mes = Number(m[2]); dia = Number(m[3]); }
  if (!dia) {
    m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/);
    if (m) {
      dia = Number(m[1]); mes = Number(m[2]);
      if (m[3]) ano = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    }
  }
  if (!dia) {
    m = t.match(/(\d{1,2})\s*de\s+([a-zç]+)/);
    if (m && MESES[m[2]]) { dia = Number(m[1]); mes = MESES[m[2]]; }
  }
  if (!dia || !mes || mes > 12 || dia > 31) return null;
  const agora = new Date();
  if (!ano) {
    // sem ano, assume o ano corrente; se isso jogar a data mais de 6 meses para trás, era do ano
    // que vem (promoção de janeiro anunciada em dezembro)
    ano = agora.getUTCFullYear();
    const tentativa = Date.UTC(ano, mes - 1, dia);
    if (tentativa < agora.getTime() - 182 * 86400000) ano += 1;
  }
  return Date.UTC(ano, mes - 1, dia, 23, 59, 59);
}

let ofertaAuditada = null;
if (output.categoria === 'OFERTA') {
  const oferta = output.oferta || {};
  const urlOferta = urlInfo(oferta.url);
  const precoAtual = valorNumerico(oferta.preco_atual);
  const precoReferencia = valorNumerico(oferta.preco_referencia);
  const tipoOferta =
    String(oferta.tipo || '').trim().toLowerCase() === 'evento' ? 'evento' : 'produto';

  // vale para as duas formas: é o que separa promoção de matéria FALANDO de promoção
  if (!urlOferta || !hostIn(urlOferta.host, dominiosLojas)) {
    erros.push('Oferta sem URL direta de uma loja conhecida');
  } else if (hostIn(urlOferta.host, lojasDeEletronicos)) {
    // Promoção de produto físico não é pauta desta conta. Notícia de hardware continua sendo —
    // o corte é só em OFERTA. Mensagem própria para o alerta não virar caça ao fantasma.
    erros.push('Promoção de produto físico não é pauta: ' + urlOferta.host + ' é loja de eletrônico, e OFERTA aqui é só de jogo');
  }
  if (/\b(esgotad[oa]|indisponível|encerrad[oa])\b/i.test(oferta.disponibilidade || '')) {
    erros.push('Oferta marcada como indisponível');
  }

  if (tipoOferta === 'evento') {
    const camposEvento = [oferta.loja, oferta.validade, oferta.disponibilidade]
      .every((value) => String(value || '').trim());
    if (!camposEvento) {
      erros.push('Evento promocional sem loja, validade ou disponibilidade');
    }
    // "até 95%" ou um cupom: sem um dos dois não há promoção nenhuma para anunciar
    const temFaixa = /\d/.test(String(oferta.desconto || ''));
    const temCupom = Boolean(String(oferta.cupom || '').trim());
    if (!temFaixa && !temCupom) {
      erros.push('Evento promocional sem faixa de desconto nem cupom');
    }
    const fim = fimDaPromocao(oferta.validade);
    // 36 h de folga porque a comparação mistura fuso do agente com o do servidor, e errar aqui
    // para o lado severo mataria promoção viva
    if (fim && fim < Date.now() - 36 * 3600 * 1000) {
      erros.push('Promoção já encerrada segundo a própria validade (' + String(oferta.validade).slice(0, 40) + ')');
    }
  } else {
    const camposObrigatorios = [
      oferta.produto,
      oferta.variante,
      oferta.loja,
      oferta.preco_atual,
      oferta.condicao_pagamento,
      oferta.disponibilidade,
    ].every((value) => String(value || '').trim());
    if (!camposObrigatorios) erros.push('Oferta sem todos os dados obrigatórios');
    // Jogo grátis é oferta legítima e recorrente (Epic toda semana), mas caía aqui: a exec 200
    // reprovou "Epic Games Store libera Beacon Pines" com preco_atual "Grátis (R$ 0,00)".
    // Só aceita quando o texto DIZ que é grátis — preço vazio ou ilegível continua sendo erro,
    // senão uma falha de extração passaria disfarçada de promoção.
    const ofertaGratuita =
      /\b(?:gr[áa]tis|free|de\s+gra[çc]a|sem\s+custo)\b/i.test(String(oferta.preco_atual || ''));
    if (precoAtual <= 0 && !ofertaGratuita) erros.push('Preço atual inválido');
    if (precoReferencia > 0 && precoReferencia < precoAtual) {
      erros.push('Preço de referência menor que o preço atual');
    }
  }

  ofertaAuditada = {
    tipo: tipoOferta,
    host: urlOferta?.host || '',
    preco_atual: precoAtual,
    preco_referencia: precoReferencia,
    validade: String(oferta.validade || ''),
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
      imagens_bloqueadas: imagensBloqueadasDetalhe,
      hosts_imagens: hostsImagens,
      oferta: ofertaAuditada,
      erros,
    },
    output,
  },
}];