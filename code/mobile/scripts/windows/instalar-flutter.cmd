@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-flutter.ps1" %*
echo.
echo Pode fechar esta janela.
pause
