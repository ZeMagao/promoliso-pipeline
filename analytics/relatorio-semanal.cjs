#!/usr/bin/env node
// RF-04 — relatório semanal automático.
//
//   node analytics/relatorio-semanal.cjs [--dry] [--semana=2026-W32] [--sem-email]
//
// CONTEÚDO (exigido pelo critério de aceite): volume, top 5, bottom 5, comparação por tema,
// formato, fonte, horário e template, padrões observados e ações sugeridas para a semana seguinte.
//
// IDEMPOTÊNCIA: a chave é `SEMANAL:<ano>-W<semana ISO>`. Rodar duas vezes na mesma semana atualiza
// a mesma linha e NÃO reenvia o e-mail (a coluna `enviado` guarda isso) — reexecutar não duplica
// relatório nem enche a caixa do responsável.
//
// ENTREGA: e-mail via /usr/local/bin/promo-alerta.sh, que reusa a credencial SMTP do próprio n8n.
// Nenhuma senha nova, nenhum segredo neste código. O canal é configurável trocando PROMO_ALERTA_CMD.
const cfg = require('./config.cjs');
const { abrirEnvolvido, agoraUtc, paraMs } = require('./lib/db.cjs');
const { NOVAS } = require('./lib/schema.cjs');
const tab = require('./lib/tabela.cjs');
const chaves = require('./lib/chaves.cjs');
const log = require('./lib/log.cjs');

const DRY = process.argv.includes('--dry');
const SEM_EMAIL = process.argv.includes('--sem-email');
const semanaArg = (process.argv.find((a) => a.startsWith('--semana=')) || '').split('=')[1] || '';

const DIA_MS = 86400000;

// ---------------------------------------------------------------------------
// Réguas de honestidade do relatório. Ficam aqui, em UM lugar, porque são usadas tanto para decidir
// o que virar "padrão observado" quanto para marcar as tabelas — e número de régua duplicado
// divergindo é o bug que já custou semanas neste projeto.
//
// AMOSTRA_MIN e DIFERENCA_MIN: 5 posts por lado e 30% de diferença. Com 3 posts e diferença de 1
// (o caso de 10/08: "12:30 = 7 contra 20:30 = 6") qualquer ruído vira padrão, e o responsável mexe
// no horário por causa de nada.
//
// PISO_ESCALA: abaixo deste alcance mediano, comparar cortes é comparar ruído. Em 14/08 o relatório
// da W33 rankeou 15 posts com alcance mediano 8 — a distância entre o "melhor" e o "pior" post da
// semana era de SEIS PESSOAS, e a tabela "por formato" elegia um vencedor com UM post medido. O
// número 30 é julgamento, não estatística: é a ordem de grandeza em que uma diferença de 2 ou 3
// deixa de caber dentro da variação normal de um punhado de posts. Rever quando o alcance subir.
const AMOSTRA_MIN = 5;
const DIFERENCA_MIN = 1.3;
const PISO_ESCALA = 30;

// Semana ISO (segunda a domingo), que é como o responsável pensa a semana de publicação.
function semanaIso(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicioAno = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const n = Math.ceil(((t - inicioAno) / DIA_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(n).padStart(2, '0')}`;
}

function intervaloDaSemana(rotulo) {
  const [ano, w] = rotulo.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(ano, 0, 4));
  const segundaDaW1 = new Date(jan4);
  segundaDaW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const inicio = new Date(segundaDaW1.getTime() + (w - 1) * 7 * DIA_MS);
  const fim = new Date(inicio.getTime() + 7 * DIA_MS - 1);
  return { inicio, fim };
}

// --------------------------------------------------------------------------------------------
// AGREGAÇÃO — função pura, sem banco, para poder ser testada com dados sintéticos.
// --------------------------------------------------------------------------------------------
function agregar({ publicacoes, metricas, inicioMs, fimMs, tz }) {
  const doPeriodo = publicacoes.filter((p) => {
    const ms = paraMs(p.published_at);
    return Number.isFinite(ms) && ms >= inicioMs && ms <= fimMs &&
      String(p.operational_status || '').toUpperCase() === 'PUBLISHED';
  });

  // TODA COMPARAÇÃO ACONTECE DENTRO DE UMA ÚNICA JANELA.
  //
  // A primeira versão usava, por post, a janela mais madura disponível (D7, senão D3, senão D1).
  // Parecia razoável e estava errado: alcance cresce com a idade, então um post medido aos 3 dias
  // aparecia acima de um medido a 1 dia só por ser mais velho. O relatório de 10/08 chegou a
  // produzir uma conclusão falsa por causa disso ("12:30 rende mais que 20:30"), que era só efeito
  // de quais posts por acaso tinham janela mais madura.
  //
  // Agora escolhemos UMA janela de referência — a de maior cobertura, desempatando pela mais
  // madura — e todo ranking e toda média usam só ela. Posts sem essa janela ficam de fora das
  // comparações (e isso é dito no texto), em vez de entrarem com número incomparável.
  const ORDEM = ['D7', 'D3', 'D1'];
  const okPorJanela = new Map();  // janela -> Map(postId -> métrica)
  for (const m of metricas) {
    if (String(m.status).toUpperCase() !== 'OK') continue;
    const j = String(m.janela);
    if (!okPorJanela.has(j)) okPorJanela.set(j, new Map());
    okPorJanela.get(j).set(String(m.instagram_post_id), m);
  }

  const idsDoPeriodo = new Set(doPeriodo.map((p) => String(p.instagram_post_id || '')).filter(Boolean));
  const cobertura = ORDEM.map((j) => ({
    janela: j,
    posts: [...(okPorJanela.get(j) || new Map()).keys()].filter((id) => idsDoPeriodo.has(id)).length,
  }));
  // maior cobertura vence; empate vai para a janela mais madura (ORDEM já está da mais madura
  // para a menos), o que faz a referência migrar de D1 para D7 conforme a operação amadurece
  const janelaRef = cobertura.slice().sort((a, b) => b.posts - a.posts)[0];
  const refMap = okPorJanela.get(janelaRef.janela) || new Map();

  const linhas = doPeriodo.map((p) => {
    const m = refMap.get(String(p.instagram_post_id || '')) || null;
    const alcance = m ? Number(m.alcance || 0) : null;
    const inter = m
      ? Number(m.curtidas || 0) + Number(m.comentarios || 0) + Number(m.compartilhamentos || 0) + Number(m.salvamentos || 0)
      : null;
    return {
      content_key: p.content_key,
      topic: p.topic || '(sem tema)',
      tema: String(p.category || 'SEM-CATEGORIA').toUpperCase(),
      formato: String(p.formato || 'CARROSSEL').toUpperCase(),
      fonte: p.fonte_dominio || chaves.dominioDe(p.primary_url) || '(sem fonte)',
      horario: p.hora_publicacao_local || chaves.horaLocal(paraMs(p.published_at), tz),
      slot: p.slot || '',
      template: p.template_versao || '(não registrado)',
      prompt: p.prompt_versao || '(não registrado)',
      score: Number(p.score || 0) || null,
      imagens_unicas: Number(p.imagens_unicas || 0) || null,
      alcance,
      interacoes: inter,
      janela: m ? m.janela : null,
      publicado_em: p.published_at,
    };
  });

  const comMetrica = linhas.filter((l) => l.alcance !== null);
  const ordenadas = comMetrica.slice().sort((a, b) => (b.alcance - a.alcance) || (b.interacoes - a.interacoes));

  const agrupar = (campo) => {
    const m = new Map();
    for (const l of linhas) {
      const k = l[campo] || '(vazio)';
      const e = m.get(k) || { chave: k, posts: 0, comMetrica: 0, alcanceTotal: 0, interacoesTotal: 0 };
      e.posts++;
      if (l.alcance !== null) { e.comMetrica++; e.alcanceTotal += l.alcance; e.interacoesTotal += l.interacoes; }
      m.set(k, e);
    }
    return [...m.values()]
      .map((e) => ({ ...e, alcanceMedio: e.comMetrica ? Math.round(e.alcanceTotal / e.comMetrica) : null }))
      .sort((a, b) => (b.alcanceMedio ?? -1) - (a.alcanceMedio ?? -1) || b.posts - a.posts);
  };

  const mediana = (xs) => {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };

  // Posts sem métrica NA JANELA DE REFERÊNCIA: separados por motivo, porque "ainda não amadureceu"
  // é rotina e "deu erro" é problema. A primeira versão juntava os dois e mandava o responsável
  // "investigar as coletas com status ERRO" mesmo quando não existia nenhuma.
  const semRef = { aguardando: 0, comErro: 0, encerradas: 0, removidas: 0 };
  for (const p of doPeriodo) {
    const id = String(p.instagram_post_id || '');
    if (refMap.has(id)) continue;
    const linhasDoPost = metricas.filter((m) => String(m.instagram_post_id) === id && String(m.janela) === janelaRef.janela);
    if (!linhasDoPost.length) { semRef.aguardando++; continue; }
    const st = String(linhasDoPost[0].status).toUpperCase();
    if (st === 'ERRO') semRef.comErro++;
    else if (st === 'REMOVIDO') semRef.removidas++;
    else semRef.encerradas++;
  }

  return {
    volume: linhas.length,
    comMetrica: comMetrica.length,
    janelaRef: janelaRef.janela,
    coberturaPorJanela: cobertura,
    semRef,
    cobertura: linhas.length ? Number((comMetrica.length / linhas.length * 100).toFixed(1)) : 0,
    alcanceMediano: mediana(comMetrica.map((l) => l.alcance)),
    alcanceMedio: comMetrica.length ? Math.round(comMetrica.reduce((a, l) => a + l.alcance, 0) / comMetrica.length) : null,
    // Com poucos posts medidos, "top 5" e "bottom 5" citam os mesmos posts e viram ruído.
    // Abaixo de 10, o relatório mostra UM ranking só e diz por quê.
    rankingUnico: ordenadas.length < 10,
    ranking: ordenadas,
    top5: ordenadas.slice(0, 5),
    bottom5: ordenadas.length < 10 ? [] : ordenadas.slice(-5).reverse(),
    porTema: agrupar('tema'),
    porFormato: agrupar('formato'),
    porFonte: agrupar('fonte'),
    porHorario: agrupar('slot'),
    porTemplate: agrupar('template'),
    linhas,
  };
}

// Padrões observados + ações. Regras explícitas e conservadoras: com pouca amostra o relatório diz
// que ainda não dá para concluir, em vez de inventar recomendação (PRD §8.2 "medir antes de otimizar").
function interpretar(ag, historico) {
  const padroes = [];
  const acoes = [];
  // As réguas moram no topo do arquivo (AMOSTRA_MIN, DIFERENCA_MIN, PISO_ESCALA): são as mesmas que
  // marcam as tabelas como inconclusivas, e ter duas cópias é convite a divergirem.

  if (ag.volume === 0) {
    padroes.push('Nenhuma publicação registrada como PUBLISHED nesta semana.');
    acoes.push('Verificar o publicador e a fila: nenhum post saiu no período.');
    return { padroes, acoes };
  }
  if (ag.comMetrica === 0) {
    padroes.push('Há publicações, mas nenhuma métrica coletada — a comparação abaixo fica em branco.');
    acoes.push('Checar permissões da API da Meta e o token; ver a coluna `erro` em promoliso_metricas.');
  }
  // Só vira ação o que É problema. Post aguardando a janela amadurecer é rotina, não falha —
  // mandar "investigar erros" quando não há erro nenhum treina o responsável a ignorar o relatório.
  const s = ag.semRef || {};
  if (s.comErro) acoes.push(`${s.comErro} coleta(s) com ERRO em ${ag.janelaRef}. Ver a coluna erro em promoliso_metricas.`);
  if (s.aguardando) {
    padroes.push(`${s.aguardando} post(s) ainda não completaram a janela ${ag.janelaRef} — entram no relatório da próxima semana.`);
  }

  const melhorDe = (lista, rotulo) => {
    const validos = lista.filter((e) => e.comMetrica >= AMOSTRA_MIN);
    if (validos.length < 2) return null;
    const [a] = validos;
    const b = validos[validos.length - 1];
    if (!a.alcanceMedio || !b.alcanceMedio) return null;
    if (a.alcanceMedio < b.alcanceMedio * DIFERENCA_MIN) return null;
    padroes.push(`${rotulo}: "${a.chave}" teve alcance médio ${a.alcanceMedio} contra ${b.alcanceMedio} de "${b.chave}" ` +
      `(${a.comMetrica} vs ${b.comMetrica} posts, todos medidos em ${ag.janelaRef}).`);
    return { melhor: a, pior: b };
  };
  const tema = melhorDe(ag.porTema, 'Tema');
  const horario = melhorDe(ag.porHorario, 'Horário');
  melhorDe(ag.porFonte, 'Fonte');
  melhorDe(ag.porTemplate, 'Template');

  if (tema) acoes.push(`Testar mais pautas de "${tema.melhor.chave}" na próxima semana, mantendo o volume atual.`);
  if (horario) acoes.push(`Comparar de novo o slot "${horario.melhor.chave}" antes de mexer nos horários — uma semana não decide.`);

  const repetidas = ag.linhas.filter((l) => l.imagens_unicas !== null && l.imagens_unicas < 6);
  if (repetidas.length) {
    padroes.push(`${repetidas.length} de ${ag.volume} carrosséis usaram menos de 6 imagens distintas.`);
    acoes.push('Repetição de imagem segue sendo o gargalo conhecido (RF-07/RF-08, ainda não implementados).');
  }

  const semVersao = ag.linhas.filter((l) => String(l.template).includes('não registrado') || String(l.prompt).includes('não registrado'));
  if (semVersao.length) acoes.push(`${semVersao.length} post(s) sem versão de prompt/template registrada — rodar analytics/registrar-versoes.cjs.`);

  if (historico && historico.alcanceMediano != null && ag.alcanceMediano != null) {
    const delta = ag.alcanceMediano - historico.alcanceMediano;
    const pct = historico.alcanceMediano ? Math.round(delta / historico.alcanceMediano * 100) : 0;
    padroes.push(`Alcance mediano ${ag.alcanceMediano} contra ${historico.alcanceMediano} na semana anterior (${pct >= 0 ? '+' : ''}${pct}%).`);
  }

  if (ag.volume < 8 || ag.comMetrica < 5) {
    acoes.push('Amostra ainda pequena: não alterar prompt, template e horário na mesma semana (PRD §8.3).');
  }
  if (!acoes.length) acoes.push('Nada exige ação: manter a configuração atual e reavaliar na próxima semana.');
  return { padroes, acoes };
}

function montarTexto(rotulo, periodo, ag, leitura) {
  const l = [];
  const linha = (x) => l.push(x);
  // A escala inteira do relatório: se o alcance mediano é de um dígito, nenhum corte é conclusivo,
  // por mais posts que tenha. A coluna "leitura" existe para que ninguém precise fazer essa conta
  // de cabeça — antes a tabela elegia vencedor com UM post medido, calada.
  const escalaBaixa = (ag.alcanceMediano ?? 0) < PISO_ESCALA;
  const leituraDoCorte = (i) => {
    if (!i.comMetrica) return 'sem métrica';
    if (i.comMetrica < AMOSTRA_MIN) return `inconclusivo (n=${i.comMetrica})`;
    if (escalaBaixa) return 'inconclusivo (escala)';
    return 'comparável';
  };
  const tabela = (titulo, itens) => {
    linha('');
    linha(`### ${titulo}`);
    if (!itens.length) { linha('_sem dados_'); return; }
    linha('| chave | posts | com métrica | alcance médio | leitura |');
    linha('|---|---:|---:|---:|---|');
    for (const i of itens.slice(0, 8)) {
      linha(`| ${i.chave} | ${i.posts} | ${i.comMetrica} | ${i.alcanceMedio ?? '—'} | ${leituraDoCorte(i)} |`);
    }
    const comparaveis = itens.filter((i) => leituraDoCorte(i) === 'comparável').length;
    if (!comparaveis) linha('');
    if (!comparaveis) linha('_nenhuma linha desta tabela tem amostra e escala para sustentar comparação._');
  };

  linha(`# PromoLiso — relatório semanal ${rotulo}`);
  linha('');
  linha(`Período: ${periodo.inicio.toISOString().slice(0, 10)} a ${periodo.fim.toISOString().slice(0, 10)} (UTC)`);
  linha('');
  linha('## Volume');
  linha(`- Publicações: **${ag.volume}**`);
  linha(`- Com métrica em ${ag.janelaRef}: **${ag.comMetrica}** (${ag.cobertura}%)`);
  linha(`- Alcance mediano em ${ag.janelaRef}: **${ag.alcanceMediano ?? '—'}** | médio: ${ag.alcanceMedio ?? '—'}`);
  linha('');
  linha(`> **Todos os números abaixo são de ${ag.janelaRef}** (alcance ${ag.janelaRef.replace('D', '')} dia(s) após a publicação).`);
  linha('> Alcance cresce com a idade do post, então misturar janelas faria o ranking medir idade,');
  linha('> não desempenho. Cobertura por janela: ' +
    ag.coberturaPorJanela.map((c) => `${c.janela}=${c.posts}`).join(', ') + '.');
  if (ag.semRef && ag.semRef.aguardando) {
    linha(`> ${ag.semRef.aguardando} post(s) ainda não completaram ${ag.janelaRef} e ficaram fora das comparações.`);
  }

  // Duas perguntas diferentes moram neste relatório, e misturá-las é o erro mais fácil de cometer:
  // ler alcance de um dígito como veredito sobre o conteúdo. Uma depende do que publicamos; a outra,
  // de quantas pessoas alcançamos — e nenhuma mudança de arte ou de pauta move a segunda.
  linha('');
  linha('## Como ler este relatório');
  linha('');
  linha('**1. O conteúdo melhorou?** Responde-se pelo que controlamos: frescor da pauta, categoria,');
  linha('versão de prompt e de template. Precisa que a versão no ar esteja declarada em');
  linha('`analytics/versoes/registry.json` — enquanto aparecer `NAO-REGISTRADA`, arte nova e arte');
  linha('velha caem no mesmo grupo e a comparação é impossível.');
  linha('');
  linha('**2. Quantas pessoas veem?** É alcance, e depende de distribuição — seguidores, hashtags,');
  linha('horário, algoritmo. Mudança de pauta ou de template praticamente não mexe neste número.');
  if (escalaBaixa && ag.comMetrica) {
    const alcances = ag.ranking && ag.ranking.length ? ag.ranking.map((p) => p.alcance) : [];
    const spread = alcances.length ? Math.max(...alcances) - Math.min(...alcances) : 0;
    linha('');
    linha(`> ⚠️ **Escala:** alcance mediano ${ag.alcanceMediano} está abaixo de ${PISO_ESCALA}.`);
    if (spread) {
      linha(`> A distância entre o post de maior e o de menor alcance da semana é de **${spread} pessoa(s)**.`);
    }
    linha('> Nesta escala, ranking e tabelas medem ruído, não desempenho: as tabelas abaixo vêm');
    linha('> marcadas como inconclusivas de propósito. O que dá para concluir é sobre a pergunta 1');
    linha('> (conteúdo), nunca sobre a 2 — e a pergunta 2 é a que precisa de trabalho de distribuição.');
  }

  const item = (p, i) => `${i + 1}. **${p.alcance}** alcance / ${p.interacoes} inter. — ${p.topic} _(${p.fonte}, ${p.slot || p.horario})_`;

  linha('');
  if (ag.rankingUnico) {
    // menos de 10 medidos: top e bottom citariam os mesmos posts. Um ranking só é mais honesto.
    linha(`## Ranking (${ag.comMetrica} posts com métrica em ${ag.janelaRef})`);
    linha('_amostra pequena demais para separar em "melhores" e "piores" — segue a lista inteira, do maior alcance para o menor._');
    if (!ag.ranking.length) linha('_sem métrica no período_');
    ag.ranking.forEach((p, i) => linha(item(p, i)));
  } else {
    linha('## Top 5');
    if (!ag.top5.length) linha('_sem métrica no período_');
    ag.top5.forEach((p, i) => linha(item(p, i)));
    linha('');
    linha('## Bottom 5');
    if (!ag.bottom5.length) linha('_sem métrica no período_');
    ag.bottom5.forEach((p, i) => linha(item(p, i)));
  }

  tabela('Por tema', ag.porTema);
  tabela('Por formato', ag.porFormato);
  tabela('Por fonte', ag.porFonte);
  tabela('Por horário (slot)', ag.porHorario);
  tabela('Por template', ag.porTemplate);

  linha('');
  linha('## Padrões observados');
  if (!leitura.padroes.length) linha('- Amostra insuficiente para afirmar padrão.');
  leitura.padroes.forEach((p) => linha(`- ${p}`));

  linha('');
  linha('## Ações sugeridas para a próxima semana');
  leitura.acoes.forEach((a) => linha(`- ${a}`));

  linha('');
  linha('_Gerado por analytics/relatorio-semanal.cjs. Uma variável por vez (PRD §8.3)._');
  return l.join('\n');
}

async function main({ logger }) {
  const w = await abrirEnvolvido(cfg.db, DRY);
  try {
    if (!(await tab.existeTabela(w, NOVAS.relatorios.id))) {
      throw new Error('promoliso_relatorios não existe — rode "node analytics/migrate.cjs up" antes');
    }
    // padrão: a semana que ACABOU (o timer roda segunda de manhã)
    const rotulo = semanaArg || semanaIso(new Date(Date.now() - 3 * DIA_MS));
    const periodo = intervaloDaSemana(rotulo);

    const publicacoes = await tab.ler(w, cfg.tabelas.publicacoes);
    const metricas = await tab.ler(w, NOVAS.metricas.id);
    const ag = agregar({
      publicacoes, metricas,
      inicioMs: periodo.inicio.getTime(), fimMs: periodo.fim.getTime(), tz: cfg.tz,
    });

    // semana anterior, para a comparação
    const anteriorRotulo = semanaIso(new Date(periodo.inicio.getTime() - 3 * DIA_MS));
    const anteriorPeriodo = intervaloDaSemana(anteriorRotulo);
    const anterior = agregar({
      publicacoes, metricas,
      inicioMs: anteriorPeriodo.inicio.getTime(), fimMs: anteriorPeriodo.fim.getTime(), tz: cfg.tz,
    });

    const leitura = interpretar(ag, anterior);
    const texto = montarTexto(rotulo, periodo, ag, leitura);
    const chave = `SEMANAL:${rotulo}`;

    if (DRY) {
      console.log(texto);
      logger.info('resumo', JSON.stringify({ rotulo, volume: ag.volume, dry: true }));
      return { rotulo, volume: ag.volume, dry: true };
    }

    const existente = (await tab.ler(w, NOVAS.relatorios.id, 'relatorio_key=?', [chave]))[0] || null;
    const jaEnviado = existente && String(existente.enviado) === '1';

    let envio = { enviado: false, motivo: 'não tentado' };
    if (!jaEnviado && !SEM_EMAIL) {
      envio = log.alertar(`[PromoLiso] Relatório semanal ${rotulo}`, texto);
      if (!envio.enviado) logger.aviso('relatório não enviado por e-mail', JSON.stringify(envio));
    } else if (jaEnviado) {
      envio = { enviado: true, motivo: 'já havia sido enviado' };
    }

    await tab.upsert(w, {
      dataTableId: NOVAS.relatorios.id, chave: 'relatorio_key', valorChave: chave,
      campos: {
        tipo: 'SEMANAL',
        periodo_inicio: agoraUtc(periodo.inicio),
        periodo_fim: agoraUtc(periodo.fim),
        gerado_em: agoraUtc(),
        volume: ag.volume,
        resumo: texto.slice(0, 20000),
        dados: JSON.stringify({
          cobertura: ag.cobertura, alcanceMediano: ag.alcanceMediano, alcanceMedio: ag.alcanceMedio,
          porTema: ag.porTema, porFormato: ag.porFormato, porFonte: ag.porFonte,
          porHorario: ag.porHorario, porTemplate: ag.porTemplate,
          top5: ag.top5.map((p) => ({ topic: p.topic, alcance: p.alcance })),
          bottom5: ag.bottom5.map((p) => ({ topic: p.topic, alcance: p.alcance })),
        }).slice(0, 20000),
        acoes: JSON.stringify(leitura.acoes),
        enviado: envio.enviado ? 1 : 0,
        enviado_em: envio.enviado ? agoraUtc() : '',
        erro_envio: envio.enviado ? '' : String(envio.motivo || '').slice(0, 300),
      },
    });

    logger.info('resumo', JSON.stringify({ rotulo, volume: ag.volume, cobertura: ag.cobertura, enviado: envio.enviado }));
    return { rotulo, volume: ag.volume, cobertura: ag.cobertura, enviado: envio.enviado };
  } finally {
    await w.fechar();
  }
}

if (require.main === module) {
  log.envolver('relatorio-semanal', main, { registrar: !DRY }).then((r) => {
    if (r.status !== 'success') console.error('FALHOU: ' + r.erro);
  });
}
module.exports = { main, agregar, interpretar, montarTexto, semanaIso, intervaloDaSemana };
