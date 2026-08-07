# Tutorial completo — Contratar a VPS (Hetzner Cloud CX32)

Passo a passo pra **contratar e deixar o servidor pronto pra usar**. Depois que terminar
aqui, a migração do PromoLiso em si está no `MIGRACAO-HETZNER.md` (Partes B a J).

> **O que é a VPS:** um computador Linux ligado 24/7 na nuvem. Ele vai rodar o n8n no lugar
> da sua máquina Windows + túnel. Assim o PromoLiso não depende mais do seu PC ligado, e o
> endereço para de mudar a cada reinício (que é o que quebrava o login do Instagram).

---

## 0. Antes de começar — o que você precisa ter em mãos

- **Um email** (o mesmo que já usa serve).
- **Um cartão de crédito internacional** (Visa/Master que aceite compra em euro) **OU uma conta PayPal**.
  A cobrança é em **euro (€)**, então entra **IOF** e o câmbio do dia.
- **Um celular** (a verificação pode mandar SMS/pedir foto de documento).
- ~20 minutos. A **verificação da conta** às vezes demora algumas horas — por isso a gente
  faz ela **primeiro**.

**Quanto custa (estimativa 2026):** CX32 ≈ **€13 a €15/mês** (≈ **R$ 80–95/mês** no câmbio ~6,
+ IOF). Cobrança mensal, **sem fidelidade** — cancela quando quiser. Confirme o preço exato na
própria página no momento da compra.

> **Por que CX32 e não outro:** 4 vCPU / 8 GB RAM / 80 GB de disco NVMe. Sobra pro n8n +
> renderizador (Chrome headless puxa RAM). As linhas **CPX/CCX** subiram muito de preço em 2026;
> fique na linha **CX**. O CX22 (menor) apertaria com o Chrome; o CX32 é o ponto certo.

---

## 1. Criar a conta na Hetzner

1. Abra **https://www.hetzner.com/cloud** → botão **Sign Up** (ou vá direto em
   **https://accounts.hetzner.com/signUp**).
2. Preencha: email, senha forte, nome, endereço (use seu endereço real — a Hetzner valida
   dados de cobrança). País: **Brazil**.
3. Aceite os termos → **Register**.
4. Confirme o email: abra a caixa de entrada, clique no link de confirmação da Hetzner.

> ⚠️ Use dados **reais e consistentes** (nome = nome do cartão). A Hetzner reprova conta com
> dado que não bate, e aí trava a verificação.

---

## 2. Verificar a conta (faça AGORA — pode demorar)

Contas novas geralmente passam por uma **verificação anti-fraude** antes de liberar servidores.

1. Faça login em **https://console.hetzner.cloud** (o "Cloud Console").
2. Se pedir verificação, siga o fluxo: pode pedir **cadastrar o meio de pagamento** (cartão ou
   PayPal) e, em alguns casos, **foto de um documento** (RG/CNH/passaporte) e/ou uma **selfie**.
3. Cadastre o **pagamento**: menu do canto → **Payment** (ou aparece no onboarding).
   - **Cartão**: preencha os dados. Pode aparecer uma cobrança de teste de ~€1 (estorna).
   - **PayPal**: conecta a conta PayPal.
4. Envie os documentos se for pedido e **aguarde a aprovação** (minutos a algumas horas; chega por email).

> Enquanto a verificação não sai, o botão de criar servidor pode ficar bloqueado. É normal.
> Só seguir pro passo 4 quando estiver **verificada**. Use o tempo pra fazer o passo 3.

---

## 3. Gerar a chave SSH (no seu Windows) — antes de criar o servidor

A VPS **não** usa senha por email: você entra com uma **chave SSH** (mais seguro). Gere a chave
no seu PC **agora** pra já colar ela na criação do servidor.

1. Abra o **PowerShell** (menu Iniciar → digite "PowerShell").
2. Gere a chave (aperte **Enter** em tudo — pode deixar sem senha de chave):
   ```powershell
   ssh-keygen -t ed25519 -C "promoliso-vps"
   ```
   Isso cria dois arquivos em `C:\Users\Magal\.ssh\`:
   - `id_ed25519` → **chave privada** (SECRETA — nunca compartilhe, nunca suba pra lugar nenhum).
   - `id_ed25519.pub` → **chave pública** (é essa que vai pra Hetzner).
3. Copie o conteúdo da chave **pública** pra área de transferência:
   ```powershell
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard
   ```
   (ou abra o arquivo `.pub` no Bloco de Notas e copie tudo — é uma linha só começando com
   `ssh-ed25519 ...`).

> **Guarde bem** o arquivo `id_ed25519` (privado). Se perder, perde o acesso e tem que gerar
> outra. Não precisa (e não deve) enviar a privada pra ninguém.

---

## 4. Criar o servidor (CX32)

Já verificado e com a chave SSH copiada:

1. No **Cloud Console** (https://console.hetzner.cloud): clique em **+ New Project** →
   nomeie ex. `promoliso` → **Add Project** → entre nele.
2. Botão **Add Server** (ou **+ Create Server**). Preencha:
   - **Location (localização):** escolha **Ashburn (EUA)** ou **Nuremberg (Alemanha)**. Tanto faz
     pro PromoLiso (o servidor só conversa com APIs: OpenAI, Instagram, Cloudinary). Ashburn costuma
     ter latência menor pras APIs americanas.
   - **Image (sistema):** aba **Ubuntu** → **Ubuntu 24.04**.
   - **Type (tipo):** aba **Standard** (compartilhada) → linha **CX** → escolha **CX32**
     (4 vCPU / 8 GB / 80 GB). ⚠️ Não pegue CPX/CCX (mais caro).
   - **Networking:** deixe **IPv4 público** marcado (precisa pro domínio depois). IPv6 pode deixar.
   - **SSH keys:** clique em **Add SSH Key** → **cole** a chave pública (passo 3) → dê um nome
     (ex. `meu-notebook`) → **Add SSH Key**. Confirme que ela ficou **marcada** ✅.
   - **Volumes / Firewalls / Backups:** por ora deixe como está (o **Backup automático** da Hetzner
     custa +20% — opcional; a gente configura backup do banco à parte no runbook, Parte G).
   - **Name (nome do servidor):** ex. `promoliso-n8n`.
3. Confira o **preço mensal** que aparece no resumo à direita → **Create & Buy now**.
4. Em ~30 segundos o servidor sobe. Anote o **IP público** (algo como `5.161.xx.xx`) — aparece
   na lista de servidores. **Você vai usar esse IP no DNS do domínio e no SSH.**

---

## 5. Firewall — travar as portas (importante)

Deixe aberto só o necessário. Um n8n exposto na internet é alvo.

1. No Console: menu lateral **Firewalls** → **Create Firewall**.
2. Em **Inbound rules** (entrada), deixe só:
   - **SSH** — TCP porta **22**
   - **HTTP** — TCP porta **80**
   - **HTTPS** — TCP porta **443**
   - **NÃO** abra 5678 (n8n) nem 5680 (renderizador) — eles ficam só internos (`127.0.0.1`).
3. Em **Apply to** → selecione o servidor `promoliso-n8n` → **Create Firewall**.

> Regra de ouro: o n8n **nunca** fica direto na porta 5678 pública. Quem atende a internet é o
> Caddy (HTTPS na 443) e ele repassa pro n8n interno. Isso está na Parte B/C do runbook.

---

## 6. Primeiro acesso ao servidor (testar o SSH)

1. No **PowerShell** do Windows:
   ```powershell
   ssh root@IP_DO_SERVIDOR
   ```
   (troque `IP_DO_SERVIDOR` pelo IP que anotou; ex.: `ssh root@5.161.10.20`).
2. Na primeira vez ele pergunta `Are you sure you want to continue connecting?` → digite **yes** → Enter.
3. Se abrir um terminal `root@promoliso-n8n:~#`, **funcionou** 🎉 — você está dentro da VPS.
   - Não pediu senha porque usou a chave SSH. Perfeito.
4. Sair do servidor: digite `exit` (você volta pro PowerShell).

> Se der **"Permission denied (publickey)"**: a chave pública não entrou certo na criação do
> servidor. Dá pra corrigir no Console (Server → **Rescue**/console web) ou recriar o servidor
> colando a `.pub` de novo. Confira que copiou a linha inteira do `id_ed25519.pub`.

---

## 7. (Em paralelo) O domínio — você vai precisar de um

A VPS resolve o "PC ligado 24/7", mas o **ganho principal** (endereço fixo que não quebra o
Instagram) precisa de um **domínio** apontando pro IP da VPS.

- Se **já tem** um domínio: ótimo, vai usar um subdomínio tipo `n8n.seudominio.com.br`.
- Se **não tem**: registre um. Opções comuns:
  - **.com.br** no **registro.br** (~R$ 40/ano, precisa CPF/CNPJ).
  - **.com** em registrador internacional (Cloudflare, Namecheap, etc.) — paga em dólar.
- **Não precisa configurar o DNS agora.** Isso é o começo da migração (Parte B do runbook):
  criar um registro **A** `n8n.seudominio.com.br` → **IP da VPS**.

> Publicar no Instagram **não** depende do domínio (usa o `ig-token.json`). O domínio conserta o
> fluxo de **reconectar** a credencial e dá HTTPS estável. Mas já deixe o domínio contratado.

---

## ✅ Pronto — o que você tem agora

- Conta Hetzner **verificada** e com pagamento cadastrado.
- Servidor **CX32 / Ubuntu 24.04** rodando, com **IP público** anotado.
- **Firewall** liberando só 22/80/443.
- **Chave SSH** funcionando (você consegue entrar com `ssh root@IP`).
- (Idealmente) um **domínio** contratado pra apontar depois.

## ➡️ Próximo passo — a migração

Agora é seguir o **`MIGRACAO-HETZNER.md`** a partir da **Parte B** (domínio/DNS) → **Parte C**
(instalar Node, Chrome, Caddy) → **D** (copiar o projeto + `data/` com o n8n do Windows **parado**)
→ ... → **J** (cutover: desligar o Windows e a VPS assumir). Me chame quando estiver com o
servidor de pé que eu te guio comando por comando na migração.

---

### Erros comuns / dicas
- **Verificação travada:** responda o email da Hetzner com os documentos pedidos; não crie 2 contas.
- **Cobrança em euro:** confira com seu banco se o cartão libera compra internacional (evita recusa).
- **Cancelar depois:** Server → **Delete** para de cobrar (cobra por hora/mês proporcional). Sem multa.
- **Guardar a chave privada:** faça um backup do arquivo `C:\Users\Magal\.ssh\id_ed25519` num lugar
  seguro (sem ela, você perde o acesso ao servidor).
- **Não abrir a 5678:** se algum tutorial mandar expor o n8n direto, ignore — a gente usa Caddy+HTTPS.
