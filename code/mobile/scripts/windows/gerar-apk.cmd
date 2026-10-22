@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gerar-apk.ps1" %*
echo.
echo Pode fechar esta janela.
pause
