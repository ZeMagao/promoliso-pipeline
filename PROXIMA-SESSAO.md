# Próxima sessão — checklist

Migração pro VPS **concluída e validada** em 2026-08-05. Operação: **`OPERACAO-VPS.md`**.
Repo: https://github.com/ZeMagao/promoliso-n8n (privado).

---

## AÇÕES SUAS (nenhuma eu consigo fazer daqui)

### 1. 🔴 URGENTE — porta do SMTP (o alerta está morto)
A **Hetzner bloqueia saída nas portas 25 e 465**; só a **587** passa. A credencial `smtp` do n8n
não tem porta definida → o n8n usa o default **465** → **todo alerta por e-mail dá timeout calado**
(no Windows funcionava). Ou seja: hoje, se o pipeline quebrar, ninguém é avisado.

**Conserto (30 s):** https://n8n.promoliso.com.br → Credentials → **"SMTP account"** →
**Port = `587`** e **desligar SSL/TLS** (fica STARTTLS) → Save.
Depois teste no VPS: `echo "teste" | /usr/local/bin/promo-alerta.sh "[PromoLiso] teste"`

### 2. Backup externo no Cloudflare R2 (falta só a credencial)
`rclone` instalado, upload já integrado no backup diário, retenção 30 dias no R2, e-mail se falhar.
Passo a passo (criar bucket + API token + rodar `promo-r2-setup.sh`) em **`OPERACAO-VPS.md`**,
seção "Cópia externa no Cloudflare R2". Enquanto não fizer, o backup roda **só local** —
VPS morto = perda total, inclusive a encryptionKey.

### 3. Redirect URI no app do Meta
Cadastrar **uma vez**: `https://n8n.promoliso.com.br/rest/oauth2-credential/callback`
Publicar não depende disso (usa `~/ig-token.json`), só reconectar a conta por OAuth. Domínio é
fixo agora, então nunca mais muda.

### 4. 2FA no owner do n8n
A UI está exposta na internet e o owner (`<conta-owner-do-n8n>`) está com `mfaEnabled=0`.
n8n → Settings → conta → habilitar 2FA (TOTP). Guardar os códigos de recuperação.

---

## O QUE FOI VALIDADO NO VPS

Execuções **179 (08:00)** e **180 (10:00)** de 05/08 rodaram `success`/`trigger` — o pipeline
inteiro no VPS: 9 feeds RSS → curador (OpenAI) → verificador → DataTable → redator (Anthropic) →
validador. Zero erro de ambiente. Também provado: 7/7 credenciais decifram, sharp Linux q95 4:4:4,
Chrome renderiza (988 ms), token IG responde `promoliso0`/BUSINESS do IP do VPS, reboot recupera
tudo, HTTPS 200 no domínio.

**Ainda não exercitado em produção:** render → Cloudinary → fila → publish. Porque o validador
reprovou as duas pautas antes de chegar lá (ver abaixo). Renderizador e sharp foram testados
isolados e funcionam.

---

## GARGALO REAL (pré-existente, não é da migração)

As execuções 179 e 180 morreram no gate `Pauta validada? → falso`:

| exec | motivo |
|---|---|
| 179 | `Estrutura dos cinco slides inválida` (fontes ok: 1 primária blog.playstation.com; **imagens_validas: 6**) |
| 180 | idem + `Uma ou mais imagens são miniaturas de baixa resolução` (thumb 768x480 do adrenaline.com.br) |

`imagens_validas: 6` prova que a busca/checagem de imagem **funciona do VPS** — não é rede nem
migração. É o validador exigindo **exatamente 5 slides** (o carrossel variável foi revertido) e o
agente entregando outra quantidade. Este é o "quase nunca publica" já conhecido —
ver memória `diagnostico-imagens-primarias` e `PLANO-MELHORIAS.md`.

Consequência prática: fila com **0 READY**, então o slot das 12:30 não publica e o watchdog das
13:00 deve alertar "sem publicação há ~26h" (correto — mas só chega depois de consertar o SMTP).

**Próximo trabalho de verdade:** atacar esse gate. Duas frentes candidatas:
(a) afrouxar/corrigir a checagem de estrutura de slides no "Validar antes de publicar";
(b) melhorar a seleção de imagem (rejeitar thumb antes, preferir a maior variante).

---

## Estado do pipeline

- Produtor + Publicador + Monitor de erros + Watchdog: **ativos no VPS**.
- Retenção de execuções: **7 dias / 150**. Banco em ~824 MB, estável ~800 MB (~8 MB por execução).
- Windows: tudo parado e autostart desativado (`PromoLiso n8n.lnk.DESATIVADO-MIGRADO-VPS`).
  **Não religar sem parar o VPS** — dois schedulers na mesma conta = post duplicado.
- Fila: 6 PUBLISHED + 5 FAILED, **0 READY**.
