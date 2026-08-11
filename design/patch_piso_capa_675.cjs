// Piso de altura da capa cai de 800 para 675.
//
// POR QUE MUDAR. O piso original (iw>=1000, ih>=800) foi escolhido no chute, justificado com
// "1,69x de ampliacao", sem medir o estoque de imagens. A primeira capa renderizada em producao
// (row 36, 11/08 16:03) cobrou a conta: a foto de origem tem 1200x675 — o formato mais comum de
// imagem de materia — e reprovou por 125 pixels de altura. Resultado: foto contida sobre preto,
// que le como defeito e nao como escolha.
//
// A MEDICAO (60 URLs candidatas dos ultimos 40 registros de curadoria, dimensoes consultadas no
// proprio Cloudinary, que e a mesma fonte que o gate usa):
//
//     ih>=900 -> 10%      ih>=720 -> 18%      ih>=600 -> 33%
//     ih>=800 -> 17%      ih>=675 -> 30%
//
// O salto esta exatamente em 675, porque e onde 1200x675 entra. Ressalva: a amostra inclui
// thumbnail de post relacionado, que nunca viraria capa, entao a taxa real e maior — mas o
// degrau em 675 nao depende disso.
//
// O CUSTO. O recorte 4:5 de uma 1200x675 usa 540x675 e sobe 2,00x ate 1080x1350, contra 1,69x do
// piso antigo. Mais mole, e o e_sharpen segura. Foi comparado lado a lado com a mesma foto real
// antes de decidir (design/capa_mock_fallback.cjs).
//
// A GRAVIDADE FICA COMO ESTA, e isso foi medido, nao assumido: g_auto e g_auto:faces devolvem
// bytes IDENTICOS nas tres fotos de teste, e g_auto:subject so difere no retrato. Nesta conta os
// modos extras nao fazem nada — trocar seria superstição. O controle g_center corta o arqueiro
// pela metade, o que confirma que o g_auto de fato esta buscando o assunto.
//
// LIMITE CONHECIDO, sem conserto barato: imagem que e GRAFICO/infografico nao sobrevive a recorte
// 4:5 com gravidade nenhuma — o corte come eixo e legenda. Detectar "isto e um grafico" exigiria
// add-on de analise de conteudo. Se aparecer com frequencia, o caminho e o tratamento de fundo
// borrado (foto contida sobre copia desfocada), ja prototipado e nao adotado.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
// os dois nos carregam o mesmo bloco da capa (um roda, o outro e copia morta)
const ALVOS = ['Code in JavaScript1', 'Code in JavaScript'];

const DE = 'const CAPA_MIN_W = 1000, CAPA_MIN_H = 800;';
const PARA = 'const CAPA_MIN_W = 1000, CAPA_MIN_H = 675;';

function trocar(code, nomeNo) {
  if (code.includes(PARA)) throw new Error(`${nomeNo}: piso já está em 675 — patch já aplicado?`);
  const vezes = code.split(DE).length - 1;
  if (vezes !== 1) throw new Error(`${nomeNo}: esperava 1 declaração do piso e achei ${vezes} — abortando`);
  const novo = code.split(DE).join(PARA);
  // o piso só vale se continuar sendo usado na URL — se alguém tiver desligado o condicional,
  // trocar o número não faria nada e o patch estaria mentindo sobre o efeito
  if (!/if_iw_gte_' \+ CAPA_MIN_W \+ '_and_ih_gte_' \+ CAPA_MIN_H/.test(novo)) {
    throw new Error(`${nomeNo}: o piso não está mais montando a URL do gate — abortando`);
  }
  if (!/c_fill,g_auto,w_1728,h_2160/.test(novo)) {
    throw new Error(`${nomeNo}: o recorte deixou de ser c_fill,g_auto — revisar antes`);
  }
  new Function(novo);
  return novo;
}

module.exports = { WF, ALVOS, DE, PARA, trocar };

if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Esta máquina não é mais fonte de verdade (n8n do Windows aposentado em 05/08).'
    + '\n      Ver data/.n8n/LEIA-ANTES-DE-RODAR-PATCH.md.'
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node ' + path.posix.join('design', path.basename(__filename)) + ' --dry');
  process.exit(1);
}
const DRY = process.argv.includes('--dry');
const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  for (const nomeNo of ALVOS) {
    const n = nodes.find((x) => x.name === nomeNo);
    if (!n) throw new Error('nó não achado: ' + nomeNo);
    const antes = n.parameters.jsCode;
    n.parameters.jsCode = trocar(antes, nomeNo);
    console.log(`OK  ${nomeNo}  (piso 800 -> 675)`);
  }

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'piso de altura da capa cai de 800 para 675 (1200x675 e o formato mais comum)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-piso-capa-675.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
