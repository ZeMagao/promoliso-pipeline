// Harness da pauta de calendário (Game Pass / PS Plus todo mês). Offline, rodando os QUATRO nós
// de código de verdade, com os títulos reais da tabela de curadoria.
//
// O que precisa provar:
//   1. O classificador acerta o gabarito à mão nos 32 itens reais do tema, e não inventa tema em
//      título que não cita o serviço.
//   2. A onda do mês ENTRA nos 24 mesmo quando a data a jogaria fora.
//   3. A onda do mês ENTRA nos 5 do Curador — e o Curador continua recebendo 5 DISTINTOS.
//   4. `Selecionar melhor pauta` escolhe a onda enquanto o mês não tem o post.
//   5. COTA: com o post do mês já na fila (PUBLISHED ou só READY), tudo isso some sozinho — sem
//      vaga, sem bônus, escolha idêntica à de antes do patch.
//   6. Dia sem tema nenhum: saída idêntica à de antes do patch, item a item.
//   7. `--reverter` fecha o círculo.
//
//   node design/test_pauta_calendario.cjs
const fs = require('fs');
const path = require('path');
const { aplicarNo, lf, BONUS_TEMA } = require('./patch_pauta_calendario.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');
const AMOSTRA = JSON.parse(fs.readFileSync(path.join(__dirname, 'tema_calendario_amostra.json'), 'utf8'));

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
}

const ARQUIVOS = {
  'Preparar candidatos': 'preparar-candidatos.js',
  'Normalizar notícias PromoLiso AI': 'normalizar-noticias-promoliso-ai.js',
  'Preparar fila de curadoria': 'preparar-fila-de-curadoria.js',
  'Selecionar melhor pauta': 'selecionar-melhor-pauta.js',
};
const antigo = {};
const novo = {};
// O harness roda nos dois estados. Com o patch já no ar, o "antes" vem de REVERTER o que está no
// ar — sem isso, `antigo` e `novo` seriam o mesmo texto e as provas de antes/depois passariam a
// comparar a coisa com ela mesma, dando falha (ou, pior, passando à toa).
// A marca de "já aplicado" é por NÓ: só "Preparar candidatos" ganha o classificador inteiro; os
// outros três recebem apenas os campos.
for (const [no, arquivo] of Object.entries(ARQUIVOS)) {
  const texto = lf(fs.readFileSync(path.join(WFDIR, arquivo), 'utf8'));
  const jaTem = /tema_(?:calendario|pendente)/.test(texto);
  novo[no] = jaTem ? texto : aplicarNo(texto, no, false);
  antigo[no] = jaTem ? aplicarNo(texto, no, true) : texto;
}
const APLICADO = /tema_calendario/.test(novo['Preparar candidatos'])
  && Object.keys(ARQUIVOS).every((no) => /tema_(?:calendario|pendente)/.test(
    lf(fs.readFileSync(path.join(WFDIR, ARQUIVOS[no]), 'utf8'))));
const METADE = !APLICADO && Object.keys(ARQUIVOS).some((no) => /tema_(?:calendario|pendente)/.test(
  lf(fs.readFileSync(path.join(WFDIR, ARQUIVOS[no]), 'utf8'))));
console.log(APLICADO ? '# os quatro nós JÁ estão com a pauta de calendário — conferindo o que está no ar'
                     : '# o export ainda não tem — conferindo a troca');
if (METADE) console.log('AVISO: os quatro nós não estão no mesmo estado — patch aplicado pela metade?');

// ── mini-n8n: roda o jsCode do nó com os globais que ele usa ──────────────────
function rodar(codigo, { entrada = [], nos = {}, execId = '1' } = {}) {
  const env = (nome) => {
    if (!(nome in nos)) throw new Error('nó não disponível nesta execução: ' + nome);
    const itens = nos[nome].map((json) => ({ json }));
    return { all: () => itens, first: () => itens[0], item: itens[0] };
  };
  const f = new Function('$input', '$', '$execution', '$json', codigo);
  const itensEntrada = entrada.map((json) => ({ json }));
  return f({ all: () => itensEntrada }, env, { id: execId }, entrada[0] || {});
}

// ── 1. classificador contra o gabarito à mão ─────────────────────────────────
// O gabarito é meu julgamento editorial: onda de catálogo sim, jogo avulso e política não.
const GABARITO = {
  'PlayStation Plus Monthly Games for August': 'psplus_entrando',
  'PS Plus tem aclamado jogo de zumbis': 'psplus_entrando',
  'Foco no Digital: PlayStation Plus de agosto': 'psplus_entrando',
  'PS Plus de agosto é revelada com Dying Light 2': 'psplus_entrando',
  'PlayStation Plus de agosto tem jogos revelados': 'psplus_entrando',
  'Coming to XBOX Game Pass: Gears of War': 'gamepass_entrando',
  'A DAY-ONE game and two more titles are joining': 'gamepass_entrando',
  'Helldivers 2 joins PlayStation Plus Game Catalog today': 'psplus_entrando',
  'PlayStation Plus Game Catalog for August': 'psplus_entrando',
  'PS Plus de agosto chega repleta de jogos': 'psplus_entrando',
  '(For Southeast Asia) Helldivers 2 joins': 'psplus_entrando',
  'PS Plus Extra and Premium August 2026 games are ready': 'psplus_entrando',
  'PlayStation Plus Extra/Deluxe: confira os jogos que deixam': 'psplus_saindo',
  'Silent Hill 2 and 7 other games are leaving PlayStation Plus': 'psplus_saindo',
  'PS Plus perderá mais 10 jogos em setembro': 'psplus_saindo',
  "Here's all the new Game Pass additions announced": 'gamepass_entrando',
  'Shelldiver, Call of Duty e mais: Xbox divulga lista': 'gamepass_entrando',
  'Game Pass is losing TEN titles on September 15': 'gamepass_saindo',
  'Coming to XBOX Game Pass: RuneScape: Dragonwilds, SpeedRunners': 'gamepass_entrando',
  'Game Pass: confira os jogos que estão chegando e saindo': 'gamepass_entrando',
  // não são onda de catálogo: jogo avulso, política, tangente
  'Surpresa! PS Plus recebe Helldivers 2': '',
  'Xbox Cloud Gaming chega às smart TVs Hisense': '',
  'Mistfall Hunter estreia no PC': '',
  'Dev da id Software critica Xbox': '',
  'Heroic Games Launcher quer trazer o Game Pass': '',
  'Game Pass has dropped a surprise thriller': '',
  'Game Pass brings in a deep-sea adventure': '',
  "Crypt Custodian's developer returns": '',
  'Militsioner: The Surreal Immersive Sim': '',
  'A Microsoft vai acabar com os lançamentos no primeiro dia': '',
  'RuneScape: Dragonwilds is coming to XBOX Game Pass': '',
};

// O classificador vive dentro do nó; aqui ele é exercitado PELO nó, sem cópia: cada título entra
// como candidato e sai carimbado em `tema_calendario`.
const feedItem = (r, extra = {}) => Object.assign({
  title: r.titulo,
  link: r.url || 'https://blog.playstation.com/' + encodeURIComponent(String(r.titulo).slice(0, 20)),
  contentSnippet: '',
  isoDate: new Date(Date.now() - 2 * 3600000).toISOString(),
}, extra);

// O nó corta em 24 de propósito, então os 32 vão em lotes — senão 8 títulos sumiriam do
// gabarito e apareceriam como erro de classificação, que é exatamente o que NÃO se quer medir.
const temaPorTitulo = new Map();
for (let i = 0; i < AMOSTRA.itens_do_tema.length; i += 20) {
  const lote20 = AMOSTRA.itens_do_tema.slice(i, i + 20);
  const saida = rodar(novo['Preparar candidatos'], {
    entrada: lote20.map((r) => feedItem(r)),
    nos: { 'Ler fila (portão)': [] },
  })[0].json.candidatos;
  for (const c of saida) temaPorTitulo.set(c.titulo, c.tema_calendario);
}

let certos = 0;
let errados = 0;
for (const r of AMOSTRA.itens_do_tema) {
  const chave = Object.keys(GABARITO).find((k) => r.titulo.includes(k));
  if (chave === undefined) continue;
  const esperado = GABARITO[chave];
  const obtido = temaPorTitulo.get(r.titulo) || '';
  if (esperado === obtido) { certos += 1; continue; }
  errados += 1;
  console.log(`  erro de classificação: esperava "${esperado || '-'}" veio "${obtido || '-'}"  ${r.titulo.slice(0, 60)}`);
}
ok(`classificador: ${certos}/${certos + errados} no gabarito real`, errados === 0);
ok(`amostra cobre os 32 itens do tema`, AMOSTRA.itens_do_tema.length === 32, String(AMOSTRA.itens_do_tema.length));

const controle = rodar(novo['Preparar candidatos'], {
  entrada: AMOSTRA.itens_de_controle.map((r) => feedItem(r)),
  nos: { 'Ler fila (portão)': [] },
})[0].json.candidatos;
ok('título sem o serviço nunca vira tema',
  controle.every((c) => !c.tema_calendario),
  (controle.find((c) => c.tema_calendario) || {}).titulo);

// ── 2. a onda entra nos 24 mesmo sendo a mais velha ──────────────────────────
// A onda PRIMÁRIA (news.xbox, PS Blog) já era salva no corte dos 24 pela reserva de primária que
// subiu em 15/09. Quem se perdia no corte é a onda de PORTAL — e é ela que este cenário usa.
const ONDA = AMOSTRA.itens_do_tema.find((r) => r.titulo.includes('Game Pass: confira os jogos'));
const horas = (h) => new Date(Date.now() - h * 3600000).toISOString();
// 30 notícias mais novas que a onda: sem vaga, o corte por data mataria a onda.
const enxurrada = AMOSTRA.itens_de_controle.concat(AMOSTRA.itens_de_controle).slice(0, 30)
  .map((r, i) => feedItem(r, { link: 'https://gamevicio.com/n' + i, isoDate: horas(1) }));
const comOnda = [...enxurrada, feedItem(ONDA, { link: 'https://gameblast.com.br/onda', isoDate: horas(20) })];

const sem = rodar(antigo['Preparar candidatos'], { entrada: comOnda, nos: { 'Ler fila (portão)': [] } })[0].json.candidatos;
const com = rodar(novo['Preparar candidatos'], { entrada: comOnda, nos: { 'Ler fila (portão)': [] } })[0].json.candidatos;
ok('antes do patch a onda ficava de fora dos 24', !sem.some((c) => c.url === 'https://gameblast.com.br/onda'));
ok('com o patch a onda entra nos 24', com.some((c) => c.url === 'https://gameblast.com.br/onda'));
ok('o corte continua sendo 24', com.length === 24, String(com.length));

// ── 3. COTA: com o post do mês na fila, nada disso acontece ──────────────────
const filaCom = (status, topico) => [{
  status,
  topic: topico,
  created_at: new Date().toISOString(),
  published_at: new Date().toISOString(),
}];
const cumprido = rodar(novo['Preparar candidatos'], {
  entrada: comOnda,
  nos: { 'Ler fila (portão)': filaCom('PUBLISHED', 'Coming to XBOX Game Pass: Gears of War e mais jogos') },
})[0].json.candidatos;
ok('cota cumprida (PUBLISHED): a onda perde a vaga',
  !cumprido.some((c) => c.url === 'https://gameblast.com.br/onda'));
const naFila = rodar(novo['Preparar candidatos'], {
  entrada: comOnda,
  nos: { 'Ler fila (portão)': filaCom('READY', 'Game Pass: os jogos que chegam nesta leva') },
})[0].json.candidatos;
ok('peça só esperando vaga (READY) também cumpre a cota',
  !naFila.some((c) => c.url === 'https://gameblast.com.br/onda'));
const outroTema = rodar(novo['Preparar candidatos'], {
  entrada: comOnda,
  nos: { 'Ler fila (portão)': filaCom('PUBLISHED', 'PS Plus: os jogos que deixam o catálogo') },
})[0].json.candidatos;
ok('cota de OUTRO tema não libera a do Game Pass',
  outroTema.some((c) => c.url === 'https://gameblast.com.br/onda'));
const mesPassado = rodar(novo['Preparar candidatos'], {
  entrada: comOnda,
  nos: {
    'Ler fila (portão)': [{
      status: 'PUBLISHED',
      topic: 'Coming to XBOX Game Pass: Gears of War e mais jogos',
      created_at: new Date(Date.now() - 45 * 86400000).toISOString(),
      published_at: new Date(Date.now() - 45 * 86400000).toISOString(),
    }],
  },
})[0].json.candidatos;
ok('post do mês PASSADO não conta para este mês',
  mesPassado.some((c) => c.url === 'https://gameblast.com.br/onda'));

// FAIL-OPEN: sem o nó da fila na execução (disparo manual), o tema segue pendente.
const semFila = rodar(novo['Preparar candidatos'], { entrada: comOnda, nos: {} })[0].json.candidatos;
ok('sem a fila na execução, o tema segue pendente (fail-open)',
  semFila.some((c) => c.url === 'https://gameblast.com.br/onda'));

// ── 4. dia sem tema: saída idêntica à de antes ───────────────────────────────
const semTema = AMOSTRA.itens_de_controle.map((r, i) => feedItem(r, { link: 'https://gamevicio.com/x' + i, isoDate: horas(i + 1) }));
const antesSemTema = rodar(antigo['Preparar candidatos'], { entrada: semTema, nos: { 'Ler fila (portão)': [] } })[0].json.candidatos;
const depoisSemTema = rodar(novo['Preparar candidatos'], { entrada: semTema, nos: { 'Ler fila (portão)': [] } })[0].json.candidatos;
ok('dia sem tema: mesma lista, na mesma ordem',
  JSON.stringify(antesSemTema.map((c) => c.url)) === JSON.stringify(depoisSemTema.map((c) => c.url)));

// ── 5. os 5 do Curador ───────────────────────────────────────────────────────
const noticia = (titulo, host, tipo, tema) => ({
  curation_key: host + '/' + titulo.slice(0, 12),
  titulo,
  conteudo: 'texto suficiente para passar no mínimo de dados',
  url: 'https://' + host + '/' + encodeURIComponent(titulo.slice(0, 10)),
  url_valida: true,
  dominio_fonte: host,
  tipo_fonte: tipo,
  data_publicacao: horas(3),
  tema_calendario: tema || '',
  tema_pendente: !!tema,
});
// 8 notícias de portal na frente + a onda oficial no fim: sem vaga, a onda não entra nos 5.
const lote = [];
// 8 primárias do dia enchem a 1ª passada; as 2 vagas de não-primária vão para as editoriais MAIS
// NOVAS. A onda de portal é a mais velha do lote — é assim que ela se perdia.
for (let i = 0; i < 8; i += 1) lote.push(noticia('Anúncio oficial ' + i, 'news.xbox.com', 'primaria', ''));
// Portais de hosts DIFERENTES: com o mesmo host, o teto de 2/host abriria vaga para a onda por
// acidente e o cenário provaria a coisa errada.
const PORTAIS = ['gamevicio.com', 'adrenaline.com.br', 'ign.com', 'tecnoblog.net'];
PORTAIS.forEach((host, i) => {
  const n = noticia('Notícia de portal ' + i, host, 'editorial', '');
  n.data_publicacao = horas(1);
  lote.push(n);
});
const ondaPortal = noticia(
  'Game Pass: confira os jogos que estão chegando e saindo na segunda leva de setembro',
  'gameblast.com.br', 'editorial', 'gamepass_entrando',
);
ondaPortal.data_publicacao = horas(20);
lote.push(ondaPortal);

const curadoriaArgs = (codigo) => rodar(codigo, {
  entrada: [],
  nos: {
    'Normalizar notícias PromoLiso AI': [{ noticias: lote, promo_liso_ai: { max_candidatos_ia: 5, janela_antiga_dias: 30 } }],
  },
});
const cincoAntes = curadoriaArgs(antigo['Preparar fila de curadoria']).map((i) => i.json.noticia.titulo);
const cincoDepois = curadoriaArgs(novo['Preparar fila de curadoria']).map((i) => i.json.noticia.titulo);
ok('antes do patch a onda não entrava nos 5', !cincoAntes.some((t) => t.includes('Game Pass: confira')));
ok('com o patch a onda entra nos 5', cincoDepois.some((t) => t.includes('Game Pass: confira')));
ok('o Curador continua recebendo 5', cincoDepois.length === 5, String(cincoDepois.length));
ok('os 5 são DISTINTOS (a vaga do tema não duplica o item)',
  new Set(cincoDepois).size === cincoDepois.length, cincoDepois.join(' | '));

// ── 6. a escolha da pauta ────────────────────────────────────────────────────
const pauta = (nota, tipo, tema, titulo) => ({
  persistencia_ok: true,
  elegivel_aprovacao: true,
  registro: { status_aprovacao: 'CANDIDATO', pontuacao_total: nota, data_publicacao: horas(2) },
  noticia: {
    titulo,
    tipo_fonte: tipo,
    tema_pendente: !!tema,
    imagem_principal: 'https://img/1.jpg',
    imagens_oficiais: ['https://img/1.jpg', 'https://img/2.jpg'],
  },
});
const disputa = [
  pauta(88, 'primaria', '', 'Notícia forte do dia'),
  pauta(78, 'primaria', 'gamepass_entrando', 'Coming to XBOX Game Pass: a leva do mês'),
];
ok('sem o patch, a notícia de nota 88 ganha da onda de 78',
  rodar(antigo['Selecionar melhor pauta'], { entrada: disputa })[0].json.noticia.titulo === 'Notícia forte do dia');
ok(`com o patch (bônus ${BONUS_TEMA}), a onda pendente ganha`,
  rodar(novo['Selecionar melhor pauta'], { entrada: disputa })[0].json.noticia.titulo.includes('Coming to XBOX'));

const disputaCumprida = [
  pauta(88, 'primaria', '', 'Notícia forte do dia'),
  pauta(78, 'primaria', '', 'Coming to XBOX Game Pass: a leva do mês'),
];
ok('cota cumprida: a escolha volta a ser a de antes',
  rodar(novo['Selecionar melhor pauta'], { entrada: disputaCumprida })[0].json.noticia.titulo === 'Notícia forte do dia');
ok('bônus não atropela diferença grande de nota',
  rodar(novo['Selecionar melhor pauta'], {
    entrada: [pauta(95, 'primaria', '', 'Furo do ano'), pauta(70, 'editorial', 'psplus_saindo', 'PS Plus: jogos que saem')],
  })[0].json.noticia.titulo === 'Furo do ano');

// ── 7. normalizar carrega os campos, e o ida-e-volta fecha ───────────────────
const normalizado = rodar(novo['Normalizar notícias PromoLiso AI'], {
  // Este nó lê de $json (a saída da "Configuração PromoLiso AI"), não de $().
  entrada: [{
    candidatos: [{
      titulo: 'Coming to XBOX Game Pass: Gears of War e mais jogos',
      url: 'https://news.xbox.com/onda',
      conteudo: 'lista de jogos da leva',
      publicado_em: horas(2),
      tipo_fonte: 'primaria',
      tema_calendario: 'gamepass_entrando',
      tema_pendente: true,
    }],
    promo_liso_ai: {},
  }],
});
const primeira = (normalizado[0].json.noticias || [])[0] || {};
ok('normalizar carrega tema_calendario adiante', primeira.tema_calendario === 'gamepass_entrando', String(primeira.tema_calendario));
ok('normalizar carrega tema_pendente adiante', primeira.tema_pendente === true, String(primeira.tema_pendente));

for (const no of Object.keys(ARQUIVOS)) {
  const revertido = aplicarNo(novo[no], no, true);
  ok(`${no}: --reverter tira a pauta de calendário`, !revertido.includes('tema_calendario'));
  ok(`${no}: reverter e reaplicar volta byte a byte`, aplicarNo(revertido, no, false) === lf(novo[no]));
  let compila = true;
  try { new Function(novo[no]); } catch (e) { compila = false; }
  ok(`${no}: jsCode resultante compila`, compila);
}

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
