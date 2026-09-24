/**
 * (A) Polir o corte de texto e (B) tornar a publicação AUTÔNOMA.
 *
 * Contexto: com toda a validação determinística (semana1c–1f) e o token
 * resolvido, o usuário quer o fluxo rodando no schedule e publicando sozinho,
 * sem os formulários de aprovação. Como ninguém mais revisa, polimos antes o
 * corte de texto que deixava fragmentos pendurados.
 *
 * (A) limitar() no "Validar antes de publicar": passa a terminar numa fronteira
 *     de frase dentro do limite (evita "...O impacto." / "...offline. Se.").
 *     Só cai no corte por palavra quando não há frase completa no limite; nesse
 *     caso remove também conjunções penduradas (que/se/com/ou/mas...).
 *
 * (B) Os dois gates humanos ("Aprovar pauta curada" e "Aprovar publicação") são
 *     nós wait (resume=form). Convertemos cada um num nó Set que injeta
 *     decisao='APROVAR' e repassa os demais campos. O downstream lê $json.decisao
 *     igual ao que o formulário mandava, então o resto do fluxo roda sem
 *     alteração — só que sem esperar humano. O wait TÉCNICO "Aguardar
 *     processamento do carrossel" NÃO é tocado.
 *
 * Uso: node patches/semana1g-autonomo-e-texto.cjs [--dry] [caminho-do-sqlite]
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
const GATES = ['Aprovar pauta curada', 'Aprovar publicação'];

const LIMITAR_ANTIGO = String.raw`function limitar(value, maximo) {
  const texto = String(value || '').trim();
  if (texto.length <= maximo) return texto;
  const limiteDoCorpo = Math.max(1, maximo - 1);
  const recorte = texto.slice(0, limiteDoCorpo + 1);
  const ultimaPalavra = recorte.lastIndexOf(' ');
  let resultado = (ultimaPalavra >= Math.floor(limiteDoCorpo * 0.65)
    ? recorte.slice(0, ultimaPalavra)
    : texto.slice(0, limiteDoCorpo)).replace(/[,:;\s.]+$/, '');
  const palavrasPendentes = /\s+(?:a|as|o|os|e|de|da|das|do|dos|em|na|nas|no|nos|para|por)$/i;
  while (palavrasPendentes.test(resultado)) {
    resultado = resultado.replace(palavrasPendentes, '').trim();
  }
  return resultado.replace(/[,:;\s.]+$/, '') + '.';
}`;

const LIMITAR_NOVO = String.raw`function limitar(value, maximo) {
  const texto = String(value || '').trim();
  if (texto.length <= maximo) return texto;
  // Preferir terminar numa fronteira de frase dentro do limite, para não deixar
  // um fragmento da frase seguinte pendurado (ex.: "...O impacto." / "...Se.").
  const janela = texto.slice(0, maximo);
  const fimFrase = Math.max(
    janela.lastIndexOf('. '),
    janela.lastIndexOf('! '),
    janela.lastIndexOf('? '),
  );
  if (fimFrase >= Math.floor(maximo * 0.5)) {
    return texto.slice(0, fimFrase + 1).trim();
  }
  // Fallback: corta em palavra e remove conjunção/preposição pendurada.
  const limiteDoCorpo = Math.max(1, maximo - 1);
  const recorte = texto.slice(0, limiteDoCorpo + 1);
  const ultimaPalavra = recorte.lastIndexOf(' ');
  let resultado = (ultimaPalavra >= Math.floor(limiteDoCorpo * 0.65)
    ? recorte.slice(0, ultimaPalavra)
    : texto.slice(0, limiteDoCorpo)).replace(/[,:;\s.]+$/, '');
  const palavrasPendentes = /\s+(?:a|as|o|os|e|de|da|das|do|dos|em|na|nas|no|nos|para|por|que|se|com|ou|mas|um|uma)$/i;
  while (palavrasPendentes.test(resultado)) {
    resultado = resultado.replace(palavrasPendentes, '').trim();
  }
  return resultado.replace(/[,:;\s.]+$/, '') + '.';
}`;

function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  if (texto.split(de).length > 2) throw new Error('alvo ambíguo (' + rotulo + ')');
  return texto.split(de).join(para);
}

function aplicar(nodes) {
  const feito = [];

  // (A) limitar()
  const validar = nodes.find((x) => x.name === 'Validar antes de publicar');
  if (!validar) throw new Error('node "Validar antes de publicar" não encontrado');
  validar.parameters.jsCode = trocar(
    String(validar.parameters.jsCode),
    LIMITAR_ANTIGO,
    LIMITAR_NOVO,
    'A. limitar() termina em fronteira de frase',
  );
  feito.push('A. limitar() poliu o corte de texto (fim de frase)');

  // (B) gates -> Set com decisao=APROVAR
  for (const nome of GATES) {
    const n = nodes.find((x) => x.name === nome);
    if (!n) throw new Error('node não encontrado: ' + nome);
    if (n.type !== 'n8n-nodes-base.wait') {
      throw new Error('node "' + nome + '" não é wait (type=' + n.type + '); já convertido?');
    }
    n.type = 'n8n-nodes-base.set';
    n.typeVersion = 3.4;
    n.parameters = {
      assignments: {
        assignments: [
          {
            id: 'auto-aprovar-' + (n.id || nome).slice(0, 8),
            name: 'decisao',
            value: 'APROVAR',
            type: 'string',
          },
        ],
      },
      includeOtherFields: true,
      options: {},
    };
    delete n.webhookId; // Set não tem webhook/form
    feito.push('B. "' + nome + '" convertido wait->Set (decisao=APROVAR)');
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
