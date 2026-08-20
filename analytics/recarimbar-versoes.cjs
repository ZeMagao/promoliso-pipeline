#!/usr/bin/env node
// CONSERTO DE DADOS — refaz o carimbo de versão das publicações antigas.
//
//   node analytics/recarimbar-versoes.cjs            # dry-run (padrão): mostra o que mudaria
//   node analytics/recarimbar-versoes.cjs --aplicar
//
// POR QUE ISTO EXISTE. Até 20/08 o `coletor-publicacoes.cjs` reescrevia `prompt_versao`,
// `template_versao` e `regras_versao` a CADA coleta, com a versão viva naquele momento (o
// `somenteVazios` não era passado e o default é false). Então o carimbo de um post não dizia "que
// versão produziu este post", dizia "que versão estava no ar na última vez que o coletor rodou".
//
// O sintoma em produção: as 15 publicações da semana W33 estavam todas com o MESMO template_versao,
// e a seção "por template" do relatório semanal — que existe para provar que arte nova mudou o
// alcance — comparava um rótulo com ele mesmo. O coletor já está consertado; isto conserta o
// passado.
//
// DE ONDE SAI A VERDADE. A tabela `promoliso_versoes` (RF-05) guarda, por artefato, cada hash com
// `primeira_vez_em` e `ultima_vez_em`. Ela é alimentada por `registrar-versoes.cjs`, que roda por
// timer diário — então existe um registro durável de qual hash estava no ar em cada dia, mesmo
// depois de o n8n podar `workflow_history` (que hoje guarda só 2 versões do produtor: o histórico de
// deploy é efêmero, o de artefato não).
//
// ⚠️ GRANULARIDADE DIÁRIA, E ISSO IMPORTA. A amostragem é uma vez por dia. Se um deploy aconteceu às
// 11h e um post saiu às 12:30 do mesmo dia, a janela pode apontar a versão anterior. O script marca
// esses casos como `INCERTO` em vez de escolher em silêncio, e por padrão NÃO os grava — pedir
// `--incluir-incertos` é uma decisão explícita. Preferir um buraco declarado a um número inventado é
// a razão de o relatório existir.
//
// Nunca inventa: post sem janela que o cubra fica como está, e o motivo é impresso.
const cfg = require('./config.cjs');
const { abrirEnvolvido, agoraUtc } = require('./lib/db.cjs');
const { NOVAS } = require('./lib/schema.cjs');
const tab = require('./lib/tabela.cjs');
const versoes = require('./lib/versoes.cjs');
const log = require('./lib/log.cjs');

const APLICAR = process.argv.includes('--aplicar');
const INCERTOS = process.argv.includes('--incluir-incertos');

// as três colunas que o coletor corrompia, e de que artefatos cada uma é feita
const COMPOSICAO = {
  prompt_versao: ['prompt_redator'],
  template_versao: ['template_slide', 'template_capa'],
  regras_versao: ['regras_validador', 'regras_legenda', 'regras_fila'],
};

const ms = (v) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : null; };
const DIA = 86400000;

// Qual hash de `artefato` estava no ar em `quando`, segundo as janelas.
// Devolve { curto, rotulo, certeza: 'CERTO' | 'INCERTO' | null, motivo }
//
// O RÓTULO VEM DO REGISTRY, não da coluna `rotulo` da tabela de janelas. Aquela coluna guarda o que
// o registry dizia NA AMOSTRAGEM, então um hash rotulado depois continua gravado lá como
// `NAO-REGISTRADA` — foi o que aconteceu na 1ª execução deste script em 20/08, que recarimbou 13
// linhas com rótulo velho. Hash é imutável; rótulo é uma decisão que pode mudar depois. Resolver
// pelo registry a cada execução é o que faz um `--adotar` posterior valer para o passado também.
function vigenteEm(janelas, artefato, quando, registry) {
  const conhecidas = (registry.artefatos && registry.artefatos[artefato]) || {};
  const rotuloDe = (hash) => conhecidas[String(hash).slice(0, 12)] || 'NAO-REGISTRADA';
  const cand = janelas.filter((j) => j.artefato === artefato);
  if (!cand.length) return { certeza: null, motivo: 'nenhuma janela para ' + artefato };

  const dentro = cand.filter((j) => {
    const de = ms(j.primeira_vez_em); const ate = ms(j.ultima_vez_em);
    if (de === null) return false;
    // janela da versão ATIVA não tem fim: vale até agora
    const fim = String(j.ativa) === '1' ? Date.now() : (ate === null ? de : ate);
    return quando >= de && quando <= fim;
  });

  if (dentro.length === 1) {
    const j = dentro[0];
    // a amostragem é diária: se o post saiu a menos de um dia da borda da janela, um deploy no
    // mesmo dia pode ter passado sem ser amostrado
    const de = ms(j.primeira_vez_em);
    const perto = Math.abs(quando - de) < DIA;
    return {
      curto: String(j.hash).slice(0, 12), rotulo: rotuloDe(j.hash),
      certeza: perto ? 'INCERTO' : 'CERTO',
      motivo: perto ? 'a menos de 24 h do início da janela (amostragem é diária)' : '',
    };
  }
  if (dentro.length > 1) {
    // duas janelas cobrindo o mesmo instante = houve troca no dia; não há como desempatar
    const ultima = dentro[dentro.length - 1];
    return { certeza: 'INCERTO', motivo: dentro.length + ' janelas cobrem esse instante',
      curto: String(ultima.hash).slice(0, 12), rotulo: rotuloDe(ultima.hash) };
  }
  // antes da primeira amostragem do analytics (instalado em 07/08) não há como saber
  const primeira = Math.min(...cand.map((j) => ms(j.primeira_vez_em)).filter((x) => x !== null));
  return { certeza: null,
    motivo: quando < primeira ? 'publicado antes da 1ª amostragem do analytics' : 'nenhuma janela cobre o instante' };
}

async function main({ logger }) {
  const w = await abrirEnvolvido(cfg.db, !APLICAR);
  try {
    if (!(await tab.existeTabela(w, NOVAS.versoes.id))) {
      throw new Error('promoliso_versoes não existe — rode "node analytics/migrate.cjs up" antes');
    }
    const janelas = await tab.ler(w, NOVAS.versoes.id);
    const registry = versoes.lerRegistry();
    // instante da amostragem mais recente: separa "hash que já esteve no ar" de "hash que entrou
    // depois da última passada do timer diário"
    const ultimaAmostragem = janelas.reduce((m, j) => Math.max(m, ms(j.ultima_vez_em) || 0), 0) || null;
    const pubs = (await tab.ler(w, cfg.tabelas.publicacoes))
      .filter((p) => p.published_at)
      .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));

    console.log(`janelas de versão: ${janelas.length} | publicações com data: ${pubs.length}\n`);

    const resumo = { certo: 0, incerto: 0, semJanela: 0, igual: 0, gravadas: 0, colunas: 0, retidas: 0 };
    for (const p of pubs) {
      const quando = ms(p.published_at);
      if (quando === null) { resumo.semJanela++; continue; }

      // A INCERTEZA É POR COLUNA, NÃO POR LINHA. A 1ª versão retinha a linha inteira quando um só
      // artefato era incerto, e o efeito era pior do que não fazer nada: em 10 linhas de 18-19/08 só
      // `regras_fila` era duvidoso, então `prompt_versao` e `template_versao` — esses CERTOS —
      // ficaram com o valor antigo, que era COMPROVADAMENTE IMPOSSÍVEL (hash de um deploy de 20/08
      // estampado em post de 18/08). Deixar valor impossível para não escrever valor incerto é a
      // troca errada.
      const campos = {};
      const incertas = new Set();
      const notas = [];
      for (const [coluna, artefatos] of Object.entries(COMPOSICAO)) {
        const partes = [];
        let ok = true;
        for (const a of artefatos) {
          const v = vigenteEm(janelas, a, quando, registry);
          if (!v.certeza) { ok = false; notas.push(`${coluna}/${a}: ${v.motivo}`); break; }
          if (v.certeza === 'INCERTO') { incertas.add(coluna); notas.push(`${coluna}/${a}: ${v.motivo}`); }
          partes.push(`${a}=${v.rotulo}@${v.curto}`);
        }
        if (ok) campos[coluna] = partes.join(' ');
      }
      const incertoNaLinha = incertas.size > 0;

      // O valor GRAVADO é impossível? Se a coluna cita um hash cuja janela só começou DEPOIS da
      // publicação, aquele carimbo não pode ter produzido o post — é o rastro exato do bug do
      // coletor. Nesse caso um valor incerto-mas-possível é estritamente melhor do que manter um
      // valor certo-e-falso, então a retenção por incerteza é suspensa para aquela coluna.
      const impossivel = (valor) => (String(valor || '').match(/@([0-9a-f]{12})/g) || []).some((m) => {
        const h = m.slice(1);
        const j = janelas.find((x) => String(x.hash).slice(0, 12) === h);
        if (j) return ms(j.primeira_vez_em) !== null && ms(j.primeira_vez_em) > quando;
        // Hash SEM janela nenhuma: ele nunca esteve no ar em instante de amostragem, ou seja entrou
        // depois da última. Então não pode ter produzido um post publicado antes dela. É inferência,
        // não leitura direta — por isso depende de a amostragem ter mesmo coberto o período.
        return ultimaAmostragem !== null && quando < ultimaAmostragem;
      });

      const nada = !Object.keys(campos).length;
      const mudou = Object.entries(campos).filter(([k, v]) => String(p[k] || '') !== v);
      if (nada) { resumo.semJanela++; }
      else if (incertoNaLinha) { resumo.incerto++; }
      else { resumo.certo++; }
      if (!nada && !mudou.length) resumo.igual++;

      const marca = nada ? 'SEM-JANELA' : (incertoNaLinha ? 'INCERTO   ' : 'CERTO     ');
      if (mudou.length || nada) {
        console.log(`${marca} ${String(p.published_at).slice(0, 16)}  ${String(p.content_key).slice(-42)}`);
        for (const [k, v] of mudou) {
          console.log(`            ${k}:`);
          console.log(`              de : ${String(p[k] || '(vazio)').slice(0, 88)}`);
          console.log(`              para: ${String(v).slice(0, 88)}`);
        }
        for (const n of notas) console.log(`            ~ ${n}`);
        for (const [k] of mudou) {
          if (incertas.has(k) && impossivel(p[k])) {
            console.log(`            ! ${k}: o valor gravado é IMPOSSÍVEL (hash de janela posterior`
              + ' à publicação) — troca mesmo sendo incerto');
          }
        }
      }

      // grava as colunas CERTAS sempre; as incertas só com --incluir-incertos
      const aGravar = mudou.filter(([k]) => !incertas.has(k) || INCERTOS || impossivel(p[k]));
      if (aGravar.length && APLICAR) {
        await tab.upsert(w, {
          dataTableId: cfg.tabelas.publicacoes,
          chave: 'content_key',
          valorChave: p.content_key,
          campos: Object.fromEntries(aGravar),
          carimbos: [],
        });
        resumo.gravadas++;
        resumo.colunas += aGravar.length;
      }
      resumo.retidas += mudou.length - aGravar.length;
    }

    console.log('\n' + JSON.stringify(resumo));
    if (!APLICAR) {
      console.log('DRY — nada gravado. Rode com --aplicar.');
      if (resumo.retidas) console.log(`${resumo.retidas} coluna(s) INCERTAS ficam de fora; --incluir-incertos as grava.`);
    }
    logger.info('resumo', JSON.stringify(resumo));
    return resumo;
  } finally {
    await w.fechar();
  }
}

if (require.main === module) {
  log.envolver('recarimbar-versoes', main, { registrar: APLICAR }).then((r) => {
    if (r.status !== 'success') console.error('FALHOU: ' + r.erro);
  });
}
module.exports = { main, vigenteEm, COMPOSICAO };
