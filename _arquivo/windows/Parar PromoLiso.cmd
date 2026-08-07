@echo off
REM Encerra n8n e tunel iniciados por start-promoliso.ps1.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-promoliso.ps1"
if errorlevel 1 pause
