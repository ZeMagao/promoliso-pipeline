// Harness offline do patch_variedade_imagem.cjs.
// Roda contra os relatorio_validacao REAIS de todas as execuções guardadas e responde:
//   1. quais execuções mudam de veredito (só podem MELHORAR: a mudança remove um erro)
//   2. quais passam a APROVAR de fato (variedade era o único erro)
//   3. se o desempate por nº de imagens (mudança B) muda algo na prática
// Só leitura. Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_variedade_imagem.cjs
const { execSync } = require('child_process');
const flatted = require('/opt/promoliso/node_modules/flatted');
const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const WF = 'NL8eVLKErgnIXBQq';

// dominiosPrimarios é lido do código NO AR pra o harness não divergir do validador
const nodes = JSON.parse(
  execSync(`sqlite3 "${DB}" "SELECT nodes FROM workflow_entity WHERE id='${WF}';"`, { maxBuffer: 1024 * 1024 * 200 }).toString(),
);
const codigo = nodes.find((x) => x.name === 'Validar antes de publicar').parameters.jsCode;
const bloco = codigo.match(/const dominiosPrimarios = \[([\s\S]*?)\];/);
if (!bloco) throw new Error('não achei dominiosPrimarios no código no ar');
const dominiosPrimarios = Function('return [' + bloco[1] + ']')();
console.log('dominiosPrimarios lidos do código no ar: ' + dominiosPrimarios.length + ' hosts');

const hostIn = (host, lista) =>
  Boolean(host) && lista.some((d) => host === d || host.endsWith('.' + d));

const execs = execSync(
  `sqlite3 "${DB}" "SELECT id FROM execution_entity WHERE workflowId='${WF}' AND status='success' ORDER BY id;"`,
).toString().trim().split('\n').filter(Boolean);

let mudam = 0, passamAAprovar = 0, jaAprovadas = 0, pioram = 0;
let comUmElegivel = 0, comVariosElegiveis = 0;

for (const id of execs) {
  let rd;
  try {
    const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=${id};"`, { maxBuffer: 1024 * 1024 * 500 }).toString();
    if (!raw.trim()) continue;
    rd = flatted.parse(raw)?.resultData?.runData;
  } catch { continue; }
  if (!rd) continue;

  // --- mudança B: o desempate só importa se houver mais de 1 candidato elegível
  const selOut = rd['Selecionar melhor pauta']?.slice(-1)[0]?.data?.main?.[0]?.[0]?.json;
  if (selOut?.existe_pauta_aprovavel) {
    if (Number(selOut.total_aprovavel || 1) > 1) comVariosElegiveis++; else comUmElegivel++;
  }

  const runs = rd['Validar antes de publicar'] || [];
  runs.forEach((r, ri) => {
    const j = r?.data?.main?.[0]?.[0]?.json;
    if (!j) return;
    const rel = j.relatorio_validacao || {};
    const erros = Array.isArray(rel.erros) ? rel.erros : [];
    const MSG_ANTIGA = 'Carrossel sem variedade visual confiável: imagem editorial repetida';
    const tinhaErroVariedade = erros.some((e) => String(e) === MSG_ANTIGA);
    if (!tinhaErroVariedade) {
      if (j.pauta_validada) jaAprovadas++;
      return;
    }

    // reconstrói as condições da regra nova a partir do relatório real
    const unicas = Number(rel.imagens_unicas || 0);
    const hostsImg = Array.isArray(rel.hosts_imagens) ? rel.hosts_imagens : [];
    const imagemUnicaOficial = unicas === 1 && hostsImg.length === 1 && hostIn(hostsImg[0], dominiosPrimarios);
    const primariasRelevantes = Number(rel.fontes_primarias_relevantes || 0);
    // hostsRelevantes = hosts das fontes, menos os que só aparecem entre as sem relação
    const hostsSemRelacao = new Set((rel.fontes_sem_relacao || []).map((f) => f.host));
    const hostsRelevantes = (rel.hosts_fontes || []).filter((h) => !hostsSemRelacao.has(h));
    const pautaBemConfirmada = primariasRelevantes > 0 || hostsRelevantes.length >= 2;

    const erroNovo = unicas === 1 && !imagemUnicaOficial && !pautaBemConfirmada;
    const outrosErros = erros.filter((e) => String(e) !== MSG_ANTIGA);

    if (erroNovo) {
      console.log(`exec ${id} run${ri}: SEGUE REPROVANDO por variedade (pauta sem confirmação forte) — primarias=${primariasRelevantes} hostsRelev=${hostsRelevantes.length}`);
      return;
    }
    mudam++;
    if (outrosErros.length === 0) {
      passamAAprovar++;
      console.log(`exec ${id} run${ri}: >>> PASSA A APROVAR <<< (variedade era o único erro) | primarias=${primariasRelevantes} hostsRelev=${hostsRelevantes.length} unicas=${unicas} host=${hostsImg.join(',')}`);
    } else {
      console.log(`exec ${id} run${ri}: variedade perdoada, mas segue reprovada por ${outrosErros.length} outro(s): ${outrosErros.map((e) => String(e).slice(0, 60)).join(' | ')}`);
    }
  });
}

console.log('');
console.log('#'.repeat(70));
console.log(`execuções cujo erro de variedade é perdoado: ${mudam}`);
console.log(`  -> das quais passam a APROVAR de fato: ${passamAAprovar}`);
console.log(`execuções que já aprovavam (não podem piorar — a mudança só REMOVE erro): ${jaAprovadas}`);
console.log(`execuções que pioram: ${pioram}  (tem que ser 0 por construção)`);
console.log('');
console.log('mudança B (desempate por nº de imagens) — só age quando há >1 candidato elegível:');
console.log(`  execuções com 1 elegível (desempate é no-op): ${comUmElegivel}`);
console.log(`  execuções com >1 elegível (desempate age):    ${comVariosElegiveis}`);
if (comVariosElegiveis === 0) {
  console.log('  AVISO: em nenhuma execução guardada havia mais de 1 elegível — a mudança B');
  console.log('  não teria efeito nessas amostras. Ela vale como rede pra frente, não como fix agora.');
}
