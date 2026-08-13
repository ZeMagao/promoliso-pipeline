// Ids no formato do n8n (nanoid de 16 chars, alfabeto alfanumérico) — porém DETERMINÍSTICOS.
//
// POR QUE DETERMINÍSTICO E NÃO ALEATÓRIO
// O id da Data Table vira o nome da tabela física (`data_table_user_<id>`). Se ele fosse aleatório,
// a migration não seria idempotente (rodar duas vezes criaria duas tabelas), a migration de rollback
// não saberia o que apagar, e a documentação não poderia citar o nome da tabela. Derivando de
// sha256(nome), o mesmo nome sempre dá o mesmo id — em qualquer máquina, hoje ou daqui a um ano.
//
// Colisão com id existente é checada na migration antes de criar; o alfabeto de 62^16 torna o
// acaso irrelevante, mas a checagem existe porque "improvável" não é "impossível".
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function idDeterministico(semente, tamanho = 16) {
  let saida = '';
  let bloco = 0;
  while (saida.length < tamanho) {
    const h = crypto.createHash('sha256').update(`promoliso:${semente}:${bloco}`).digest();
    for (const byte of h) {
      if (saida.length >= tamanho) break;
      // rejeição de sobra: 62*4=248, bytes >=248 são descartados para não enviesar o alfabeto
      if (byte >= 248) continue;
      saida += ALFABETO[byte % ALFABETO.length];
    }
    bloco++;
  }
  return saida;
}

module.exports = { idDeterministico, ALFABETO };
