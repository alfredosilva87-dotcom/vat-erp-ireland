@echo off
title VAT ERP Ireland - Instalacao
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js nao encontrado neste computador.
  echo     Instale a versao LTS em https://nodejs.org, feche esta janela
  echo     e depois clique duas vezes aqui de novo.
  echo.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Docker Desktop nao encontrado neste computador.
  echo     Instale em https://docs.docker.com/desktop/, abra o Docker Desktop,
  echo     espere ficar verde ^(Running^) e clique duas vezes aqui de novo.
  echo.
  start https://docs.docker.com/desktop/setup/install/windows-install/
  pause
  exit /b 1
)

node "selfhost\scripts\install.js"
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo A instalacao nao terminou. Veja a mensagem acima.
)
pause
exit /b %EXITCODE%
