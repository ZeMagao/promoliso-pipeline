# Vazão da fila — por que peça pronta apodrece, medido em 20/08/2026

**Estado:** portão, reordenação e faxina **prontos e NÃO deployados**. Comandos no fim.

## O número

14 dias de fila (06/08 a 19/08), lidos do banco de produção:

| | |
|---|---|
| peças criadas | 55 |
| publicadas | 30 |
| apodrecidas (passaram das 48 h) | 22 |

Cada peça apodrecida pagou curador (OpenAI), redator (Anthropic), de 6 a 8 renders no Chrome e o
mesmo tanto de upload no Cloudinary. É **40% do custo de produção no lixo** — e o carrossel variável,
no ar desde 20/08, encarece cada peça.

## Duas hipóteses que a medição derrubou

Ficam registradas porque as duas são plausíveis e vão voltar.

### 1. "O ramo B ignora a nota, e é por isso que apodrece" — NÃO

O `Selecionar READY` tem três ramos: `≤12 h` ordena por nota, `12–48 h` ordena por idade, `>48 h`
ordena por idade. O ramo do meio joga a nota fora, o que é verdade e é um furo — mas ele decide
**3 de 14 publicações desde 14/08**, não metade.

O "51%" que eu tinha calculado veio de classificar as 23 publicações **antigas** nesses três ramos.
Os ramos não existiam antes de `a3b37bc` (14/08, "publicador escolhe a notícia do DIA"): até ali o
publicador pegava a mais perto de vencer. A prova de que os números antigos são de outro código está
em 07/08 15:31, que tinha peça de 12 h disponível e publicou uma de **40,5 h** — coisa que o código
de hoje nunca faria.

> **Lição de método:** medir comportamento em cima de execuções que rodaram uma versão diferente do
> nó dá número bonito e sem sentido. O corte de regime tem que entrar na conta.

### 2. "O portão de 12 h do ramo A starva quem é de ontem" — starva, mas não é a causa

Ele starva mesmo: em 4 de 14 slots desde 15/08 deixou nota melhor na mesa, média **1,6 ponto por
slot**. É o preço de publicar notícia do mesmo dia, e numa faixa de nota de 70 a 88 isso é ruído —
escolha editorial defensável, não bug.

E afrouxar a janela **não reduz o apodrecimento**. Replay dos 14 dias:

| janela do dia | apodrecidas | nota média | idade média do que sai |
|---|---|---|---|
| 12 h (hoje) | 12 | 25,7 | 6,8 h |
| 6 h | 12 | 25,9 | 7,9 h |
| 0 h (nota decide tudo) | 12 | 26,2 | 8,2 h |

Reordenar muda **qual** peça sai. Não cria vaga.

## O que sobra: vazão

O cron do publicador (`0 30 12`, `0 30 20`, e `0 30 16` em ter/qua/sex) dá de 4 a 6 vagas em
qualquer janela de 48 h. O produtor roda 8× ao dia e entrega ~4. O excedente não tem onde caber.

Só produzir menos resolve. O `N` do portão saiu de **replay sequencial** — não de teoria:

| N | produção | apodrecidas | publicadas | apagão 24 h | 48 h | 72 h |
|---|---|---|---|---|---|---|
| — | 55 | 18 | 34 | 0 | 0 | 0 |
| 4 | 48 | 12 | 34 | 0 | 0 | 0 |
| **3** | **42** | **7** | **34** | **0** | **0** | **1** |
| 2 | 35 | 1 | 34 | 0 | 3 | 5 |
| 1 | 27 | 0 | 27 | 7 | — | — |

(colunas de apagão = slots que ficariam **sem post** se a produção parasse por aquele tempo, como
parou ~20 h em 13/08 quando o token foi invalidado)

**N = 3.** As 34 publicações ficam intactas em qualquer N ≥ 2 — o veto do PRD ("não aumente a
quantidade de publicações") continua valendo e nada de publicação se perde. N=2 é mais barato e perde
3 posts num apagão de 48 h; N=4 é mais seguro e deixa quase o dobro de peça apodrecendo.

> **A primeira derivação foi teórica e estava errada por conservadorismo:** "o pior caso do cron são
> 4 vagas em 48 h, logo N=4". Ela ignora que a produção **continua dentro da janela** — a fila se
> recompõe, então não é preciso estoque para 48 h inteiras.

## O que está pronto

| arquivo | o que faz |
|---|---|
| `design/patch_portao_da_fila.cjs` | 2 nós entre o `Schedule Trigger` e os 13 feeds; com 3 frescas o Code devolve `[]` e a rodada morre antes de pagar nada |
| `design/test_portao_da_fila.cjs` | harness: o 48 duplicado nos dois workflows, decisão do portão, a cirurgia contra o grafo real, e o replay dos 14 dias |
| `design/prova_portao_da_fila.cjs` | banco de provas na instância: `[]` corta o ramo mesmo? com controle positivo |
| `design/patch_ramo_b_por_nota.cjs` | ramo B ordena por nota. **Quase inerte hoje** — é seguro para quando a produção cair, não conserto |
| `design/limpar_fila_nota_zero.cjs` | apaga as 14 rows READY de nota 0 já vencidas; dry-run é o padrão |

### Onde o portão entra, e o que se perde

Entre o trigger e os feeds. É o ponto mais barato (não paga feed, `og`, curador, redator nem render)
e é **uma única saída para refiar** num workflow de 123 nós.

Custo: a rodada gateada não grava registro em `promoliso_curadoria_ai`, então não fica o retrato de
"que notícia existia às 14:00". Conferido no watchdog (`avaliar-saude.js`): ele alerta em (a) registro
de curadoria **com erro de cota** no último run e (b) 26 h sem publicar. Rodada gateada não gera
registro nenhum, então não dispara (a) por engano, e (b) não depende do produtor. **Ponto cego
aceito:** se o curador quebrar enquanto a fila está cheia, o alerta só vem por (b), com atraso.

### O 48 mora em dois workflows

`FRESCOR_MAX_H` está no publicador (`selecionar-ready.js`) e agora também no portão, dentro do
produtor. n8n não compartilha código entre workflows, então a cópia é inevitável — quem cobra que as
duas concordem é a seção A do harness. Divergir faz o portão contar como fresca uma peça que o
publicador já considera vencida, e a fila entope sem ninguém ver.

### As 14 rows e a reserva

A faxina exige três condições juntas: `READY`, `score = 0` e idade > 48 h. Em 20/08 as três
selecionam exatamente as mesmas 14 rows (146 h a 306 h de idade). A de idade é cinto de segurança
contra o dia em que a gravação da nota falhar.

Sobram **8** rows vencidas **com** nota. Ficam de propósito: o terceiro ramo do `Selecionar READY`
pega peça vencida quando não há nada fresco. Nunca foi acionado (0 das 37 publicações), mas é a única
rede contra um dia de produção zero.

## Ordem de deploy

O portão é cirurgia de nó, então passa pelo banco de provas primeiro.

```bash
# 1. prova na instância — não publica nada, não chama API
sudo -u promo node design/prova_portao_da_fila.cjs --criar
systemctl restart promo-n8n           # a prova dispara de 5 em 5 min
sudo -u promo node design/prova_portao_da_fila.cjs --ver
sudo -u promo node design/prova_portao_da_fila.cjs --remover
systemctl restart promo-n8n

# 2. só se a prova disser PROVADO
AUTO=1 /opt/promoliso/deploy-vps.sh design/patch_portao_da_fila.cjs

# 3. o seguro do ramo B (independente, sem nó novo)
AUTO=1 /opt/promoliso/deploy-vps.sh design/patch_ramo_b_por_nota.cjs

# 4. a faxina (dry-run primeiro, é o padrão)
sudo -u promo node design/limpar_fila_nota_zero.cjs
sudo -u promo node design/limpar_fila_nota_zero.cjs --apagar
```

Não deployar em cima dos slots: produtor de 2 em 2 horas das 8 às 22, publicador 12:30 e 20:30 todo
dia mais 16:30 em ter/qua/sex.

## O que fica em aberto

- O portão corta produção, não aumenta publicação. Se o objetivo mudar para publicar mais, o veto do
  PRD é que precisa mudar primeiro — o gargalo não é falta de peça.
- O apodrecimento não vai a zero com N=3: sobram 7 em 14 dias. Ir a 1 exige N=2 e o preço é perder
  post em apagão.
- `limit: 500` no nó de leitura. A fila tem 68 rows e cresce; no dia em que truncar, o portão
  **abre** (fail-open de propósito) e o pior caso volta a ser o comportamento de hoje.
