# Roda o Publicador via CLI (posta 1 teste). Para n8n, executa, religa. Tunel preservado.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Magal\Documents\Codex\promoliso-n8n'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
Set-Location -LiteralPath $root
$baseUrl = (Get-Content -LiteralPath (Join-Path $root 'tunnel-url.txt') -Raw).Trim()

Write-Host 'parar n8n'
$n8nPid = $null
try { $n8nPid = (Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue).OwningProcess } catch {}
if (-not $n8nPid) { $n8nPid = (Get-Content -LiteralPath (Join-Path $root 'n8n.pid') -Raw).Trim() }
if ($n8nPid) { Stop-Process -Id ([int]$n8nPid) -Force -ErrorAction SilentlyContinue }
for ($i=0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (-not (Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue)) { break } }
Write-Host 'n8n parado; executando Publicador via CLI...'

$env:N8N_USER_FOLDER='C:\Users\Magal\Documents\Codex\promoliso-n8n\data'
$env:GENERIC_TIMEZONE='America/Sao_Paulo'; $env:TZ='America/Sao_Paulo'
$env:N8N_DIAGNOSTICS_ENABLED='false'; $env:N8N_PERSONALIZATION_ENABLED='false'
& $nodeExe '.\node_modules\n8n\bin\n8n' execute --id E27F7yVdsZRj
$rc = $LASTEXITCODE
Write-Host "CLI execute exit code = $rc"

Write-Host 'religar n8n'
$env:N8N_LISTEN_ADDRESS='127.0.0.1'; $env:N8N_CONCURRENCY_PRODUCTION_LIMIT='1'
$env:EXECUTIONS_DATA_PRUNE='true'; $env:EXECUTIONS_DATA_MAX_AGE='336'; $env:EXECUTIONS_DATA_PRUNE_MAX_COUNT='500'
$env:N8N_EDITOR_BASE_URL=$baseUrl; $env:N8N_WEBHOOK_URL=$baseUrl
$n8n = Start-Process -FilePath $nodeExe -ArgumentList '.\node_modules\n8n\bin\n8n', 'start' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'n8n.stdout.log') -RedirectStandardError (Join-Path $root 'n8n.stderr.log') -PassThru
Set-Content -LiteralPath (Join-Path $root 'n8n.pid') -Value $n8n.Id -Encoding ascii
$ok=$false; for ($i=0;$i -lt 60;$i++){Start-Sleep -Seconds 1; try{ if((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/healthz' -TimeoutSec 3).StatusCode -eq 200){$ok=$true;break} }catch{}}
if($ok){Write-Host "n8n UP (PID $($n8n.Id))"}else{Write-Warning 'sem healthz'}
Write-Host 'DONE'
