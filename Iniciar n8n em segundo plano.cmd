@echo off
REM Mesma stack, com o n8n em segundo plano. Config em start-promoliso.ps1.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-promoliso.ps1" -Background
if errorlevel 1 pause
