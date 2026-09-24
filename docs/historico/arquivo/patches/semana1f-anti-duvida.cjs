/**
 * Impede publicar carrossel cujo TEXTO expõe dúvida/hedge editorial.
 *
 * Diagnóstico (exec 82, "Steam Machine FSR 4.1", Adrenaline): o agente reprovou
 * corretamente (aprovado_para_publicar=false, "não pôde ser confirmada com
 * fonte primária"), mas o recovery determinístico do semana1c SOBRESCREVEU e
 * aprovou — porque `reprovacaoSomentePorRecuperacao` casa "fonte primária"/
 * "busca" e tratou uma reprovação de FONTE como se fosse de imagem. Resultado:
 * ia publicar slides dizendo "Espere a validação / Sem prova oficial /
 * aguardar confirmação da Valve/AMD" e legenda "preferimos segurar a
 * publicação". Impublicável para um perfil de notícias.
 *
 * Correção (node "Validar antes de publicar"), determinística:
 *   1. Expande o regex de dúvida editorial (antes só cobria desistência de
 *      IMAGEM) para pegar também dúvida de FONTE/confirmação e "aguardar/
 *      espere". Continua bloqueando o recovery (conteudoDeBloqueioEditorial).
 *   2. Adiciona ERRO duro: se o texto dos slides/legenda casar esse regex, a
 *      pauta REPROVA — mesmo que o agente tenha aprovado ou o recovery tenha
 *      forçado aprovação. Assim texto de dúvida NUNCA publica; o fluxo troca de
 *      pauta. Calibrado contra execs reais: reprova a 82, mantém 80 e 81.
 *
 * Uso: node patches/semana1f-anti-duvida.cjs [--dry] [caminho-do-sqlite]
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

function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  if (texto.split(de).length > 2) throw new Error('alvo ambíguo (' + rotulo + ')');
  return texto.split(de).join(para);
}

function transformar(cv) {
  const feito = [];

  // 1. Regex único e expandido + conteudoDeBloqueioEditorial usando ele.
  cv = trocar(
    cv,
    `const conteudoDeBloqueioEditorial =
  /(?:n.o d. para postar|refazer a checagem|aguardar nova base|n.o deu para aprovar|melhor segurar|o que faltou fechar|risco de ru.do|espere a arte|quando houver (?:a )?(?:arte|imagem)|s. fica segur\\w* quando|aguard\\w* (?:a )?(?:arte|imagem)|imagem oficial direta)/i.test(
    textoEditorialRecuperavel,
  );`,
    `// Dúvida/hedge editorial: desistência de IMAGEM (semana1c) + dúvida de
// FONTE/confirmação (semana1f). Se aparecer no texto, a pauta não é publicável
// — bloqueia o recovery e reprova mais abaixo.
const regexDuvidaEditorial =
  /(?:n.o d. para postar|refazer a checagem|aguardar nova base|n.o deu para aprovar|melhor segurar|preferimos segurar|o que faltou fechar|risco de ru.do|espere a arte|espere a valida|quando houver (?:a )?(?:arte|imagem|fonte|confirma)|s. fica segur\\w* quando|aguard\\w* (?:a )?(?:arte|imagem|confirma|valida|fonte)|imagem oficial direta|sem prova oficial|sem p.gina oficial|sem fonte prim.ria|faltou a origem oficial|n.o localiz\\w+ .{0,30}fonte prim.ria|n.o fechou com a confirma|confirma..o oficial que a promoliso|antes de tratar isso como novidade)/i;
const conteudoDeBloqueioEditorial = regexDuvidaEditorial.test(
  textoEditorialRecuperavel,
);`,
    '1. regex de dúvida expandido (imagem + fonte/confirmação)',
  );
  feito.push('1. conteudoDeBloqueioEditorial agora pega dúvida de fonte/confirmação também');

  // 2. Erro duro: texto de dúvida reprova a pauta (vence o override do recovery).
  cv = trocar(
    cv,
    `if (/\\b(bomba|chocante|você não vai acreditar)\\b/i.test(textosPrincipais)) {
  erros.push('Título com sensacionalismo genérico');
}`,
    `if (/\\b(bomba|chocante|você não vai acreditar)\\b/i.test(textosPrincipais)) {
  erros.push('Título com sensacionalismo genérico');
}
// O agente às vezes escreve a própria incerteza como conteúdo ("espere a
// validação", "sem prova oficial", "aguardar confirmação"). Isso é
// impublicável e vence qualquer aprovação (do agente ou do recovery): reprova
// para o fluxo trocar de pauta em vez de postar dúvida.
if (regexDuvidaEditorial.test(textoEditorialRecuperavel)) {
  erros.push('Texto dos slides ou legenda expõe dúvida/hedge editorial (ex.: "aguardar confirmação", "sem prova oficial", "espere a validação") — não publicável');
}`,
    '2. erro duro que reprova texto de dúvida',
  );
  feito.push('2. erro duro: texto de dúvida reprova a pauta (vence o override do recovery)');

  return { cv, feito };
}

module.exports = { transformar };

if (require.main === module) {
  const db = new DatabaseSync(DB);
  const row = db.prepare('select nodes from workflow_entity where id=?').get(WF);
  if (!row) throw new Error('workflow não encontrado em ' + DB);
  const nodes = JSON.parse(row.nodes);
  const validar = nodes.find((x) => x.name === 'Validar antes de publicar');
  if (!validar) throw new Error('node "Validar antes de publicar" não encontrado');
  const { cv, feito } = transformar(String(validar.parameters.jsCode));

  if (DRY) {
    console.log('[DRY-RUN] alvos casaram. Não gravado:\n');
    feito.forEach((f) => console.log('  ' + f));
  } else {
    validar.parameters.jsCode = cv;
    db.prepare('update workflow_entity set nodes=?, updatedAt=? where id=?').run(
      JSON.stringify(nodes),
      new Date().toISOString().replace('T', ' ').replace('Z', ''),
      WF,
    );
    console.log('Aplicado em ' + DB + ':\n');
    feito.forEach((f) => console.log('  ' + f));
  }
}
