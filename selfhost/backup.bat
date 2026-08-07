@echo off
title VAT ERP Ireland - Backup
cd /d "%~dp0.."
node "selfhost\scripts\backup.js" %1
pause
