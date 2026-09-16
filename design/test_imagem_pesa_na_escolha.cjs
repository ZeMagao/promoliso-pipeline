// Harness offline do patch_imagem_pesa_na_escolha.cjs.
// Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_imagem_pesa_na_escolha.cjs
// (só leitura; não grava nada)
//
// O dono vetou a versão anterior porque ela cortava conteúdo. Então este harness cobra, acima de
// tudo, que NENHUMA pauta seja reprovada nem encolhida: o patch só mexe em ORDEM DE ESCOLHA.

const { execSync } = require('child_process');
const patch = require('./patch_imagem_pesa_na_escolha.cjs');
const { TETO_BONUS } = patch;

const DB = '/opt/promoliso/data/.n8n/database.sqlite';
let falhas = 0;
const checa = (cond, texto) => { if (!cond) falhas++; console.log((cond ? 'OK     ' : 'FALHA  ') + texto); };

// ───────────────────────────────── réplicas: contagem e bônus, antes e depois
const distintasHoje = (n) => new Set(
  [...(Array.isArray(n.imagens_oficiais) ? n.imagens_oficiais : []), n.imagem_principal]
    .filter((u) => typeof u === 'string' && /^https:\/\//i.test(u))
    .map((u) => String(u).split(/[?#]/)[0].toLowerCase()),
).size;

const TAMANHO_WP = /-\d{2,4}x\d{2,4}(?=\.[a-z]{3,4}$)/i;
const ESCALADA_WP = /-scaled(?=\.[a-z]{3,4}$)/i;
const TAMANHO_BLOGGER = /\/(s\d+(?:-[a-z0-9-]+)*|w\d+-h\d+(?:-[a-z0-9-]+)*)\/([^/]+)$/i;
const identidadeVisual = (url) => {
  let limpa = String(url).toLowerCase().split(/[?#]/)[0];
  if (/^https:\/\/blogger\.googleusercontent\.com\//i.test(limpa)) {
    limpa = limpa.replace(TAMANHO_BLOGGER, '/TAM/$2');
  }
  return limpa.replace(TAMANHO_WP, '').replace(ESCALADA_WP, '');
};
const distintasNova = (n) => new Set(
  [...(Array.isArray(n.imagens_oficiais) ? n.imagens_oficiais : []), n.imagem_principal]
    .filter((u) => typeof u === 'string' && /^https:\/\//i.test(u))
    .map(identidadeVisual),
).size;

const bonusHoje = (f) => (f >= 2 ? 8 : 0);
const bonusNovo = (f) => (f <= 1 ? 0 : Math.min(2 * f, TETO_BONUS));

console.log('--- contagem: variante de tamanho é a MESMA foto ---');
const casos = [
  { nome: 'WordPress -scaled + -2048x1365 (peça 71)', urls: [
    'https://x.com/a/e292c-scaled.jpg', 'https://x.com/a/e292c-2048x1365.jpg'], hoje: 2, nova: 1 },
  { nome: 'Blogger /s1920/ + /w640-h360/', urls: [
    'https://blogger.googleusercontent.com/img/b/K/s1920/f.jpg',
    'https://blogger.googleusercontent.com/img/b/K/w640-h360/f.jpg'], hoje: 2, nova: 1 },
  { nome: 'duas fotos DIFERENTES continuam duas', urls: [
    'https://x.com/a/foto1.jpg', 'https://x.com/a/foto2.jpg'], hoje: 2, nova: 2 },
  { nome: 'arquivos diferentes com sufixo de tamanho', urls: [
    'https://x.com/a/um-1024x768.jpg', 'https://x.com/a/dois-1024x768.jpg'], hoje: 2, nova: 2 },
  { nome: 'foto única', urls: ['https://x.com/a/so.jpg'], hoje: 1, nova: 1 },
];
for (const c of casos) {
  const n = { imagens_oficiais: c.urls, imagem_principal: c.urls[0] };
  const a = distintasHoje(n); const b = distintasNova(n);
  checa(a === c.hoje && b === c.nova, `${c.nome}: hoje ${a}, honesta ${b} (esperado ${c.hoje}/${c.nova})`);
}

console.log('\n--- bônus: graduado, e teto abaixo da procedência ---');
for (const f of [1, 2, 3, 4, 7]) {
  console.log(`       ${f} foto(s): hoje ${bonusHoje(f)}  ->  novo ${bonusNovo(f)}`);
}
checa(bonusNovo(1) === 0, 'pauta de foto única deixa de levar bônus');
checa(bonusNovo(4) > bonusNovo(2), 'pauta com 4 fotos vence pauta com 2 (hoje empatam)');
checa(bonusNovo(7) <= TETO_BONUS, `teto respeitado (${bonusNovo(7)} <= ${TETO_BONUS})`);
checa(TETO_BONUS < 10, 'teto abaixo dos 10 da fonte primária — arte não vence procedência');

console.log('\n--- ⚠️ o patch NÃO pode reprovar nem encolher nada ---');
{
  // ⚠️ A primeira versão desta checagem varria TODAS as edições atrás da palavra "reprova" e
  // acusava falha — porque ela aparece na PROSA do prompt ("em vez de reprovar a pauta"), que é
  // instrução ao modelo, não lógica de gate. Só o jsCode pode conter reprovação de verdade.
  const corpoCodigo = patch.EDICOES.filter((e) => e.campo === 'jsCode').map((e) => e.para).join('\n');
  checa(!/erros\.push|pauta_validada|slidesNaFaixa|aprovado_para_publicar/.test(corpoCodigo),
    'o CÓDIGO do patch não toca em reprovação nem na faixa de slides');
  checa(!/slice\(0,|\.length\s*>/.test(corpoCodigo.replace(/Math\.min\([^)]*\)/g, '')),
    'o código do patch não corta nenhuma lista');
  const prompt = patch.EDICOES.filter((e) => e.campo === 'prompt').map((e) => e.para).join(' ');
  checa(/NUNCA corte um fato/i.test(prompt), 'o prompt diz explicitamente para não cortar fato');
  checa(/Nunca remova um slide/i.test(prompt), 'a 2ª cópia também protege o slide');
  checa(!/REDUZA O NÚMERO DE SLIDES/i.test(prompt),
    'a instrução de amputar conteúdo (versão vetada) não voltou');
}

console.log('\n--- dado REAL: o que muda na escolha ---');
try {
  const flatted = require('/opt/promoliso/node_modules/flatted');
  // Dois motivos MUITO diferentes para perder pontos, e somá-los mente:
  //  - enganavam: contavam 2+ e têm 1 foto (variante do mesmo arquivo) -> caem para bônus 0
  //  - reescaladas: têm 2 ou 3 fotos de verdade e a régua nova as separa de quem tem 4+
  let total = 0, enganavam = 0, reescaladas = 0, sobem = 0; const dist = {};
  for (const id of [598, 601]) {
    const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=${id};"`,
      { maxBuffer: 1024 * 1024 * 400 }).toString();
    if (!raw.trim()) continue;
    const rd = flatted.parse(raw)?.resultData?.runData;
    const pacote = rd?.['Normalizar notícias PromoLiso AI']?.[0]?.data?.main?.[0]?.[0]?.json;
    for (const n of (pacote?.noticias || [])) {
      const a = distintasHoje(n); if (!a) continue;
      const b = distintasNova(n);
      total++; dist[b] = (dist[b] || 0) + 1;
      if (bonusNovo(b) < bonusHoje(a)) {
        if (a >= 2 && b < 2) enganavam++; else reescaladas++;
      }
      if (bonusNovo(b) > bonusHoje(a)) sobem++;
    }
  }
  if (!total) {
    console.log('AVISO  execuções já podadas — os sintéticos acima cobrem a lógica');
  } else {
    console.log(`       ${total} notícias reais`);
    console.log('       fotos REAIS por notícia: '
      + Object.keys(dist).map(Number).sort((x, y) => x - y).map((k) => k + '→' + dist[k]).join('  '));
    console.log(`       ENGANAVAM (contavam 2+, têm 1 foto): ${enganavam}  -> perdem o bônus inteiro`);
    console.log(`       reescaladas (2 ou 3 fotos reais):    ${reescaladas}  -> cedem lugar a quem tem 4+`);
    console.log(`       ganham posição:                      ${sobem}`);
    checa(total > 0, 'mediu sobre dado real');
    checa(enganavam > 0, `o defeito existe no dado real: ${enganavam} pauta(s) levavam bônus sem ter variedade`);
    checa(enganavam + reescaladas < total,
      `a maioria NÃO é penalizada (${total - enganavam - reescaladas} de ${total} intactas)`);
    checa((dist[1] || 0) > 0, `há pautas de foto única no lote (${dist[1] || 0}) — são as que devem perder a vez`);
  }
} catch (e) {
  console.log('AVISO  não deu para ler o banco (' + e.message.split('\n')[0] + ')');
}

console.log('\n--- âncoras no código/prompt REAIS ---');
try {
  const live = execSync(`sqlite3 "${DB}" "SELECT nodes FROM workflow_entity WHERE id='${patch.WF}';"`,
    { maxBuffer: 1024 * 1024 * 200 }).toString();
  const nodes = JSON.parse(live);
  const acumulado = {};
  for (const e of patch.EDICOES) {
    const no = nodes.find((x) => x.name === e.no);
    const chave = e.no + '|' + e.campo;
    const atual = acumulado[chave] !== undefined ? acumulado[chave] : patch.leCampo(no, e.campo);
    let ok = true; let msg = '';
    try { acumulado[chave] = patch.aplicar(atual, e, false); }
    catch (err) { ok = false; msg = ' — ' + err.message; }
    checa(ok, `âncora "${e.nome}"${msg}`);
  }
  for (const chave of Object.keys(acumulado)) {
    if (!chave.endsWith('|jsCode')) continue;
    let compila = true; try { new Function(acumulado[chave]); } catch (e) { compila = false; }
    checa(compila, `${chave.split('|')[0]}: jsCode resultante compila`);
  }
  const promptDepois = acumulado['AI Agent|prompt'];
  if (promptDepois) {
    checa(!/reutilize as dispon[ií]veis\./.test(promptDepois.split('prefira a de melhor')[0] || ''),
      'a instrução crua de repetir saiu da 1ª cópia');
    checa(promptDepois.includes('de 3 a 7 slides'), 'a seção de estrutura segue intacta');
  }
} catch (e) {
  console.log('AVISO  não deu para ler o workflow (' + e.message.split('\n')[0] + ')');
  falhas++;
}

console.log('');
if (falhas === 0) {
  console.log('RESULTADO ESPERADO EM TODOS OS CASOS — patch pode ir pro ar');
  console.log('⚠️  Isto muda ORDEM DE ESCOLHA, não conteúdo. Se a pauta pobre for a única boa');
  console.log('    do dia, ela continua vencendo e continua publicando — com a foto que tiver.');
  process.exit(0);
}
console.log(`FALHOU: ${falhas} caso(s) — NÃO deployar`);
process.exit(1);
