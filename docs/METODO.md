# Como este projeto muda código que está no ar

O sistema publica sozinho, todo dia, numa conta real. Cada tentativa errada custa um post — e um
slot perdido não volta. Isso moldou um método, e este documento é ele.

---

## 1. Medir antes de mexer

A regra é simples: **hipótese plausível não vira patch**. Ela vira uma medição sobre dados reais,
e a medição frequentemente mata a hipótese. Alguns casos deste repositório:

| hipótese plausível | o que a medição mostrou |
|---|---|
| "A fila apodrece porque a ordem de escolha é ruim" | O gargalo era **vazão**: reordenar não cria vaga. Duas hipóteses caíram; o conserto virou um portão que encerra a rodada quando já há peça esperando — 40% menos desperdício |
| "O Cloudinary é pior que outro host para o buscador do Meta" | Medição **pareada no mesmo minuto**: 17/18 dos dois lados. A medição anterior comparava intervalos diferentes e confundia host com relógio |
| "Falta pauta de Game Pass/PS Plus nos feeds" | 32 itens do tema chegaram ao Curador em 7 semanas, quase todos nota ≥78. Só 3 viraram post: o problema era competição em três funis, não oferta |
| "O agente de redação ignora o limite de iterações" | O limite é **código morto** naquela versão do nó. O que faltava era output parser ligado |
| "n8n resolve expressão em `fixedCollection`" | Não resolve. Eu tinha lido o código-fonte e concluído que sim — **leitura não é execução**. Custou um slot e, antes disso, 3 dias de publicação quebrada |

A última linha é a mais importante do método: **ler documentação ou código não substitui rodar**.

## 2. Anatomia de um patch

`design/patch_*.cjs`. Cada um é um script Node que edita o `jsCode` de um nó no banco do n8n:

- **Troca por âncora exata**, não por regex frouxa. A âncora é um trecho literal do código que está
  no ar.
- **Aborta se a âncora aparecer 0 ou 2 vezes.** Zero significa "o nó mudou ou o patch já foi
  aplicado"; dois significa "eu ia editar o lugar errado". Nos dois casos ele não grava nada.
- **Confere antes de escrever**: `draft == publicado` (o agendamento roda a versão *publicada*, não
  o rascunho — patch que só mexe no rascunho não muda nada e parece que funcionou), e os `nodes` do
  banco batem com o `workflow_history`.
- **Compila o resultado** (`new Function(codigo)`) antes de gravar.
- **Tem `--dry` e `--reverter`.** O dry-run é leitura pura. Vários patches vão além e validam
  pré-condições externas: o de ponte de imagem, por exemplo, só libera se o serviço já responder
  com a imagem **e** o Cloudinary conseguir buscar dela.
- **O cabeçalho é a documentação da decisão**: o sintoma, a medição com números, o que foi
  descartado e o que o patch deliberadamente **não** faz.

## 3. Anatomia de um harness

`design/test_*.cjs`, um por patch na maioria dos casos. O que os torna úteis:

- **Rodam o código real do nó**, carregado de `workflows/` (que é o export do banco), dentro de um
  mini-ambiente que imita os globais do n8n (`$input`, `$()`, `$json`, `$execution`). Não há mock do
  que está sendo testado.
- **Provam os dois lados**: o que a mudança faz *e* o que ela não muda. Várias asserções existem só
  para garantir que um dia sem o caso novo sai **idêntico** ao de antes, item a item.
- **Usam dados reais** sempre que possível: títulos da tabela de curadoria, filas exportadas,
  execuções que aconteceram. Fixture inventada já escondeu bug aqui — dois deles vieram de seed que
  não imitava produção.
- **Fecham o círculo**: aplicar duas vezes tem que dar erro, e reverter+reaplicar tem que devolver o
  byte original.

Harnesses pegaram, antes do deploy, coisas como: reatribuir uma variável `const` dentro de uma
função do nó (estouraria em produção), um filtro de nome que casava "Control" dentro de "Controle
do PS5", e uma lista de hosts que aceitaria `127.0.0.1`.

**Provas de época × suíte viva.** Um harness feito para provar uma mudança envelhece quando outro
patch mexe no mesmo nó. `npm test` roda só os vivos — os que detectam o estado e montam o "antes"
revertendo o que está no ar. Os de época ficam no repo como registro, e `npm run test:epoca` os
roda sem cobrar verde. Fingir que estão todos verdes seria ruído.

## 4. Deploy

`deploy-vps.sh <patch.cjs>`, nesta ordem: **backup → dry-run → para o n8n → aplica → religa →
valida**. A validação confere que os workflows reativaram e que `draft == publicado`.

Depois do deploy, `export-workflows.cjs` despeja o banco de volta para `workflows/`. Sem esse passo
o repositório passa a mentir — e isso já aconteceu: em 17/09 um patch marcado "NÃO DEPLOYADO" no
título do commit **estava no ar**, e a âncora do patch seguinte só fechou depois de sincronizar com
o código vivo.

## 5. Banco de provas

Mecanismo novo se prova em **workflow temporário na instância real**, que não publica nada — nunca
no publicador, onde cada tentativa custa um post. Sempre com **controle positivo**: sem ele não se
distingue "o mecanismo novo falha" de "a bancada não é fiel".

Exemplo: para saber se o nó de código do n8n consegue falar com a internet, subiu um workflow
temporário com webhook e um nó que tentava a chamada **e** somava 2+2. A resposta foi
`{"controle_positivo":4,"tem_fetch":"undefined","erro":"fetch is not defined"}` — pergunta
respondida, bancada provada, e o desenho mudou: a busca foi para um serviço nosso, sem inserir nó
novo no workflow.

## 6. Armadilhas medidas (o catálogo)

Cada uma destas custou tempo ou um post, e está documentada no patch correspondente:

- **`\b` do JavaScript é ASCII.** `/\bperderá\b/` não casa `"perderá "` — o acento não fecha
  fronteira de palavra. Padrão com acento vai sem `\b`.
- **Regex montada em string morre calada.** `'\d+'` dentro de aspas vira `d+`. Use literal `/…/`.
- **O export do repo pode estar atrás do banco.** A verdade é o banco; sincronize antes de ancorar.
- **Dois fusos no mesmo banco.** O n8n grava execuções em UTC; os patches gravam `updatedAt` em
  hora local. Misturar erra por 3 h e faz parecer que algo já estava no ar.
- **"Já aplicado" é por nó, não por palavra.** Um patch que toca 3 nós deixa marcas diferentes em
  cada um; procurar a mesma palavra nos três faz o harness tentar reaplicar no que já está no ar.
- **Cuidado com o cron na hora do deploy.** Parar o n8n durante uma rodada mata a execução. Já
  aconteceu duas vezes aqui — a segunda está registrada no commit, com o horário exato.
- **Ler o valor não é executar o código.** Ver um `if` no fonte do n8n não garante o caminho que ele
  toma em runtime.

## 7. Como a produção é observada

- **Monitor de erros** (dentro do n8n): erro duro de qualquer workflow → e-mail.
- **Vigia** (fora do n8n, timer do systemd, 4× por dia): checa n8n de pé, workflow desligado na
  interface, horas sem publicar (26 h avisa, 48 h grave, 72 h crítico), fila vazia, serviços e
  disco. Fala por **push no Telegram**, com e-mail de reserva.
- **Analytics** (timers): alcance e interações D1/D3/D7 por post, com carimbo da versão dos prompts
  — para poder atribuir mudança de resultado a mudança de conteúdo.

O vigia mora fora do n8n de propósito: o watchdog antigo rodava dentro dele, então uma queda do n8n
levava junto quem deveria avisar da queda.
