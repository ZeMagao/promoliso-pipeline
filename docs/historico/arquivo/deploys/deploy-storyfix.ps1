# Remove "Arraste pra ver" do story. Para n8n, backup, writer_story, religa.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Magal\Documents\Codex\promoliso-n8n'
$scratch = 'C:\Users\Magal\AppData\Local\Temp\claude\C--Users-Magal-Documents-Codex-promoliso-n8n\2b1f2260-10af-42ea-8b61-9089790689ba\scratchpad'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
Set-Location -LiteralPath $root
$baseUrl = (Get-Content -LiteralPath (Join-Path $root 'tunnel-url.txt') -Raw).Trim()
$tpid = (Get-Content -LiteralPath (Join-Path $root 'tunnel.pid') -Raw).Trim()
$tproc = Get-Process -Id ([int]$tpid) -ErrorAction SilentlyContinue
if (-not ($tproc -and $tproc.ProcessName -eq 'cloudflared')) { throw 'tunel nao vivo' }
$n8nPid = $null
try { $n8nPid = (Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue).OwningProcess } catch {}
if (-not $n8nPid) { $n8nPid = (Get-Content -LiteralPath (Join-Path $root 'n8n.pid') -Raw).Trim() }
if ($n8nPid) { Stop-Process -Id ([int]$n8nPid) -Force -ErrorAction SilentlyContinue }
for ($i=0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (-not (Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue)) { break } }
Write-Host 'n8n parado'
foreach ($ext in @('', '-wal', '-shm')) { $s=Join-Path $root ("data\.n8n\database.sqlite$ext"); if (Test-Path $s){ Copy-Item $s (Join-Path $root ("backups\database.sqlite$ext.pre-storyfix")) -Force } }
$env:NODE_PATH = Join-Path $root 'node_modules'
& $nodeExe (Join-Path $scratch 'writer_story.cjs'); if ($LASTEXITCODE -ne 0) { throw 'writer_story falhou' }
$V = (Get-Content -LiteralPath (Join-Path $scratch 'newversion.txt') -Raw).Trim()
Remove-Item Env:\NODE_PATH -ErrorAction SilentlyContinue
Write-Host "gravado $V"
$env:N8N_USER_FOLDER=Join-Path $root 'data'; $env:GENERIC_TIMEZONE='America/Sao_Paulo'; $env:TZ='America/Sao_Paulo'
$env:N8N_DIAGNOSTICS_ENABLED='false'; $env:N8N_PERSONALIZATION_ENABLED='false'; $env:N8N_LISTEN_ADDRESS='127.0.0.1'
$env:N8N_CONCURRENCY_PRODUCTION_LIMIT='1'; $env:EXECUTIONS_DATA_PRUNE='true'; $env:EXECUTIONS_DATA_MAX_AGE='336'; $env:EXECUTIONS_DATA_PRUNE_MAX_COUNT='500'
$env:N8N_EDITOR_BASE_URL=$baseUrl; $env:N8N_WEBHOOK_URL=$baseUrl
$n8n = Start-Process -FilePath $nodeExe -ArgumentList '.\node_modules\n8n\bin\n8n','start' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'n8n.stdout.log') -RedirectStandardError (Join-Path $root 'n8n.stderr.log') -PassThru
Set-Content -LiteralPath (Join-Path $root 'n8n.pid') -Value $n8n.Id -Encoding ascii
$ok=$false; for ($i=0;$i -lt 60;$i++){Start-Sleep -Seconds 1; try{ if((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/healthz' -TimeoutSec 3).StatusCode -eq 200){$ok=$true;break} }catch{}}
if($ok){Write-Host "n8n UP ver=$V"}else{Write-Warning 'sem healthz'}
Write-Host 'DONE'
