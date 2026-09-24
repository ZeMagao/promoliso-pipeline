// Classificação por SUFIXO de domínio (não mais mapa exato): os feeds oficiais
// linkam de subdomínios (nvidianews.nvidia.com, newsroom.intel.com,
// www.nintendo.co.jp...) que o mapa exato jogava em "editorial". Esta lista
// espelha dominiosPrimarios do "Validar antes de publicar".
const dominiosPrimarios = [
  'playstation.com', 'sony.com', 'sonyinteractive.com',
  'xbox.com', 'microsoft.com', 'majornelson.com',
  'nintendo.com', 'nintendo.co.jp', 'nintendo-europe.com', 'nintendo.com.au',
  'nvidia.com', 'amd.com', 'intel.com',
  'samsung.com', 'lg.com', 'asus.com', 'msi.com', 'gigabyte.com', 'acer.com',
  'dell.com', 'alienware.com', 'lenovo.com', 'corsair.com', 'logitechg.com',
  'razer.com', 'ea.com', 'ubisoft.com', 'rockstargames.com', 'bethesda.net',
  'bandainamcoent.com', 'capcom.com', 'capcom.co.jp', 'konami.com',
  'square-enix.com', 'activision.com', 'blizzard.com', 'riotgames.com',
  'sega.com', 'sega.jp', 'cdprojektred.com', 'epicgames.com',
  'steampowered.com', 'unrealengine.com', 'unity.com',
];
const dominiosEditoriais = [
  'adrenaline.com.br', 'flowgames.gg', 'gamevicio.com',
];
function fonteBate(host, dominios) {
  return dominios.some((d) => host === d || host.endsWith('.' + d));
}
function classificarFonte(host) {
  if (!host) return 'editorial';
  if (fonteBate(host, dominiosPrimarios)) return 'primaria';
  if (fonteBate(host, dominiosEditoriais)) return 'editorial';
  return 'editorial';
}

function hostnameFromUrl(value) {
  const match = String(value || '').match(/^https?:\/\/([^\/?#]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, '') : '';
}

// PAUTA DE CALENDÁRIO — Game Pass e PS Plus, entrando e saindo, 1 de cada por mês.
// Só é "onda de catálogo" quem cita o SERVIÇO e dá sinal de LOTE. Jogo avulso, crítica de
// política e notícia tangencial ficam de fora: medido em 1549 títulos reais, 32/32 no gabarito.
const TEMA_SERVICOS = [
  { chave: 'gamepass', re: /game\s?pass/i },
  { chave: 'psplus', re: /ps\s?plus|playstation\s?plus|psn\s?plus/i },
];
// Regex literal, não string montada: dentro de string, '\\d' vira 'd' e o padrão morre calado.
// 'games' sozinho não serve — "Heroic Games Launcher" casaria. 'titles'/'títulos' serve.
const TEMA_LOTE = /lista|leva|wave|cat[áa]logo|catalog|mensa(?:l|is)|monthly|additions|adi[çc][õo]es|extra (?:and|e) (?:premium|deluxe)|extra\/(?:deluxe|premium)|titles|t[íi]tulos|(?:\d+|more|other|outros?|mais|ten|two|three|v[áa]rios)\s+(?:\w+\s+)?(?:jogos|games)|os jogos|tem jogos|de jogos|the games|^coming to .{0,20}game pass/i;
// Sem \b: o \b do JS é ASCII e /\bperderá\b/ não casa "perderá " porque á não fecha fronteira.
const TEMA_SAINDO = /saindo|sai(?:r|em) d|deixa(?:m|r|ndo)|remov|perde(?:r|ndo|m)?|leaving|leave|losing|removed|last chance|[úu]ltima chance|despedi|fora do cat[áa]logo/i;
const TEMA_ENTRANDO = /chega|entra(?:m|ndo|r)?|adiciona|dispon[íi]ve|recebe|revelad|anuncia|joining|joins|coming|added|additions|arrive|new games|bring|confira a lista|divulga|ready to download|resgatar|monthly games/i;
function classificarTema(texto) {
  const t = String(texto || '');
  const servico = TEMA_SERVICOS.find((s) => s.re.test(t));
  if (!servico) return '';
  if (!TEMA_LOTE.test(t)) return '';
  // "chegando e saindo" na mesma manchete conta como entrada, que é a onda principal.
  if (TEMA_SAINDO.test(t) && !TEMA_ENTRANDO.test(t)) return servico.chave + '_saindo';
  // Lote sem verbo nenhum ainda é onda de entrada: "Game Catalog for August: <lista de jogos>".
  return servico.chave + '_entrando';
}

// COTA DO MÊS. A fila já foi lida pelo portão no começo da rodada — aqui é releitura de memória,
// não consulta nova. READY/RETRY/PUBLISHING contam junto com PUBLISHED: peça esperando vaga já é
// o post do mês, e produzir outra igual seria duplicar.
// FAIL-OPEN: leitura que falha vira "nenhum tema cumprido" — melhor insistir do que sumir.
const TEMA_ESTADOS_QUE_CONTAM = ['PUBLISHED', 'PUBLISHING', 'READY', 'RETRY'];
const mesLocal = (valor) => {
  const d = new Date(valor);
  return Number.isFinite(d.getTime()) ? d.getFullYear() + '-' + (d.getMonth() + 1) : '';
};
const mesCorrente = mesLocal(new Date());
const temasCumpridos = new Set();
try {
  for (const item of $('Ler fila (portão)').all()) {
    const row = (item && item.json) || {};
    if (!TEMA_ESTADOS_QUE_CONTAM.includes(String(row.status || '').toUpperCase())) continue;
    if (mesLocal(row.published_at || row.created_at || row.createdAt) !== mesCorrente) continue;
    const tema = classificarTema(row.topic);
    if (tema) temasCumpridos.add(tema);
  }
} catch (e) {
  // sem fila nesta execução (disparo manual, por exemplo): todo tema segue pendente
}

const candidatos = $input.all()
  .map((item) => item.json || {})
  .map((item) => {
    const url = String(item.link || item.url || '').trim();
    const hostname = hostnameFromUrl(url);
    const tipoFonte = classificarFonte(hostname);
    const categories =
      item.categories || item.category || item.tags || [];
    const enclosure =
      item.enclosure?.url ||
      item.image?.url ||
      item.image ||
      item.thumbnail ||
      '';
    return {
      titulo: String(item.title || '').trim(),
      conteudo: String(
        item.contentSnippet ||
          item.content ||
          item.description ||
          item.summary ||
          '',
      )
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000),
      url,
      publicado_em:
        item.isoDate || item.pubDate || item.date || item.published || '',
      fonte:
        String(item.source || '').trim() ||
        (hostname ? hostname.toUpperCase() : ''),
      tipo_fonte: tipoFonte,
      tema_calendario: classificarTema(
        String(item.title || '') + ' ' + String(item.contentSnippet || item.description || ''),
      ),
      autor: String(item.creator || item.author || item.byline || '').trim(),
      imagem_principal:
        typeof enclosure === 'string' ? enclosure.trim() : '',
      categoria_original: Array.isArray(categories)
        ? String(categories[0] || '')
        : String(categories || ''),
      palavras_chave: Array.isArray(categories)
        ? categories
        : String(categories || '').split(','),
      dados_brutos: item,
    };
  })
  .sort(
    (a, b) =>
      new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0),
  );

// RESERVA DE VAGA PARA FONTE PRIMÁRIA.
// Antes daqui era `.slice(0, 24)` direto sobre a ordem por data, e o resultado medido na exec 601
// foi 23 portais e 1 primária — Xbox, Nintendo e NVIDIA zerados. O peso de fonte que existe em
// "Preparar fila de curadoria" roda DEPOIS do corte e não alcança quem já morreu aqui.
// A primária importa por imagem: traz 5-11 por artigo contra 1 do portal.
const VAGAS_PRIMARIA = 6;   // replay dos 441 itens reais da exec 601
const TETO_POR_HOST = 3;    // sem ele, news.xbox sozinho leva a reserva inteira
const TOTAL = 24;

// PISO DE FRESCOR NA RESERVA. Sem ele a reserva desce a lista inteira atrás de primária: o lote
// da exec 601 tinha 241 primárias, mas só 10 com menos de 24 h — e a mais antiga era de 2016-03-16
// (nvidianews). Num dia parado, a vaga privilegiada iria para notícia de 2016 sem ninguém ver.
// Item sem data legível dá Infinity e fica fora da reserva; ainda pode entrar pelo bolo geral.
const FRESCOR_RESERVA_H = 48;
const idadeEmHoras = (candidato) => {
  const t = Date.parse(String(candidato.publicado_em || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};

const reservadas = [];
const usadosPorHost = Object.create(null);
for (const candidato of candidatos) {
  if (reservadas.length >= VAGAS_PRIMARIA) break;
  if (candidato.tipo_fonte !== 'primaria') continue;
  if (idadeEmHoras(candidato) > FRESCOR_RESERVA_H) continue;
  const host = hostnameFromUrl(candidato.url);
  if (!host) continue;
  if ((usadosPorHost[host] || 0) >= TETO_POR_HOST) continue;
  usadosPorHost[host] = (usadosPorHost[host] || 0) + 1;
  reservadas.push(candidato);
}
// PISO, NÃO COTA: vaga de primária que sobrou volta pro bolo geral, então o total continua 24
// mesmo num dia em que nenhuma primária publique.
// VAGA DA PAUTA DE CALENDÁRIO. Sem ela, a onda do mês disputa as 24 vagas por data como qualquer
// nota solta — e medido em 7 semanas: 32 itens do tema chegaram ao Curador e só 3 viraram post.
// A vaga só existe enquanto o mês não tem o post: cumprida a cota, este bloco não pega ninguém.
const VAGAS_TEMA = 1;
const FRESCOR_TEMA_H = 48;
const temaPendente = (candidato) =>
  !!candidato.tema_calendario && !temasCumpridos.has(candidato.tema_calendario);
for (const candidato of candidatos) {
  candidato.tema_pendente = temaPendente(candidato);
}
// Primária na frente entre os do tema: é a escolha do dono e a que traz mais imagem por artigo.
const doTema = candidatos
  .filter((c) => c.tema_pendente && idadeEmHoras(c) <= FRESCOR_TEMA_H)
  .sort((a, b) => {
    const peso = (x) => (x.tipo_fonte === 'primaria' ? 1 : 0);
    return (peso(b) - peso(a))
      || (new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0));
  });
const reservadasTema = [];
const jaReservado = new Set(reservadas);
for (const candidato of doTema) {
  if (reservadasTema.length >= VAGAS_TEMA) break;
  if (jaReservado.has(candidato)) continue;   // já entrou pela vaga de primária
  reservadasTema.push(candidato);
}

const naReserva = new Set([...reservadas, ...reservadasTema]);
const completando = candidatos
  .filter((candidato) => !naReserva.has(candidato))
  .slice(0, TOTAL - naReserva.size);
const selecionados = [...reservadas, ...reservadasTema, ...completando].sort(
  (a, b) => new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0),
);

return [{ json: { candidatos: selecionados } }];