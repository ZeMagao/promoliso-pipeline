# Deploy do redesign estrutural nos nos de render.
# Para SO o n8n (preserva tunel cloudflared), faz backup, grava o patch (writer.cjs),
# religa o n8n reusando N8N_EDITOR_BASE_URL = tunnel-url.txt. NAO mexe no tunel/renderer.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Magal\Documents\Codex\promoliso-n8n'
$scratch = 'C:\Users\Magal\AppData\Local\Temp\claude\C--Users-Magal-Documents-Codex-promoliso-n8n\2b1f2260-10af-42ea-8b61-9089790689ba\scratchpad'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
Set-Location -LiteralPath $root

Write-Host '== 0. checagens =='
$baseUrl = (Get-Content -LiteralPath (Join-Path $root 'tunnel-url.txt') -Raw).Trim()
if ($baseUrl -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com$') { throw "tunnel-url.txt inesperado: $baseUrl" }
$tpid = (Get-Content -LiteralPath (Join-Path $root 'tunnel.pid') -Raw).Trim()
$tproc = Get-Process -Id ([int]$tpid) -ErrorAction SilentlyContinue
if (-not ($tproc -and $tproc.ProcessName -eq 'cloudflared')) { throw "tunel cloudflared PID $tpid nao esta vivo; abortando para nao trocar a URL" }
Write-Host "   tunel OK ($baseUrl), cloudflared PID $tpid"
try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5680/healthz' -TimeoutSec 4 | Out-Null; Write-Host '   renderer :5680 OK' } catch { Write-Warning 'renderer :5680 nao respondeu (segue mesmo assim)' }

Write-Host '== 1. parar SO o n8n =='
$n8nPid = $null
try { $n8nPid = (Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue).OwningProcess } catch {}
if (-not $n8nPid) { $n8nPid = (Get-Content -LiteralPath (Join-Path $root 'n8n.pid') -Raw).Trim() }
if ($n8nPid) {
  Write-Host "   parando n8n PID $n8nPid"
  Stop-Process -Id ([int]$n8nPid) -Force -ErrorAction SilentlyContinue
} else { Write-Warning 'nenhum n8n encontrado na :5678 nem em n8n.pid' }
for ($i=0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  $still = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue
  if (-not $still) { break }
}
$still = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue
if ($still) { throw 'porta 5678 ainda ocupada apos parar o n8n' }
Write-Host '   n8n parado, :5678 livre'

Write-Host '== 2. backup do DB =='
$stamp = 'pre-redesign'
foreach ($ext in @('', '-wal', '-shm')) {
  $srcf = Join-Path $root ("data\.n8n\database.sqlite$ext")
  if (Test-Path -LiteralPath $srcf) {
    $dstf = Join-Path $root ("backups\database.sqlite$ext.$stamp")
    Copy-Item -LiteralPath $srcf -Destination $dstf -Force
    Write-Host "   backup: $dstf"
  }
}

Write-Host '== 3. gravar patch (writer.cjs) =='
$env:NODE_PATH = Join-Path $root 'node_modules'
& $nodeExe (Join-Path $scratch 'writer.cjs')
if ($LASTEXITCODE -ne 0) { throw 'writer.cjs falhou; DB pode estar inalterado; ver erro acima' }
$V = (Get-Content -LiteralPath (Join-Path $scratch 'newversion.txt') -Raw).Trim()
Write-Host "   gravado. versionId = $V"

Write-Host '== 4. religar n8n (reusa tunel) =='
$env:N8N_USER_FOLDER                  = Join-Path $root 'data'
$env:GENERIC_TIMEZONE                 = 'America/Sao_Paulo'
$env:TZ                               = 'America/Sao_Paulo'
$env:N8N_DIAGNOSTICS_ENABLED          = 'false'
$env:N8N_PERSONALIZATION_ENABLED      = 'false'
$env:N8N_LISTEN_ADDRESS               = '127.0.0.1'
$env:N8N_CONCURRENCY_PRODUCTION_LIMIT = '1'
$env:EXECUTIONS_DATA_PRUNE            = 'true'
$env:EXECUTIONS_DATA_MAX_AGE          = '336'
$env:EXECUTIONS_DATA_PRUNE_MAX_COUNT  = '500'
$env:N8N_EDITOR_BASE_URL              = $baseUrl
$env:N8N_WEBHOOK_URL                  = $baseUrl
Remove-Item Env:\NODE_PATH -ErrorAction SilentlyContinue
$n8n = Start-Process -FilePath $nodeExe `
  -ArgumentList '.\node_modules\n8n\bin\n8n', 'start' `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $root 'n8n.stdout.log') `
  -RedirectStandardError  (Join-Path $root 'n8n.stderr.log') `
  -PassThru
Set-Content -LiteralPath (Join-Path $root 'n8n.pid') -Value $n8n.Id -Encoding ascii
Write-Host "   n8n religado, PID $($n8n.Id)"

Write-Host '== 5. aguardar healthz =='
$ok = $false
for ($i=0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/healthz' -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}
if ($ok) { Write-Host "   n8n UP (healthz ok). versionId ativo = $V" }
else { Write-Warning 'n8n nao respondeu healthz em 60s; ver n8n.stderr.log' }
Write-Host 'DONE'
