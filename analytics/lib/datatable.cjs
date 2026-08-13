// Cria e remove Data Tables do n8n **pela convenção que o próprio n8n usa**, para que as tabelas
// novas apareçam na UI e possam ser lidas por nós `dataTable` no futuro, sem gambiarra.
//
// O n8n materializa uma Data Table em TRÊS lugares e os três precisam concordar:
//   1. `data_table`         — 1 linha (id, name, projectId)
//   2. `data_table_column`  — 1 linha por coluna (name, type, index, dataTableId)
//   3. `data_table_user_<id>` — a tabela física, com id/createdAt/updatedAt + as colunas
// Criar só a física deixa a tabela invisível na UI; criar só o metadado quebra o nó dataTable.
// Por isso tudo aqui é feito dentro de UMA transação.
//
// Tipos aceitos pelo n8n: string | number | boolean | date. O mapeamento para SQLite abaixo é o
// mesmo observado nas tabelas que o n8n já criou neste banco (ver docs/FASE0-INVENTARIO.md).
const { agoraUtc } = require('./db.cjs');
const crypto = require('crypto');

const TIPO_SQL = { string: 'TEXT', number: 'REAL', boolean: 'INTEGER', date: 'TEXT' };

function prefixoFisico(id) {
  return `data_table_user_${id}`;
}

function validaNome(n) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error(`nome inválido para coluna/tabela: ${n}`);
  return n;
}

async function existe(w, id) {
  const r = await w.get('SELECT id FROM data_table WHERE id=?', [id]);
  return Boolean(r);
}

async function existeNome(w, nome, projectId) {
  const r = await w.get('SELECT id FROM data_table WHERE name=? AND projectId=?', [nome, projectId]);
  return r ? r.id : null;
}

// Cria a Data Table completa. Idempotente: se já existir com o mesmo id, não faz nada.
// `colunas` = [{ nome, tipo, unico? }] — `unico` cria índice único PARCIAL (ignora vazio), a mesma
// forma que o n8n usou em `idx_PLAiCur8cTx26M1Q_curation_key_unique`. É o que garante idempotência
// dos coletores: reexecutar não duplica linha.
async function criar(w, { id, nome, projectId, colunas }) {
  validaNome(nome);
  const fisica = prefixoFisico(id);

  if (await existe(w, id)) return { criada: false, motivo: 'id já existe', id, fisica };
  const outroId = await existeNome(w, nome, projectId);
  if (outroId) throw new Error(`já existe Data Table "${nome}" com outro id (${outroId}) — resolva à mão antes`);

  const t = agoraUtc();
  const defs = colunas.map((c) => {
    validaNome(c.nome);
    const sql = TIPO_SQL[c.tipo];
    if (!sql) throw new Error(`tipo desconhecido "${c.tipo}" na coluna ${c.nome}`);
    return `"${c.nome}" ${sql}`;
  }).join(', ');

  await w.run(
    `CREATE TABLE "${fisica}" (` +
    '"id" integer PRIMARY KEY NOT NULL, ' +
    '"createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME(\'%Y-%m-%d %H:%M:%f\', \'NOW\')), ' +
    '"updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME(\'%Y-%m-%d %H:%M:%f\', \'NOW\')), ' +
    `${defs})`,
  );

  await w.run('INSERT INTO data_table (id,name,projectId,createdAt,updatedAt) VALUES (?,?,?,?,?)',
    [id, nome, projectId, t, t]);

  for (let i = 0; i < colunas.length; i++) {
    const c = colunas[i];
    await w.run(
      'INSERT INTO data_table_column (id,name,type,"index",dataTableId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
      [crypto.randomUUID(), c.nome, c.tipo, i, id, t, t],
    );
    if (c.unico) {
      await w.run(
        `CREATE UNIQUE INDEX "idx_${id}_${c.nome}_unique" ON "${fisica}" ("${c.nome}") ` +
        `WHERE "${c.nome}" IS NOT NULL AND "${c.nome}" <> ''`,
      );
    }
  }
  return { criada: true, id, fisica, colunas: colunas.length };
}

// Remove a Data Table inteira. Só é chamada pelo `down` das migrations.
async function remover(w, id) {
  if (!(await existe(w, id))) return { removida: false, motivo: 'não existe' };
  // ON DELETE CASCADE cuida de data_table_column (PRAGMA foreign_keys=ON é ligado em abrirEnvolvido)
  await w.run('DELETE FROM data_table WHERE id=?', [id]);
  await w.run(`DROP TABLE IF EXISTS "${prefixoFisico(id)}"`);
  return { removida: true, id };
}

// Acrescenta coluna a uma Data Table QUE JÁ EXISTE (usado para estender promoliso_publicacoes).
// Idempotente: coluna já presente é ignorada. Preserva os dados — ALTER TABLE ADD COLUMN não
// reescreve a tabela.
async function adicionarColuna(w, { dataTableId, nome, tipo }) {
  validaNome(nome);
  const sql = TIPO_SQL[tipo];
  if (!sql) throw new Error(`tipo desconhecido "${tipo}"`);
  const fisica = prefixoFisico(dataTableId);

  const jaMeta = await w.get('SELECT id FROM data_table_column WHERE dataTableId=? AND name=?', [dataTableId, nome]);
  const cols = await w.all(`PRAGMA table_info("${fisica}")`);
  const jaFisica = cols.some((c) => c.name === nome);
  if (jaMeta && jaFisica) return { adicionada: false, motivo: 'já existe' };
  if (Boolean(jaMeta) !== jaFisica) {
    throw new Error(`coluna ${nome} inconsistente (metadado=${Boolean(jaMeta)}, física=${jaFisica}) — corrigir à mão`);
  }

  const t = agoraUtc();
  const maxIdx = await w.get('SELECT COALESCE(MAX("index"),-1) m FROM data_table_column WHERE dataTableId=?', [dataTableId]);
  await w.run(`ALTER TABLE "${fisica}" ADD COLUMN "${nome}" ${sql}`);
  await w.run('INSERT INTO data_table_column (id,name,type,"index",dataTableId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
    [crypto.randomUUID(), nome, tipo, (maxIdx.m || 0) + 1, dataTableId, t, t]);
  return { adicionada: true, nome };
}

// Remove coluna (rollback do adicionarColuna). SQLite >= 3.35 suporta DROP COLUMN; o n8n 2.30.4
// empacota 3.44. Se a versão for antiga, falha explicitamente em vez de deixar meia-mudança.
async function removerColuna(w, { dataTableId, nome }) {
  validaNome(nome);
  const fisica = prefixoFisico(dataTableId);
  const cols = await w.all(`PRAGMA table_info("${fisica}")`);
  if (!cols.some((c) => c.name === nome)) {
    await w.run('DELETE FROM data_table_column WHERE dataTableId=? AND name=?', [dataTableId, nome]);
    return { removida: false, motivo: 'não existe na tabela física' };
  }
  await w.run(`ALTER TABLE "${fisica}" DROP COLUMN "${nome}"`);
  await w.run('DELETE FROM data_table_column WHERE dataTableId=? AND name=?', [dataTableId, nome]);
  return { removida: true, nome };
}

// Descobre o projeto pessoal quando PROMO_PROJECT_ID não foi informado.
async function projetoPadrao(w) {
  const r = await w.get("SELECT id FROM project WHERE type='personal' ORDER BY createdAt LIMIT 1");
  if (!r) throw new Error('nenhum project pessoal no banco — informe PROMO_PROJECT_ID');
  return r.id;
}

module.exports = { criar, remover, adicionarColuna, removerColuna, existe, prefixoFisico, projetoPadrao, TIPO_SQL };
