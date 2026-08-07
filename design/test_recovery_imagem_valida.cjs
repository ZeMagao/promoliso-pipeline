// Harness offline do patch_recovery_imagem_valida.cjs.
// Para cada execução guardada onde o recovery de mídia rodou, reconstrói o que o recovery
// ATRIBUIU (antes) e o que atribuiria com a piscina filtrada (depois), e conta quantas das 6
// imagens passam pelo gate — que é o que produz "Esperava 6 imagens válidas e passaram N".
// Só leitura. Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_recovery_imagem_valida.cjs
const { execSync } = require('child_process');
const flatted = require('/opt/promoliso/node_modules/flatted');
const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const WF = 'NL8eVLKErgnIXBQq';

// listas lidas do código NO AR, pro harness não divergir do validador
const nodes = JSON.parse(
  execSync(`sqlite3 "${DB}" "SELECT nodes FROM workflow_entity WHERE id='${WF}';"`, { maxBuffer: 1024 * 1024 * 200 }).toString(),
);
const codigo = nodes.find((x) => x.name === 'Validar antes de publicar').parameters.jsCode;
const arr = (nome) => {
  const m = codigo.match(new RegExp('const ' + nome + ' = \\[([\\s\\S]*?)\\];'));
  if (!m) throw new Error('não achei ' + nome + ' no código no ar');
  return Function('return [' + m[1].replace(/\.\.\.\w+,?/g, '') + ']')();
};
const dominiosBloqueados = arr('dominiosBloqueados');
const imagensBloqueadas = [...dominiosBloqueados, ...arr('imagensBloqueadas')];
const hostsImagemConhecidos = arr('hostsImagemConhecidos');
console.log(`listas do código no ar: ${imagensBloqueadas.length} hosts bloqueados, ${hostsImagemConhecidos.length} hosts de imagem conhecidos`);

const hostIn = (host, lista) => Boolean(host) && lista.some((d) => host === d || host.endsWith('.' + d));
const urlInfo = (v) => { try { const u = new URL(String(v)); return { url: String(v), host: u.hostname.replace(/^www\./, '') }; } catch { return null; } };
const pareceImagemUrl = (u) => /\.(?:jpe?g|png|webp|gif|avif)$/.test(String(u).split(/[?#]/)[0].toLowerCase());
function imagemUtilizavel(imagem) {
  if (!imagem || !imagem.url) return false;
  if (hostIn(imagem.host, imagensBloqueadas)) return false;
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\.(?:html?|php|asp|aspx)$/.test(caminho)) return false;
  if (/\/(?:search|busca)(?:\/|$)/.test(caminho)) return false;
  return pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos);
}
const urlUtilizavel = (u) => imagemUtilizavel(urlInfo(u));

const execs = execSync(
  `sqlite3 "${DB}" "SELECT id FROM execution_entity WHERE workflowId='${WF}' AND status='success' ORDER BY id;"`,
).toString().trim().split('\n').filter(Boolean);

let melhoram = 0, iguais = 0, pioram = 0, perdemRecovery = 0, semRecovery = 0;

for (const id of execs) {
  let rd;
  try {
    const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=${id};"`, { maxBuffer: 1024 * 1024 * 500 }).toString();
    if (!raw.trim()) continue;
    rd = flatted.parse(raw)?.resultData?.runData;
  } catch { continue; }
  if (!rd) continue;

  const cand = rd['Consolidar candidatos aprovados']?.[0]?.data?.main?.[0]?.[0]?.json?.candidatos?.[0];
  if (!cand) continue;

  // piscina como o código monta hoje
  const piscinaAntes = [cand.imagem_principal, ...(Array.isArray(cand.imagens_oficiais) ? cand.imagens_oficiais : [])]
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u))
    .filter((u, i, a) => a.indexOf(u) === i);
  const piscinaDepois = piscinaAntes.filter(urlUtilizavel);

  const runs = rd['Validar antes de publicar'] || [];
  runs.forEach((r, ri) => {
    const j = r?.data?.main?.[0]?.[0]?.json;
    if (!j) return;
    const out = j.output || {};
    if (out.recuperacao_midias_oficiais !== true) { semRecovery++; return; }
    const nSlides = Array.isArray(out.slides) ? out.slides.length : 0;
    if (!nSlides || !piscinaAntes.length) return;

    // o recovery atribui capa = piscina[0] e slide i = piscina[i % len]
    const atribuidas = (piscina) => piscina.length
      ? [piscina[0], ...Array.from({ length: nSlides }, (_, i) => piscina[i % piscina.length])]
      : [];
    const validas = (lista) => lista.filter(urlUtilizavel).length;

    const antes = validas(atribuidas(piscinaAntes));
    const depois = piscinaDepois.length ? validas(atribuidas(piscinaDepois)) : null;

    const erroAntes = antes !== nSlides + 1;
    if (depois === null) {
      // piscina zerou -> recovery deixa de habilitar; usa as imagens do próprio agente
      perdemRecovery++;
      console.log(`exec ${id} run${ri}: piscina ZERA com o filtro (${piscinaAntes.length} imgs, todas inutilizáveis) -> recovery não habilita, cai nas imagens do agente`);
      return;
    }
    const erroDepois = depois !== nSlides + 1;
    if (erroAntes && !erroDepois) {
      melhoram++;
      console.log(`exec ${id} run${ri}: >>> ANTES ${antes}/${nSlides + 1} (reprovava) -> DEPOIS ${depois}/${nSlides + 1} (passa) <<< piscina ${piscinaAntes.length}->${piscinaDepois.length}`);
    } else if (!erroAntes && erroDepois) {
      pioram++;
      console.log(`exec ${id} run${ri}: !!! PIORA ${antes} -> ${depois} !!!`);
    } else {
      iguais++;
    }
  });
}

console.log('');
console.log('#'.repeat(70));
console.log(`execuções com recovery que MELHORAM (passam a ter as 6 imagens): ${melhoram}`);
console.log(`execuções com recovery sem mudança:                             ${iguais}`);
console.log(`execuções que PIORAM:                                           ${pioram}   (tem que ser 0)`);
console.log(`execuções onde a piscina zera e o recovery deixa de habilitar:   ${perdemRecovery}`);
console.log(`runs sem recovery (não afetados):                               ${semRecovery}`);
console.log('');
console.log(pioram === 0
  ? 'OK — nenhuma execução piora. A regra de validade não mudou; só passou a ser aplicada nos dois lados.'
  : 'ATENCAO: alguma execução piora — NÃO deployar.');
process.exit(pioram === 0 ? 0 : 1);
