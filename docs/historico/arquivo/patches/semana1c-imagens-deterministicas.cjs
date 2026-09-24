/**
 * Destrava pauta da imprensa brasileira que traz imagem própria boa.
 *
 * Diagnóstico (medido na execução 79, "Driver AMD Adrenalin 26.7.1", Adrenaline):
 *   1. O candidato chegou ao agente com 4 imagens_oficiais válidas (CDN do
 *      Adrenaline + amd.com) e com confirmação primária de sobra em fontes
 *      (amd.com + neowin.net + adrenaline, 3 relevantes recentes).
 *   2. O agente IGNOROU as imagens que recebeu e colou a URL .html da página de
 *      release notes da AMD em capa e nos 5 slides -> 0 imagens válidas.
 *   3. Existe recovery determinístico no "Validar antes de publicar", mas ele
 *      só dispara para candidato-semente tipo_fonte=primaria. Adrenaline é
 *      "editorial", então o recovery pulou e a pauta reprovou por imagem.
 *   4. Ao desistir da imagem, o agente ainda contaminou o texto: slide 4 virou
 *      "Espere a arte oficial / A pauta só fica segura quando houver imagem
 *      oficial direta e nítida da AMD..." — texto impublicável.
 *
 * Correção (duas partes, ambas no node "Validar antes de publicar"):
 *   A. O recovery de imagem deixa de exigir semente primária. A confirmação de
 *      fonte já é validada à parte em output.fontes; aqui basta o candidato ter
 *      imagens próprias, estrutura completa e o agente ter reprovado só por
 *      mídia. Para semente editorial, preservamos as fontes que o agente reuniu
 *      (colapsar para fonte única só quando o semente é primário) — senão
 *      perderíamos a confirmação primária independente e a checagem de fonte
 *      reprovaria por sobrar só o portal secundário.
 *   B. conteudoDeBloqueioEditorial passa a reconhecer o texto-desistência do
 *      agente ("espere a arte", "só fica segura quando houver imagem"...). Com
 *      isso, texto contaminado bloqueia o recovery -> reprova limpo -> tenta
 *      outra pauta, em vez de publicar slide com narração de fracasso.
 *
 * Uso: node patches/semana1c-imagens-deterministicas.cjs [caminho-do-sqlite]
 * Com o n8n PARADO quando escrever no banco real.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const DB = process.argv[2] || path.join(RAIZ, 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';

function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  if (texto.split(de).length > 2) throw new Error('alvo ambíguo, aparece mais de uma vez (' + rotulo + ')');
  return texto.split(de).join(para);
}

// ---------------------------------------------------------------------------
// Transformação pura do código do node (exportada para o teste rodar sem DB).
// ---------------------------------------------------------------------------
function transformar(cv) {
  const feito = [];

  // A. Recovery de imagem: soltar o gate de semente primária.
  cv = trocar(
    cv,
    `if (
  candidatoPrimario &&
  fonteDoCandidatoPresente &&
  estruturaEditorialCompleta &&
  imagensOficiaisDoCandidato.length > 0 &&
  recuperacaoSeguraDeMidia &&
  !conteudoDeBloqueioEditorial
) {
  output.capa = imagensOficiaisDoCandidato[0];
  output.slides = output.slides.map((slide, index) => ({
    ...slide,
    imagem:
      imagensOficiaisDoCandidato[index % imagensOficiaisDoCandidato.length],
    fonte_imagem:
      String(slide.fonte_imagem || '').trim() ||
      String(candidatoEditorialAprovado.fonte || 'FONTE OFICIAL'),
  }));
  output.fontes = [{
    nome: String(candidatoEditorialAprovado.fonte || 'FONTE OFICIAL'),
    url: urlCandidato,
    data_publicacao: String(
      candidatoEditorialAprovado.publicado_em ||
      candidatoEditorialAprovado.data_publicacao ||
      fonteCandidataOriginal?.data_publicacao ||
      '',
    ).slice(0, 10),
  }];
  output.aprovado_para_publicar = true;
  output.motivo_reprovacao = '';
  output.recuperacao_midias_oficiais = true;
}`,
    `// A recuperação de imagem não depende mais de o candidato-semente ser
// primário. A confirmação de fonte é checada à parte em output.fontes (exige
// fonte primária relevante OU duas confirmações independentes). O que basta
// aqui: o candidato traz as próprias imagens oficiais — extraídas da fonte pelo
// Normalizar — e o agente só reprovou por mídia. Sem isso, pauta da imprensa BR
// (tipo_fonte=editorial) com imagem boa era descartada porque o agente colava a
// URL .html da release notes no lugar da imagem.
// fonteDoCandidatoPresente reflete se o AGENTE citou o candidato e é calculado
// antes da injeção automática de fonte — quando o agente esquece de citá-lo
// (comum), fica false mesmo já tendo sido injetado logo acima. Para o recovery
// de imagem, o que importa é que a fonte do candidato esteja disponível DEPOIS
// da injeção, não que o agente a tenha citado.
const fonteDoCandidatoDisponivel =
  Boolean(urlCandidato) &&
  (Array.isArray(output.fontes) ? output.fontes : []).some(
    (fonte) => urlCanonica(fonte?.url) === urlCanonica(urlCandidato),
  );
const recuperacaoDeImagemHabilitada =
  fonteDoCandidatoDisponivel &&
  estruturaEditorialCompleta &&
  imagensOficiaisDoCandidato.length > 0 &&
  recuperacaoSeguraDeMidia &&
  !conteudoDeBloqueioEditorial;

if (recuperacaoDeImagemHabilitada) {
  output.capa = imagensOficiaisDoCandidato[0];
  output.slides = output.slides.map((slide, index) => ({
    ...slide,
    imagem:
      imagensOficiaisDoCandidato[index % imagensOficiaisDoCandidato.length],
    fonte_imagem:
      String(slide.fonte_imagem || '').trim() ||
      String(candidatoEditorialAprovado.fonte || 'FONTE OFICIAL'),
  }));
  // Colapsar para uma única fonte só quando o semente é primário: aí a própria
  // URL do candidato já é a confirmação. Para pauta editorial, preservamos as
  // fontes que o agente reuniu (validadas abaixo) — senão perderíamos a
  // confirmação primária independente (ex.: amd.com) e sobraria só o portal.
  if (candidatoPrimario) {
    output.fontes = [{
      nome: String(candidatoEditorialAprovado.fonte || 'FONTE OFICIAL'),
      url: urlCandidato,
      data_publicacao: String(
        candidatoEditorialAprovado.publicado_em ||
        candidatoEditorialAprovado.data_publicacao ||
        fonteCandidataOriginal?.data_publicacao ||
        '',
      ).slice(0, 10),
    }];
  }
  output.aprovado_para_publicar = true;
  output.motivo_reprovacao = '';
  output.recuperacao_midias_oficiais = true;
}`,
    'A. recovery de imagem sem gate de semente primária',
  );
  feito.push('A. Recovery de imagem aceita candidato editorial (fontes do agente preservadas)');

  // B. Bloquear texto-desistência do agente.
  cv = trocar(
    cv,
    `  /(?:n.o d. para postar|refazer a checagem|aguardar nova base|n.o deu para aprovar|melhor segurar|o que faltou fechar|risco de ru.do)/i.test(`,
    `  /(?:n.o d. para postar|refazer a checagem|aguardar nova base|n.o deu para aprovar|melhor segurar|o que faltou fechar|risco de ru.do|espere a arte|quando houver (?:a )?(?:arte|imagem)|s. fica segur\\w* quando|aguard\\w* (?:a )?(?:arte|imagem)|imagem oficial direta)/i.test(`,
    'B. bloqueio editorial pega texto-desistência de imagem',
  );
  feito.push('B. conteudoDeBloqueioEditorial pega texto-desistência ("espere a arte", etc.)');

  return { cv, feito };
}

module.exports = { transformar };

// ---------------------------------------------------------------------------
// Execução direta: grava no banco.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const db = new DatabaseSync(DB);
  const linha = db.prepare('select nodes from workflow_entity where id=?').get(WF);
  if (!linha) throw new Error('workflow não encontrado em ' + DB);
  const nodes = JSON.parse(linha.nodes);
  const validar = nodes.find((x) => x.name === 'Validar antes de publicar');
  if (!validar) throw new Error('node "Validar antes de publicar" não encontrado');

  const { cv, feito } = transformar(String(validar.parameters.jsCode));
  validar.parameters.jsCode = cv;

  db.prepare('update workflow_entity set nodes=?, updatedAt=? where id=?').run(
    JSON.stringify(nodes),
    new Date().toISOString().replace('T', ' ').replace('Z', ''),
    WF,
  );

  console.log('Aplicado em ' + DB + ':\n');
  feito.forEach((f) => console.log('  ' + f));
}
