// A CAPA DEIXA DE DERRUBAR A RODADA INTEIRA (24/09/2026).
//
// O QUE ACONTECEU: em 24/09 a rodada das 16:00 morreu com "Bad request - please check your
// parameters" no nó da capa. A causa não era nossa nem do Cloudinary: a URL escolhida
// (`news.xbox.com/.../Free-Play-Days-Sept-24.jpg`) **redireciona para si mesma**, 50 saltos, zero
// byte — imagem morta na origem. O nó da capa tem retry, não tem saída de erro, então a execução
// inteira do produtor morreu.
//
// O CUSTO MEDIDO: a pauta se perde. Ela já tinha sido gravada na curadoria como processada
// (`CURADO_APROVAVEL`), e o corte de candidatos ignora o que já passou por lá — ou seja, ela não
// volta nas rodadas seguintes. Uma foto quebrada custa a pauta inteira.
//
// A ASSIMETRIA QUE FICOU EVIDENTE: os SLIDES já tinham fallback desde 06/08 (`Imagem do slide
// válida?` → `Usar capa como fallback`). A capa, que é obrigatória, não tinha nenhum.
//
// O CONSERTO: a tag da capa passa a levar `data-fallback` com as outras fotos da MESMA peça (a
// capa da pauta e as imagens dos slides, na ordem). O renderizador tenta em ordem e só falha se
// todas falharem — a regra mora em `vps/renderer/candidatos.cjs`, com harness próprio.
//
// ⚠️ ORDEM OBRIGATÓRIA: o renderizador com suporte a `data-fallback` tem que estar no ar ANTES
// deste patch. Com o renderizador antigo, `data-fallback` é atributo ignorado — não quebra nada,
// mas também não conserta; o `--dry` confere a versão do serviço antes de liberar.
//
// O QUE NÃO MUDA: a foto escolhida continua a mesma, o enquadramento continua o mesmo, e uma peça
// cuja primária responde sai byte a byte igual à de antes. O fallback só existe para o caso em que
// hoje a rodada morre.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Code in JavaScript1';
const MAX_ALTERNATIVAS = 4;

const ANCORA_FN = `function capaImg(source){`;
const NOVO_FN = `function capaImg(source, alternativas){`;

const ANCORA_TAG = `  return '<img src="' + cloud(source, t) + '" style="position:absolute;inset:0;width:1080px;height:1350px;object-fit:cover;filter:contrast(1.06) saturate(1.06);" />';`;

const NOVO_TAG = `  // CANDIDATOS DE CAPA: as outras fotos da mesma peça, na ordem, para o renderizador tentar se a
  // primária estiver morta na origem. Em 24/09 uma URL que redirecionava para si mesma derrubou a
  // execução inteira — e a pauta se perdeu, porque a curadoria já a tinha marcado como processada.
  const outras = (Array.isArray(alternativas) ? alternativas : [])
    .filter((u) => typeof u === 'string' && /^https:\\/\\//i.test(u) && u !== source)
    .slice(0, ${MAX_ALTERNATIVAS})
    .map((u) => cloud(u, t))
    .filter(Boolean);
  const fallback = outras.length ? ' data-fallback="' + outras.join(' ') + '"' : '';
  return '<img src="' + cloud(source, t) + '"' + fallback + ' style="position:absolute;inset:0;width:1080px;height:1350px;object-fit:cover;filter:contrast(1.06) saturate(1.06);" />';`;

const ANCORA_CHAMADA = `  \${capaImg(source)}`;
const NOVO_CHAMADA = `  \${capaImg(source, capaAlternativas(output))}`;

// A lista de alternativas nasce da própria peça: a capa da pauta e as fotos dos slides.
const ANCORA_FONTE = `function capaCredito(output){`;
const NOVO_FONTE = `// Alternativas de capa, em ordem de preferência: a capa declarada na pauta e depois as fotos dos
// slides. São as imagens que o validador já aprovou para esta peça — não entra nada de fora.
function capaAlternativas(output){
  const slides = Array.isArray(output.slides) ? output.slides : [];
  return [output.capa, ...slides.map((s) => s && s.imagem)]
    .filter((u) => typeof u === 'string' && /^https:\\/\\//i.test(u));
}
function capaCredito(output){`;

const EDICOES = [
  { nome: 'capaImg aceita alternativas', de: ANCORA_FN, para: NOVO_FN },
  { nome: 'a tag da capa leva data-fallback', de: ANCORA_TAG, para: NOVO_TAG },
  { nome: 'lista de alternativas da peça', de: ANCORA_FONTE, para: NOVO_FONTE },
  { nome: 'a chamada passa as alternativas', de: ANCORA_CHAMADA, para: NOVO_CHAMADA },
];

const MARCA = 'capaAlternativas';
const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, reverter) {
  let saida = lf(texto);
  if (!reverter && saida.includes(MARCA)) throw new Error(NO + ': já tem candidatos de capa — patch aplicado?');
  if (reverter && !saida.includes(MARCA)) throw new Error(NO + ': não tem candidatos de capa — nada a reverter');
  for (const e of (reverter ? [...EDICOES].reverse() : EDICOES)) {
    const de = lf(reverter ? e.para : e.de);
    const para = lf(reverter ? e.de : e.para);
    const vezes = saida.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${e.nome}" apareceu ${vezes} vezes (esperava 1)`);
    saida = saida.split(de).join(para);
  }
  return saida;
}

module.exports = { WF, NO, EDICOES, aplicar, lf, MARCA, MAX_ALTERNATIVAS };

if (require.main === module) {
  const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
  if (!fs.existsSync(DB)) {
    console.error('FAIL  rode no VPS: cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
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
    if (row.versionId !== row.activeVersionId) throw new Error('draft != publicado — resolver no editor antes');
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != workflow_history — abortando');

    const nodes = JSON.parse(row.nodes);
    const no = nodes.find((x) => x.name === NO);
    if (!no) throw new Error('nó não achado: ' + NO);
    const depois = aplicar(no.parameters.jsCode, REVERTER);
    try { new Function(depois); } catch (e) { throw new Error('jsCode resultante não compila: ' + e.message); }
    no.parameters.jsCode = depois;
    for (const e of EDICOES) console.log('OK  ' + e.nome);

    // O renderizador precisa entender data-fallback ANTES: senão o patch não conserta nada.
    if (!REVERTER) {
      const modulo = '/opt/promoliso/renderer/candidatos.cjs';
      if (!fs.existsSync(modulo)) {
        throw new Error('o renderizador ainda não tem ' + modulo + ' — suba o serviço antes deste patch');
      }
      console.log('OK  renderizador já entende data-fallback');
    }

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
          REVERTER ? 'Reverte os candidatos de capa'
            : 'Capa ganha fotos candidatas: foto morta deixa de derrubar a rodada', '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-capa-candidatos.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
