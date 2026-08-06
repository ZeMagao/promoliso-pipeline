// Destrava o gargalo de ESTOQUE medido em 2026-08-05: das 3 execuções que rodaram com o
// fix dos caps, 2 morreram só por variedade de imagem (execs 185 e 187), e a que passou
// (189) passou porque o curador escolheu um portal com galeria.
//
// Medição em 28 execuções (ver memória plano-imagens-medido): a variedade NÃO é aleatória,
// depende de QUAL portal é selecionado.
//   gamevicio.com / flowgames.gg -> 0-2 imagens por artigo
//   adrenaline / playstation / xbox -> 5-11 imagens
//
// MUDANÇA A (nó "Validar antes de publicar"): parar de jogar fora pauta BEM CONFIRMADA só
//   porque o artigo trouxe uma imagem. Hoje 1 imagem única só passa se o host DA IMAGEM for
//   domínio primário (`imagemUnicaOficial`) — a exec 187 tinha fonte primária ir.amd.com e
//   foi reprovada porque a foto veio do portal. Passa a aceitar a repetição quando a pauta
//   tem fonte primária relevante OU duas confirmações independentes: a MESMA barra que o
//   resto do validador já usa pra considerar o fato provado.
//   Carrossel com arte repetida é pior visualmente, e é por isso que existe a mudança B.
//
// MUDANÇA B (nó "Selecionar melhor pauta"): +8 pontos de desempate para candidato com >=2
//   imagens distintas. Nunca reprova ninguém, só reordena. Menor que os +10 de fonte
//   primária de propósito — não queremos que arte vença procedência.
//
// MUDANÇA C (nó "Validar antes de publicar"): o `motivo_reprovacao` do agente entra cru na
//   lista de erros (era um ensaio de ~900 chars na exec 185) e isso vai pro corpo do e-mail
//   de alerta. Passa a ser prefixado e truncado em 200 chars.
//
// NÃO INCLUÍDO de propósito:
//   - apertar o gate de resolução (cego em 76% das imagens) e o de relevância (tautológico:
//     mesmo host da fonte = aprovado). Os dois, se ficarem mais rigorosos, REPROVAM MAIS —
//     o oposto do que precisamos agora. Viram trabalho separado, como preferência/telemetria.
//   - unificar as constantes 42/38/300 (hoje em 3 lugares: limitar(), o check e o prompt).
//     É higiene sem ganho imediato; bundle pequeno = poucos suspeitos se 22:00 quebrar.
//   - passar N candidatos ao agente (hoje é 1, e "Preparar 2 tentativas" pede pra "escolher
//     outra pauta" sem ter outra). Muda o funil — deploy separado.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE_VAL = 'Validar antes de publicar';
const NODE_SEL = 'Selecionar melhor pauta';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// ---------- MUDANÇA A: aceitar 1 imagem repetida em pauta bem confirmada ----------
const A_RE = /if \(urlsImagens\.length === 1 && !imagemUnicaOficial\) \{\s*erros\.push\('Carrossel sem variedade visual confiável: imagem editorial repetida'\);\s*\}/;
const A_NOVO = `// Portais como gamevicio.com e flowgames.gg publicam UMA imagem por artigo (medido em
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
}`;

// ---------- MUDANÇA C: motivo do agente prefixado e truncado ----------
const C_RE = /if \(output\.aprovado_para_publicar !== true\) \{\s*erros\.push\(output\.motivo_reprovacao \|\| 'A própria análise editorial reprovou a pauta'\);\s*\}/;
const C_NOVO = `if (output.aprovado_para_publicar !== true) {
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
}`;

// ---------- MUDANÇA B: desempate por quantidade de imagens ----------
const B_RE = /    const efetivo = \(x\) =>\s*Number\(x\.registro\?\.pontuacao_total \|\| 0\) \+\s*\(String\(x\.noticia\?\.tipo_fonte \|\| ''\) === 'primaria' \? 10 : 0\);/;
const B_NOVO = `    // Pauta que não renderiza vale 0: dá desempate pra quem tem arte suficiente pro
    // carrossel. 8 < 10 de propósito — arte não vence procedência.
    const imagensDistintas = (x) => {
      const noticia = x.noticia || {};
      const lista = Array.isArray(noticia.imagens_oficiais)
        ? noticia.imagens_oficiais
        : [];
      return new Set(
        [...lista, noticia.imagem_principal]
          .filter((u) => typeof u === 'string' && /^https:\\/\\//i.test(u))
          .map((u) => String(u).split(/[?#]/)[0].toLowerCase()),
      ).size;
    };
    const efetivo = (x) =>
      Number(x.registro?.pontuacao_total || 0) +
      (String(x.noticia?.tipo_fonte || '') === 'primaria' ? 10 : 0) +
      (imagensDistintas(x) >= 2 ? 8 : 0);`;

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const nVal = nodes.find((x) => x.name === NODE_VAL);
  const nSel = nodes.find((x) => x.name === NODE_SEL);
  if (!nVal) throw new Error('nó não achado: ' + NODE_VAL);
  if (!nSel) throw new Error('nó não achado: ' + NODE_SEL);

  let val = nVal.parameters.jsCode;
  let sel = nSel.parameters.jsCode;
  const valAntes = val;
  const selAntes = sel;

  // pré-condições: os patches anteriores já têm que estar no ar.
  // ATENÇÃO: patch_mensagens_validador.cjs reescreveu o bloco de estrutura, então a forma
  // dos caps aqui é `> 42` / `> 38` (o `<= 42` do patch_caps só existia ANTES dele).
  if (!val.includes('problemasSlides')) {
    throw new Error('pré-requisito faltando: patch_mensagens_validador.cjs não está aplicado');
  }
  for (const p of ['slide.titulo.length > 42', 'slide.destaque.length > 38']) {
    if (!val.includes(p)) throw new Error('pré-requisito faltando: ' + p + ' — caps não estão em 42/38');
  }
  // as variáveis que a mudança A passa a usar precisam existir ANTES do ponto de uso
  const posUso = val.search(A_RE);
  for (const v of ['fontesPrimariasRelevantes', 'hostsRelevantes']) {
    const decl = val.indexOf('const ' + v);
    if (decl === -1) throw new Error('variável esperada não existe no validador: ' + v);
    if (decl > posUso) throw new Error(`${v} é declarada DEPOIS do ponto de uso — abortando`);
  }

  const alvos = [
    ['A (aceita 1 imagem em pauta confirmada)', A_RE, A_NOVO, 'val'],
    ['C (motivo do agente truncado)', C_RE, C_NOVO, 'val'],
    ['B (desempate por nº de imagens)', B_RE, B_NOVO, 'sel'],
  ];
  for (const [nome, re, novo, onde] of alvos) {
    const alvo = onde === 'val' ? val : sel;
    const achou = (alvo.match(new RegExp(re.source, (re.flags || '') + 'g')) || []).length;
    if (achou !== 1) throw new Error(`mudança ${nome}: esperava 1 trecho e achei ${achou} — abortando (já aplicado?)`);
    if (onde === 'val') val = val.replace(re, novo); else sel = sel.replace(re, novo);
    console.log('OK  mudança ' + nome);
  }

  // nada que deveria continuar existindo pode ter sumido
  for (const p of ['slidesValidos', 'imagensValidas.length !== 6', "erros.push('Nenhuma imagem válida')", 'imagemUnicaOficial', 'imagensBaixaResolucao']) {
    if (!val.includes(p)) throw new Error('sumiu algo que deveria continuar no validador: ' + p);
  }
  for (const p of ['existe_pauta_aprovavel', 'persistencia_ok', 'elegivel_aprovacao', 'eligible[0]']) {
    if (!sel.includes(p)) throw new Error('sumiu algo que deveria continuar na seleção: ' + p);
  }
  new Function(val); // não grava código que nem compila
  new Function(sel);

  nVal.parameters.jsCode = val;
  nSel.parameters.jsCode = sel;
  const changed = val !== valAntes || sel !== selAntes;
  console.log('diff validador:', val.length - valAntes.length, '| diff seleção:', sel.length - selAntes.length, '| mudou:', changed);
  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
  if (!changed) { console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'variedade de imagem: aceita arte repetida em pauta bem confirmada + desempate por nº de imagens na selecao + motivo do agente truncado', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-variedade.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
