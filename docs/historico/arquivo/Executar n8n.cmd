@echo off
REM Duplicata historica de "Iniciar PromoLiso n8n.cmd". Mantida so para nao
REM quebrar atalhos antigos - delega para o mesmo orquestrador.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-promoliso.ps1"
if errorlevel 1 pause
