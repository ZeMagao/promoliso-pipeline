"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccessToken = getAccessToken;
exports.getInstagramBusinessAccountId = getInstagramBusinessAccountId;
exports.instagramApiRequest = instagramApiRequest;
exports.instagramApiRequestAllItems = instagramApiRequestAllItems;
exports.validateSignature = validateSignature;
const n8n_workflow_1 = require("n8n-workflow");
const crypto = __importStar(require("crypto"));
function logIgToken(linha) {
    try {
        require('fs').appendFileSync(
            require('path').join(require('os').homedir(), 'ig-token-debug.log'),
            new Date().toISOString() + ' ' + linha + '\n',
        );
    }
    catch (e) { }
}
// ---------------------------------------------------------------------------
// Persistência do token de 60 dias (Instagram Login / graph.instagram.com).
//
// O problema histórico: a troca ig_exchange_token pegava um token de 60 dias a
// cada execução mas NUNCA gravava. Quando o token base da credencial vencia, a
// troca também morria e a publicação parava em silêncio (OAuthException 190).
//
// Solução: guardamos o token longo + validade num arquivo (~/ig-token.json),
// que sobrevive a restart do n8n e à troca do túnel. Renovamos via
// ig_refresh_token quando faltam menos de REFRESH_MARGIN dias — tokens do
// Instagram Login são renováveis indefinidamente desde que refrescados dentro
// da janela de 60 dias. Só é preciso semear UM token válido uma vez (reconexão
// no n8n OU `node ig-set-token.cjs <TOKEN>`); daí em diante se mantém sozinho.
// ---------------------------------------------------------------------------
function igTokenStorePath() {
    return require('path').join(require('os').homedir(), 'ig-token.json');
}
function igReadStore() {
    try {
        return JSON.parse(require('fs').readFileSync(igTokenStorePath(), 'utf8'));
    }
    catch (e) {
        return null;
    }
}
function igWriteStore(token, expiresIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + (Number(expiresIn) || 0);
    try {
        require('fs').writeFileSync(igTokenStorePath(), JSON.stringify({ token, expiresAt }), { mode: 0o600 });
    }
    catch (e) { }
    return expiresAt;
}
async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const REFRESH_MARGIN = 10 * 24 * 3600; // renova quando faltam <10 dias

    // 1. Token de 60 dias persistido — o caminho normal do dia a dia.
    const store = igReadStore();
    if (store && store.token && store.expiresAt) {
        if (store.expiresAt - now > REFRESH_MARGIN) {
            return store.token;
        }
        if (store.expiresAt > now) {
            // Ainda válido, mas perto de vencer: renova e persiste.
            try {
                const r = await this.helpers.request({
                    method: 'GET',
                    url: 'https://graph.instagram.com/refresh_access_token',
                    qs: { grant_type: 'ig_refresh_token', access_token: store.token },
                    json: true,
                });
                if (r && r.access_token) {
                    igWriteStore(r.access_token, r.expires_in);
                    logIgToken('REFRESH_OK expires_in=' + (r.expires_in || '?'));
                    return r.access_token;
                }
            }
            catch (error) {
                logIgToken('REFRESH_FAIL status=' + (error && error.statusCode));
            }
            return store.token; // renovação falhou, mas o token ainda vale
        }
        logIgToken('STORE_EXPIRED expiresAt=' + store.expiresAt);
    }

    // 2. Bootstrap: troca o token da credencial (curto ou longo) por um de 60
    //    dias e persiste. Cobre a primeira execução após uma reconexão no n8n.
    const credentials = (await this.getCredentials('instagramOAuth2Api'));
    const oauthTokenData = credentials.oauthTokenData;
    const accessToken = oauthTokenData === null || oauthTokenData === void 0 ? void 0 : oauthTokenData.access_token;
    const clientSecret = credentials.clientSecret;
    if (accessToken && clientSecret) {
        try {
            const exchanged = await this.helpers.request({
                method: 'GET',
                url: 'https://graph.instagram.com/access_token',
                qs: {
                    grant_type: 'ig_exchange_token',
                    client_secret: clientSecret,
                    access_token: accessToken,
                },
                json: true,
            });
            if (exchanged && exchanged.access_token) {
                igWriteStore(exchanged.access_token, exchanged.expires_in);
                logIgToken('BOOTSTRAP_OK expires_in=' + (exchanged.expires_in || '?'));
                return exchanged.access_token;
            }
            logIgToken('BOOTSTRAP_EMPTY body=' + JSON.stringify(exchanged).slice(0, 200));
        }
        catch (error) {
            const body = error && error.response && (error.response.body || error.response.data);
            const msg = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : (error && error.message);
            logIgToken('BOOTSTRAP_FAIL status=' + (error && error.statusCode) +
                ' metaMsg=' + String(msg || 'sem corpo').slice(0, 400));
        }
    }
    else {
        logIgToken('BOOTSTRAP_SEM_CREDENCIAL accessToken=' + Boolean(accessToken) + ' clientSecret=' + Boolean(clientSecret));
    }

    // 3. Últimos recursos.
    if (store && store.token && store.expiresAt > now) {
        return store.token;
    }
    if (accessToken) {
        return accessToken; // pode estar vencido; o erro a seguir será claro
    }
    throw new Error('Token do Instagram indisponível. Semeie um token válido: ' +
        'rode "node ig-set-token.cjs <TOKEN_LONGO>" ou reconecte a credencial no n8n.');
}
async function getInstagramBusinessAccountId() {
    try {
        const accessToken = await getAccessToken.call(this);
        const options = {
            method: 'GET',
            url: 'https://graph.instagram.com/v23.0/me',
            qs: {
                access_token: accessToken,
                fields: 'id,name,account_type,media_count,user_id,username',
            },
            json: true,
        };
        const response = await this.helpers.request(options);
        if (response && response.id) {
            return response.id;
        }
        throw new Error('No Instagram Business Account found. Make sure your Facebook Page is connected to an Instagram Business Account.');
    }
    catch (error) {
        throw new n8n_workflow_1.NodeApiError(this.getNode(), error, {
            message: 'Failed to fetch Instagram Business Account ID, Error: ' + error.message,
        });
    }
}
async function instagramApiRequest(method, endpoint, body = {}, qs = {}) {
    const accessToken = await getAccessToken.call(this);
    const options = {
        method,
        body,
        qs: {
            ...qs,
            access_token: accessToken,
        },
        url: `https://graph.instagram.com/v23.0${endpoint}`,
        json: true,
    };
    if (Object.keys(body).length === 0) {
        delete options.body;
    }
    try {
        return await this.helpers.request(options);
    }
    catch (error) {
        throw new n8n_workflow_1.NodeApiError(this.getNode(), error);
    }
}
async function instagramApiRequestAllItems(method, endpoint, body = {}, qs = {}) {
    var _a, _b;
    const returnData = [];
    let responseData;
    qs.limit = 100;
    do {
        responseData = await instagramApiRequest.call(this, method, endpoint, body, qs);
        if (responseData.data) {
            returnData.push(...responseData.data);
        }
        if ((_a = responseData.paging) === null || _a === void 0 ? void 0 : _a.next) {
            const url = new URL(responseData.paging.next);
            qs.after = url.searchParams.get('after');
        }
        else {
            break;
        }
    } while ((_b = responseData.paging) === null || _b === void 0 ? void 0 : _b.next);
    return returnData;
}
function validateSignature(payload, signature, appSecret) {
    const hmac = crypto.createHmac('sha256', appSecret);
    const expectedSignature = 'sha256=' + hmac.update(payload).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }
    catch (error) {
        return false;
    }
}
//# sourceMappingURL=GenericFunctions.js.map