@echo off
chcp 65001 >nul
title Dashmin - Admin
cd /d "%~dp0"
echo.
echo   Lance d'abord ouvrir_bot.bat, puis ouvre ce fichier.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "serveur_admin.ps1"
echo.
echo  Le serveur admin s'est arrete.
pause
