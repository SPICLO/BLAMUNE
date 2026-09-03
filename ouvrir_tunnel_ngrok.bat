@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
title BLAMUNE - Tunnel Public
cd /d "%~dp0"

echo.
echo   ============================================
echo   BLAMUNE - ACCES PUBLIC VIA NGROK
echo   ============================================
echo.

:: --- Verification ngrok ---
if not exist "ngrok.exe" (
    echo   [ERREUR] ngrok.exe introuvable dans ce dossier.
    echo   Telecharge: https://ngrok.com/download
    pause
    exit /b 1
)

:: --- Arret des anciens processus ---
echo   [1/4] Arret des anciens processus...
taskkill /F /IM ngrok.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: --- Demarrage du serveur BLAMUNE ---
echo   [2/4] Verification du serveur BLAMUNE...
netstat -ano | findstr ":8080 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    echo         Demarrage du serveur...
    start /b powershell -NoProfile -ExecutionPolicy Bypass -File "serveur_bot.ps1" >nul 2>&1
    echo         Attente du demarrage...
    set /a "retry=0"
    :wait_server
    timeout /t 2 /nobreak >nul
    netstat -ano | findstr ":8080 " | findstr "LISTENING" >nul 2>&1
    if !errorlevel! neq 0 (
        set /a "retry+=1"
        if !retry! lss 10 goto wait_server
        echo   [ERREUR] Le serveur n'a pas pu demarrer apres 20s.
        pause
        exit /b 1
    )
    echo         Serveur BLAMUNE demarre.
) else (
    echo         Serveur BLAMUNE deja actif.
)

:: --- Health check du serveur ---
echo   [3/4] Health check du serveur...
set /a "hc=0"
:health_check
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8080/ping' -UseBasicParsing -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
    set /a "hc+=1"
    if !hc! lss 5 (
        echo         Tentative !hc!/5...
        timeout /t 3 /nobreak >nul
        goto health_check
    )
    echo   [ERREUR] Le serveur ne repond pas apres 5 tentatives.
    pause
    exit /b 1
)
echo         Serveur OK.

:: --- Demarrage ngrok ---
echo   [4/4] Demarrage du tunnel ngrok...
echo.
echo   ============================================
echo   L'URL PUBLIC S'AFFICHERA CI-DESSOUS
echo   Copie-colle ce lien pour tes amis
echo   ============================================
echo.

ngrok start --all

