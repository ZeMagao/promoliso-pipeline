#!/usr/bin/env node
// RF-05 — versionamento de prompts, templates e regras editoriais.
//
//   node analytics/registrar-versoes.cjs                    # registra o que está no ar e acusa drift
//   node analytics/registrar-versoes.cjs --listar           # só mostra, não grava
//   node analytics/registrar-versoes.cjs --adotar=baseline  # carimba o conteúdo ATUAL com um rótulo
//
// COMO O ROLLBACK FUNCIONA (é a pergunta que o PRD faz e que precisa de resposta operacional):
//  1. o conteúdo de cada artefato vive em `workflow_entity.nodes` e cada deploy grava uma linha em
//     `workflow_history` — o histórico REAL já existe, feito pelos design/patch_*.cjs;
//  2. este script guarda, por artefato, o hash + o rótulo + quando ele esteve no ar;
//  3. reverter = deployar o conteúdo antigo (patch_*.cjs / restaurar o versionId de
//     `workflow_history`, ver OPERACAO-VPS.md). O hash volta a bater com o rótulo antigo sozinho —
//     não há um segundo lugar para "desfazer" e ficar inconsistente.
//
// `--adotar` é o passo de partida: sem uma linha de base, todo hash aparece como NAO-REGISTRADA.
const fs = require('fs');
const cfg = require('./config.cjs');
const { abrirEnvolvido, agoraUtc } = require('./lib/db.cjs');
const { NOVAS } = require('./lib/schema.cjs');
const tab = require('./lib/tabela.cjs');
const versoes = require('./lib/versoes.cjs');
const log = require('./lib/log.cjs');

const DRY = process.argv.includes('--dry');
const LISTAR = process.argv.includes('--listar');
const adotar = (process.argv.find((a) => a.startsWith('--adotar=')) || '').split('=')[1] || '';

async function main({ logger }) {
  const w = await abrirEnvolvido(cfg.db, DRY || LISTAR);
  try {
    const inspecao = await versoes.inspecionar(w, cfg.workflows);

    console.log('artefato'.padEnd(20) + 'rótulo'.padEnd(16) + 'hash-lógica'.padEnd(14) + 'tam'.padStart(8) + '  nó');
    console.log('-'.repeat(96));
    for (const i of inspecao) {
      if (!i.presente) { console.log(`${i.chave.padEnd(20)}AUSENTE  ${i.motivo}`); continue; }
      console.log(`${i.chave.padEnd(20)}${i.rotulo.padEnd(16)}${i.curto.padEnd(14)}${String(i.tamanho).padStart(8)}  ${i.no}`);
    }

    if (LISTAR) return { listado: inspecao.length };

    if (adotar) {
      const registry = versoes.lerRegistry();
      registry.artefatos = registry.artefatos || {};
      let novos = 0;
      for (const i of inspecao) {
        if (!i.presente) continue;
        registry.artefatos[i.chave] = registry.artefatos[i.chave] || {};
        if (!registry.artefatos[i.chave][i.curto]) { registry.artefatos[i.chave][i.curto] = adotar; novos++; }
      }
      registry.atualizado_em = new Date().toISOString();
      if (DRY) {
        console.log(`\nDRY — ${novos} hash(es) seriam carimbados como "${adotar}".`);
      } else {
        fs.writeFileSync(versoes.REGISTRY, JSON.stringify(registry, null, 2) + '\n');
        console.log(`\n${novos} hash(es) carimbados como "${adotar}" em ${versoes.REGISTRY}`);
        console.log('COMMITE esse arquivo: é o que liga hash a rótulo humano.');
      }
      return { adotados: novos, rotulo: adotar };
    }

    if (!(await tab.existeTabela(w, NOVAS.versoes.id))) {
      throw new Error('promoliso_versoes não existe — rode "node analytics/migrate.cjs up" antes');
    }

    const t = agoraUtc();
    const vistos = [];
    for (const i of inspecao) {
      if (!i.presente) { logger.aviso('artefato ausente', JSON.stringify({ artefato: i.chave, motivo: i.motivo })); continue; }
      const chave = `${i.chave}:${i.curto}`;
      vistos.push(chave);
      if (DRY) continue;
      // primeira_vez_em só é gravado na criação (somenteVazios não serve: ultima_vez_em muda sempre)
      const ja = (await tab.ler(w, NOVAS.versoes.id, 'versao_key=?', [chave]))[0];
      await tab.upsert(w, {
        dataTableId: NOVAS.versoes.id, chave: 'versao_key', valorChave: chave,
        campos: {
          artefato: i.chave,
          rotulo: i.rotulo,
          hash: i.hash,
          workflow_id: i.workflow_id,
          no: i.no,
          primeira_vez_em: (ja && ja.primeira_vez_em) || t,
          ultima_vez_em: t,
          ativa: 1,
          observacao: i.publicado ? '' : 'ATENÇÃO: draft != publicado neste workflow',
        },
      });
    }

    // tudo que não foi visto agora deixou de estar no ar
    if (!DRY) {
      const todas = await tab.ler(w, NOVAS.versoes.id);
      for (const r of todas) {
        if (vistos.includes(String(r.versao_key)) || String(r.ativa) !== '1') continue;
        await tab.upsert(w, {
          dataTableId: NOVAS.versoes.id, chave: 'versao_key', valorChave: r.versao_key,
          campos: { ativa: 0 },
        });
      }
    }

    const drift = inspecao.filter((i) => i.presente && i.rotulo === 'NAO-REGISTRADA');
    if (drift.length) {
      logger.aviso('conteúdo no ar sem rótulo registrado', JSON.stringify({ artefatos: drift.map((d) => `${d.chave}@${d.curto}`) }));
      log.alertar('[PromoLiso] versão de prompt/template não registrada',
        'Estes artefatos estão no ar com conteúdo que não consta em analytics/versoes/registry.json:\n' +
        drift.map((d) => ` - ${d.chave} @ ${d.curto} (nó "${d.no}")`).join('\n') +
        '\n\nSe a mudança foi proposital, rode:\n  node analytics/registrar-versoes.cjs --adotar=<rotulo>\ne commite o registry.json.');
    }

    const draftSujo = inspecao.filter((i) => i.presente && !i.publicado);
    if (draftSujo.length) {
      logger.aviso('workflow com draft diferente do publicado', JSON.stringify({ nos: draftSujo.map((d) => d.no) }));
    }

    logger.info('resumo', JSON.stringify({ artefatos: inspecao.length, registrados: vistos.length, drift: drift.length }));
    return { artefatos: inspecao.length, registrados: vistos.length, drift: drift.length };
  } finally {
    await w.fechar();
  }
}

if (require.main === module) {
  log.envolver('registrar-versoes', main, { registrar: !DRY }).then((r) => {
    if (r.status !== 'success') console.error('FALHOU: ' + r.erro);
  });
}
module.exports = { main };
