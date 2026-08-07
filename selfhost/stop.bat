@echo off
title VAT ERP Ireland - Parar
cd /d "%~dp0.."
node "selfhost\scripts\stop.js"
pause
