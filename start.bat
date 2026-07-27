@echo off
title VAT Invoice Reader - Ireland
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js nao encontrado no seu computador.
  echo     Instale a versao LTS em https://nodejs.org e depois de dois cliques aqui de novo.
  echo.
  start https://nodejs.org/en/download
  pause
  exit /b
)

for /f "delims=" %%v in ('node --version') do set NODEV=%%v
echo Node.js encontrado: %NODEV%

if not exist node_modules (
  echo.
  echo Instalando dependencias pela primeira vez... isso pode levar alguns minutos.
  call npm install
)

echo.
echo Iniciando o app. O navegador vai abrir em http://localhost:3000
echo (se abrir antes de carregar, espere uns segundos e atualize a pagina)
echo Para PARAR o app, feche esta janela.
echo.
start "" http://localhost:3000
call npm run dev
pause
