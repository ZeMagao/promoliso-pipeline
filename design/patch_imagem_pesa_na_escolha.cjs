// A IMAGEM PASSA A PESAR NA ESCOLHA DA PAUTA — E O CONTEÚDO NUNCA É CORTADO POR CAUSA DELA.
//
// SUBSTITUI o patch_slides_pela_imagem.cjs (escrito e descartado em 15/09, nunca deployado).
// Aquele resolvia "a mesma foto 5x" cortando slides: pauta com 7 fatos e 3 imagens virava 3
// slides. O dono vetou, e com razão — o post tem que ser importante pelo que DIZ. Amputar fato
// para melhorar arte é trocar o fim pelo meio.
//
// A estética então não se resolve no redator. Resolve-se ANTES: não escolhendo pauta pobre de
// imagem quando existe pauta rica na mesma rodada.
//
// ───────────────────────────────────────────────────────────────────────────────────────────
// 1. `Selecionar melhor pauta` — O BÔNUS DE IMAGEM PREMIAVA VARIEDADE QUE NÃO EXISTE.
//
// `imagensDistintas` conta URL, não foto. Duas variantes de tamanho do MESMO arquivo contam
// como duas imagens, e a pauta leva o bônus de +8 sem ter variedade nenhuma.
//
// Foi exatamente assim que a peça 71 venceu a rodada 601:
//
//   "Sony anuncia sua nova geração de headsets Pulse"   hoje conta 2, real 1
//      .../e292ccd503363bbe4274d7777e38b7-scaled.jpg
//      .../e292ccd503363bbe4274d7777e38b7-2048x1365.jpg
//
// Mesmo arquivo. Ela ganhou +8 por variedade inexistente, venceu, e saiu com a mesma foto em
// todos os slides. MEDIDO sobre 40 notícias reais das execs 598 e 601:
//
//   ganham o bônus hoje (>=2 "distintas")   37 de 40   <- 92%, quase não discrimina
//   perdem com contagem honesta              5 de 40   <- eram 1 foto em 2 tamanhos
//
//   fotos REAIS por notícia:  1 foto: 8 · 2: 10 · 3: 10 · 4: 6 · 6: 2 · 7: 4
//
// Duas correções, as duas só de RANKING — nenhuma reprova nada, ninguém perde publicação:
//
//   a) contagem honesta: variante de tamanho do mesmo arquivo é UMA foto.
//      (-2048x1365 e -scaled do WordPress; /s1920/ e /w640-h360/ do Blogger)
//   b) bônus graduado: 1 foto vale 0, e sobe até o teto. Hoje é binário — pauta com 7 fotos
//      recebe o mesmo que pauta com 2, então a régua não separa o que queremos separar.
//
// ⚠️ O TETO CONTINUA 8, ABAIXO DOS 10 DA FONTE PRIMÁRIA. O comentário no código diz por quê:
// "8 < 10 de propósito — arte não vence procedência". Subir o teto acima de 10 inverteria essa
// decisão de lado, sem ninguém ter pedido.
//
// ⚠️ ESTA É A CONTAGEM HONESTA APLICADA ONDE ELA É SEGURA. A mesma canonicalização dentro do
// VALIDADOR faria `imagens_unicas` cair para 1 em 31 pautas (todas do GameBlast, medido em 437
// itens) e poderia REPROVÁ-LAS na regra de variedade — barrando a fonte que acabou de ser
// desbloqueada. Aqui, no ranking, o efeito é só perder a vez para uma pauta melhor.
//
// ───────────────────────────────────────────────────────────────────────────────────────────
// 2. `AI Agent` — NÃO REPETIR É PREFERÊNCIA, FATO É OBRIGAÇÃO.
//
// A instrução atual manda repetir sem pensar ("Se houver menos imagens que slides, reutilize as
// disponíveis"), e está em DOIS lugares — linhas 54 e 277. Foi escrita quando o carrossel era
// fixo em 5 slides; desde 20/08 ele vai de 3 a 7 e a faixa nunca rodou em produção.
//
// A regra nova inverte a ordem SEM cortar conteúdo: evite repetir, mas se o fato existe, o
// slide existe. As duas cópias trocam juntas — divergir cópia é o defeito que já custou semanas
// aqui (caps 42/38 vs 34/30, URL do Cloudinary em 3 arquivos).
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const TETO_BONUS = 8;   // mantido abaixo dos 10 da fonte primária, de propósito

// ───────────────────────────────────────────── 1. ranking
const ANCORA_SEL = `    const imagensDistintas = (x) => {
      const noticia = x.noticia || {};
      const lista = Array.isArray(noticia.imagens_oficiais)
        ? noticia.imagens_oficiais
        : [];
      return new Set(
        [...lista, noticia.imagem_principal]
          .filter((u) => typeof u === 'string' && /^https:\\/\\//i.test(u))
          .map((u) => String(u).split(/[?#]/)[0].toLowerCase()),
      ).size;
    };`;

const NOVO_SEL = `    // MESMA FOTO EM TAMANHOS DIFERENTES É UMA FOTO. Antes daqui a contagem era por URL, e
    // duas variantes do mesmo arquivo valiam duas imagens — a pauta levava o bônus sem ter
    // variedade nenhuma. Medido na exec 601: a peça que venceu contava 2 e tinha 1
    // (…-scaled.jpg e …-2048x1365.jpg, mesmo hash), e saiu com a mesma foto em todos os slides.
    const TAMANHO_WP = /-\\d{2,4}x\\d{2,4}(?=\\.[a-z]{3,4}$)/i;
    const ESCALADA_WP = /-scaled(?=\\.[a-z]{3,4}$)/i;
    const TAMANHO_BLOGGER = /\\/(s\\d+(?:-[a-z0-9-]+)*|w\\d+-h\\d+(?:-[a-z0-9-]+)*)\\/([^/]+)$/i;
    const identidadeVisual = (url) => {
      let limpa = String(url).toLowerCase().split(/[?#]/)[0];
      if (/^https:\\/\\/blogger\\.googleusercontent\\.com\\//i.test(limpa)) {
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
          .filter((u) => typeof u === 'string' && /^https:\\/\\//i.test(u))
          .map(identidadeVisual),
      ).size;
    };`;

const ANCORA_BONUS = `      (imagensDistintas(x) >= 2 ? 8 : 0);`;

const NOVO_BONUS = `      bonusDeImagem(imagensDistintas(x));`;

const ANCORA_EFETIVO = `    const efetivo = (x) =>`;

const NOVO_EFETIVO = `    // BÔNUS GRADUADO. Era binário (>=2 imagens valia 8), e 37 das 40 notícias medidas passavam
    // desse corte — régua que não separa o que precisamos separar. Agora pauta com 4+ fotos
    // vence pauta com 2, e pauta de foto única não leva nada.
    // Teto mantido em ${TETO_BONUS}, ABAIXO dos 10 da fonte primária: arte não vence procedência.
    const bonusDeImagem = (fotos) => (fotos <= 1 ? 0 : Math.min(2 * fotos, ${TETO_BONUS}));
    const efetivo = (x) =>`;

// ───────────────────────────────────────────── 2. prompt, conteúdo em primeiro lugar
const ANCORA_P1 = 'Se houver menos imagens que slides, reutilize as disponíveis.';

const NOVO_P1 = 'Evite repetir a mesma imagem em slides diferentes — duas URLs do mesmo arquivo '
  + 'em tamanhos diferentes (…-scaled.jpg e …-2048x1365.jpg, ou /s1920/ e /w640-h360/) são a '
  + 'MESMA imagem, não duas. Mas NUNCA corte um fato relevante só para evitar repetição: se a '
  + 'matéria sustenta o slide, o slide existe, e aí repita a imagem de melhor enquadramento. '
  + 'Conteúdo vem primeiro; não repetir é preferência, não regra.';

const ANCORA_P2 = 'Se houver menos imagens oficiais que slides, reutilize as disponíveis em vez de reprovar a pauta ou inventar URLs.';

const NOVO_P2 = 'Se houver menos imagens oficiais que slides, reutilize as disponíveis em vez de '
  + 'reprovar a pauta ou inventar URLs — e prefira a de melhor enquadramento na repetição. Nunca '
  + 'remova um slide que a matéria sustenta só porque faltou imagem.';

const EDICOES = [
  { no: 'Selecionar melhor pauta', campo: 'jsCode', nome: 'contagem honesta de fotos distintas', de: ANCORA_SEL, para: NOVO_SEL },
  { no: 'Selecionar melhor pauta', campo: 'jsCode', nome: 'bônus graduado (define)', de: ANCORA_EFETIVO, para: NOVO_EFETIVO },
  { no: 'Selecionar melhor pauta', campo: 'jsCode', nome: 'bônus graduado (usa)', de: ANCORA_BONUS, para: NOVO_BONUS },
  { no: 'AI Agent', campo: 'prompt', nome: 'campos visuais: evitar repetir sem cortar fato', de: ANCORA_P1, para: NOVO_P1 },
  { no: 'AI Agent', campo: 'prompt', nome: 'candidato aprovado: nunca remover slide por falta de imagem', de: ANCORA_P2, para: NOVO_P2 },
];

const lf = (s) => String(s).split('\r\n').join('\n');
const MARCA = 'identidadeVisual';

const leCampo = (no, campo) => (campo === 'prompt' ? no.parameters.options.systemMessage : no.parameters.jsCode);
const escreveCampo = (no, campo, v) => {
  if (campo === 'prompt') no.parameters.options.systemMessage = v; else no.parameters.jsCode = v;
};

function aplicar(texto, edicao, reverter) {
  const saida = lf(texto);
  const de = lf(reverter ? edicao.para : edicao.de);
  const para = lf(reverter ? edicao.de : edicao.para);
  const vezes = saida.split(de).length - 1;
  if (vezes !== 1) {
    throw new Error(`${edicao.no}: âncora "${edicao.nome}" apareceu ${vezes} vezes (esperava 1)`);
  }
  return saida.split(de).join(para);
}

module.exports = { WF, EDICOES, aplicar, lf, MARCA, TETO_BONUS, leCampo, escreveCampo };

if (require.main !== module) return;

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

  // valida TODAS as âncoras antes de escrever qualquer uma
  {
    const rascunho = {};
    for (const e of EDICOES) {
      const no = nodes.find((x) => x.name === e.no);
      if (!no) throw new Error('nó não achado: ' + e.no);
      const chave = e.no + '|' + e.campo;
      const atual = rascunho[chave] !== undefined ? rascunho[chave] : leCampo(no, e.campo);
      if (typeof atual !== 'string') throw new Error(`${e.no}: campo ${e.campo} não é string`);
      rascunho[chave] = aplicar(atual, e, REVERTER);
    }
  }

  const acumulado = {};
  for (const e of EDICOES) {
    const no = nodes.find((x) => x.name === e.no);
    const chave = e.no + '|' + e.campo;
    const atual = acumulado[chave] !== undefined ? acumulado[chave] : leCampo(no, e.campo);
    acumulado[chave] = aplicar(atual, e, REVERTER);
    console.log(`OK  ${e.no.padEnd(24)} ${e.nome}`);
  }
  for (const chave of Object.keys(acumulado)) {
    const [nome, campo] = chave.split('|');
    const no = nodes.find((x) => x.name === nome);
    if (campo === 'jsCode') {
      try { new Function(acumulado[chave]); } catch (err) {
        throw new Error(`${nome}: jsCode resultante não compila: ${err.message}`);
      }
    }
    escreveCampo(no, campo, acumulado[chave]);
  }
  console.log(`OK  bônus graduado: 1 foto=0, 2=4, 3=6, 4+=${TETO_BONUS} (teto abaixo dos 10 da primária)`);
  console.log('OK  conteúdo preservado: nenhuma regra corta slide por falta de imagem');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte o peso de imagem na escolha da pauta'
    : 'Imagem pesa na escolha da pauta; conteudo nunca e cortado por falta dela';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-imagem-na-escolha.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
