/**
 * Destrava pautas vindas da imprensa brasileira.
 *
 * Diagnóstico (medido na execução 75, pauta do GameVicio):
 *   1. collectOfficialImages só aceitava imagem do domínio da fonte ou de duas
 *      CDNs oficiais. GameVicio/Adrenaline/Flow Games servem de CDN própria, e
 *      caíam fora — o candidato chegava ao agente com imagens_oficiais: [].
 *   2. Sem imagem, o agente saía caçando: trouxe key art de loja Shopify e
 *      colou URL de página .html como se fosse imagem.
 *   3. Ele também não citou o artigo de origem entre as fontes, então sobrava
 *      uma única confirmação relevante e a validação reprovava.
 *
 * Uso: node patches/semana1b-fontes-e-imagens.cjs [caminho-do-sqlite]
 * Com o n8n PARADO quando escrever no banco real.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const DB = process.argv[2] || path.join(RAIZ, 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';

const db = new DatabaseSync(DB);
const linha = db.prepare('select nodes from workflow_entity where id=?').get(WF);
if (!linha) throw new Error('workflow não encontrado em ' + DB);
const nodes = JSON.parse(linha.nodes);
const feito = [];

const pegar = (nome) => {
  const n = nodes.find((x) => x.name === nome);
  if (!n) throw new Error('node não encontrado: ' + nome);
  return n;
};
function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  if (texto.split(de).length > 2) throw new Error('alvo ambíguo, aparece mais de uma vez (' + rotulo + ')');
  return texto.split(de).join(para);
}

// ---------------------------------------------------------------------------
// 1. IMAGENS — trocar a allowlist de domínio por filtro de qualidade.
//    Continua preferindo material oficial (vem primeiro na lista), mas aceita
//    a imagem do próprio artigo em vez de devolver lista vazia.
// ---------------------------------------------------------------------------
const normalizar = pegar('Normalizar notícias PromoLiso AI');
let cn = String(normalizar.parameters.jsCode);

cn = trocar(
  cn,
  `    const sameOfficialDomain =
      sourceDomain &&
      (host === sourceDomain || host.endsWith('.' + sourceDomain));
    const trustedOfficialCdn = allowedCdnDomains.some(
      (domain) => host === domain || host.endsWith('.' + domain),
    );
    if ((!sameOfficialDomain && !trustedOfficialCdn) || seen.has(direct)) {
      continue;
    }
    seen.add(direct);
    unique.push(direct);
    if (unique.length >= 10) break;
  }
  return unique;
}`,
  `    const sameOfficialDomain =
      sourceDomain &&
      (host === sourceDomain || host.endsWith('.' + sourceDomain));
    const trustedOfficialCdn = allowedCdnDomains.some(
      (domain) => host === domain || host.endsWith('.' + domain),
    );
    // O domínio oficial deixa de ser exigência e passa a ser só prioridade.
    // O corte agora é por qualidade — era daqui que vinham os slides repetidos
    // e as "imagens em baixa resolução" reclamadas na revisão.
    const hostDescartavel =
      /(?:gravatar|feedburner|doubleclick|googlesyndication|google-analytics|facebook|fbcdn|twimg|adservice|analytics)/i.test(host);
    const caminhoDescartavel =
      /(?:\\/avatars?\\/|\\/emoji\\/|\\/icons?\\/|spacer|tracking|\\/ads?\\/|1x1)/i.test(direct);
    if (hostDescartavel || caminhoDescartavel || seen.has(direct)) {
      continue;
    }
    seen.add(direct);
    unique.push({ url: direct, oficial: Boolean(sameOfficialDomain || trustedOfficialCdn) });
    if (unique.length >= 40) break;
  }
  // O WordPress publica a mesma foto em vários tamanhos (-640x400, -210x131…).
  // Aceitar todas enchia o carrossel com cópias da mesma imagem. Agrupamos por
  // nome-base e mantemos só a maior versão de cada foto.
  const porFoto = new Map();
  for (const imagem of unique) {
    const semTamanho = imagem.url.replace(
      /-(\\d{2,4})x(\\d{2,4})(\\.(?:jpe?g|png|webp))/i,
      '$3',
    );
    const medida = imagem.url.match(/-(\\d{2,4})x(\\d{2,4})\\.(?:jpe?g|png|webp)/i);
    // sem sufixo de tamanho = arquivo original, sempre o preferido
    const area = medida ? Number(medida[1]) * Number(medida[2]) : Number.MAX_SAFE_INTEGER;
    const atual = porFoto.get(semTamanho);
    if (!atual || area > atual.area) {
      porFoto.set(semTamanho, { url: imagem.url, oficial: imagem.oficial, area });
    }
  }
  return [...porFoto.values()]
    .filter((imagem) => imagem.area >= 360000 || imagem.area === Number.MAX_SAFE_INTEGER)
    .sort((a, b) => Number(b.oficial) - Number(a.oficial) || b.area - a.area)
    .slice(0, 10)
    .map((imagem) => imagem.url);
}`,
  'collectOfficialImages',
);
normalizar.parameters.jsCode = cn;
feito.push('1. collectOfficialImages: allowlist de domínio -> filtro de qualidade (oficial tem prioridade)');

// ---------------------------------------------------------------------------
// 2. FONTE DE ORIGEM — o node já sabia qual artigo gerou a pauta e apenas
//    conferia se o agente o havia citado. Agora injeta quando faltar.
//    Medido: elimina sozinho os três erros de fonte da execução 75.
// ---------------------------------------------------------------------------
const validar = pegar('Validar antes de publicar');
let cv = String(validar.parameters.jsCode);

cv = trocar(
  cv,
  `const estruturaEditorialCompleta =`,
  `// O artigo que originou a pauta é recente, relevante e veio do RSS, mas o
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

const estruturaEditorialCompleta =`,
  'injeção da fonte de origem',
);
feito.push('2. Fonte de origem injetada automaticamente quando o agente esquece de citá-la');

// ---------------------------------------------------------------------------
// 3. RELEVÂNCIA — julgar a fonte pelo que ela diz, não pelo nome do arquivo.
//    Sem isso, capcom.co.jp/.../e260608.html era descartada por ter URL opaca.
// ---------------------------------------------------------------------------
cv = trocar(
  cv,
  `  const materialFonte = [
    fonte.nome,
    ...tokensDaUrl(fonte.url),
    candidato?.titulo,
    candidato?.resumo,
  ].join(' ');`,
  `  const materialFonte = [
    fonte.nome,
    // Fonte descoberta por busca não casa com nenhum candidato do RSS, então
    // só sobrava o nome do arquivo para julgar relevância.
    fonte.titulo,
    fonte.descricao,
    ...tokensDaUrl(fonte.url),
    candidato?.titulo,
    candidato?.resumo,
  ].join(' ');`,
  'material de relevância da fonte',
);
feito.push('3. Relevância passa a considerar título e descrição da fonte');

// ---------------------------------------------------------------------------
// 4. DOMÍNIOS PRIMÁRIOS — faltavam variantes regionais. capcom.co.jp (matriz,
//    fonte real do dado) não era reconhecida porque a lista só tinha .com.
// ---------------------------------------------------------------------------
cv = trocar(
  cv,
  `  'capcom.com',\n  'konami.com',`,
  [
    "  'capcom.com',",
    "  'capcom.co.jp',",
    "  'konami.com',",
    "  'konami.jp',",
    "  'square-enix.com',",
    "  'square-enix-holdings.com',",
    "  'sonyinteractive.com',",
    "  'activision.com',",
    "  'blizzard.com',",
    "  'riotgames.com',",
    "  'nintendo.co.jp',",
    "  'sega.jp',",
  ].join('\n'),
  'lista de domínios primários',
);
validar.parameters.jsCode = cv;
feito.push('4. Domínios primários: variantes regionais (capcom.co.jp, nintendo.co.jp, etc.)');

// ---------------------------------------------------------------------------
db.prepare('update workflow_entity set nodes=?, updatedAt=? where id=?').run(
  JSON.stringify(nodes),
  new Date().toISOString().replace('T', ' ').replace('Z', ''),
  WF,
);

console.log('Aplicado em ' + DB + ':\n');
feito.forEach((f) => console.log('  ' + f));
