#!/usr/bin/env node
// FALHA SILENCIOSA DE NÓ — alerta quando um nó erra dentro de uma execução que terminou `success`.
//
//   node analytics/verificar-nos-com-erro.cjs [--dry] [--horas=48] [--verbose]
//
// O CASO QUE MOTIVOU, MEDIDO EM 20/08. A cota do Tavily estourou em 18/08 23:00. Desde então TODA
// busca do redator devolveu erro — 138 buscas com erro contra 60 boas na janela retida — e o agente,
// sem saber que a ferramenta morreu, reformulava a consulta e tentava de novo: 17 vezes numa única
// pauta. Cada tentativa reenvia ~15.800 tokens. Custo por rodada saiu de $0,264 para $0,427.
//
// E NADA ALERTOU, por três motivos que este script cobre:
//  1. a execução termina `success` — erro de nó de ferramenta não derruba o workflow, então o
//     Monitor de erros (que dispara em status de erro) não vê;
//  2. o watchdog procura padrão de cota em `promoliso_curadoria_ai`, ou seja no CURADOR, e este erro
//     é do REDATOR;
//  3. o padrão do watchdog é /rate.?limit|insufficient_quota|exceeded your current quota|too many
//     requests/ e o Tavily diz "exceeds your plan's set usage limit" — não casa.
//
// POR QUE FORA DO n8n. Mesmo motivo do resto do analytics (RF-03) e do promo-fila-writeback: inserir
// nó no monitor exige religar conexões, e cirurgia de workflow é o que quebrou a publicação por 3
// dias em 05/08. Rodando de fora, o pior caso deste script é ele mesmo falhar.
//
// PRAZO: `execution_data` é podado em 168 h. Rodando por timer diário o script sempre alcança a
// execução enquanto ela existe.
//
// O QUE É ALERTADO: nó cujo erro é PADRÃO, não acidente. Um erro isolado em 20 chamadas é ruído
// (rede, timeout) e não vira e-mail; um nó que erra na maioria das chamadas está fora do ar. Os dois
// limites estão em PISO_CHAMADAS e FRACAO_MINIMA.
const cfg = require('./config.cjs');
const { abrirEnvolvido } = require('./lib/db.cjs');
const log = require('./lib/log.cjs');

const DRY = process.argv.includes('--dry');
const VERBOSE = process.argv.includes('--verbose');
const HORAS = Number((process.argv.find((a) => a.startsWith('--horas=')) || '').split('=')[1] || 48);

// Um erro em muitas chamadas é ruído; a maioria com erro é ferramenta fora do ar.
const PISO_CHAMADAS = 3;      // menos que isso não dá para distinguir padrão de acidente
const FRACAO_MINIMA = 0.5;    // metade ou mais das chamadas com erro

// FALHAS CONHECIDAS E ACEITAS, COM PRAZO.
//
// Por que isto existe: alerta que grita todo dia por condição que o dono já conhece e decidiu não
// resolver agora ENSINA A IGNORAR ALERTA — e aí o detector perde justamente o valor de existir. Já
// aconteceu neste projeto em 11/08, quando o watchdog gritou cota da OpenAI por causa de um path de
// SVG e o alerta passou a ser lido como ruído.
//
// TRÊS REGRAS DE DESENHO, cada uma consertando um jeito de silenciamento virar ponto cego:
//
//  1. `ate` é OBRIGATÓRIO e o silêncio expira sozinho. Não existe flag que alguém precise lembrar de
//     desligar — passada a data, o alerta volta por conta própria.
//  2. Silencia o PAR (nó + mensagem), nunca o nó inteiro. Silenciar `Busca detalhada` por completo
//     esconderia um erro DIFERENTE do mesmo nó; a mensagem tem de casar.
//  3. O que está silenciado aparece SEMPRE na saída e no log, e entra no corpo de qualquer e-mail
//     que for enviado por outro motivo. Silêncio invisível é o mesmo buraco de novo.
const SILENCIADOS = [
  {
    no: 'Busca detalhada',
    // a frase exata que o Tavily devolve ao estourar as 1000 requisições do plano gratuito
    mensagem: /exceeds your plan's set usage limit/i,
    ate: '2026-09-01',
    motivo: 'plano gratuito do Tavily (1000 req/mes) estourou em 18/08; dono decidiu esperar o reset',
  },
];

const hoje = new Date().toISOString().slice(0, 10);

// Devolve o silenciamento VIGENTE que cobre este nó+mensagem, ou null.
function silenciamentoDe(nome, mensagens) {
  for (const s of SILENCIADOS) {
    if (s.no !== nome) continue;
    if (s.ate <= hoje) continue;                       // venceu: volta a alertar sozinho
    const msgs = [...mensagens];
    // TODAS as mensagens do nó têm de casar. Se apareceu uma mensagem nova junto, é outra falha
    // escondida atrás da mesma ferramenta — e essa tem de alertar.
    if (msgs.length && msgs.every((m) => s.mensagem.test(m))) return s;
  }
  return null;
}

// Lê o pool `flatted` resolvendo UM nível por vez. Expandir o pool inteiro estoura a memória: ele
// deduplica referências, e expandir transforma o grafo em árvore (o kernel matou o processo na
// primeira versão desta análise). O teto `< N` evita tratar um id numérico-como-string como índice.
function leitor(pool) {
  const N = pool.length;
  const res = (x) => (typeof x === 'string' && /^[0-9]+$/.test(x) && Number(x) < N ? pool[Number(x)] : x);
  const campo = (o, k) => {
    const obj = res(o);
    return obj && typeof obj === 'object' && !Array.isArray(obj) && k in obj ? res(obj[k]) : undefined;
  };
  return { res, campo };
}

async function main({ logger }) {
  const w = await abrirEnvolvido(cfg.db, true);      // só leitura: este script nunca escreve
  try {
    const desde = new Date(Date.now() - HORAS * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    const execs = await w.all(
      "SELECT id, workflowId, status, startedAt FROM execution_entity "
      + 'WHERE startedAt >= ? ORDER BY id DESC', [desde],
    );

    // nó -> { chamadas, erros, mensagens:Set, execs:Set, workflows:Set }
    const porNo = new Map();
    let lidas = 0;
    for (const e of execs) {
      const row = await w.get('SELECT data FROM execution_data WHERE executionId=?', [e.id]);
      if (!row || !row.data) continue;
      let pool;
      try { pool = JSON.parse(row.data); } catch (err) { continue; }
      const { res, campo } = leitor(pool);
      const rd = campo(campo(pool[0], 'resultData'), 'runData');
      if (!rd || typeof rd !== 'object') continue;
      lidas++;

      for (const nome of Object.keys(rd)) {
        const corridas = res(rd[nome]);
        if (!Array.isArray(corridas)) continue;
        const reg = porNo.get(nome) || {
          chamadas: 0, erros: 0, mensagens: new Set(), execs: new Set(), workflows: new Set(),
        };
        for (const c of corridas) {
          reg.chamadas++;
          if (campo(c, 'executionStatus') !== 'error') continue;
          reg.erros++;
          reg.execs.add(e.id);
          reg.workflows.add(e.workflowId);
          // a descrição real do erro (a mensagem de cota, por exemplo) mora no metadado do nó,
          // não no resultado devolvido ao modelo
          const err = campo(c, 'error');
          const desc = campo(err, 'description') || campo(err, 'message') || '';
          if (typeof desc === 'string' && desc) reg.mensagens.add(desc.slice(0, 220));
        }
        porNo.set(nome, reg);
      }
      pool = null;
    }

    const emPadrao = [...porNo.entries()]
      .filter(([, r]) => r.erros >= PISO_CHAMADAS && r.erros / r.chamadas >= FRACAO_MINIMA)
      .sort((a, b) => b[1].erros - a[1].erros);

    const calados = [];
    const suspeitos = [];
    for (const [nome, r] of emPadrao) {
      const s = silenciamentoDe(nome, r.mensagens);
      if (s) calados.push([nome, r, s]); else suspeitos.push([nome, r]);
    }

    if (VERBOSE) {
      for (const [nome, r] of [...porNo.entries()].filter(([, r]) => r.erros)) {
        console.log(`  ${nome}: ${r.erros}/${r.chamadas} com erro em ${r.execs.size} execução(ões)`);
      }
    }

    console.log(`execuções na janela de ${HORAS} h: ${execs.length} | com dados: ${lidas}`);
    console.log(`nós com erro em padrão (>=${PISO_CHAMADAS} erros e >=${FRACAO_MINIMA * 100}% das chamadas): ${emPadrao.length}`);
    for (const [nome, r, s] of calados) {
      console.log(`  SILENCIADO até ${s.ate}: ${nome} ${r.erros}/${r.chamadas} — ${s.motivo}`);
      for (const m of r.mensagens) console.log(`     "${m}"`);
    }
    if (suspeitos.length) console.log(`  a alertar: ${suspeitos.length}`);
    for (const [nome, r] of suspeitos) {
      console.log(`  ${nome}: ${r.erros}/${r.chamadas} chamadas com erro, ${r.execs.size} execução(ões)`);
      for (const m of r.mensagens) console.log(`     "${m}"`);
    }

    const resumo = {
      janela_h: HORAS, execucoes: execs.length, lidas,
      em_padrao: emPadrao.length, suspeitos: suspeitos.length, silenciados: calados.length,
      nos: suspeitos.map(([n, r]) => `${n}=${r.erros}/${r.chamadas}`),
      calados: calados.map(([n, r, s]) => `${n}=${r.erros}/${r.chamadas} ate ${s.ate}`),
    };

    // o silenciado vai pro log mesmo sem e-mail: é o registro de que algo está sendo abafado
    for (const [nome, r, s] of calados) {
      logger.info('falha conhecida silenciada', JSON.stringify({
        no: nome, erros: r.erros, chamadas: r.chamadas, ate: s.ate, motivo: s.motivo,
      }));
    }
    if (!suspeitos.length) { logger.info('resumo', JSON.stringify(resumo)); return resumo; }

    const corpo = 'Nó(s) errando DENTRO de execuções que terminaram success — o Monitor de erros não\n'
      + 'vê isso, porque nada derruba o workflow.\n\n'
      + suspeitos.map(([nome, r]) => ` - ${nome}: ${r.erros} de ${r.chamadas} chamadas com erro, em `
        + `${r.execs.size} execução(ões) [${[...r.workflows].join(', ')}]\n`
        + [...r.mensagens].map((m) => `     "${m}"`).join('\n')).join('\n')
      + `\n\nJanela: últimas ${HORAS} h (${lidas} execuções com dados).`
      + (calados.length
        ? '\n\nSILENCIADO neste momento (nao gerou alerta, e volta a alertar sozinho na data):\n'
          + calados.map(([n, r, s]) => ` - ${n}: ${r.erros}/${r.chamadas} até ${s.ate} — ${s.motivo}`).join('\n')
        : '')
      + '\n\nPor que isto importa em custo: quando a ferramenta de busca do redator erra, o agente'
      + '\nreformula a consulta e tenta de novo, e cada tentativa reenvia a linha de base inteira'
      + '\n(~15.800 tokens). Em 19-20/08 isso deu 17 buscas numa única pauta.'
      + '\n\nAção: conferir cota/credencial da ferramenta apontada acima.';

    if (DRY) {
      console.log('\nDRY — e-mail NÃO enviado. Corpo que iria:\n' + corpo);
      return { ...resumo, alertado: false, dry: true };
    }
    const r = log.alertar('PromoLiso: no errando dentro de execucao success', corpo);
    logger.aviso('alerta de no com erro', JSON.stringify({ ...resumo, envio: r }));
    return { ...resumo, alertado: r.enviado };
  } finally {
    await w.fechar();
  }
}

if (require.main === module) {
  log.envolver('verificar-nos-com-erro', main, { registrar: !DRY }).then((r) => {
    if (r.status !== 'success') console.error('FALHOU: ' + r.erro);
  });
}
module.exports = { main, PISO_CHAMADAS, FRACAO_MINIMA, leitor, SILENCIADOS, silenciamentoDe };
