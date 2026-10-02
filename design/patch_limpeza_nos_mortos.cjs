// LIMPEZA: OS 30 NÓS QUE NENHUM GATILHO ALCANÇA SAEM DO PRODUTOR (02/10/2026).
//
// O QUE FOI MEDIDO. Nas conexões reais do banco (main e as de sub-nó de IA), 30 dos 125 nós do
// produtor não têm caminho a partir de nenhum gatilho: o antigo ramo de publicação direta
// (Create a carousel post, Publish a post, Create a story, os Salvar/Resultado/Preparar falha — de
// antes da fila), mais Buscar capa, Embeddings OpenAI e três nós desabilitados. Em 57 execuções
// nenhum deles rodou. Nenhum é citado por código de nó vivo nem pelos scripts de fora do n8n
// (analytics e writeback leem nós com esses nomes, mas no PUBLICADOR, que não muda).
//
// FICA DE FORA, de propósito: renomear o "GPT 5.4 mini" (que é lmChatAnthropic, claude-sonnet-5).
// O analytics (`coletor-publicacoes.cjs`, modeloDoAgente) grava o modelo de cada post lendo o NOME
// desse nó; renomear mudaria a série `modelo_ia` sem ninguém pedir. Decisão separada.
//
// AS TRAVAS (cada uma aborta em vez de presumir):
//  - o conjunto de mortos é RECALCULADO no banco e tem que ser exatamente a lista abaixo; nó novo
//    que ficou solto, ou nó desta lista que voltou a ser ligado, aborta.
//  - nó desabilitado no meio de uma corrente passa dado adiante no n8n: a conta atravessa
//    desabilitados, e um nó vivo que aponte para um morto aborta.
//  - nenhum parâmetro de nó vivo pode citar um morto pelo nome.
//  - o subgrafo vivo sai idêntico: mesmos nós (byte a byte, fora o nome trocado) e mesmas ligações.
//
// ROLLBACK: `--reverter` restaura nós e conexões do arquivo que este patch grava antes de mudar
// (design/antes-limpeza-<versionId>.json no VPS). Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const MORTOS_ESPERADOS = [
  'Aguardar processamento do carrossel', 'Buscar capa', 'Carrossel ainda processando?',
  'Carrossel pronto para publicar?', 'Carrossel publicado?', 'Consultar status do carrossel',
  'Contêiner do carrossel criado?', 'Create a carousel post', 'Create a story', 'Criar imagem do story',
  'Delete table or rows', 'Embeddings OpenAI', 'Interpretar status do carrossel', 'Memória Postgres',
  'Obter noticias', 'Preparar carrossel publicado', 'Preparar falha ao criar carrossel',
  'Preparar falha ao publicar carrossel', 'Preparar falha do story', 'Preparar falha no processamento',
  'Preparar publicação concluída', 'Preparar verificação do carrossel', 'Publish a post',
  'Resultado FALHA_PUBLICACAO', 'Resultado PUBLICADO', 'Salvar carrossel publicado',
  'Salvar falha de publicação', 'Salvar publicação concluída', 'Story publicado?',
  'Upload an asset from file data1',
].sort();

// Quem é alcançável a partir de um gatilho. Atravessa desabilitados (no n8n eles passam o dado
// adiante), e sub-nó (ai_*) vive se o nó raiz dele vive.
function alcancaveis(nodes, connections) {
  const main = {};
  const sub = [];
  for (const [orig, tipos] of Object.entries(connections)) {
    for (const [tipo, saidas] of Object.entries(tipos || {})) {
      for (const s of saidas || []) {
        for (const l of s || []) {
          if (tipo === 'main') (main[orig] = main[orig] || []).push(l.node);
          else sub.push([orig, l.node]);
        }
      }
    }
  }
  const gatilhos = nodes.filter((n) => /trigger/i.test(n.type) && !n.disabled).map((n) => n.name);
  const vivo = new Set(gatilhos);
  const fila = [...gatilhos];
  while (fila.length) {
    const n = fila.shift();
    for (const d of main[n] || []) if (!vivo.has(d)) { vivo.add(d); fila.push(d); }
  }
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [o, d] of sub) if (vivo.has(d) && !vivo.has(o)) { vivo.add(o); mudou = true; }
  }
  return vivo;
}

const ehNota = (n) => n.type === 'n8n-nodes-base.stickyNote';

function aplicar(nodes, connections) {
  const vivo = alcancaveis(nodes, connections);
  const mortos = nodes.filter((n) => !vivo.has(n.name) && !ehNota(n)).map((n) => n.name).sort();
  if (JSON.stringify(mortos) !== JSON.stringify(MORTOS_ESPERADOS)) {
    const a = mortos.filter((m) => !MORTOS_ESPERADOS.includes(m));
    const b = MORTOS_ESPERADOS.filter((m) => !mortos.includes(m));
    throw new Error(`conjunto de mortos mudou — a mais: ${JSON.stringify(a)}; a menos (voltaram a ser ligados): ${JSON.stringify(b)}`);
  }
  const morto = new Set(mortos);
  // nó vivo apontando para morto: a conta estaria errada
  for (const [orig, tipos] of Object.entries(connections)) {
    if (morto.has(orig)) continue;
    for (const saidas of Object.values(tipos || {})) for (const s of saidas || []) for (const l of s || []) {
      if (morto.has(l.node)) throw new Error(`nó vivo "${orig}" aponta para "${l.node}" — abortando`);
    }
  }
  // parâmetro de nó vivo citando morto pelo nome
  for (const n of nodes) {
    if (morto.has(n.name)) continue;
    const p = JSON.stringify(n.parameters || {});
    for (const m of mortos) {
      if (p.includes(`$('${m}')`) || p.includes(`$(\\"${m}\\")`) || p.includes(`'${m}'`)) {
        throw new Error(`"${n.name}" cita "${m}" — abortando`);
      }
    }
  }

  const removidos = nodes.filter((n) => morto.has(n.name));
  const conexoesRemovidas = Object.fromEntries(Object.entries(connections).filter(([k]) => morto.has(k)));
  if (!removidos.length) throw new Error('nada a remover — patch já aplicado?');
  const novosNos = nodes.filter((n) => !morto.has(n.name));
  const novasConexoes = {};
  for (const [orig, tipos] of Object.entries(connections)) {
    if (!morto.has(orig)) novasConexoes[orig] = JSON.parse(JSON.stringify(tipos));
  }
  return { nodes: novosNos, connections: novasConexoes, removidos, conexoesRemovidas, vivosAntes: vivo.size };
}

module.exports = { WF, MORTOS_ESPERADOS, alcancaveis, aplicar };

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
    const pub = await get('SELECT nodes, connections FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

    let nodesStr;
    let connStr;
    if (REVERTER) {
      const arquivos = fs.readdirSync(__dirname).filter((f) => /^antes-limpeza-.*\.json$/.test(f)).sort();
      if (!arquivos.length) throw new Error('não achei design/antes-limpeza-*.json — nada a reverter por aqui');
      const antes = JSON.parse(fs.readFileSync(path.join(__dirname, arquivos[arquivos.length - 1]), 'utf8'));
      nodesStr = antes.nodes;
      connStr = antes.connections;
      console.log(`OK  restaurando de ${arquivos[arquivos.length - 1]} (versão ${antes.versionId})`);
    } else {
      const nodes = JSON.parse(row.nodes);
      const connections = JSON.parse(row.connections);
      const r = aplicar(nodes, connections);
      // o subgrafo vivo sai idêntico
      const vivoAntes = alcancaveis(nodes, connections);
      const vivoDepois = alcancaveis(r.nodes, r.connections);
      const esperado = [...vivoAntes].sort();
      if (JSON.stringify([...vivoDepois].sort()) !== JSON.stringify(esperado)) throw new Error('o conjunto de nós vivos mudou — abortando');
      for (const n of r.nodes) {
        const original = nodes.find((x) => x.name === n.name);
        if (JSON.stringify(original) !== JSON.stringify(n)) throw new Error(`nó vivo "${n.name}" mudou — abortando`);
      }
      console.log(`OK  ${r.removidos.length} nós inalcançáveis saem (vivos: ${r.vivosAntes}, iguais antes e depois)`);
      console.log('OK  nenhum nó vivo aponta para morto nem cita morto pelo nome');
      nodesStr = JSON.stringify(r.nodes);
      connStr = JSON.stringify(r.connections);
    }
    try { JSON.parse(nodesStr); JSON.parse(connStr); } catch (e) { throw new Error('JSON inválido: ' + e.message); }
    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    if (!REVERTER) {
      const arq = path.join(__dirname, `antes-limpeza-${row.versionId}.json`);
      fs.writeFileSync(arq, JSON.stringify({ versionId: row.versionId, nodes: row.nodes, connections: row.connections }));
      console.log('OK  estado anterior salvo em ' + arq);
    }
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER ? 'Reverte: volta os 30 nos inalcancaveis' : 'Limpeza: 30 nos inalcancaveis saem do produtor';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, connStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, connStr, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    fs.writeFileSync(path.join(__dirname, '..', 'newversion-limpeza.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
