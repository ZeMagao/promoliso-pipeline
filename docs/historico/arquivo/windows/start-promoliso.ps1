<#
  Sobe a stack do PromoLiso na ordem correta:

    1. renderizador de slides (somente 127.0.0.1)
    2. tunel cloudflared apontando para o n8n
    3. n8n, ja com N8N_EDITOR_BASE_URL igual ao hostname do tunel

  A ordem importa: o n8n le N8N_EDITOR_BASE_URL uma unica vez no boot, e e essa
  variavel que monta o redirect URI do OAuth
  (<base>/rest/oauth2-credential/callback). Se o n8n subir antes do tunel, o
  redirect URI aponta para localhost e o Meta recusa.

  Acesse a UI SEMPRE pela URL do tunel. O cookie de sessao do n8n fica preso a
  origem em que voce fez login; se logar em localhost e o callback do OAuth
  chegar pelo dominio do tunel, o cookie nao acompanha e o n8n responde
  Unauthorized.
#>

param(
  [switch]$Background,
  [int]$TunnelTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$rendererScript = 'C:\Users\Magal\Documents\Codex\2026-07-13\chat-eu-to-precisand\renderer\start-renderer.ps1'
$cloudflaredExe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$nodeExe        = 'C:\Program Files\nodejs\node.exe'
$n8nPort        = 5678

$tunnelLog    = Join-Path $root 'tunnel.log'
$tunnelOutLog = Join-Path $root 'tunnel.stdout.log'
$tunnelPidPath = Join-Path $root 'tunnel.pid'
$tunnelUrlPath = Join-Path $root 'tunnel-url.txt'

foreach ($p in @($rendererScript, $cloudflaredExe, $nodeExe)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "Nao encontrado: $p" }
}

# --- 1. renderizador -------------------------------------------------------
Write-Host '[1/3] Renderizador...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $rendererScript
if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar o renderizador.' }

# --- 2. tunel --------------------------------------------------------------
# Derruba apenas o tunel que este script iniciou antes. Um cloudflared de outra
# origem fica intacto - so avisamos, porque dois tuneis geram dois hostnames e
# fica facil cadastrar o errado no app do Meta.
if (Test-Path -LiteralPath $tunnelPidPath) {
  $oldPid = (Get-Content -LiteralPath $tunnelPidPath -Raw).Trim()
  if ($oldPid -match '^\d+$') {
    $proc = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'cloudflared') {
      Write-Host "      encerrando tunel anterior (PID $oldPid)"
      Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
  }
  Remove-Item -LiteralPath $tunnelPidPath -ErrorAction SilentlyContinue
}

$strays = @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
if ($strays.Count -gt 0) {
  Write-Warning "Ja existe cloudflared rodando (PID $(($strays | ForEach-Object { $_.Id }) -join ', ')) fora deste script."
  Write-Warning 'Cada tunel tem um hostname proprio. Confira qual esta cadastrado no app do Meta.'
}

Write-Host "[2/3] Tunel cloudflared -> http://127.0.0.1:$n8nPort ..."
Remove-Item -LiteralPath $tunnelLog, $tunnelOutLog -ErrorAction SilentlyContinue

$tunnel = Start-Process `
  -FilePath $cloudflaredExe `
  -ArgumentList @(
    'tunnel',
    '--url', "http://127.0.0.1:$n8nPort",
    '--protocol', 'quic',
    '--edge-ip-version', '4',
    '--ha-connections', '1',
    '--no-autoupdate'
  ) `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $tunnelOutLog `
  -RedirectStandardError $tunnelLog `
  -PassThru

Set-Content -LiteralPath $tunnelPidPath -Value $tunnel.Id -Encoding ascii

# cloudflared escreve o hostname sorteado no stderr, dentro de um box ASCII.
$baseUrl = $null
for ($i = 0; $i -lt ($TunnelTimeoutSeconds * 2); $i++) {
  Start-Sleep -Milliseconds 500

  foreach ($logPath in @($tunnelLog, $tunnelOutLog)) {
    if (-not (Test-Path -LiteralPath $logPath)) { continue }
    $text = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    $m = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) { $baseUrl = $m.Value; break }
  }
  if ($baseUrl) { break }

  if ($tunnel.HasExited) { throw "cloudflared encerrou durante a inicializacao. Consulte $tunnelLog" }
}

if (-not $baseUrl) {
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  throw "cloudflared nao publicou um hostname em $TunnelTimeoutSeconds s. Consulte $tunnelLog"
}

Set-Content -LiteralPath $tunnelUrlPath -Value $baseUrl -Encoding ascii
$redirectUri = "$baseUrl/rest/oauth2-credential/callback"

# --- 3. n8n ----------------------------------------------------------------
$env:N8N_USER_FOLDER                    = Join-Path $root 'data'
$env:GENERIC_TIMEZONE                   = 'America/Sao_Paulo'
$env:TZ                                 = 'America/Sao_Paulo'
$env:N8N_DIAGNOSTICS_ENABLED            = 'false'
$env:N8N_PERSONALIZATION_ENABLED        = 'false'
$env:N8N_LISTEN_ADDRESS                 = '127.0.0.1'
$env:N8N_CONCURRENCY_PRODUCTION_LIMIT   = '1'
$env:EXECUTIONS_DATA_PRUNE              = 'true'
$env:EXECUTIONS_DATA_MAX_AGE            = '336'
$env:EXECUTIONS_DATA_PRUNE_MAX_COUNT    = '500'
# Origem publica do n8n. Governa o redirect URI do OAuth e a URL dos webhooks.
$env:N8N_EDITOR_BASE_URL                = $baseUrl
$env:N8N_WEBHOOK_URL                    = $baseUrl
# N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS foi removido: nao existe no Windows e so
# polui o stderr com avisos a cada boot.

Write-Host ''
Write-Host '--------------------------------------------------------------'
Write-Host " UI do n8n:    $baseUrl"
Write-Host " Redirect URI: $redirectUri"
Write-Host '--------------------------------------------------------------'
Write-Host ' Cadastre esse redirect URI no app do Meta (Instagram) e abra a'
Write-Host ' UI pela URL acima - nao por localhost - para conectar a conta.'
Write-Host ' O tunnel gratuito sorteia hostname novo a cada execucao, entao'
Write-Host ' isso se repete a cada restart ate voce usar dominio fixo.'
Write-Host '--------------------------------------------------------------'
Write-Host ''

Set-Location -LiteralPath $root

if ($Background) {
  Write-Host '[3/3] n8n em segundo plano...'
  $n8n = Start-Process `
    -FilePath $nodeExe `
    -ArgumentList '.\node_modules\n8n\bin\n8n', 'start' `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root 'n8n.stdout.log') `
    -RedirectStandardError  (Join-Path $root 'n8n.stderr.log') `
    -PassThru
  Set-Content -LiteralPath (Join-Path $root 'n8n.pid') -Value $n8n.Id -Encoding ascii
  Write-Host "      n8n PID $($n8n.Id)"
} else {
  Write-Host '[3/3] n8n (Ctrl+C encerra)...'
  & $nodeExe '.\node_modules\n8n\bin\n8n' start
}
