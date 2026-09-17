// PAUTA DE CALENDÁRIO: Game Pass e PS Plus entram todo mês, por construção (17/09/2026).
//
// O PEDIDO. "As atualizações de jogos do Xbox Game Pass e da PS Plus são boas de ter todo mês."
// Decidido com o dono: **4 posts garantidos por mês** — entrando e saindo, por serviço — e, quando
// o mesmo assunto aparece em várias fontes no mesmo dia, **primária na frente** (PS Blog e Xbox
// Wire trazem de 5 a 11 imagens por artigo contra 1 do portal, e imagem é o que mata peça).
//
// O QUE A MEDIÇÃO MOSTROU (1549 títulos reais da tabela de curadoria, 28/07 a 17/09):
//
//   32 itens do tema chegaram ao Curador, quase todos com nota ≥ 78
//    3 viraram post (rows 15, 42 e 68)
//
// Ou seja: não falta matéria nem nota. O tema morre porque **compete** em três funis seguidos —
// 24 candidatos, 5 do Curador, 1 pauta por rodada — e perder três sorteios seguidos é o normal.
// Casos concretos do que se perdeu: a PS Plus de agosto (nota 84) morreu em correção de imagens,
// e a onda do Game Pass de 15/09 (nota 86) morreu no bloqueio de imagem do Blogger.
//
// COMO FICA. Um item de tema pendente ganha três empurrões, todos no mesmo lugar onde já existe
// reserva medida — e **todos somem sozinhos** assim que o mês tem o post:
//
//   1. `Preparar candidatos`      1 vaga reservada no corte dos 24
//   2. `Preparar fila de curadoria`  1 vaga entre os 5 que vão ao Curador
//   3. `Selecionar melhor pauta`  +${''}BONUS no desempate (a nota do Curador continua mandando no resto)
//
// A COTA. O mês corrente é lido da própria fila, que o nó `Ler fila (portão)` já carregou no
// começo da rodada — sem consulta nova. Conta como cumprido o que está PUBLISHED, PUBLISHING,
// READY ou RETRY: peça esperando vaga já é o post do mês, e produzir outra igual seria duplicar.
// FAIL-OPEN: se a leitura falhar, o tema é tratado como pendente — melhor insistir do que sumir.
//
// O CLASSIFICADOR, e por que ele é estreito. Só vira tema quem cita o serviço **e** dá sinal de
// LOTE (lista, leva, catálogo, monthly, "10 jogos", "7 other games", "Coming to Game Pass:" no
// começo). Chegada de um jogo só, crítica de política e notícia tangencial ficam de fora — o
// pedido é a atualização mensal, não toda menção ao serviço. Medido contra gabarito à mão nos 32
// itens reais: **32 certos, 0 errados**, e 0 falso positivo nos 1549 títulos.
//
// Duas armadilhas que a medição pegou no caminho, e que estão resolvidas aqui:
//   - `games` sozinho não pode ser sinal de lote: "Heroic Games Launcher" casava.
//   - `\b` do JS é ASCII: `/\bperderá\b/` NÃO casa "perderá " porque á não fecha fronteira. Por
//     isso os padrões acentuados vão sem \b.
//
// O QUE ESTE PATCH **NÃO** FAZ:
//   - Não fura o portão da fila. Se a fila estiver cheia (3 frescas), a rodada nem lê os feeds —
//     e uma onda que caia bem nessa janela ainda pode passar batida. Medir antes de mexer: o
//     portão é o que cortou 40% de desperdício em 20/08.
//   - Não baixa a régua do Curador nem do validador. Tema pendente ganha PRIORIDADE, não passe
//     livre: peça feia continua reprovando.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const BONUS_TEMA = 15;        // primária vale 10 e imagem vale 8 no mesmo desempate
const VAGAS_TEMA_24 = 1;
const FRESCOR_TEMA_H = 48;    // mesmo frescor da reserva de primária e do publicador

// O classificador nasce aqui e é copiado para dentro do nó — o harness importa DAQUI, então
// prova o mesmo texto que vai rodar.
const CLASSIFICADOR = `// PAUTA DE CALENDÁRIO — Game Pass e PS Plus, entrando e saindo, 1 de cada por mês.
// Só é "onda de catálogo" quem cita o SERVIÇO e dá sinal de LOTE. Jogo avulso, crítica de
// política e notícia tangencial ficam de fora: medido em 1549 títulos reais, 32/32 no gabarito.
const TEMA_SERVICOS = [
  { chave: 'gamepass', re: /game\\s?pass/i },
  { chave: 'psplus', re: /ps\\s?plus|playstation\\s?plus|psn\\s?plus/i },
];
// Regex literal, não string montada: dentro de string, '\\\\d' vira 'd' e o padrão morre calado.
// 'games' sozinho não serve — "Heroic Games Launcher" casaria. 'titles'/'títulos' serve.
const TEMA_LOTE = /lista|leva|wave|cat[áa]logo|catalog|mensa(?:l|is)|monthly|additions|adi[çc][õo]es|extra (?:and|e) (?:premium|deluxe)|extra\\/(?:deluxe|premium)|titles|t[íi]tulos|(?:\\d+|more|other|outros?|mais|ten|two|three|v[áa]rios)\\s+(?:\\w+\\s+)?(?:jogos|games)|os jogos|tem jogos|de jogos|the games|^coming to .{0,20}game pass/i;
// Sem \\b: o \\b do JS é ASCII e /\\bperderá\\b/ não casa "perderá " porque á não fecha fronteira.
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
}`;

// ───────────────────────────────────────────── 1A. Preparar candidatos: classificador + cota
const ANCORA_CAND_A = `const candidatos = $input.all()`;

const NOVO_CAND_A = `${CLASSIFICADOR}

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

const candidatos = $input.all()`;

// ───────────────────────────────────────────── 1B. Preparar candidatos: marca cada candidato
const ANCORA_CAND_B = `      tipo_fonte: tipoFonte,`;

const NOVO_CAND_B = `      tipo_fonte: tipoFonte,
      tema_calendario: classificarTema(
        String(item.title || '') + ' ' + String(item.contentSnippet || item.description || ''),
      ),`;

// ───────────────────────────────────────────── 1C. Preparar candidatos: vaga no corte dos 24
const ANCORA_CAND_C = `const naReserva = new Set(reservadas);
const completando = candidatos
  .filter((candidato) => !naReserva.has(candidato))
  .slice(0, TOTAL - reservadas.length);`;

const NOVO_CAND_C = `// VAGA DA PAUTA DE CALENDÁRIO. Sem ela, a onda do mês disputa as 24 vagas por data como qualquer
// nota solta — e medido em 7 semanas: 32 itens do tema chegaram ao Curador e só 3 viraram post.
// A vaga só existe enquanto o mês não tem o post: cumprida a cota, este bloco não pega ninguém.
const VAGAS_TEMA = ${VAGAS_TEMA_24};
const FRESCOR_TEMA_H = ${FRESCOR_TEMA_H};
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
  .slice(0, TOTAL - naReserva.size);`;

// O `selecionados` monta a partir de `reservadas`; a reserva do tema precisa entrar junto.
const ANCORA_CAND_D = `const selecionados = [...reservadas, ...completando].sort(`;
const NOVO_CAND_D = `const selecionados = [...reservadas, ...reservadasTema, ...completando].sort(`;

// ───────────────────────────────────────────── 2. Normalizar: leva os dois campos adiante
const ANCORA_NORM = `    tipo_fonte: clean(item.tipo_fonte, 50),`;
const NOVO_NORM = `    tipo_fonte: clean(item.tipo_fonte, 50),
    // Pauta de calendário: classificada uma vez em "Preparar candidatos" e carregada daqui pra
    // frente. Este objeto é montado campo a campo, então o que não for listado aqui some.
    tema_calendario: clean(item.tema_calendario, 40),
    tema_pendente: !!item.tema_pendente,`;

// ───────────────────────────────────────────── 3. Preparar fila de curadoria: 1 das 5 vagas
const ANCORA_FILA = `// 1ª passada: preenche na ordem de mérito, deixando PISO_NAO_PRIMARIA vagas guardadas.
const tetoDaPrimeiraPassada = Math.max(0, MAX_IA - PISO_NAO_PRIMARIA);
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= tetoDaPrimeiraPassada) break;
  if (!cabeNoHost(candidato)) continue;
  pegar(candidato);
}`;

const NOVO_FILA = `// VAGA DA PAUTA DE CALENDÁRIO (17/09). O Curador só vê 5 itens; sem vaga própria, a onda do mês
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
}`;

// ───────────────────────────────────────────── 4. Selecionar melhor pauta: bônus no desempate
const ANCORA_SEL = `    const efetivo = (x) =>
      Number(x.registro?.pontuacao_total || 0) +
      (String(x.noticia?.tipo_fonte || '') === 'primaria' ? 10 : 0) +
      bonusDeImagem(imagensDistintas(x));`;

const NOVO_SEL = `    // PAUTA DE CALENDÁRIO: enquanto o mês não tiver o post de Game Pass / PS Plus (entrando e
    // saindo, 1 de cada), a onda passa na frente. 15 > 10 da primária e > 8 das imagens de
    // propósito: é a única pauta que o dono pediu para existir todo mês. Cumprida a cota,
    // \`tema_pendente\` vem false e este termo vira 0 sozinho — não há régua para desligar depois.
    const BONUS_TEMA = ${BONUS_TEMA};
    const efetivo = (x) =>
      Number(x.registro?.pontuacao_total || 0) +
      (String(x.noticia?.tipo_fonte || '') === 'primaria' ? 10 : 0) +
      bonusDeImagem(imagensDistintas(x)) +
      (x.noticia?.tema_pendente ? BONUS_TEMA : 0);`;

const EDICOES = [
  { no: 'Preparar candidatos', nome: 'classificador do tema + cota do mês', de: ANCORA_CAND_A, para: NOVO_CAND_A },
  { no: 'Preparar candidatos', nome: 'marca o tema em cada candidato', de: ANCORA_CAND_B, para: NOVO_CAND_B },
  { no: 'Preparar candidatos', nome: 'vaga do tema no corte dos 24', de: ANCORA_CAND_C, para: NOVO_CAND_C },
  { no: 'Preparar candidatos', nome: 'reserva do tema entra no resultado', de: ANCORA_CAND_D, para: NOVO_CAND_D },
  { no: 'Normalizar notícias PromoLiso AI', nome: 'carrega tema_calendario adiante', de: ANCORA_NORM, para: NOVO_NORM },
  { no: 'Preparar fila de curadoria', nome: 'vaga do tema entre os 5 do Curador', de: ANCORA_FILA, para: NOVO_FILA },
  { no: 'Selecionar melhor pauta', nome: 'bônus enquanto o mês não tem o post', de: ANCORA_SEL, para: NOVO_SEL },
];

const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, edicao, reverter) {
  const saida = lf(texto);
  const de = lf(reverter ? edicao.para : edicao.de);
  const para = lf(reverter ? edicao.de : edicao.para);
  const vezes = saida.split(de).length - 1;
  if (vezes !== 1) {
    throw new Error(`${edicao.no}: âncora "${edicao.nome}" apareceu ${vezes} vezes `
      + `(esperava 1) — patch já aplicado, ou o nó mudou`);
  }
  return saida.split(de).join(para);
}

function aplicarNo(texto, nome, reverter) {
  const doNo = EDICOES.filter((e) => e.no === nome);
  const ordem = reverter ? doNo.slice().reverse() : doNo;
  return ordem.reduce((acc, edicao) => aplicar(acc, edicao, reverter), texto);
}

module.exports = { WF, EDICOES, aplicar, aplicarNo, lf, BONUS_TEMA, VAGAS_TEMA_24, FRESCOR_TEMA_H, CLASSIFICADOR };

if (require.main === module) {
  const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
  if (!fs.existsSync(DB)) {
    console.error('FAIL  banco do n8n não existe aqui: ' + DB
      + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
    process.exit(1);
  }
  const sqlite3 = require('sqlite3');
  const DRY = process.argv.includes('--dry');
  const REVERTER = process.argv.includes('--reverter');
  const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
  const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
  function agora() {
    const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
      + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }

  (async () => {
    const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
    if (!row) throw new Error('workflow não achado: ' + WF);
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

    const nodes = JSON.parse(row.nodes);
    const alvos = [...new Set(EDICOES.map((e) => e.no))];

    // Uma passada de checagem ANTES de escrever: todas as âncoras têm que existir. Sem isto, um
    // patch parcial deixaria o workflow num estado que nenhum dos dois lados descreve.
    for (const nome of alvos) {
      const no = nodes.find((x) => x.name === nome);
      if (!no) throw new Error('nó não achado: ' + nome);
      if (typeof no.parameters.jsCode !== 'string') throw new Error(`${nome}: jsCode não é string`);
      aplicarNo(no.parameters.jsCode, nome, REVERTER);   // só valida
    }

    for (const nome of alvos) {
      const no = nodes.find((x) => x.name === nome);
      const antes = no.parameters.jsCode;
      const depois = aplicarNo(antes, nome, REVERTER);
      try { new Function(depois); } catch (e) {
        throw new Error(`${nome}: jsCode resultante não compila: ${e.message}`);
      }
      no.parameters.jsCode = depois;
      const delta = depois.length - lf(antes).length;
      console.log(`OK  ${nome.padEnd(34)} (${delta > 0 ? '+' : ''}${delta} bytes)`);
    }
    console.log(`OK  cota 4/mês (entrando+saindo por serviço) · vaga nos 24 e nos 5 · bônus ${BONUS_TEMA}`);
    console.log('OK  os nós compilam');

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER
      ? 'Reverte a pauta de calendario de Game Pass e PS Plus'
      : 'Game Pass e PS Plus entram todo mes: vaga nos 24, vaga nos 5 e bonus ate publicar';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-pauta-calendario.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
