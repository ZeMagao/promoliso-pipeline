#!/usr/bin/env node
// Harness do promo-vigia. Offline, sem tocar no banco nem no Telegram.
//
// O que precisa provar — e cada item aqui é uma falha que JÁ aconteceu de verdade:
//   1. Workflow desligado pela UI vira alerta GRAVE (foi assim que a conta ficou 23 dias muda,
//      25/08 → 17/09, sem ninguém perceber).
//   2. "Sem publicar" escala com o tempo: 26 h avisa, 48 h é grave, 72 h é crítico.
//   3. A MESMA situação não repete a cada rodada — foram 44 e-mails idênticos que treinaram o
//      dono a ignorar o alarme. Repete no máximo 1×/dia, e só quando grave.
//   4. Piorar manda na hora (aviso → grave não espera o dia virar).
//   5. Voltar ao normal manda "resolvido" — alarme que não desarma vira ruído também.
//   6. Semana inteira sem nada manda "tudo certo": silêncio total tem que ser suspeito, senão o
//      alarme quebrado se parece com sistema saudável.
//
//   node vps/bin/test_promo_vigia.cjs
const { avaliar, decidir, NIVEL, REPETIR_H, HEARTBEAT_DIAS } = require('./promo-vigia.cjs');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
}

const H = 3600 * 1000;
const SAUDAVEL = {
  n8n_ativo: true,
  healthz_ok: true,
  servicos: [{ nome: 'promo-renderer', ativo: true }, { nome: 'promo-cdn', ativo: true }],
  workflows: [
    { id: 'NL8eVLKErgnIXBQq', nome: 'Produtor', ativo: true, draft_igual_publicado: true },
    { id: 'E27F7yVdsZRj', nome: 'Publicador', ativo: true, draft_igual_publicado: true },
  ],
  horas_sem_post: 5,
  posts_7d: 9,
  publicaveis: 2,
  disco_pct: 40,
};
const com = (mudanca) => Object.assign({}, SAUDAVEL, mudanca);
const nivelDe = (probs, chave) => (probs.find((p) => p.chave === chave) || {}).nivel || 'ok';

// 1. o caso de 25/08
ok('dia saudável não gera problema', avaliar(SAUDAVEL).length === 0,
  JSON.stringify(avaliar(SAUDAVEL).map((p) => p.chave)));
const desligado = avaliar(com({
  workflows: [{ id: 'NL8eVLKErgnIXBQq', nome: 'Produtor', ativo: false, draft_igual_publicado: true }],
}));
ok('produtor desligado pela UI é GRAVE', nivelDe(desligado, 'wf_NL8eVLKErgnIXBQq') === 'grave');
const meioDeploy = avaliar(com({
  workflows: [{ id: 'E27F7yVdsZRj', nome: 'Publicador', ativo: true, draft_igual_publicado: false }],
}));
ok('draft ≠ publicado é aviso', nivelDe(meioDeploy, 'wf_E27F7yVdsZRj') === 'aviso');

// 2. escada do "sem publicar"
ok('25 h ainda não alarma', nivelDe(avaliar(com({ horas_sem_post: 25 })), 'sem_post') === 'ok');
ok('26 h avisa', nivelDe(avaliar(com({ horas_sem_post: 26 })), 'sem_post') === 'aviso');
ok('48 h é grave', nivelDe(avaliar(com({ horas_sem_post: 48 })), 'sem_post') === 'grave');
ok('72 h é crítico', nivelDe(avaliar(com({ horas_sem_post: 100 })), 'sem_post') === 'critico');
ok('533 h (o caso real) é crítico', nivelDe(avaliar(com({ horas_sem_post: 533 })), 'sem_post') === 'critico');

// n8n fora do ar é o pior caso: o watchdog velho morria junto e ninguém saberia
ok('n8n parado é crítico', nivelDe(avaliar(com({ n8n_ativo: false })), 'n8n') === 'critico');
ok('healthz mudo é crítico', nivelDe(avaliar(com({ healthz_ok: false })), 'n8n') === 'critico');
ok('serviço parado é grave', nivelDe(avaliar(com({
  servicos: [{ nome: 'promo-cdn', ativo: false }],
})), 'svc_promo-cdn') === 'grave');
ok('fila vazia avisa', nivelDe(avaliar(com({ publicaveis: 0 })), 'fila_vazia') === 'aviso');

// 3, 4, 5. a parte que separa alarme de ruído
const t0 = Date.parse('2026-09-17T12:00:00Z');
const probGrave = avaliar(com({ horas_sem_post: 50 }));
const d1 = decidir({ chaves: {}, ultimo_envio: 0 }, probGrave, t0, {});
ok('primeira vez manda', d1.enviar && d1.novos.length === 1);

const d2 = decidir(d1.novoEstado, probGrave, t0 + 6 * H, {});
ok('mesma situação 6 h depois NÃO repete', !d2.enviar, JSON.stringify(d2.novos.map((p) => p.chave)));

const d3 = decidir(d1.novoEstado, probGrave, t0 + (REPETIR_H + 1) * H, {});
ok(`mesma situação após ${REPETIR_H} h manda um lembrete`, d3.enviar && d3.lembretes.length === 1);

const probAviso = avaliar(com({ horas_sem_post: 30 }));
const dA = decidir({ chaves: {}, ultimo_envio: 0 }, probAviso, t0, {});
const dB = decidir(dA.novoEstado, probAviso, t0 + (REPETIR_H + 1) * H, {});
ok('aviso que não piora nunca vira lembrete', !dB.enviar);
const dC = decidir(dA.novoEstado, avaliar(com({ horas_sem_post: 50 })), t0 + 2 * H, {});
ok('aviso que PIORA para grave manda na hora', dC.enviar && dC.novos.length === 1);

const dOk = decidir(d1.novoEstado, [], t0 + 8 * H, {});
ok('voltar ao normal manda "resolvido"', dOk.enviar && dOk.resolvidos.length === 1, JSON.stringify(dOk.resolvidos));
const dOk2 = decidir(dOk.novoEstado, [], t0 + 9 * H, {});
ok('depois de resolvido, silêncio', !dOk2.enviar);

// 6. prova de vida semanal
const semNada = { chaves: {}, ultimo_envio: t0 };
ok('3 dias de silêncio não geram heartbeat', !decidir(semNada, [], t0 + 3 * 24 * H, {}).enviar);
const hb = decidir(semNada, [], t0 + (HEARTBEAT_DIAS + 1) * 24 * H, {});
ok(`${HEARTBEAT_DIAS} dias sem nada manda "tudo certo"`, hb.enviar && hb.heartbeat);

// o estado tem que guardar desde quando o problema existe (para a mensagem não mentir a duração)
const dD = decidir(d1.novoEstado, probGrave, t0 + 30 * H, {});
ok('o "desde" do problema não é reescrito a cada rodada',
  dD.novoEstado.chaves.sem_post.desde === d1.novoEstado.chaves.sem_post.desde);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
