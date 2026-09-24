const normalized =
  $('Normalizar notícias PromoLiso AI').item.json || {};
const noticias = Array.isArray(normalized.noticias)
  ? normalized.noticias
  : [];
const config = normalized.promo_liso_ai || {};
const existingRows = $input
  .all()
  .map((item) => item.json || {})
  .filter((row) => row.curation_key);
const processed = new Set(
  existingRows.map((row) => String(row.curation_key || '').toLowerCase()),
);
const now = Date.now();
const oldLimitMs =
  Number(config.janela_antiga_dias || 30) * 86400000;

function ageMs(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    ? Math.max(0, now - timestamp)
    : Number.POSITIVE_INFINITY;
}

const unseen = noticias.filter(
  (noticia) =>
    !processed.has(String(noticia.curation_key || '').toLowerCase()),
);
const deterministic = [];
const aiCandidates = [];

for (const noticia of unseen) {
  if (!noticia.url_valida || !noticia.titulo || !noticia.conteudo) {
    deterministic.push({
      noticia,
      requer_ia: false,
      preavaliacao: {
        tipo: 'ERRO_DADOS_MINIMOS',
        motivo: !noticia.url_valida
          ? 'URL ausente ou inválida'
          : 'Notícia sem título ou conteúdo suficiente',
      },
      promo_liso_ai: config,
    });
    continue;
  }
  if (
    noticia.data_publicacao &&
    ageMs(noticia.data_publicacao) > oldLimitMs
  ) {
    deterministic.push({
      noticia,
      requer_ia: false,
      preavaliacao: {
        tipo: 'NOTICIA_ANTIGA',
        motivo:
          'Notícia fora da janela máxima de ' +
          String(config.janela_antiga_dias || 30) +
          ' dias',
      },
      promo_liso_ai: config,
    });
    continue;
  }
  aiCandidates.push({
    noticia,
    requer_ia: true,
    preavaliacao: null,
    promo_liso_ai: config,
  });
}

aiCandidates.sort((a, b) => {
  const sourceWeight = (value) =>
    value === 'primaria' ? 2 : value === 'editorial' ? 1 : 0;
  const sourceDelta =
    sourceWeight(b.noticia.tipo_fonte) -
    sourceWeight(a.noticia.tipo_fonte);
  if (sourceDelta) return sourceDelta;
  return (
    new Date(b.noticia.data_publicacao || 0) -
    new Date(a.noticia.data_publicacao || 0)
  );
});

// EQUILÍBRIO DOS CANDIDATOS DE IA.
// Antes daqui era `aiCandidates.slice(0, 5)` sobre uma lista já ordenada com primária na frente.
// Isso era inofensivo enquanto o lote tinha 1 primária; depois da reserva de vagas (52ab6c5f) o
// lote passou a ter 6, e os 5 viravam 5 primárias em 2 hosts — conta brasileira recebendo só
// anúncio internacional, com o mesmo host repetido três vezes. Medido na exec 601.
const MAX_IA = Number(config.max_candidatos_ia || 5);
const TETO_POR_HOST_IA = 2;
const PISO_NAO_PRIMARIA = 2;

const hostDoCandidato = (c) =>
  String((c && c.noticia && c.noticia.dominio_fonte) || '').toLowerCase();
const ehPrimaria = (c) =>
  String((c && c.noticia && c.noticia.tipo_fonte) || '') === 'primaria';

const escolhidosIA = [];
const usoPorHostIA = Object.create(null);
const cabeNoHost = (c) => {
  const host = hostDoCandidato(c);
  return !host || (usoPorHostIA[host] || 0) < TETO_POR_HOST_IA;
};
const pegar = (c) => {
  const host = hostDoCandidato(c);
  if (host) usoPorHostIA[host] = (usoPorHostIA[host] || 0) + 1;
  escolhidosIA.push(c);
};

// VAGA DA PAUTA DE CALENDÁRIO (17/09). O Curador só vê 5 itens; sem vaga própria, a onda do mês
// disputa com o dia inteiro e perde por acaso — 32 chegaram aqui em 7 semanas e 3 viraram post.
// A vaga vale 1 e só enquanto o mês não tem o post; cumprida a cota, este bloco não pega ninguém.
// Ignora o teto por host de propósito: a onda vem do host oficial, que é o que tem imagem.
const VAGA_TEMA_IA = 1;
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= VAGA_TEMA_IA) break;
  if (!candidato.noticia || !candidato.noticia.tema_pendente) continue;
  pegar(candidato);
}

// 1ª passada: preenche na ordem de mérito, deixando PISO_NAO_PRIMARIA vagas guardadas.
const tetoDaPrimeiraPassada = Math.max(0, MAX_IA - PISO_NAO_PRIMARIA);
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= tetoDaPrimeiraPassada) break;
  // A vaga do tema já pode ter pego este item: sem esta linha ele entraria duas vezes e o
  // Curador receberia 4 pautas distintas em vez de 5.
  if (escolhidosIA.includes(candidato)) continue;
  if (!cabeNoHost(candidato)) continue;
  pegar(candidato);
}
// 2ª passada: as vagas guardadas só aceitam NÃO-primária — é o que garante pauta brasileira.
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= MAX_IA) break;
  if (escolhidosIA.includes(candidato)) continue;
  if (ehPrimaria(candidato)) continue;
  if (!cabeNoHost(candidato)) continue;
  pegar(candidato);
}
// 3ª passada: se não houver não-primária suficiente, completa com o que sobrou, IGNORANDO o teto.
// De propósito: melhor 5 candidatos com host repetido do que 3 candidatos. O piso é preferência,
// não obrigação — num dia em que só exista fonte primária, o Curador continua recebendo 5.
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= MAX_IA) break;
  if (escolhidosIA.includes(candidato)) continue;
  pegar(candidato);
}

const selected = [
  ...deterministic.slice(0, 3),
  ...escolhidosIA,
];

if (!selected.length) {
  return [{
    json: {
      sem_noticias: true,
      requer_ia: false,
      motivo:
        noticias.length && !unseen.length
          ? 'Todas as notícias coletadas já foram processadas'
          : 'Nenhuma notícia foi coletada',
      promo_liso_ai: config,
    },
  }];
}

return selected.map((item) => ({
  json: {
    ...item,
    sem_noticias: false,
    id_execucao: String($execution.id || ''),
  },
}));