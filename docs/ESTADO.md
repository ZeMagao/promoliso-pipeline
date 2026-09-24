# Estado do sistema — 24/09/2026

Fotografia do que está rodando, com os números medidos no dia. Para reconstruir esta página:
os comandos de verificação estão no fim.

## No ar

| workflow | id | versão publicada | cadência |
|---|---|---|---|
| Produtor (Conteúdo Instagram v7.2) | `NL8eVLKErgnIXBQq` | `5dcd24c9` (24/09 18:29) | de 2 em 2 h, horas pares BRT |
| Publicador (fila) | `E27F7yVdsZRj` | `d1ff7341` (17/09 12:16) | 12:30 · 16:30 ter/qua/sex · 20:30 BRT |
| Watchdog de saúde | `MJly91QFGKep` | `dfb31644` | 2× por dia |
| Monitor de erros | `PRMLERR20260725A` | `9a276b27` | por evento (Error Trigger) |

| serviço (systemd) | estado |
|---|---|
| `promo-n8n`, `promo-renderer`, `promo-cdn`, `caddy` | ativos |
| 9 timers (`promo-vigia`, backup, token-check, analytics, writeback, detector de nó com erro) | ativos |

Stack: n8n 2.30.4 · Node 24.19 · Hetzner CX23 · backup diário para Cloudflare R2 (restauração
testada).

## Produção de conteúdo

| medida | valor |
|---|---|
| peças publicadas (total) | 67 |
| posts por dia (17–24/09) | 2 a 3 |
| rodadas do produtor sem erro após o conserto da capa (20/09) | 28 seguidas, 1 falha em 24/09 |
| fila hoje | 4 prontas, 8 falhadas no histórico |

## Resultado no Instagram (o que o conteúdo rende)

| janela | posts medidos | alcance médio | maior |
|---|---|---|---|
| D7 | 45 | **10,0** | 20 |

84 seguidores, engajamento próximo de zero. **O pipeline entrega; a audiência ainda não existe.**
Está medido em vez de escondido — e é o problema mais importante em aberto, acima de qualquer
item de encanamento abaixo.

## Defeitos abertos

| o quê | impacto medido | por que ainda não foi consertado |
|---|---|---|
| Capa que falha mata a rodada inteira | 1 rodada perdida em 24/09 (URL do `news.xbox.com` redirecionando para si mesma, 50 saltos) | precisa de decisão editorial: reprovar a peça ou tentar outra pauta |
| Retry do carrossel é all-or-nothing nos 6 filhos | em dia ruim do Meta derruba todos os slots (16/09: 3 de 3) | exige trocar o nó da comunidade por HTTP Requests; cirurgia de conexão já quebrou 3 dias de publicação |
| Mesma regra duplicada | URL do Cloudinary em 3 nós; limite de imagens em 2 workflows | auditoria iniciada e incompleta |
| Nós de IA pendurados sem uso | `Obter noticias` (pgvector) e `Embeddings OpenAI` não executam em nenhuma rodada; `Buscar capa` (Brave) e `Memória Postgres` estão desconectados; e o nó chamado `GPT 5.4 mini` é, na verdade, Anthropic `claude-sonnet-5` | limpeza cosmética, mas nome que mente já custou horas de diagnóstico neste projeto |
| Backup não cobre o código | `analytics/`, units, scripts e serviços vivem só no disco do VPS | o repositório cobre hoje; a origem do backup continua com 2 arquivos |

## Últimos deploys

| data | o que entrou | versão |
|---|---|---|
| 24/09 | segurança: legenda e slides só citam link/domínio da allowlist | `5dcd24c9` |
| 24/09 | segurança: URL de imagem não pode fechar o atributo `src` | `562cf5af` |
| 20/09 | ponte para hosts que bloqueiam o buscador do Cloudinary (capa parou de matar a rodada) | `9d7698da` |
| 17/09 | prompt: slides cabem nas fotos distintas, sem repetir | `ef9d227d` |
| 17/09 | fotos oficiais do jogo entram no acervo da pauta | `b990d5f2` |
| 17/09 | Game Pass e PS Plus garantidos 4×/mês | `67be2041` |
| 17/09 | imagens do carrossel servidas de host próprio | `d1ff7341` |
| 15/09 | reserva de fonte primária no corte dos 24; imagem do Blogger deixa de ser descartada | `52ab6c5f`, `81c54175`, `53b47a11` |

## Como conferir

```bash
# no repositório, sem acesso ao servidor
npm test
npm run test:mapa

# no VPS
systemctl is-active promo-n8n promo-renderer promo-cdn caddy
sudo -u promo node /usr/local/bin/promo-vigia.cjs --seco     # diagnóstico sem enviar alerta
sqlite3 /opt/promoliso/data/.n8n/database.sqlite \
  'select id,active,versionId=activeVersionId from workflow_entity where active=1;'
```
