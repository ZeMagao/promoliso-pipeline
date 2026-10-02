// NÓ DO INSTAGRAM: RETRY POR FILHO, MENSAGEM REAL DO META E FILHO SEM ID VIRA ERRO (02/10/2026).
//
// Este patch não mexe em workflow nenhum. Ele edita o código do nó da comunidade
// `n8n-nodes-instagram-integrations` 1.6.0, no disco do VPS — o mesmo pacote que já carrega o
// patch do token no `GenericFunctions.js` (ver `ig-set-token.cjs`). Nenhuma conexão, nenhum nó,
// nenhuma expressão muda: cirurgia de conexão foi o que derrubou a publicação por 3 dias em 05/08.
//
// OS TRÊS DEFEITOS, LIDOS NO CÓDIGO DO NÓ (o de produção é byte a byte o 1.6.0 do npm):
//
//  1. `createCarouselPost` cria os filhos um a um e o primeiro erro derruba o carrossel inteiro.
//     O retry do n8n refaz OS SEIS — e o motor limita esse retry a 5 tentativas com no máximo
//     5 s entre elas (n8n-core workflow-execute.js), então as tentativas caem todas no mesmo
//     minuto ruim do Meta. Em 16/09, com ~60% de falha por imagem, publicar 6 filhos dava ~0,3%.
//     Agora cada filho tenta de novo SOZINHO (15 s, 30 s, 60 s), só quando o erro é passageiro.
//
//  2. O `catch` do nó guarda só `error.message`, e o NodeApiError troca a mensagem do Meta pelo
//     genérico "Bad request - please check your parameters". O texto real ("Media download has
//     failed", code 9004) só aparecia refazendo a chamada à mão. Agora vai na mensagem.
//
//  3. `if (childResponse.id) childIds.push(...)`: filho que volta sem id é DESCARTADO calado e o
//     carrossel sai com menos fotos. Agora é erro (passageiro: entra no retry).
//
// TETO DE TEMPO. O n8n daqui roda UMA execução por vez (N8N_CONCURRENCY_PRODUCTION_LIMIT=1):
// publicador demorado atrasa o produtor que vier atrás. Por isso cada passada do carrossel tem
// ORCAMENTO_MS de espera somada; estourou, o erro sobe como antes. Pior caso medido no papel:
// 3 passadas do nó × (6 filhos × ~10 s + 180 s) ≈ 12 min — o slot das :30 termina antes da hora par.
//
// O QUE NÃO MUDA: o caminho feliz faz exatamente as mesmas chamadas, na mesma ordem, com os
// mesmos corpos (o harness confere). `publishPost`, `createStory` e o resto só ganham a mensagem
// melhor no erro. O patch do token não é tocado.
//
// ⚠️ Reinstalar o pacote apaga este patch (e o do token). O promo-vigia confere as marcas.
//
//   sudo -u promo node design/patch_dist_instagram.cjs --dry        # confere âncoras, compila, não grava
//   sudo -u promo node design/patch_dist_instagram.cjs              # grava (com o n8n PARADO)
//   sudo -u promo node design/patch_dist_instagram.cjs --reverter   # volta byte a byte
// Pelo deploy-vps.sh: `deploy-vps.sh design/patch_dist_instagram.cjs` (para e religa o n8n).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIST = process.env.PROMO_IG_DIST
  || '/opt/promoliso/data/.n8n/nodes/node_modules/n8n-nodes-instagram-integrations/dist/nodes/Instagram';
const ARQ_NO = 'Instagram.node.js';
const ARQ_GF = 'GenericFunctions.js';
const MARCA_NO = 'PROMO_ESPERAS_FILHO';
const MARCA_GF = 'promoErroDoMeta';
const MARCA_TOKEN = 'igTokenStorePath';   // patch do token: tem que estar lá, e continuar lá

// ───────────────────────────────────────────── GenericFunctions.js: a mensagem do Meta
const EDICOES_GF = [
  {
    nome: 'erro do Meta vai na mensagem',
    de: `    try {
        return await this.helpers.request(options);
    }
    catch (error) {
        throw new n8n_workflow_1.NodeApiError(this.getNode(), error);
    }
}`,
    para: `    try {
        return await this.helpers.request(options);
    }
    catch (error) {
        // MENSAGEM DO META (patch PromoLiso 02/10). Sem isto o NodeApiError troca o texto do Meta
        // pelo genérico "Bad request - please check your parameters", e o nó só guarda a mensagem.
        const meta = promoErroDoMeta(error);
        const apiError = new n8n_workflow_1.NodeApiError(this.getNode(), error, meta ? { message: meta.texto } : {});
        if (meta) apiError.metaError = meta;
        throw apiError;
    }
}
// O n8n põe o corpo da resposta em \`error.error\` (objeto, ou string se não era JSON) e o status
// em \`error.statusCode\`. O Meta responde { error: { message, code, error_subcode, ... } }.
function promoErroDoMeta(error) {
    try {
        let corpo = error && (error.error !== undefined ? error.error : (error.response && (error.response.body || error.response.data)));
        if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch (e) { return null; } }
        const e = corpo && typeof corpo === 'object' ? corpo.error : null;
        if (!e || typeof e !== 'object') return null;
        const status = Number(error.statusCode || (error.response && error.response.status)) || null;
        const codigo = [e.code, e.error_subcode].filter((x) => x !== undefined && x !== null).join('/');
        const texto = ('Meta' + (status ? ' HTTP ' + status : '') + (codigo ? ' code ' + codigo : '') + ': '
            + [e.message, e.error_user_msg].filter(Boolean).join(' | ')).slice(0, 600);
        return { status, code: e.code, subcode: e.error_subcode, transient: e.is_transient === true, texto };
    }
    catch (x) {
        return null;
    }
}`,
  },
];

// ───────────────────────────────────────────── Instagram.node.js: retry por filho
const EDICOES_NO = [
  {
    nome: 'prazo de espera por passada do carrossel',
    de: `                        const childIds = [];`,
    para: `                        const childIds = [];
                        const promoPrazo = Date.now() + PROMO_ORCAMENTO_FILHOS_MS;`,
  },
  {
    nome: 'cada filho tenta de novo sozinho; sem id é erro',
    de: `                                const childResponse = await GenericFunctions_1.instagramApiRequest.call(this, 'POST', \`/\${igUserId}/media\`, childBody);
                                if (childResponse.id) {
                                    childIds.push(childResponse.id);
                                }`,
    para: `                                // RETRY POR FILHO (patch PromoLiso 02/10): antes, um filho que falhava derrubava
                                // os outros e o retry do n8n refazia todos no mesmo minuto ruim.
                                let childResponse;
                                for (let promoTentativa = 0; ; promoTentativa++) {
                                    try {
                                        childResponse = await GenericFunctions_1.instagramApiRequest.call(this, 'POST', \`/\${igUserId}/media\`, childBody);
                                        if (!childResponse || !childResponse.id) {
                                            // antes: o filho era descartado calado e o carrossel saía com menos fotos
                                            const semId = new n8n_workflow_1.NodeOperationError(this.getNode(), \`filho \${childIds.length + 1}: o Instagram respondeu sem id: \${JSON.stringify(childResponse).slice(0, 300)}\`);
                                            semId.promoSemId = true;
                                            throw semId;
                                        }
                                        break;
                                    }
                                    catch (promoErro) {
                                        const espera = PROMO_ESPERAS_FILHO[promoTentativa];
                                        if (espera === undefined || !promoFilhoRepetivel(promoErro) || Date.now() + espera > promoPrazo) {
                                            throw promoErro;
                                        }
                                        await new Promise((resolve) => setTimeout(resolve, espera));
                                    }
                                }
                                childIds.push(childResponse.id);`,
  },
  {
    nome: 'quais erros valem repetir',
    de: `exports.Instagram = Instagram;`,
    para: `exports.Instagram = Instagram;
// RETRY POR FILHO (patch PromoLiso 02/10). Espera crescente, só para erro passageiro, e um teto de
// tempo por passada: o n8n daqui roda uma execução por vez, e publicador lento atrasa o produtor.
const PROMO_ESPERAS_FILHO = [15000, 30000, 60000];
const PROMO_ORCAMENTO_FILHOS_MS = 180000;
function promoFilhoRepetivel(erro) {
    if (!erro) return false;
    if (erro.promoSemId) return true;
    const m = erro.metaError;
    if (m) {
        if (m.transient) return true;
        // 9004 / 2207052: "Media download has failed" — o buscador do Meta não baixou a imagem (16/09)
        if (m.code === 9004 || m.subcode === 2207052) return true;
        // 1: erro desconhecido, 2: serviço indisponível — os dois o Meta manda "tentar mais tarde"
        if (m.code === 1 || m.code === 2) return true;
        return Number(m.status) >= 500;
    }
    const status = Number(erro.httpCode || erro.statusCode || 0);
    if (status >= 500) return true;
    // sem status nenhum é rede (timeout, conexão caída): passageiro
    return !status;
}`,
  },
];

const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, edicoes, reverter, arquivo) {
  const ordem = reverter ? edicoes.slice().reverse() : edicoes;
  return ordem.reduce((acc, e) => {
    const de = lf(reverter ? e.para : e.de);
    const para = lf(reverter ? e.de : e.para);
    const vezes = acc.split(de).length - 1;
    if (vezes !== 1) {
      throw new Error(`${arquivo}: âncora "${e.nome}" apareceu ${vezes} vezes (esperava 1) — patch já aplicado, ou o pacote mudou`);
    }
    return acc.split(de).join(para);
  }, lf(texto));
}

const patchNo = (texto, reverter) => aplicar(texto, EDICOES_NO, reverter, ARQ_NO);
const patchGF = (texto, reverter) => aplicar(texto, EDICOES_GF, reverter, ARQ_GF);

// Compila como módulo CommonJS, sem executar.
function compila(texto, nome) {
  new vm.Script('(function (exports, require, module, __filename, __dirname) {' + texto + '\n})', { filename: nome });
}

module.exports = {
  DIST, ARQ_NO, ARQ_GF, MARCA_NO, MARCA_GF, MARCA_TOKEN, EDICOES_NO, EDICOES_GF, lf, patchNo, patchGF, compila,
};

if (require.main === module) {
  const DRY = process.argv.includes('--dry');
  const REVERTER = process.argv.includes('--reverter');
  try {
    const pNo = path.join(DIST, ARQ_NO);
    const pGF = path.join(DIST, ARQ_GF);
    const no = fs.readFileSync(pNo, 'utf8');
    const gf = fs.readFileSync(pGF, 'utf8');
    if (!gf.includes(MARCA_TOKEN)) throw new Error(`${ARQ_GF}: o patch do token não está lá — pacote reinstalado? resolver isso ANTES`);
    if (no.includes('\r\n') || gf.includes('\r\n')) throw new Error('arquivo com CRLF: o patch compara em LF e gravaria diferente — abortando');

    const novoNo = patchNo(no, REVERTER);
    const novoGF = patchGF(gf, REVERTER);
    compila(novoNo, ARQ_NO);
    compila(novoGF, ARQ_GF);
    if (!novoGF.includes(MARCA_TOKEN)) throw new Error('o patch do token sumiria — abortando');
    for (const e of EDICOES_NO) console.log(`OK  ${ARQ_NO}: ${e.nome}`);
    for (const e of EDICOES_GF) console.log(`OK  ${ARQ_GF}: ${e.nome}`);
    console.log(`OK  os dois compilam; patch do token preservado`);
    console.log(`    ${ARQ_NO} ${no.length} -> ${novoNo.length} bytes · ${ARQ_GF} ${gf.length} -> ${novoGF.length} bytes`);

    if (DRY) { console.log('DRY — nada gravado.'); process.exit(0); }

    // cópia do estado anterior, ao lado, com a data — o .bak antigo é do patch do token e fica intacto
    const sufixo = '.antes-' + (REVERTER ? 'reverter' : 'retry-filho') + '-' + new Date().toISOString().slice(0, 10);
    for (const [p, txt] of [[pNo, no], [pGF, gf]]) {
      if (!fs.existsSync(p + sufixo)) fs.writeFileSync(p + sufixo, txt);
    }
    // grava em arquivo temporário e renomeia: o n8n nunca lê um arquivo pela metade
    for (const [p, txt] of [[pNo, novoNo], [pGF, novoGF]]) {
      fs.writeFileSync(p + '.tmp', txt);
      fs.renameSync(p + '.tmp', p);
    }
    console.log('OK gravado.' + (REVERTER ? ' (revertido)' : '') + ' Religar o n8n para carregar.');
  } catch (e) {
    console.error('FAIL', e.message);
    process.exit(1);
  }
}
