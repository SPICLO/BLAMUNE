@echo off
chcp 65001 >nul
title BLAMUNE - Ouvrir le pare-feu
cd /d "%~dp0"
echo.
echo   Ouverture du pare-feu pour BLAMUNE...
echo   (Necessite les droits administrateur)
echo.
powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0ouvrir_parefeu.ps1\"' -Verb RunAs"
echo.
