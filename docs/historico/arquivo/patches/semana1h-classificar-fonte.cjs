/**
 * Conserta a classificação tipo_fonte dos feeds oficiais.
 *
 * Diagnóstico (exec 83): o pool de curadoria vinha quase 100% "editorial"
 * (23 de 24), então a curadoria só tinha pautas fracas e a validação reprovava
 * — fluxo terminava em "Encerrar sem pauta segura", sem publicar.
 *
 * Causa: "Preparar candidatos" decidia tipo_fonte por um mapa de hostname
 * EXATO. Mas os feeds oficiais linkam de subdomínios:
 *   NVIDIA  -> nvidianews.nvidia.com / blogs.nvidia.com
 *   Intel   -> newsroom.intel.com
 *   Nintendo-> www.nintendo.co.jp / pictonico.nintendo.com
 * Nenhum batia no mapa (que só tinha nvidia.com, intel.com, nintendo.com), então
 * caíam em "editorial". Só blog.playstation.com e news.xbox.com acertavam.
 *
 * Correção: classificar por SUFIXO de domínio (host === d || host.endsWith('.'+d)),
 * alinhado com a lista dominiosPrimarios que o "Validar antes de publicar" já
 * usa. Assim NVIDIA/Intel/Nintendo/AMD etc. entram como primária, a curadoria
 * passa a ter pauta forte e o fluxo publica de forma confiável.
 *
 * Uso: node patches/semana1h-classificar-fonte.cjs [--dry] [caminho-do-sqlite]
 * Com o n8n PARADO para gravar (sem --dry).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const RAIZ = path.resolve(__dirname, '..');
const DB = args.find((a) => !a.startsWith('--')) ||
  path.join(RAIZ, 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';

const ANTIGO_MAPA = `const sourceTypes = {
  'blog.playstation.com': 'primaria',
  'news.xbox.com': 'primaria',
  'nintendo.com': 'primaria',
  'www.nintendo.com': 'primaria',
  'nvidia.com': 'primaria',
  'www.nvidia.com': 'primaria',
  'intel.com': 'primaria',
  'www.intel.com': 'primaria',
  'adrenaline.com.br': 'editorial',
  'www.adrenaline.com.br': 'editorial',
  'flowgames.gg': 'editorial',
  'www.flowgames.gg': 'editorial',
  'gamevicio.com': 'editorial',
  'www.gamevicio.com': 'editorial',
};`;

const NOVO_CLASSIFICADOR = `// Classificação por SUFIXO de domínio (não mais mapa exato): os feeds oficiais
// linkam de subdomínios (nvidianews.nvidia.com, newsroom.intel.com,
// www.nintendo.co.jp...) que o mapa exato jogava em "editorial". Esta lista
// espelha dominiosPrimarios do "Validar antes de publicar".
const dominiosPrimarios = [
  'playstation.com', 'sony.com', 'sonyinteractive.com',
  'xbox.com', 'microsoft.com', 'majornelson.com',
  'nintendo.com', 'nintendo.co.jp', 'nintendo-europe.com', 'nintendo.com.au',
  'nvidia.com', 'amd.com', 'intel.com',
  'samsung.com', 'lg.com', 'asus.com', 'msi.com', 'gigabyte.com', 'acer.com',
  'dell.com', 'alienware.com', 'lenovo.com', 'corsair.com', 'logitechg.com',
  'razer.com', 'ea.com', 'ubisoft.com', 'rockstargames.com', 'bethesda.net',
  'bandainamcoent.com', 'capcom.com', 'capcom.co.jp', 'konami.com',
  'square-enix.com', 'activision.com', 'blizzard.com', 'riotgames.com',
  'sega.com', 'sega.jp', 'cdprojektred.com', 'epicgames.com',
  'steampowered.com', 'unrealengine.com', 'unity.com',
];
const dominiosEditoriais = [
  'adrenaline.com.br', 'flowgames.gg', 'gamevicio.com',
];
function fonteBate(host, dominios) {
  return dominios.some((d) => host === d || host.endsWith('.' + d));
}
function classificarFonte(host) {
  if (!host) return 'editorial';
  if (fonteBate(host, dominiosPrimarios)) return 'primaria';
  if (fonteBate(host, dominiosEditoriais)) return 'editorial';
  return 'editorial';
}`;

const ANTIGO_USO = `    const tipoFonte =
      sourceTypes[hostname] ||
      sourceTypes['www.' + hostname] ||
      'editorial';`;

const NOVO_USO = `    const tipoFonte = classificarFonte(hostname);`;

function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  if (texto.split(de).length > 2) throw new Error('alvo ambíguo (' + rotulo + ')');
  return texto.split(de).join(para);
}

function transformar(cv) {
  cv = trocar(cv, ANTIGO_MAPA, NOVO_CLASSIFICADOR, 'mapa exato -> classificador por sufixo');
  cv = trocar(cv, ANTIGO_USO, NOVO_USO, 'uso do classificador');
  return cv;
}

module.exports = { transformar };

if (require.main === module) {
  const db = new DatabaseSync(DB);
  const row = db.prepare('select nodes from workflow_entity where id=?').get(WF);
  if (!row) throw new Error('workflow não encontrado em ' + DB);
  const nodes = JSON.parse(row.nodes);
  const n = nodes.find((x) => x.name === 'Preparar candidatos');
  if (!n) throw new Error('node "Preparar candidatos" não encontrado');
  const novo = transformar(String(n.parameters.jsCode));

  if (DRY) {
    new Function(novo); // valida sintaxe
    console.log('[DRY-RUN] alvos casaram e o código compila. Não gravado.');
  } else {
    new Function(novo);
    n.parameters.jsCode = novo;
    db.prepare('update workflow_entity set nodes=?, updatedAt=? where id=?').run(
      JSON.stringify(nodes),
      new Date().toISOString().replace('T', ' ').replace('Z', ''),
      WF,
    );
    console.log('Aplicado: classificação de fonte por sufixo em "Preparar candidatos".');
  }
}
