// FONTE ÚNICA da forma das entidades novas. Migrations, coletores, relatório e testes leem daqui.
//
// POR QUE UM ARQUIVO SÓ
// Os dois bugs de 2026-08-05/06 foram da mesma classe: uma regra escrita em dois lugares que
// precisavam concordar, divergindo sem ninguém ver (ver workflows/README.md). Uma lista de colunas
// repetida na migration e no coletor seria exatamente isso de novo. Aqui ela existe uma vez.
//
// Mapeamento para as "Entidades conceituais" do PRD §12:
//   Publicação            -> promoliso_publicacoes (JÁ EXISTIA; estendida pela migration 002)
//   Pauta                 -> promoliso_curadoria_ai (JÁ EXISTIA; não alterada)
//   Fonte                 -> promoliso_fontes            (nova)
//   Métrica da publicação -> promoliso_metricas          (nova)
//   Template / Versão de prompt -> promoliso_versoes     (nova, um registro por artefato+hash)
//   Execução do workflow  -> promoliso_execucoes         (nova)
//   Relatório semanal     -> promoliso_relatorios        (nova)
//   Imagem                -> NÃO tem tabela própria nesta fase (é P1/RF-07-08). As imagens usadas
//                            ficam em promoliso_publicacoes.imagens_urls/imagens_origem/imagens_unicas,
//                            que é o "Dados visuais" mínimo do PRD §11. Desvio registrado no README.
//   Link de afiliado      -> NÃO implementado (RF-10 é P1 e depende dos P0).
const { idDeterministico } = require('./ids.cjs');

const s = (nome, extra) => ({ nome, tipo: 'string', ...extra });
const n = (nome) => ({ nome, tipo: 'number' });
const b = (nome) => ({ nome, tipo: 'boolean' });

// ---------------------------------------------------------------------------------------------
// TABELAS NOVAS
// ---------------------------------------------------------------------------------------------
const NOVAS = {
  metricas: {
    nome: 'promoliso_metricas',
    // `coleta_key` = `${instagram_post_id}:${janela}` — UNIQUE. É o que torna RF-02 idempotente:
    // reexecutar o coletor no mesmo dia não cria segunda linha da mesma janela.
    colunas: [
      s('coleta_key', { unico: true }),
      s('content_key'),
      s('instagram_post_id'),
      s('janela'),                 // D1 | D3 | D7
      s('status'),                 // OK | ERRO | INDISPONIVEL
      s('alvo_em'),                // quando a janela venceu (UTC)
      s('coletado_em'),            // quando a coleta que gravou esta linha rodou (UTC)
      n('tentativas'),
      s('erro'),
      n('alcance'),
      n('visualizacoes'),
      n('curtidas'),
      n('comentarios'),
      n('compartilhamentos'),
      n('salvamentos'),
      n('visitas_perfil'),
      n('seguidores_atribuiveis'),
      s('metricas_brutas'),        // JSON cru da API, para auditoria
    ],
  },

  versoes: {
    nome: 'promoliso_versoes',
    // Um registro por (artefato, hash do conteúdo). Rótulo vem de analytics/versoes/registry.json.
    colunas: [
      s('versao_key', { unico: true }),  // `${artefato}:${hash12}`
      s('artefato'),                     // prompt_redator | template_slide | ...
      s('rotulo'),                       // v3, v3.1... ou NAO-REGISTRADA
      s('hash'),                         // sha256 completo do conteúdo que roda no banco
      s('workflow_id'),
      s('no'),                           // nome do nó de onde o conteúdo saiu
      s('primeira_vez_em'),
      s('ultima_vez_em'),
      b('ativa'),                        // é o conteúdo que está no ar AGORA
      s('observacao'),
    ],
  },

  execucoes: {
    nome: 'promoliso_execucoes',
    // Observabilidade. Guarda tanto execução de workflow do n8n (copiada de execution_entity ANTES
    // do prune de 7 dias) quanto execução dos próprios scripts deste módulo.
    colunas: [
      s('execucao_key', { unico: true }), // `${origem}:${id}`
      s('origem'),                        // n8n | analytics
      s('workflow_id'),
      s('workflow_nome'),
      s('etapa'),
      s('status'),                        // success | error | crashed | canceled | running
      s('iniciado_em'),
      s('terminado_em'),
      n('duracao_ms'),
      n('tentativas'),
      s('erro'),
      s('detalhe'),                       // JSON
    ],
  },

  relatorios: {
    nome: 'promoliso_relatorios',
    colunas: [
      s('relatorio_key', { unico: true }), // `SEMANAL:2026-W32`
      s('tipo'),
      s('periodo_inicio'),
      s('periodo_fim'),
      s('gerado_em'),
      n('volume'),
      s('resumo'),   // markdown legível — é o corpo do e-mail
      s('dados'),    // JSON com os agregados
      s('acoes'),    // JSON com as ações sugeridas
      b('enviado'),
      s('enviado_em'),
      s('erro_envio'),
    ],
  },

  fontes: {
    nome: 'promoliso_fontes',
    colunas: [
      s('dominio', { unico: true }),
      s('nome'),
      s('tipo'),        // RSS | BUSCA | OUTRO
      n('publicacoes'),
      s('primeira_em'),
      s('ultima_em'),
    ],
  },
};

// id determinístico derivado do nome — ver lib/ids.cjs para o porquê
for (const chave of Object.keys(NOVAS)) {
  NOVAS[chave].id = idDeterministico(NOVAS[chave].nome);
}

// ---------------------------------------------------------------------------------------------
// COLUNAS ACRESCENTADAS EM promoliso_publicacoes (RF-01 + RF-05)
// A tabela original tem: content_key, topic, primary_url, category, operational_status,
// carousel_container_id, instagram_post_id, instagram_story_id, execution_id, published_at,
// error_message. Nenhuma delas é tocada — só somamos.
// ---------------------------------------------------------------------------------------------
const COLUNAS_PUBLICACOES = [
  // Dados editoriais (PRD §11)
  s('fonte_dominio'),
  n('score'),
  s('score_justificativa'),
  s('decisao_editorial'),
  s('formato'),                 // CARROSSEL
  s('entidades'),               // JSON de entidades detectadas na pauta
  // Dados de criação / versionamento (RF-05)
  s('modelo_ia'),
  s('prompt_versao'),
  s('template_versao'),
  s('regras_versao'),
  // Dados visuais
  s('imagens_urls'),            // JSON
  s('imagens_origem'),          // JSON
  n('imagens_unicas'),
  // Dados operacionais
  s('coletado_em'),             // quando a pauta entrou na fila
  s('hora_publicacao_local'),   // HH:MM BRT — é o "horário" que o relatório compara
  s('slot'),                    // 12:30 | 16:30 | 20:30 | FORA-DE-SLOT
  n('duracao_producao_ms'),
  n('duracao_publicacao_ms'),
  n('tentativas'),
  s('avisos'),
  // Controle do próprio módulo
  s('registro_versao'),
  s('analytics_atualizado_em'),
];

// Colunas ORIGINAIS de promoliso_publicacoes. Existe para os testes provarem que a migration não
// mexeu em nenhuma delas (critério "Preserve os dados existentes").
const COLUNAS_PUBLICACOES_ORIGINAIS = [
  'id', 'createdAt', 'updatedAt', 'content_key', 'topic', 'primary_url', 'category',
  'operational_status', 'carousel_container_id', 'instagram_post_id', 'instagram_story_id',
  'execution_id', 'published_at', 'error_message',
];

module.exports = { NOVAS, COLUNAS_PUBLICACOES, COLUNAS_PUBLICACOES_ORIGINAIS };
