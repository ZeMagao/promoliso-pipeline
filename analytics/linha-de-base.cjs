#!/usr/bin/env node
// FASE 0 — registra a LINHA DE BASE: o retrato do sistema no momento anterior a qualquer
// otimização. É contra ele que as metas do PRD §13 vão ser comparadas.
//
//   node analytics/linha-de-base.cjs            # imprime e grava em promoliso_relatorios
//   node analytics/linha-de-base.cjs --dry      # só imprime
//
// HONESTIDADE DO QUE É MEDIDO
// Antes deste módulo não havia métrica de alcance gravada em lugar nenhum: os números de
// engajamento citados no PRD ("84 seguidores, ~15 visualizações") vieram da UI do Instagram, não
// do sistema. Então a linha de base registrada aqui tem duas partes:
//   MEDIDO   — o que existe no banco: volume, cadência, fontes, taxa de falha, latência
//   DECLARADO— o que o responsável informou e o sistema ainda não sabe medir
// Elas ficam separadas de propósito. Misturar as duas é como uma meta vira ficção.
//
// Idempotente pela chave `LINHA_DE_BASE:<data>`: rodar duas vezes no mesmo dia atualiza a linha.
const cfg = require('./config.cjs');
const { abrirEnvolvido, agoraUtc, paraMs } = require('./lib/db.cjs');
const { NOVAS } = require('./lib/schema.cjs');
const tab = require('./lib/tabela.cjs');
const chaves = require('./lib/chaves.cjs');
const ex = require('./lib/execucoes.cjs');
const log = require('./lib/log.cjs');

const DRY = process.argv.includes('--dry');

// O que o responsável informou no PRD §2 e que o sistema NÃO consegue medir sozinho hoje.
// Fica versionado para que daqui a 90 dias se saiba de onde veio o número de partida.
const DECLARADO = {
  seguidores: 84,
  alcance_medio_informado: 15,
  fonte: 'PRD.md §2 (informado pelo responsável em 2026-08-07, lido da UI do Instagram)',
  observacao: 'Não é medição do sistema. A linha de base MEDIDA de alcance só começa a existir depois de 30 dias de coleta D+1/D+3/D+7.',
};

async function main({ logger }) {
  const w = await abrirEnvolvido(cfg.db, DRY);
  try {
    const pubs = await tab.ler(w, cfg.tabelas.publicacoes);
    const fila = await tab.ler(w, cfg.tabelas.fila);
    const curadoria = await tab.ler(w, cfg.tabelas.curadoria);

    const publicadas = pubs.filter((p) => String(p.operational_status || '').toUpperCase() === 'PUBLISHED');
    const comPostId = publicadas.filter((p) => String(p.instagram_post_id || '').trim());
    const porStatus = {};
    for (const p of pubs) {
      const k = String(p.operational_status || 'SEM-STATUS').toUpperCase();
      porStatus[k] = (porStatus[k] || 0) + 1;
    }
    const filaPorStatus = {};
    for (const r of fila) {
      const k = String(r.status || 'SEM-STATUS').toUpperCase();
      filaPorStatus[k] = (filaPorStatus[k] || 0) + 1;
    }

    // cadência medida: publicações por dia, nos dias em que houve publicação
    const porDia = {};
    for (const p of publicadas) {
      const d = chaves.dataLocal(paraMs(p.published_at), cfg.tz);
      if (d) porDia[d] = (porDia[d] || 0) + 1;
    }
    const dias = Object.keys(porDia).sort();
    const cadencia = dias.length ? Number((publicadas.length / dias.length).toFixed(2)) : 0;

    // fontes
    const porFonte = {};
    for (const p of publicadas) {
      const d = chaves.dominioDe(p.primary_url) || '(sem fonte)';
      porFonte[d] = (porFonte[d] || 0) + 1;
    }

    // latência fonte -> post: usa data_coleta da curadoria contra published_at
    const porChaveCur = new Map();
    for (const r of curadoria) {
      const k = chaves.chaveDeConteudo(r.url_normalizada || r.url || r.curation_key);
      if (k) porChaveCur.set(k, r);
    }
    const latencias = [];
    for (const p of publicadas) {
      const c = porChaveCur.get(chaves.chaveDeConteudo(p.content_key));
      const coleta = c && paraMs(c.data_coleta);
      const pub = paraMs(p.published_at);
      if (Number.isFinite(coleta) && Number.isFinite(pub) && pub > coleta) latencias.push((pub - coleta) / 3600000);
    }
    latencias.sort((a, b) => a - b);
    const latencia = latencias.length ? {
      amostra: latencias.length,
      mediana_h: Number(latencias[Math.floor(latencias.length / 2)].toFixed(1)),
      min_h: Number(latencias[0].toFixed(1)),
      max_h: Number(latencias[latencias.length - 1].toFixed(1)),
    } : { amostra: 0, observacao: 'sem data_coleta comparável — latência é pendência de Fase 0' };

    // execuções por workflow: estabilidade
    const execucoes = {};
    for (const [nome, id] of Object.entries(cfg.workflows)) {
      const lista = await ex.listar(w, id, { limite: 1000 });
      const sucesso = lista.filter((e) => e.status === 'success').length;
      execucoes[nome] = {
        total_na_retencao: lista.length,
        sucesso,
        taxa_sucesso_pct: lista.length ? Number((sucesso / lista.length * 100).toFixed(1)) : null,
        observacao: 'só as execuções ainda dentro da retenção de 168 h',
      };
    }

    // taxa de curadoria: quantas pautas avaliadas viram publicação
    const aprovadas = curadoria.filter((c) => String(c.decisao_final || '').toLowerCase() === 'aprovar').length;

    const base = {
      medido_em: agoraUtc(),
      banco: cfg.db,
      MEDIDO: {
        publicacoes_registradas: pubs.length,
        publicadas: publicadas.length,
        publicadas_com_post_id: comPostId.length,
        cobertura_post_id_pct: publicadas.length ? Number((comPostId.length / publicadas.length * 100).toFixed(1)) : null,
        por_status: porStatus,
        fila_por_status: filaPorStatus,
        dias_com_publicacao: dias.length,
        primeiro_dia: dias[0] || null,
        ultimo_dia: dias[dias.length - 1] || null,
        cadencia_posts_por_dia_ativo: cadencia,
        por_fonte: porFonte,
        latencia_fonte_para_post: latencia,
        curadoria: {
          pautas_avaliadas: curadoria.length,
          aprovadas,
          taxa_aprovacao_pct: curadoria.length ? Number((aprovadas / curadoria.length * 100).toFixed(1)) : null,
        },
        execucoes,
        alcance: 'NÃO MEDIDO — nenhuma métrica de alcance existia no banco antes deste módulo (RF-02)',
      },
      DECLARADO,
      metas_do_prd: {
        alcance_mediano: '+100% sobre a base medida, em 90 dias (provisória, revisar após 30 dias de coleta)',
        seguidores: 'crescimento líquido positivo por 8 semanas (provisória)',
        cobertura_registro: '100%',
        coletas_concluidas: '>= 95%',
      },
    };

    console.log(JSON.stringify(base, null, 2));

    if (DRY) { logger.info('resumo', JSON.stringify({ dry: true, publicadas: publicadas.length })); return { dry: true }; }
    if (!(await tab.existeTabela(w, NOVAS.relatorios.id))) {
      throw new Error('promoliso_relatorios não existe — rode "node analytics/migrate.cjs up" antes');
    }
    const dia = new Date().toISOString().slice(0, 10);
    await tab.upsert(w, {
      dataTableId: NOVAS.relatorios.id, chave: 'relatorio_key', valorChave: `LINHA_DE_BASE:${dia}`,
      campos: {
        tipo: 'LINHA_DE_BASE',
        periodo_inicio: dias[0] || '',
        periodo_fim: dias[dias.length - 1] || '',
        gerado_em: agoraUtc(),
        volume: publicadas.length,
        resumo: `Linha de base de ${dia}. Publicadas: ${publicadas.length} em ${dias.length} dia(s) ativos ` +
          `(cadência ${cadencia}/dia). Alcance: não medido antes deste módulo. Declarado no PRD: ` +
          `${DECLARADO.seguidores} seguidores, ~${DECLARADO.alcance_medio_informado} visualizações/post.`,
        dados: JSON.stringify(base).slice(0, 20000),
        acoes: JSON.stringify(['Aguardar 30 dias de coleta antes de mexer em prompt, template ou horário (PRD §8.2).']),
        enviado: 0,
        enviado_em: '',
        erro_envio: 'linha de base não é enviada por e-mail',
      },
    });

    logger.info('resumo', JSON.stringify({ publicadas: publicadas.length, dias: dias.length, cadencia }));
    return { publicadas: publicadas.length, dias: dias.length, cadencia };
  } finally { await w.fechar(); }
}

if (require.main === module) {
  log.envolver('linha-de-base', main, { registrar: !DRY }).then((r) => {
    if (r.status !== 'success') console.error('FALHOU: ' + r.erro);
  });
}
module.exports = { main, DECLARADO };
