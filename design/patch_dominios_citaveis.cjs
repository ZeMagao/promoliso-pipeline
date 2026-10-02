// ALLOWLIST DE LINK: DOMÍNIOS OFICIAIS QUE APARECEM COMO NOME (02/10/2026).
//
// O QUE FOI MEDIDO. A allowlist de 24/09 (design/patch_link_allowlist.cjs) reprovou 3 peças em uma
// semana, e as 3 eram texto legítimo — o domínio aparece como NOME de loja ou de fonte, não como
// link:
//
//   exec 782  "O game chega em 23 de outubro na Xbox PC, Battle.net e Steam"   (MW4, as DUAS
//             tentativas barradas: pauta perdida)
//   exec 746  "o recap oficial da Mojang em minecraft.net"                     (a 2ª tentativa,
//             sem o domínio, passou)
//
// Nas 58 peças validadas da semana só 3 domínios foram citados no texto: battle.net (2),
// minecraft.net (1) e timesaver.gg (1, que passou por ser a fonte da própria pauta).
//
// O QUE MUDA. Uma lista própria, `dominiosCitaveis`, usada SÓ na allowlist do texto. Não entra em
// `dominiosPrimarios` de propósito: aquela lista também decide o que conta como FONTE primária na
// validação, e misturar as duas mudaria a regra de fonte sem ninguém pedir. Escolha do dono:
// os 2 medidos + os dois do mesmo dono citados nas mesmas pautas (callofduty.com, mojang.com).
//
// O QUE NÃO MUDA: o resto da regra. Encurtador, domínio solto de terceiro e link explícito de host
// desconhecido continuam reprovando — o harness da allowlist refaz os ataques.
//
// ⚠️ O bloco da allowlist em design/patch_link_allowlist.cjs foi atualizado para o texto NOVO,
// para ele continuar descrevendo a regra que roda. Este patch leva o validador do texto antigo ao
// novo; aplicado os dois em sequência ou só o da allowlist, o resultado é o mesmo.
//
// ROLLBACK: `--reverter`. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Validar antes de publicar';

const ANTES = `const hostsPermitidosNoTexto = [
  ...dominiosPrimarios,
  ...dominiosLojas,
  ...fontes.map((fonte) => fonte.host),
  'promoliso.com.br',
];`;

const DEPOIS = `// Dominios oficiais que aparecem escritos como NOME, nao como link: "chega no Battle.net e na
// Steam", "o recap da Mojang em minecraft.net". Medido em 02/10/2026: as 3 reprovacoes da
// allowlist na semana foram estas, e a pauta do MW4 se perdeu nas duas tentativas. So entra
// dominio primario de publisher/plataforma: nada de encurtador, loja de terceiro ou agregador.
const dominiosCitaveis = ['battle.net', 'callofduty.com', 'minecraft.net', 'mojang.com'];
const hostsPermitidosNoTexto = [
  ...dominiosPrimarios,
  ...dominiosLojas,
  ...dominiosCitaveis,
  ...fontes.map((fonte) => fonte.host),
  'promoliso.com.br',
];`;

const MARCA = 'const dominiosCitaveis = [';
const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, reverter) {
  const t = lf(texto);
  const de = reverter ? DEPOIS : ANTES;
  const para = reverter ? ANTES : DEPOIS;
  const vezes = t.split(de).length - 1;
  if (vezes !== 1) {
    throw new Error(`${NO}: trecho ${reverter ? 'novo' : 'antigo'} da allowlist apareceu ${vezes} vezes (esperava 1)`
      + (reverter ? '' : (t.includes(MARCA) ? ' — patch já aplicado?' : ' — o validador mudou')));
  }
  return t.split(de).join(para);
}

// Leva qualquer estado ao estado com a lista: é o que o harness da allowlist usa para rodar igual
// antes e depois do deploy (teste não pode depender de desfazer história).
const normalizar = (texto) => (lf(texto).includes(MARCA) ? lf(texto) : aplicar(texto, false));

module.exports = { WF, NO, ANTES, DEPOIS, MARCA, lf, aplicar, normalizar };

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
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

    const nodes = JSON.parse(row.nodes);
    const no = nodes.find((n) => n.name === NO);
    if (!no || typeof no.parameters.jsCode !== 'string') throw new Error('nó não achado ou sem jsCode: ' + NO);
    const depois = aplicar(no.parameters.jsCode, REVERTER);
    try { new Function('$input', '$', '$json', depois); } catch (e) { throw new Error(NO + ': jsCode resultante não compila: ' + e.message); }
    console.log(`OK  ${NO}: ${REVERTER ? 'lista removida' : 'dominiosCitaveis entra na allowlist do texto'} (${depois.length - lf(no.parameters.jsCode).length > 0 ? '+' : ''}${depois.length - lf(no.parameters.jsCode).length} chars)`);
    console.log('OK  conexões intocadas');
    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    no.parameters.jsCode = depois;
    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER ? 'Reverte: allowlist sem dominios citaveis' : 'Allowlist do texto aceita battle.net, callofduty.com, minecraft.net, mojang.com';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    fs.writeFileSync(path.join(__dirname, '..', 'newversion-dominios-citaveis.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
