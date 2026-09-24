/**
 * Bypass do Cloudinary para imagens do Mux (PlayStation Blog).
 *
 * Diagnóstico (exec 80, pauta "Silent Hill: Townfall" do blog.playstation.com):
 * o pipeline embrulha TODA imagem via Cloudinary image/fetch para redimensionar
 * (helper safeImage). O PlayStation Blog serve os thumbnails via Mux
 * (image.mux.com) com URL assinada por token JWT. Cloudinary NÃO consegue
 * buscar image.mux.com — retorna HTTP 400 para qualquer URL Mux (com token, sem
 * token, encodada) enquanto busca .jpg/.png normais (ex.: Adrenaline) em 200.
 * Resultado: o renderizador recebia a URL Cloudinary e batia 400 em "Convert
 * HTML to JPEG". Buscar o Mux direto funciona (curl 200) e o Mux honra o
 * parâmetro width.
 *
 * Correção: em safeImage (nodes "Code in JavaScript", "Code in JavaScript1",
 * "Usar capa como fallback"), quando a origem for image.mux.com, devolver a URL
 * do Mux direta (com width=1400) em vez de embrulhar no Cloudinary.
 *
 * Uso: node patches/semana1e-mux-bypass.cjs [--dry] [caminho-do-sqlite]
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
const NODES = ['Code in JavaScript', 'Code in JavaScript1', 'Usar capa como fallback'];

const ANCORA =
  `    return source;
  }
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/`;

const SUBST =
  `    return source;
  }
  // Cloudinary image/fetch não consegue buscar image.mux.com (retorna 400); o
  // PlayStation Blog serve thumbnails via Mux com URL assinada. O renderizador
  // busca direto (o Mux aceita o token e honra o parâmetro width). Bypass:
  if (source.startsWith('https://image.mux.com/')) {
    return source + (source.includes('?') ? '&' : '?') + 'width=1400';
  }
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/`;

function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  if (texto.split(de).length > 2) throw new Error('alvo ambíguo (' + rotulo + ')');
  return texto.split(de).join(para);
}

function aplicar(nodes) {
  const feito = [];
  for (const nome of NODES) {
    const n = nodes.find((x) => x.name === nome);
    if (!n) throw new Error('node não encontrado: ' + nome);
    n.parameters.jsCode = trocar(String(n.parameters.jsCode), ANCORA, SUBST, nome);
    feito.push('bypass Mux em "' + nome + '"');
  }
  return feito;
}

module.exports = { aplicar };

if (require.main === module) {
  const db = new DatabaseSync(DB);
  const row = db.prepare('select nodes from workflow_entity where id=?').get(WF);
  if (!row) throw new Error('workflow não encontrado em ' + DB);
  const nodes = JSON.parse(row.nodes);
  const feito = aplicar(nodes);

  if (DRY) {
    console.log('[DRY-RUN] alvos casaram. Não gravado:\n');
    feito.forEach((f) => console.log('  ' + f));
  } else {
    db.prepare('update workflow_entity set nodes=?, updatedAt=? where id=?').run(
      JSON.stringify(nodes),
      new Date().toISOString().replace('T', ' ').replace('Z', ''),
      WF,
    );
    console.log('Aplicado em ' + DB + ':\n');
    feito.forEach((f) => console.log('  ' + f));
  }
}
