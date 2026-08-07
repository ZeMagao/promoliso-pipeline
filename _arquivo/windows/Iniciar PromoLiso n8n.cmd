@echo off
REM Ponto de entrada unico. Toda a configuracao vive em start-promoliso.ps1.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-promoliso.ps1"
if errorlevel 1 pause
