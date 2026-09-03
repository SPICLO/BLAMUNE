@echo off
chcp 65001 >nul
title BLAMUNE - Serveur avec Tunnel Public
cd /d "%~dp0"
echo.
echo   ========================================
echo   BLAMUNE - ACCES PUBLIC
echo   ========================================
echo.
echo   Double-clique pour lancer le serveur
echo   et creer un lien public pour tes amis.
echo.
echo   Pour arreter, ferme cette fenetre.
echo   ========================================
echo.

REM Verifier si cloudflared est installe
if not exist "%~dp0cloudflared.exe" (
    where cloudflared >nul 2>&1
    if %errorlevel% neq 0 (
        echo   Telechargement de Cloudflare Tunnel...
        powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
        if exist "%~dp0cloudflared.exe" (
            echo   Telechargement termine !
        ) else (
            echo   ERREUR: Impossible de telecharger cloudflared.
            pause
            exit /b 1
        )
    )
)

REM Demarrer le serveur PowerShell
echo   Demarrage du serveur BLAMUNE...
start "BLAMUNE Server" powershell -NoProfile -ExecutionPolicy Bypass -File "serveur_bot.ps1"

REM Attendre que le serveur soit pret
echo   Attente du serveur...
timeout /t 5 /nobreak >nul

REM Creer le tunnel Cloudflare
echo.
echo   ========================================
echo   ENVOIE CE LIEN A TES AMIS :
echo   ========================================
echo.

"%~dp0cloudflared.exe" tunnel --url http://localhost:8080

echo.
echo   Tunnel arrete. Le serveur continue de tourner.
echo   Ferme cette fenetre pour tout arreter.
pause
