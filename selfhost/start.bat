@echo off
title VAT ERP Ireland
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js nao encontrado. Rode selfhost\install.bat primeiro.
  pause
  exit /b 1
)

node "selfhost\scripts\start.js"
echo.
echo O app foi encerrado.
pause
