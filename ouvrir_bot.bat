@echo off
chcp 65001 >nul
title BLAMUNE - Serveur web
cd /d "%~dp0"
echo.
echo   Double-clicke sur ce fichier pour lancer BLAMUNE.
echo   Le navigateur s'ouvrira automatiquement.
echo   Pour arreter, ferme cette fenetre.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "serveur_bot.ps1"
echo.
echo  Le serveur s'est arrete.
pause
