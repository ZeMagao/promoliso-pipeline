#!/usr/bin/env node
// RF-01 — registra o metadado completo de toda publicação, e RF-11 (básico) — copia as execuções
// do n8n para uma tabela durável antes do prune.
//
//   node analytics/coletor-publicacoes.cjs [--dry] [--verbose]
//
// POR QUE RODA FORA DO n8n
// Mesmo motivo do promo-fila-writeback.cjs (ver OPERACAO-VPS.md): inserir nó no publicador exige
// religar conexões, e cirurgia de workflow foi o que quebrou a publicação por 3 dias em 05/08.
// Rodando de fora, o pior caso deste script é ele mesmo falhar — o produtor e o publicador não
// têm sequer como perceber. É o isolamento que o PRD exige (RF-03).
//
// PRAZO: `execution_data` é podado em 168 h. Rodando de hora em hora, o script sempre alcança a
// execução enquanto ela existe, e o que ele copia para a Data Table é durável.
//
// DIVISÃO DE ESCRITA COM O promo-fila-writeback.cjs (importante)
// Aquele script continua sendo o ÚNICO dono de `operational_status`, `instagram_post_id`,
// `instagram_story_id`, `carousel_container_id` e `published_at`. Este aqui NUNCA escreve nesses
// cinco campos — só nas colunas novas da migration 002. Um campo, um dono: é assim que se evita a
// regra duplicada que já produziu dois bugs neste projeto.
// A única exceção é a rede de segurança: se a fila prova que publicou e não existe linha
// correspondente em promoliso_publicacoes, este script INSERE o esqueleto (com
// operational_status='PREPARED') para que o writeback possa promovê-lo depois. Isso é logado alto.
const cfg = require('./config.cjs');
const { abrirEnvolvido, agoraUtc, paraMs } = require('./lib/db.cjs');
const { NOVAS } = require('./lib/schema.cjs');
const tab = require('./lib/tabela.cjs');
const ex = require('./lib/execucoes.cjs');
const versoes = require('./lib/versoes.cjs');
const chaves = require('./lib/chaves.cjs');
const log = require('./lib/log.cjs');
const dt = require('./lib/datatable.cjs');

const DRY = process.argv.includes('--dry');
const VERBOSE = process.argv.includes('--verbose');

const CAMPOS_DO_WRITEBACK = ['operational_status', 'instagram_post_id', 'instagram_story_id',
  'carousel_container_id', 'published_at'];

// Extrai de uma execução do PRODUTOR o que interessa para o registro.
async function metadadosDoProdutor(w, execucaoId) {
  const rd = await ex.runData(w, execucaoId);
  if (!rd) return null;

  const fila = ex.saidaDoNo(rd, 'Fila: montar row');
  const pauta = ex.saidaDoNo(rd, 'Selecionar melhor pauta');
  const validado = ex.saidaDoNo(rd, 'Validar antes de publicar');

  let imagens = [];
  if (fila && fila.carousel_urls) {
    try { imagens = JSON.parse(fila.carousel_urls); } catch { imagens = []; }
  }
  const distintas = new Set(imagens.filter(Boolean).map((u) => String(u).split(/[?#]/)[0].toLowerCase()));

  const noticia = (pauta && pauta.noticia) || {};
  const registro = (pauta && pauta.registro) || {};
  const saida = (validado && validado.output) || {};

  const erros = ex.errosDaExecucao(rd);
  return {
    imagens_urls: JSON.stringify(imagens),
    imagens_origem: JSON.stringify({
      capa: imagens[0] ? chaves.dominioDe(imagens[0]) : '',
      slides: imagens.slice(1).map((u) => chaves.dominioDe(u)),
      fonte_declarada: noticia.tipo_fonte || '',
    }),
    imagens_unicas: distintas.size,
    score: Number(registro.pontuacao_total || 0) || null,
    score_justificativa: String(registro.motivo || '').slice(0, 500),
    decisao_editorial: String(registro.decisao_final || registro.decisao_recomendada || ''),
    formato: String(registro.formato_recomendado || 'carrossel').toUpperCase(),
    entidades: JSON.stringify(Array.isArray(saida.entidades) ? saida.entidades : []),
    modelo_ia: modeloDoAgente(rd),
    coletado_em: String(registro.data_coleta || noticia.data_coleta || ''),
    tentativas: ex.tentativasDoNo(rd, 'Tentar outra pauta') || ex.tentativasDoNo(rd, 'AI Agent') || 1,
    avisos: erros.length ? JSON.stringify(erros).slice(0, 900) : '',
  };
}

// Qual modelo escreveu o post. Não há campo explícito, então lemos o nome do nó de LLM que rodou —
// é a informação que existe sem instrumentar o workflow por dentro.
function modeloDoAgente(rd) {
  const candidatos = ['GPT 5.4 mini', 'Modelo do Curador PromoLiso AI', 'Modelo de Confiabilidade PromoLiso AI'];
  const usados = candidatos.filter((n) => rd[n]);
  return usados.join(' + ');
}

async function main({ logger }) {
  const w = await abrirEnvolvido(cfg.db, DRY);
  try {
    for (const chave of ['metricas', 'versoes', 'execucoes', 'relatorios', 'fontes']) {
      if (!(await tab.existeTabela(w, NOVAS[chave].id))) {
        throw new Error(`tabela ${NOVAS[chave].nome} não existe — rode "node analytics/migrate.cjs up" antes`);
      }
    }
    const colsPub = await tab.colunas(w, cfg.tabelas.publicacoes);
    if (!colsPub.has('prompt_versao')) throw new Error('migration 002 não aplicada em promoliso_publicacoes');

    // --- versões vigentes (RF-05) --------------------------------------------------------
    const inspecao = await versoes.inspecionar(w, cfg.workflows);
    const semRegistro = inspecao.filter((i) => i.presente && i.rotulo === 'NAO-REGISTRADA');
    if (semRegistro.length) {
      logger.aviso('artefatos sem versão registrada (drift)', JSON.stringify({
        artefatos: semRegistro.map((i) => `${i.chave}@${i.curto}`),
      }));
    }
    const versaoAtual = versoes.resumoParaPublicacao(inspecao);

    // --- leitura -------------------------------------------------------------------------
    const fila = await tab.ler(w, cfg.tabelas.fila);
    const curadoria = await tab.ler(w, cfg.tabelas.curadoria);
    const pubs = await tab.ler(w, cfg.tabelas.publicacoes);

    const porChaveFila = new Map();
    for (const r of fila) {
      const k = chaves.chaveDeConteudo(r.content_key);
      if (k) porChaveFila.set(k, r);
    }
    const porChaveCuradoria = new Map();
    for (const r of curadoria) {
      const k = chaves.chaveDeConteudo(r.url_normalizada || r.url || r.curation_key);
      // a curadoria pode ter várias avaliações da mesma URL; a mais recente é a que vale
      if (k && (!porChaveCuradoria.has(k) || Number(r.id) > Number(porChaveCuradoria.get(k).id))) {
        porChaveCuradoria.set(k, r);
      }
    }

    // execuções do produtor e do publicador, indexadas por id
    const execProdutor = new Map((await ex.listar(w, cfg.workflows.produtor, { limite: 400 })).map((e) => [String(e.id), e]));
    const execPublicador = await ex.listar(w, cfg.workflows.publicador, { limite: 400 });

    // content_key -> execução do publicador que publicou (a mais recente vence)
    const publicouPorChave = new Map();
    for (const e of execPublicador.slice().reverse()) {
      if (e.status !== 'success') continue;
      const rd = await ex.runData(w, e.id);
      if (!rd) continue;
      const sel = ex.saidaDoNo(rd, 'Selecionar READY', 'primeiro');
      const k = chaves.chaveDeConteudo(sel && sel.content_key);
      if (!k) continue;
      const post = ex.saidaDoNo(rd, 'Publish a post');
      publicouPorChave.set(k, {
        execucao: e,
        temPost: Boolean(post && (post.id || post.media_id)),
        tentativas: ex.tentativasDoNo(rd, 'Consultar status 1') + ex.tentativasDoNo(rd, 'Consultar status 2') + ex.tentativasDoNo(rd, 'Consultar status 3'),
      });
    }

    // --- rede de segurança: publicou mas não tem registro (RF-01 exige 100%) --------------
    const chavesPub = new Set(pubs.map((p) => chaves.chaveDeConteudo(p.content_key)).filter(Boolean));
    const orfas = [];
    for (const [k, r] of porChaveFila) {
      if (String(r.status || '').toUpperCase() !== 'PUBLISHED') continue;
      if (chavesPub.has(k)) continue;
      orfas.push({ chave: k, topic: r.topic });
      if (DRY) continue;
      await tab.upsert(w, {
        dataTableId: cfg.tabelas.publicacoes,
        chave: 'content_key',
        valorChave: r.content_key,
        campos: {
          topic: r.topic || '',
          primary_url: r.primary_url || '',
          category: r.category || '',
          // PREPARED de propósito: quem promove para PUBLISHED é o promo-fila-writeback.cjs
          operational_status: 'PREPARED',
          execution_id: String(r.execution_id || ''),
          error_message: '',
        },
        somenteVazios: false,
      });
    }
    if (orfas.length) {
      logger.aviso('publicações sem registro em promoliso_publicacoes — esqueleto inserido', JSON.stringify({ total: orfas.length, chaves: orfas.map((o) => o.chave).slice(0, 10) }));
      log.alertar('[PromoLiso] analytics: publicação sem registro',
        `A fila prova ${orfas.length} publicação(ões) sem linha em promoliso_publicacoes.\n` +
        orfas.map((o) => ` - ${o.chave} (${o.topic})`).join('\n'));
    }

    // --- enriquecimento por publicação ---------------------------------------------------
    const atual = orfas.length && !DRY ? await tab.ler(w, cfg.tabelas.publicacoes) : pubs;
    const resumo = { total: atual.length, atualizadas: 0, semMudanca: 0, semExecucao: 0 };

    for (const p of atual) {
      const k = chaves.chaveDeConteudo(p.content_key);
      if (!k) { resumo.semMudanca++; continue; }
      const rowFila = porChaveFila.get(k);
      const cur = porChaveCuradoria.get(k);
      const pubExec = publicouPorChave.get(k);

      const campos = {
        fonte_dominio: chaves.dominioDe(p.primary_url || (rowFila && rowFila.primary_url) || ''),
        formato: 'CARROSSEL',
        registro_versao: cfg.registroVersao,
        analytics_atualizado_em: agoraUtc(),
        // versões vigentes: só preenchem quando ainda estão vazias, para não reescrever a
        // versão que valia quando o post saiu (ver comentário em lib/versoes.cjs)
        ...versaoAtual,
      };

      // da curadoria (durável, não depende de execution_data)
      if (cur) {
        campos.score = Number(cur.pontuacao_total || 0) || null;
        campos.score_justificativa = String(cur.motivo || '').slice(0, 500);
        campos.decisao_editorial = String(cur.decisao_final || cur.decisao_recomendada || '');
        if (cur.formato_recomendado) campos.formato = String(cur.formato_recomendado).toUpperCase();
        if (cur.data_coleta) campos.coletado_em = String(cur.data_coleta);
        if (!campos.fonte_dominio && cur.dominio_fonte) campos.fonte_dominio = String(cur.dominio_fonte);
      }

      // da fila (durável)
      if (rowFila) {
        if (!campos.coletado_em && rowFila.created_at) campos.coletado_em = String(rowFila.created_at);
        try {
          const urls = JSON.parse(rowFila.carousel_urls || '[]');
          if (Array.isArray(urls) && urls.length) {
            campos.imagens_urls = JSON.stringify(urls);
            campos.imagens_unicas = new Set(urls.filter(Boolean).map((u) => String(u).split(/[?#]/)[0].toLowerCase())).size;
            campos.imagens_origem = JSON.stringify({ capa: chaves.dominioDe(urls[0] || ''), slides: urls.slice(1).map(chaves.dominioDe) });
          }
        } catch { /* carousel_urls ilegível: não é motivo para abortar a linha */ }
      }

      // da execução do produtor (efêmera — por isso copiamos)
      const execProd = execProdutor.get(String(p.execution_id || ''));
      if (execProd) {
        campos.duracao_producao_ms = execProd.duracao_ms;
        const meta = await metadadosDoProdutor(w, execProd.id);
        if (meta) {
          for (const [kk, vv] of Object.entries(meta)) {
            if (vv === null || vv === undefined || vv === '' ) continue;
            if (kk === 'formato' && campos.formato) continue;
            campos[kk] = vv;
          }
        } else { resumo.semExecucao++; }
      } else { resumo.semExecucao++; }

      // da execução do publicador
      if (pubExec) {
        campos.duracao_publicacao_ms = pubExec.execucao.duracao_ms;
        campos.tentativas = pubExec.tentativas || campos.tentativas || 1;
      }

      // hora/slot vêm do published_at (dono: writeback) — aqui só derivamos
      const msPub = paraMs(p.published_at || (rowFila && rowFila.published_at));
      if (Number.isFinite(msPub)) {
        campos.hora_publicacao_local = chaves.horaLocal(msPub, cfg.tz);
        campos.slot = chaves.slotDe(campos.hora_publicacao_local);
      }

      // trava dura: este script nunca toca os campos do writeback
      for (const proibido of CAMPOS_DO_WRITEBACK) delete campos[proibido];

      if (DRY) { resumo.atualizadas++; continue; }
      const r = await tab.upsert(w, {
        dataTableId: cfg.tabelas.publicacoes,
        chave: 'content_key',
        valorChave: p.content_key,
        campos,
        carimbos: ['analytics_atualizado_em'],
        aviso: (d) => logger.aviso('colunas inexistentes descartadas', JSON.stringify({ colunas: d })),
      });
      if (r.acao === 'sem-mudanca') resumo.semMudanca++; else { resumo.atualizadas++; logger.ok(); }
      if (VERBOSE) logger.info('publicação', JSON.stringify({ chave: k, acao: r.acao, mudou: r.mudou }));
    }

    // --- promoliso_fontes ----------------------------------------------------------------
    const porDominio = new Map();
    for (const p of atual) {
      const d = chaves.dominioDe(p.primary_url);
      if (!d) continue;
      const quando = p.published_at || p.createdAt || '';
      const e = porDominio.get(d) || { publicacoes: 0, primeira: quando, ultima: quando };
      e.publicacoes++;
      if (quando && (!e.primeira || quando < e.primeira)) e.primeira = quando;
      if (quando && (!e.ultima || quando > e.ultima)) e.ultima = quando;
      porDominio.set(d, e);
    }
    const RSS = new Set(['news.xbox.com', 'blog.playstation.com', 'nintendo.com', 'nvidia.com',
      'intel.com', 'adrenaline.com.br', 'gamevicio.com', 'flowgames.gg']);
    for (const [d, e] of porDominio) {
      if (DRY) continue;
      await tab.upsert(w, {
        dataTableId: NOVAS.fontes.id,
        chave: 'dominio',
        valorChave: d,
        campos: {
          nome: d,
          tipo: RSS.has(d) ? 'RSS' : 'OUTRO',
          publicacoes: e.publicacoes,
          primeira_em: e.primeira || '',
          ultima_em: e.ultima || '',
        },
      });
    }

    // --- observabilidade: copia execution_entity antes do prune (RF-11 básico) ------------
    let execCopiadas = 0;
    for (const [nome, id] of Object.entries(cfg.workflows)) {
      const lista = await ex.listar(w, id, { limite: 300 });
      for (const e of lista) {
        if (DRY) { execCopiadas++; continue; }
        const r = await tab.upsert(w, {
          dataTableId: NOVAS.execucoes.id,
          chave: 'execucao_key',
          valorChave: `n8n:${e.id}`,
          campos: {
            origem: 'n8n',
            workflow_id: id,
            workflow_nome: nome,
            etapa: 'workflow',
            status: e.status,
            iniciado_em: String(e.startedAt || ''),
            terminado_em: String(e.stoppedAt || ''),
            duracao_ms: e.duracao_ms,
            tentativas: 1,
            erro: '',
            detalhe: JSON.stringify({ mode: e.mode }),
          },
          somenteVazios: false,
        });
        if (r.acao !== 'sem-mudanca') execCopiadas++;
      }
    }

    logger.info('resumo', JSON.stringify({ ...resumo, orfas: orfas.length, fontes: porDominio.size, execCopiadas, dry: DRY }));
    return { ...resumo, orfas: orfas.length, fontes: porDominio.size, execCopiadas, dry: DRY };
  } finally {
    await w.fechar();
  }
}

if (require.main === module) {
  log.envolver('coletor-publicacoes', main, { registrar: !DRY }).then((r) => {
    if (r.status !== 'success') console.error('FALHOU: ' + r.erro);
  });
}
module.exports = { main, metadadosDoProdutor, CAMPOS_DO_WRITEBACK };
