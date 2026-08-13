#!/usr/bin/env node
// RF-02 — coleta métricas de cada publicação em D+1, D+3 e D+7.
//
//   node analytics/coletor-metricas.cjs [--dry] [--verbose] [--janela=D1]
//   PROMO_ANALYTICS_MOCK=1 node analytics/coletor-metricas.cjs   # sem rede, para homologação
//
// CRITÉRIO DE ACEITE ("pelo menos 95% das coletas concluídas OU registradas como erro"):
// toda janela vencida vira uma LINHA, sempre. Os estados possíveis são
//   OK             — a API respondeu e os números estão gravados
//   ERRO           — a API recusou/falhou; `erro` e `tentativas` ficam registrados e há retry
//   INDISPONIVEL   — a janela venceu há mais que a tolerância e nunca deu certo; encerrada
//   REMOVIDO       — a mídia não existe mais no Instagram (o post foi apagado). Terminal, sem
//                    retry, e FORA do denominador: post apagado não é coleta falha. Sem isso,
//                    2 posts apagados entre 9 deixariam a taxa em ~78% para sempre e o alerta
//                    de "abaixo de 95%" dispararia toda rodada sem nada estar errado.
//   PRE_INSTALACAO — a janela já tinha vencido quando o módulo foi instalado. Fisicamente
//                    incoletável (a API não devolve insight retroativo de janela fechada), então
//                    ela é registrada e EXCLUÍDA do denominador da taxa. Sem isso, o primeiro dia
//                    de operação nasceria com taxa perto de zero e dispararia alerta falso — foi
//                    o que apareceu no primeiro teste em homologação.
// Não existe janela vencida sem linha. O que o script mede e reporta é a fatia em OK.
//
// IDEMPOTÊNCIA: a chave é `${instagram_post_id}:${janela}` com índice UNIQUE. Rodar o coletor três
// vezes no mesmo dia atualiza a mesma linha; nunca cria uma segunda.
//
// ISOLAMENTO: processo separado, disparado por timer. Não há caminho pelo qual uma falha aqui
// alcance o publicador.
const cfg = require('./config.cjs');
const { abrirEnvolvido, agoraUtc, paraMs } = require('./lib/db.cjs');
const { NOVAS } = require('./lib/schema.cjs');
const tab = require('./lib/tabela.cjs');
const ig = require('./lib/instagram.cjs');
const log = require('./lib/log.cjs');

const DRY = process.argv.includes('--dry');
const VERBOSE = process.argv.includes('--verbose');
const soJanela = (process.argv.find((a) => a.startsWith('--janela=')) || '').split('=')[1] || '';

const DIA_MS = 86400000;

// A Meta devolve a MESMA mensagem para "mídia apagada" e para "sem permissão de ver esta mídia":
//   "Unsupported get request. Object with ID '...' does not exist, cannot be loaded due to
//    missing permissions, or does not support this operation."
// Por isso o REMOVIDO sai do denominador da taxa (senão post apagado vira falha crônica) MAS é
// contado e reportado à parte: várias mídias virando REMOVIDO de uma vez é sintoma de permissão
// perdida, não de faxina no perfil — e nesse caso o alerta dispara.
function pareceMidiaInexistente(mensagem) {
  const m = String(mensagem || '');
  return /does not exist/i.test(m) || /Unsupported get request/i.test(m);
}

// Decide o que fazer com uma (publicação, janela) — separado da E/S para poder ser testado puro.
function planejar({ publicadoEmMs, janela, agoraMs, linha, toleranciaH, maxTentativas, marcoZeroMs }) {
  const alvoMs = publicadoEmMs + janela.dias * DIA_MS;
  if (!Number.isFinite(publicadoEmMs)) return { acao: 'pular', motivo: 'sem published_at legível' };
  if (agoraMs < alvoMs) return { acao: 'pular', motivo: 'janela ainda não venceu', alvoMs };

  const status = linha && String(linha.status || '').toUpperCase();
  if (status === 'OK') return { acao: 'pular', motivo: 'já coletada', alvoMs };
  if (status === 'INDISPONIVEL' || status === 'PRE_INSTALACAO' || status === 'REMOVIDO') {
    return { acao: 'pular', motivo: 'encerrada', alvoMs };
  }

  // janela que já tinha fechado antes de o módulo existir: não há como coletar, e contá-la como
  // falha distorceria a taxa para sempre
  if (Number.isFinite(marcoZeroMs) && alvoMs < marcoZeroMs) {
    return { acao: 'pre-instalacao', motivo: 'janela venceu antes da instalação do módulo', alvoMs, tentativas: 0 };
  }

  const tentativas = Number((linha && linha.tentativas) || 0);
  const atrasoH = (agoraMs - alvoMs) / 3600000;
  if (atrasoH > toleranciaH || tentativas >= maxTentativas) {
    // desistiu: fica registrado como erro definitivo, que é o que o critério de aceite pede
    return { acao: 'encerrar', motivo: atrasoH > toleranciaH ? `janela vencida há ${atrasoH.toFixed(1)}h` : `${tentativas} tentativas sem sucesso`, alvoMs, tentativas };
  }
  return { acao: 'coletar', alvoMs, tentativas };
}

async function main({ logger }) {
  const w = await abrirEnvolvido(cfg.db, DRY);
  try {
    if (!(await tab.existeTabela(w, NOVAS.metricas.id))) {
      throw new Error('promoliso_metricas não existe — rode "node analytics/migrate.cjs up" antes');
    }
    const janelas = cfg.janelas.filter((j) => !soJanela || j.nome === soJanela);
    if (!janelas.length) throw new Error(`janela desconhecida: ${soJanela}`);

    // marco zero = quando a migration 001 rodou. Antes disso não havia onde gravar métrica.
    let marcoZeroMs = NaN;
    if (cfg.marcoZero) {
      marcoZeroMs = paraMs(cfg.marcoZero);
      if (!Number.isFinite(marcoZeroMs)) throw new Error(`PROMO_MARCO_ZERO ilegível: ${cfg.marcoZero}`);
      logger.info('marco zero forçado por PROMO_MARCO_ZERO', JSON.stringify({ marcoZero: cfg.marcoZero }));
    } else {
      try {
        const m = await w.get("SELECT aplicada_em FROM promoliso_analytics_migrations WHERE id='001'");
        if (m) marcoZeroMs = paraMs(m.aplicada_em);
      } catch { /* tabela de estado ausente: sem marco zero, tudo é coletável */ }
    }

    const pubs = (await tab.ler(w, cfg.tabelas.publicacoes))
      .filter((p) => String(p.instagram_post_id || '').trim() && String(p.published_at || '').trim());
    const linhas = await tab.ler(w, NOVAS.metricas.id);
    const porChave = new Map(linhas.map((l) => [String(l.coleta_key), l]));

    const agoraMs = Date.now();
    const resumo = { publicacoes: pubs.length, ok: 0, erro: 0, removidos: 0, encerradas: 0, preInstalacao: 0, puladas: 0, vencidas: 0 };

    for (const p of pubs) {
      const postId = String(p.instagram_post_id).trim();
      const publicadoEmMs = paraMs(p.published_at);

      for (const janela of janelas) {
        const chave = `${postId}:${janela.nome}`;
        const linha = porChave.get(chave);
        const plano = planejar({
          publicadoEmMs, janela, agoraMs, linha, marcoZeroMs,
          toleranciaH: cfg.janelaToleranciaHoras, maxTentativas: cfg.maxTentativasColeta,
        });

        if (plano.acao === 'pular') {
          resumo.puladas++;
          if (plano.motivo === 'já coletada') resumo.vencidas++;
          if (VERBOSE) logger.info('pulada', JSON.stringify({ chave, motivo: plano.motivo }));
          continue;
        }
        resumo.vencidas++;

        const base = {
          content_key: String(p.content_key || ''),
          instagram_post_id: postId,
          janela: janela.nome,
          alvo_em: agoraUtc(new Date(plano.alvoMs)),
          coletado_em: agoraUtc(),
        };

        if (plano.acao === 'pre-instalacao') {
          resumo.preInstalacao++;
          if (DRY) continue;
          await tab.upsert(w, {
            dataTableId: NOVAS.metricas.id, chave: 'coleta_key', valorChave: chave,
            campos: { ...base, status: 'PRE_INSTALACAO', tentativas: 0, erro: plano.motivo },
          });
          continue;
        }

        if (plano.acao === 'encerrar') {
          resumo.encerradas++;
          if (DRY) continue;
          await tab.upsert(w, {
            dataTableId: NOVAS.metricas.id, chave: 'coleta_key', valorChave: chave,
            campos: { ...base, status: 'INDISPONIVEL', tentativas: plano.tentativas, erro: plano.motivo },
          });
          logger.aviso('janela encerrada sem métrica', JSON.stringify({ chave, motivo: plano.motivo }));
          continue;
        }

        // --- coleta de verdade ---
        if (DRY) { resumo.ok++; if (VERBOSE) logger.info('coletaria', JSON.stringify({ chave })); continue; }
        try {
          const r = await ig.insightsDaMidia(postId);
          const perfil = janela.nome === 'D1'
            ? await ig.insightsDoPerfil(publicadoEmMs, plano.alvoMs).catch(() => null)
            : null;
          await tab.upsert(w, {
            dataTableId: NOVAS.metricas.id, chave: 'coleta_key', valorChave: chave,
            campos: {
              ...base,
              status: 'OK',
              tentativas: plano.tentativas + 1,
              erro: r.avisos.length ? r.avisos.join(' | ').slice(0, 400) : '',
              alcance: r.valores.alcance ?? null,
              visualizacoes: r.valores.visualizacoes ?? null,
              curtidas: r.valores.curtidas ?? null,
              comentarios: r.valores.comentarios ?? null,
              compartilhamentos: r.valores.compartilhamentos ?? null,
              salvamentos: r.valores.salvamentos ?? null,
              visitas_perfil: (perfil && perfil.visitas_perfil) ?? r.valores.visitas_perfil ?? null,
              seguidores_atribuiveis: (perfil && perfil.seguidores_atribuiveis) ?? null,
              metricas_brutas: JSON.stringify({ midia: r.brutas, perfil: perfil && perfil.brutas }).slice(0, 4000),
            },
          });
          resumo.ok++; logger.ok();
          if (VERBOSE) logger.info('coletada', JSON.stringify({ chave, valores: r.valores }));
        } catch (e) {
          // mídia apagada: terminal, sem retry, e fora do denominador — ver topo do arquivo
          if (pareceMidiaInexistente(e.message)) {
            resumo.removidos++;
            await tab.upsert(w, {
              dataTableId: NOVAS.metricas.id, chave: 'coleta_key', valorChave: chave,
              campos: { ...base, status: 'REMOVIDO', tentativas: plano.tentativas + 1, erro: String(e.message).slice(0, 400) },
            });
            logger.aviso('mídia não existe mais no Instagram', JSON.stringify({ chave, post: postId }));
            continue;
          }
          resumo.erro++; logger.falha();
          await tab.upsert(w, {
            dataTableId: NOVAS.metricas.id, chave: 'coleta_key', valorChave: chave,
            campos: { ...base, status: 'ERRO', tentativas: plano.tentativas + 1, erro: String(e.message).slice(0, 400) },
          });
          logger.erro('falha na coleta', JSON.stringify({ chave, erro: String(e.message).slice(0, 200) }));
        }
      }
    }

    // taxa de conclusão sobre TODAS as janelas já vencidas (não só as desta rodada), excluindo o
    // que era incoletável por natureza: janela anterior à instalação e mídia apagada.
    // Ver o comentário no topo do arquivo para o porquê de cada exclusão.
    const FORA_DO_DENOMINADOR = ['PRE_INSTALACAO', 'REMOVIDO'];
    const todas = DRY ? linhas : await tab.ler(w, NOVAS.metricas.id);
    const noAlcance = todas.filter((l) => !FORA_DO_DENOMINADOR.includes(String(l.status).toUpperCase()));
    const concluidas = noAlcance.filter((l) => String(l.status).toUpperCase() === 'OK').length;
    const registradas = noAlcance.length;
    const taxa = registradas ? concluidas / registradas : 1;
    resumo.taxa_conclusao = Number((taxa * 100).toFixed(1));
    resumo.linhas_totais = todas.length;
    resumo.linhas_no_alcance = registradas;
    resumo.removidos_no_total = todas.filter((l) => String(l.status).toUpperCase() === 'REMOVIDO').length;

    // Post apagado é rotina; VÁRIOS de uma vez é sintoma de permissão perdida (a Meta usa a mesma
    // mensagem para os dois casos). Nesse caso o silêncio seria pior que o alarme falso.
    if (resumo.removidos >= 3) {
      log.alertar('[PromoLiso] analytics: várias mídias sumiram de uma vez',
        `${resumo.removidos} mídias responderam "não existe" nesta rodada.\n` +
        'Se você não apagou esses posts, provavelmente é permissão do token, não exclusão.\n' +
        'Ver a coluna erro em promoliso_metricas (status REMOVIDO).');
    }

    logger.info('resumo', JSON.stringify({ ...resumo, dry: DRY, mock: cfg.mock }));

    // RF-02 pede >= 95%. Abaixo disso o responsável precisa saber — mas só quando já há amostra.
    if (registradas >= 10 && taxa < 0.95) {
      log.alertar('[PromoLiso] analytics: coleta de métricas abaixo de 95%',
        `Taxa de conclusão: ${resumo.taxa_conclusao}% (${concluidas}/${registradas}).\n` +
        'Causas prováveis: permissão da API da Meta faltando, token expirado ou mídia apagada.\n' +
        'Ver promoliso_metricas (coluna erro) e analytics/logs/.');
    }
    return resumo;
  } finally {
    await w.fechar();
  }
}

if (require.main === module) {
  log.envolver('coletor-metricas', main, { registrar: !DRY }).then((r) => {
    if (r.status !== 'success') console.error('FALHOU: ' + r.erro);
  });
}
module.exports = { main, planejar, pareceMidiaInexistente, DIA_MS };
