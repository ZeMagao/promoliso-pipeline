@echo off
REM Abre pela URL do tunel, nao por localhost: o cookie de sessao do n8n fica
REM preso a origem do login, e o callback do OAuth chega pelo dominio do tunel.
REM Sem o tunel no ar, cai em localhost (OAuth nao vai funcionar assim).
setlocal
set "URLFILE=%~dp0tunnel-url.txt"
if exist "%URLFILE%" (
  set /p TUNNELURL=<"%URLFILE%"
) else (
  set "TUNNELURL="
)
if defined TUNNELURL (
  start "" "%TUNNELURL%"
) else (
  echo Tunel nao encontrado. Rode "Iniciar PromoLiso n8n.cmd" primeiro.
  echo Abrindo localhost - OAuth do Instagram nao funciona por essa origem.
  start "" "http://localhost:5678/"
)
endlocal
