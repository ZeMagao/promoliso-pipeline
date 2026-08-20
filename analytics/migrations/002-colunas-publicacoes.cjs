// RF-01 + RF-05 — estende promoliso_publicacoes com os "Dados mínimos por publicação" do PRD §11
// que ainda não existiam (versões de prompt/template, imagens, durações, tentativas, slot...).
//
// PRESERVAÇÃO DE DADOS: só `ALTER TABLE ADD COLUMN`. Nenhuma coluna existente é renomeada,
// removida ou reescrita; as linhas antigas continuam intactas e passam a ter NULL nas novas.
// O `down` usa `DROP COLUMN` (SQLite >= 3.35; o n8n 2.30.4 empacota 3.44) e verifica ANTES que
// nenhuma coluna original está na lista de remoção.
const { COLUNAS_PUBLICACOES, COLUNAS_PUBLICACOES_ORIGINAIS } = require('../lib/schema.cjs');
const dt = require('../lib/datatable.cjs');

exports.descricao = 'acrescenta colunas de metadado/versão/imagem em promoliso_publicacoes';

function guarda(cfg) {
  const id = cfg.tabelas.publicacoes;
  for (const c of COLUNAS_PUBLICACOES) {
    if (COLUNAS_PUBLICACOES_ORIGINAIS.includes(c.nome)) {
      throw new Error(`coluna nova "${c.nome}" colide com coluna original — abortando`);
    }
  }
  return id;
}

exports.up = async ({ w, cfg, dry }) => {
  const id = guarda(cfg);
  if (!(await dt.existe(w, id))) throw new Error(`promoliso_publicacoes (${id}) não existe neste banco`);
  const cols = await w.all(`PRAGMA table_info("${dt.prefixoFisico(id)}")`);
  const presentes = new Set(cols.map((c) => c.name));
  for (const orig of COLUNAS_PUBLICACOES_ORIGINAIS) {
    if (!presentes.has(orig)) throw new Error(`coluna original "${orig}" sumiu — banco inesperado, abortando`);
  }

  const plano = [];
  for (const c of COLUNAS_PUBLICACOES) {
    const ja = presentes.has(c.nome);
    plano.push({ coluna: c.nome, tipo: c.tipo, acao: ja ? 'ja-existe' : 'adicionar' });
    if (dry || ja) continue;
    await dt.adicionarColuna(w, { dataTableId: id, nome: c.nome, tipo: c.tipo });
  }
  return plano;
};

exports.down = async ({ w, cfg, dry }) => {
  const id = guarda(cfg);
  const cols = await w.all(`PRAGMA table_info("${dt.prefixoFisico(id)}")`);
  const presentes = new Set(cols.map((c) => c.name));
  const plano = [];
  for (const c of COLUNAS_PUBLICACOES.slice().reverse()) {
    const ja = presentes.has(c.nome);
    plano.push({ coluna: c.nome, acao: ja ? 'remover' : 'nao-existe' });
    if (dry || !ja) continue;
    await dt.removerColuna(w, { dataTableId: id, nome: c.nome });
  }
  return plano;
};
