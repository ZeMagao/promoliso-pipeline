#!/usr/bin/env node
// RF-05, complemento — DATA cada versão de artefato, para saber que rótulo é honesto dar a ela.
//
//   node analytics/datar-versoes.cjs                  # linha do tempo de todos os artefatos
//   node analytics/datar-versoes.cjs template_capa    # só um artefato
//
// POR QUE ISTO EXISTE. O `registrar-versoes.cjs --adotar=<rotulo>` carimba TODOS os hashes órfãos
// com o MESMO rótulo. Isso serve para adotar uma linha de base e MENTE quando os órfãos são de ondas
// diferentes — foi o caso em 20/08: sete órfãos, três de 18-19/08 e quatro do deploy daquele dia. Um
// rótulo único juntaria ondas distintas e o relatório semanal passaria a comparar coisas que não
// aconteceram juntas, que é o oposto do "uma variável por vez" do PRD §8.3.
//
// A FONTE É A TABELA DE JANELAS, NÃO O HISTÓRICO DO n8n.
// `promoliso_versoes` guarda, por artefato, cada hash com `primeira_vez_em`/`ultima_vez_em`,
// alimentada pelo timer diário do `registrar-versoes.cjs`. É a única fonte durável.
//
// ⚠️ A primeira versão deste script usava `workflow_history` e ISSO ESTAVA ERRADO: o n8n poda essa
// tabela, e em 20/08 ela tinha só 2 versões por workflow. Resultado — todo artefato aparecia com a
// data do deploy mais antigo que sobrou, inclusive os que não mudavam há dias (`prompt_curador`
// aparecia como "hoje" sendo de 10/08). Data de tabela podada não é data. O histórico continua sendo
// lido, mas só como COMPLEMENTO, para dizer qual deploy introduziu o hash — e com aviso quando ele
// está curto demais para ser confiável.
//
// ⚠️ FUSO: `workflow_history.createdAt` é gravado pelos patches em hora LOCAL (`getHours()`) e
// `promoliso_versoes` em UTC. Cada bloco abaixo diz qual está usando. Ver OPERACAO-VPS.md.
//
// Só leitura: nunca escreve no banco nem no registry.
const cfg = require('./config.cjs');
const { abrirEnvolvido } = require('./lib/db.cjs');
const { NOVAS } = require('./lib/schema.cjs');
const tab = require('./lib/tabela.cjs');
const versoes = require('./lib/versoes.cjs');

const alvo = process.argv.slice(2).find((a) => !a.startsWith('--'));

// Quantas versões o histórico precisa ter para a data dele valer algo. Abaixo disso a tabela foi
// podada e a "primeira aparição" é só o começo da janela de retenção.
const HISTORICO_MINIMO = 5;

(async () => {
  const w = await abrirEnvolvido(cfg.db, true);
  try {
    const registry = versoes.lerRegistry();
    const artefatos = versoes.ARTEFATOS.filter((a) => !alvo || a.chave === alvo);
    if (!artefatos.length) {
      console.error('artefato desconhecido: ' + alvo
        + '\nconhecidos: ' + versoes.ARTEFATOS.map((a) => a.chave).join(', '));
      process.exit(1);
    }

    if (!(await tab.existeTabela(w, NOVAS.versoes.id))) {
      throw new Error('promoliso_versoes não existe — rode "node analytics/migrate.cjs up" antes');
    }
    const janelas = await tab.ler(w, NOVAS.versoes.id);

    // complemento: qual deploy introduziu cada hash, quando o histórico ainda o alcança
    const deployPorHash = new Map();
    const historicoCurto = [];
    for (const wfChave of ['produtor', 'publicador']) {
      const wfId = cfg.workflows[wfChave];
      if (!wfId) continue;
      const hist = await w.all(
        'SELECT versionId, createdAt, description, nodes FROM workflow_history WHERE workflowId=? ORDER BY createdAt ASC',
        [wfId],
      );
      if (hist.length < HISTORICO_MINIMO) historicoCurto.push(`${wfChave}: ${hist.length} versão(ões)`);
      for (const v of hist) {
        let nodes;
        try { nodes = JSON.parse(v.nodes); } catch (e) { continue; }
        for (const art of versoes.ARTEFATOS.filter((a) => a.workflow === wfChave)) {
          const no = nodes.find((n) => n.name === art.no);
          const conteudo = no ? versoes.extrairConteudo(no, art.campo) : null;
          if (!conteudo) continue;
          const curto = versoes.sha(versoes.semAssets(conteudo)).slice(0, 12);
          const k = art.chave + ':' + curto;
          if (!deployPorHash.has(k)) {
            deployPorHash.set(k, { quando: String(v.createdAt).slice(0, 16), desc: v.description || '' });
          }
        }
      }
    }

    if (historicoCurto.length) {
      console.log('⚠️  workflow_history está podado (' + historicoCurto.join(', ') + ').');
      console.log('    As datas vêm de promoliso_versoes; a coluna "deploy" só aparece quando o');
      console.log('    histórico ainda alcança aquele hash.\n');
    }

    for (const art of artefatos) {
      const linhas = janelas
        .filter((j) => j.artefato === art.chave)
        .sort((a, b) => String(a.primeira_vez_em).localeCompare(String(b.primeira_vez_em)));

      console.log(`\n## ${art.chave}   (nó "${art.no}" no ${art.workflow})`);
      if (!linhas.length) { console.log('  sem janela registrada — o timer diário ainda não amostrou'); continue; }

      const conhecidas = (registry.artefatos && registry.artefatos[art.chave]) || {};
      // A verdade sobre "o que está no ar" é a INSPEÇÃO do banco, não a coluna `ativa` da tabela de
      // janelas: aquela coluna só é atualizada pelo timer diário, então fica velha depois de um
      // deploy e faria dois hashes aparecerem como no ar ao mesmo tempo. Mesmo vício de confiar em
      // fonte defasada que já tinha derrubado a primeira versão deste script.
      const vivo = (await versoes.inspecionar(w, cfg.workflows)).find((i) => i.chave === art.chave);
      const curtoVivo = vivo && vivo.presente ? vivo.curto : null;
      for (const j of linhas) {
        const curto = String(j.hash).slice(0, 12);
        const rotulo = conhecidas[curto] || 'NAO-REGISTRADA';
        const ativo = curto === curtoVivo ? ' ← NO AR'
          : (String(j.ativa) === '1' ? ' (ativa na última amostragem)' : '');
        const dep = deployPorHash.get(art.chave + ':' + curto);
        console.log('  ' + String(j.primeira_vez_em).slice(0, 10) + ' → ' + String(j.ultima_vez_em).slice(0, 10)
          + '  ' + curto + '  ' + rotulo.padEnd(22) + ativo
          + (dep ? '   [deploy ' + dep.quando + ' ' + String(dep.desc).slice(0, 46) + ']' : ''));
      }

      // o que está no ar AGORA pode ser mais novo que a última amostragem
      if (curtoVivo && !linhas.some((j) => String(j.hash).slice(0, 12) === curtoVivo)) {
        console.log('  (hoje)       ' + curtoVivo + '  ' + vivo.rotulo.padEnd(22)
          + ' ← NO AR, ainda não amostrado pelo timer diário');
      }
    }

    console.log('\nRótulo honesto = um por ONDA de deploy. Se os órfãos acima têm datas diferentes,');
    console.log('um único --adotar juntaria ondas distintas: rotule a onda de hoje e acrescente as');
    console.log('anteriores no registry.json (é um mapa hash→rótulo; editá-lo para ROTULAR é legítimo,');
    console.log('o que não se faz por lá é rollback).');
  } finally {
    await w.fechar();
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
