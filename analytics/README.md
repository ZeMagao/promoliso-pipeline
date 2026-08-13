# Módulo de analytics — Fase 1 do PRD

Registra o metadado de toda publicação, coleta métricas em D+1/D+3/D+7, versiona prompts e
templates e entrega um relatório semanal — **sem tocar em nenhum dos dois workflows que publicam**.

Inventário da arquitetura, mapa do banco, credenciais e pendências: **`../docs/FASE0-INVENTARIO.md`**.

---

## A decisão central: por que fora do n8n

O PRD manda acoplar, não substituir, e proíbe que uma falha de analytics impeça uma publicação.
Havia duas formas de fazer isso:

| | workflow n8n novo | processo externo + timer |
|---|---|---|
| isolamento da publicação | bom | **total** — nem compartilha processo |
| acesso a `~/ig-token.json` | Code node do n8n é sandboxed (sem `fs`) | direto |
| leitura do `execution_data` | precisaria expor o banco a si mesmo | direto |
| risco de cirurgia de workflow | existe | **zero** |
| precedente no projeto | — | `promo-fila-writeback.cjs` + `promo-writeback.timer` |

Escolhemos o **processo externo**, seguindo o precedente. Cirurgia de workflow foi o que quebrou a
publicação por 3 dias em 05/08 (carrossel variável). Este módulo não insere nó, não religa conexão,
não republica versão. O pior caso de uma falha aqui é o timer marcar `failed`.

---

## Um campo, um dono

Os dois bugs de 05–06/08 foram da mesma classe: **uma regra escrita em dois lugares que precisavam
concordar, divergindo sem ninguém ver**. O módulo foi desenhado contra isso:

| campo / regra | dono único |
|---|---|
| `operational_status`, `instagram_post_id`, `instagram_story_id`, `carousel_container_id`, `published_at` | `promo-fila-writeback.cjs` (já existia) |
| as 22 colunas novas de `promoliso_publicacoes` | `coletor-publicacoes.cjs` |
| forma das tabelas | `lib/schema.cjs` (migrations, coletores e testes leem daqui) |
| normalização de URL | `lib/chaves.cjs`, **testada contra o snapshot de produção** |
| toda escrita em Data Table | `lib/tabela.cjs` (único `INSERT`/`UPDATE` do módulo) |

A trava do primeiro item é código, não convenção: o coletor apaga esses 5 campos do objeto antes de
gravar, e `test_idempotencia.cjs` (I6) compara os valores antes e depois para provar.

---

## O que roda

| script | quando | RF |
|---|---|---|
| `coletor-publicacoes.cjs` | de hora em hora (`:20`) | RF-01, RF-11 |
| `coletor-metricas.cjs` | 09:10, 15:10, 22:10 | RF-02 |
| `registrar-versoes.cjs` | diário 07:40 | RF-05 |
| `relatorio-semanal.cjs` | segunda 08:05 | RF-04 |
| `linha-de-base.cjs` | sob demanda (Fase 0) | — |
| `migrate.cjs` | sob demanda | migrations |

A frequência horária do coletor de publicações **não é capricho**: `execution_data` é podado em
168 h e é de lá que sai boa parte do metadado. O que ele copia para a Data Table é durável.

---

## Decisões técnicas

**Versão = hash do conteúdo, não número digitado.** Prompt e template vivem num blob JSON dentro do
banco. Um rótulo digitado à mão poderia divergir do que roda (já aconteceu). Então
`lib/versoes.cjs` calcula o `sha256` do que está no banco e busca o rótulo em
`versoes/registry.json`. Conteúdo sem rótulo aparece como `NAO-REGISTRADA` e **gera alerta** — drift
vira evento, não surpresa. Rollback continua sendo deployar o conteúdo antigo; o hash volta a bater
com o rótulo antigo sozinho.

**Hash de lógica vs. hash completo.** Os builders têm fonte e mascote em base64 (~387 KB). Trocar a
fonte mudaria o hash sem o layout mudar. O rótulo é ancorado no hash com os literais gigantes
substituídos por `<ASSET:tamanho>`; o hash completo fica gravado ao lado, para auditoria.

**Ids de Data Table determinísticos.** O id vira o nome da tabela física. Aleatório, a migration não
seria idempotente nem reversível e a documentação não poderia citar a tabela. `lib/ids.cjs` deriva
de `sha256(nome)`.

**Status `PRE_INSTALACAO`.** Janela que já tinha fechado quando o módulo foi instalado é
fisicamente incoletável (a API não devolve insight retroativo). Ela é **registrada** e **excluída
do denominador** da taxa. Sem isso o primeiro dia de operação nasceria com taxa perto de zero e
dispararia alerta falso — foi o que apareceu no primeiro teste em homologação.

**Cliente da API tolerante.** Quais métricas a conta pode ler é pendência de Fase 0. Se a Meta
recusar uma métrica, o cliente a remove e tenta de novo com o resto. Uma permissão faltando degrada
a coleta em vez de zerá-la, e o motivo fica na coluna `erro`.

**Nenhum segredo novo.** O token vem do mesmo arquivo que o community node já usa. O e-mail delega
em `promo-alerta.sh`, que decifra a credencial SMTP do próprio n8n. `lib/log.cjs` redige
token/senha/chave de tudo que é logado, e `test_isolamento_e_segredos.cjs` varre o módulo inteiro
atrás de literal que pareça segredo (já pegou dois fixtures de teste).

### Desvios do PRD (registrados)

1. **Entidade "Imagem" sem tabela própria.** O PRD §12 a lista, mas o hash perceptual e o banco de
   apoio são RF-07/RF-08, que são **P1** e dependem dos P0. As imagens usadas ficam em
   `imagens_urls` / `imagens_origem` / `imagens_unicas` em `promoliso_publicacoes`, que é o "Dados
   visuais" mínimo do PRD §11. Quando RF-07 for implementado, a tabela nasce com o hash junto.
2. **Entidade "Link de afiliado" não criada.** RF-10 é P1 e depende das pendências §16.8 e §16.10.
3. **"Versão vigente" e não "versão histórica" por post.** Sem instrumentar o workflow por dentro
   (o que exigiria cirurgia), o mais próximo da verdade é o rótulo vigente no momento da coleta —
   que roda de hora em hora. A precisão real vem de `promoliso_versoes.primeira_vez_em/ultima_vez_em`.

---

## Rodar local / homologação (sem nenhuma credencial real)

```bash
npm install                       # `npm ci` NÃO funciona neste projeto (lock fora de sincronia)

# 1. banco de homologação descartável, com a mesma forma do banco de produção
node analytics/homolog/seed.cjs --saida=/tmp/homolog.sqlite --posts=14

# 2. ambiente (o próprio seed imprime estas linhas no fim)
export PROMO_DB=/tmp/homolog.sqlite
export PROMO_ANALYTICS_MOCK=1        # zero rede
export PROMO_ALERTAS=0               # não tenta mandar e-mail
export PROMO_MARCO_ZERO="$(node -e 'console.log(new Date(Date.now()-90*864e5).toISOString())')"
export PROMO_JANELA_TOLERANCIA_H=2400   # os dados do seed são retroativos

# 3. o ciclo inteiro
node analytics/migrate.cjs up
node analytics/coletor-publicacoes.cjs
node analytics/coletor-metricas.cjs
node analytics/registrar-versoes.cjs
node analytics/relatorio-semanal.cjs --dry     # imprime o relatório no terminal
node analytics/linha-de-base.cjs --dry

# 4. desfazer
node analytics/migrate.cjs down
```

### Testes

```bash
node analytics/test/rodar-todos.cjs
```

7 arquivos, ~504 verificações, cada um com seu banco descartável. Nenhum toca produção, nenhum
precisa de credencial.

---

## Instalar no VPS

```bash
sudo bash /opt/promoliso/analytics/systemd/instalar.sh
```

Faz, nesta ordem: backup → testes → dry-run → **para o n8n** → migrations → religa → carimba a
linha de base das versões → primeira coleta → instala e liga os timers → valida.
`AUTO=1` para não-interativo.

Depois, **commite `analytics/versoes/registry.json`** — é o arquivo que liga hash a rótulo humano.

### Migrations à mão

```bash
node analytics/migrate.cjs status
node analytics/migrate.cjs up   --dry      # abre o banco em READONLY: impossível gravar
node analytics/migrate.cjs up
node analytics/migrate.cjs down --dry
node analytics/migrate.cjs down            # reverte tudo
node analytics/migrate.cjs up   --ate=001  # aplica só até a 001
```

O runner **recusa** rodar com a porta 5678 de pé (n8n no ar).

### Rollback

```bash
sudo bash /opt/promoliso/analytics/systemd/desinstalar.sh                  # só desliga os timers
sudo REVERTER_BANCO=1 bash /opt/promoliso/analytics/systemd/desinstalar.sh # + reverte o banco
```

Nível 3, se algo muito errado acontecer: restaurar o `.tar.gz` (ver `OPERACAO-VPS.md` §Restaurar).
Os workflows não são tocados pela Fase 1 — não há rollback de workflow a fazer.

---

## Operar

```bash
systemctl list-timers 'promo-analytics-*'
journalctl -u promo-analytics-coletor -n 40 --no-pager
journalctl -u promo-analytics-metricas -n 40 --no-pager
ls -la /opt/promoliso/analytics/logs/          # JSONL por script e por dia
```

Rodar na hora, sem esperar o timer:

```bash
sudo -u promo node /opt/promoliso/analytics/coletor-metricas.cjs --verbose
sudo -u promo node /opt/promoliso/analytics/relatorio-semanal.cjs --semana=2026-W32 --dry
```

### Alertas que este módulo emite

| assunto | significa |
|---|---|
| `analytics: publicação sem registro` | a fila prova que publicou e não havia linha em `promoliso_publicacoes` |
| `analytics: coleta de métricas abaixo de 95%` | RF-02 em risco: token, permissão da Meta ou mídia apagada |
| `versão de prompt/template não registrada` | alguém deployou conteúdo que não está no `registry.json` |

Todos vão para o mesmo canal dos alertas que já existiam (`promo-alerta.sh`).
