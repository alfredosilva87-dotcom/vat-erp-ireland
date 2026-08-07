@echo off
title VAT ERP Ireland - Instalacao do SERVIDOR
cd /d "%~dp0.."

net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Rode como Administrador ^(botao direito no arquivo -^> Executar como administrador^).
  echo     As portas 80 e 443 exigem isso.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org
  echo     e depois rode este arquivo de novo.
  echo.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Docker Desktop nao encontrado. Instale, abra o programa,
  echo     espere ficar verde ^(Running^) e rode este arquivo de novo.
  echo.
  start https://docs.docker.com/desktop/setup/install/windows-install/
  pause
  exit /b 1
)

node "selfhost\scripts\install-server.js"
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" echo A instalacao nao terminou. Veja a mensagem acima.
pause
exit /b %EXITCODE%
