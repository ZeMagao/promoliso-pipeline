const items = $input
  .all()
  .map((item) => item.json || {});
const eligible = items
  .filter(
    (item) =>
      item.persistencia_ok &&
      item.elegivel_aprovacao &&
      item.registro?.status_aprovacao === 'CANDIDATO',
  )
  .sort((a, b) => {
    // Pauta que não renderiza vale 0: dá desempate pra quem tem arte suficiente pro
    // carrossel. 8 < 10 de propósito — arte não vence procedência.
    // MESMA FOTO EM TAMANHOS DIFERENTES É UMA FOTO. Antes daqui a contagem era por URL, e
    // duas variantes do mesmo arquivo valiam duas imagens — a pauta levava o bônus sem ter
    // variedade nenhuma. Medido na exec 601: a peça que venceu contava 2 e tinha 1
    // (…-scaled.jpg e …-2048x1365.jpg, mesmo hash), e saiu com a mesma foto em todos os slides.
    const TAMANHO_WP = /-\d{2,4}x\d{2,4}(?=\.[a-z]{3,4}$)/i;
    const ESCALADA_WP = /-scaled(?=\.[a-z]{3,4}$)/i;
    const TAMANHO_BLOGGER = /\/(s\d+(?:-[a-z0-9-]+)*|w\d+-h\d+(?:-[a-z0-9-]+)*)\/([^/]+)$/i;
    const identidadeVisual = (url) => {
      let limpa = String(url).toLowerCase().split(/[?#]/)[0];
      if (/^https:\/\/blogger\.googleusercontent\.com\//i.test(limpa)) {
        limpa = limpa.replace(TAMANHO_BLOGGER, '/TAM/$2');
      }
      return limpa.replace(TAMANHO_WP, '').replace(ESCALADA_WP, '');
    };
    const imagensDistintas = (x) => {
      const noticia = x.noticia || {};
      const lista = Array.isArray(noticia.imagens_oficiais)
        ? noticia.imagens_oficiais
        : [];
      return new Set(
        [...lista, noticia.imagem_principal]
          .filter((u) => typeof u === 'string' && /^https:\/\//i.test(u))
          .map(identidadeVisual),
      ).size;
    };
    // BÔNUS GRADUADO. Era binário (>=2 imagens valia 8), e 37 das 40 notícias medidas passavam
    // desse corte — régua que não separa o que precisamos separar. Agora pauta com 4+ fotos
    // vence pauta com 2, e pauta de foto única não leva nada.
    // Teto mantido em 8, ABAIXO dos 10 da fonte primária: arte não vence procedência.
    const bonusDeImagem = (fotos) => (fotos <= 1 ? 0 : Math.min(2 * fotos, 8));
    // PAUTA DE CALENDÁRIO: enquanto o mês não tiver o post de Game Pass / PS Plus (entrando e
    // saindo, 1 de cada), a onda passa na frente. 15 > 10 da primária e > 8 das imagens de
    // propósito: é a única pauta que o dono pediu para existir todo mês. Cumprida a cota,
    // `tema_pendente` vem false e este termo vira 0 sozinho — não há régua para desligar depois.
    const BONUS_TEMA = 15;
    const efetivo = (x) =>
      Number(x.registro?.pontuacao_total || 0) +
      (String(x.noticia?.tipo_fonte || '') === 'primaria' ? 10 : 0) +
      bonusDeImagem(imagensDistintas(x)) +
      (x.noticia?.tema_pendente ? BONUS_TEMA : 0);
    const score = efetivo(b) - efetivo(a);
    if (score) return score;
    return (
      new Date(b.registro?.data_publicacao || 0) -
      new Date(a.registro?.data_publicacao || 0)
    );
  });

if (!eligible.length) {
  return [{
    json: {
      existe_pauta_aprovavel: false,
      total_avaliado: items.length,
      motivo: 'Nenhuma notícia atingiu 70 pontos com curadoria válida',
    },
  }];
}

return [{
  json: {
    ...eligible[0],
    existe_pauta_aprovavel: true,
    total_avaliado: items.length,
    total_aprovavel: eligible.length,
  },
}];