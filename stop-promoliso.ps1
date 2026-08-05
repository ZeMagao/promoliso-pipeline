<#
  Encerra n8n e tunel iniciados por start-promoliso.ps1, via arquivos .pid.
  O renderizador fica de pe: e local, leve, e start-renderer.ps1 reaproveita
  a instancia viva no proximo boot.
#>

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

foreach ($file in @('n8n.pid', 'tunnel.pid')) {
  $pidPath = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $pidPath)) { continue }

  $id = (Get-Content -LiteralPath $pidPath -Raw).Trim()
  if ($id -match '^\d+$') {
    $proc = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
      Write-Host "encerrado: $file (PID $id)"
    } else {
      Write-Host "$file aponta para PID $id, que nao esta mais rodando"
    }
  }
  Remove-Item -LiteralPath $pidPath -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath (Join-Path $root 'tunnel-url.txt') -ErrorAction SilentlyContinue
Write-Host 'Pronto.'
