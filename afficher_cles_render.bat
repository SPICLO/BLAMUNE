@echo off
chcp 65001 >nul
title BLAMUNE - Valeurs a coller dans Render
cd /d "%~dp0"

REM AFFICHER_CLES_RENDER.BAT
REM
REM Affiche dans cette console les valeurs a coller dans le dashboard
REM Render (ton service > Environment) quand une variable est declaree
REM "sync: false" dans render.yaml : les secrets se gerent LA-BAS, jamais
REM dans le depot.
REM
REM Les valeurs viennent du fichier .env de CETTE machine (il est ignore
REM par git : aucun secret ne circule via le repo).
REM
REM Apres collage dans Render : Save Changes, puis Manual Deploy >
REM Deploy latest commit (ou simplement attendre le prochain push).

setlocal enabledelayedexpansion

if not exist ".env" (
    echo.
    echo   Aucun .env ici. Ce fichier fournit les cles locales ;
    echo   cree-le d'abord avec les cles de tes comptes.
    echo.
    pause
    exit /b 1
)

REM --- Lecture brute de .env ---
set "CLE_GEMINI="
set "CLE_DIRECTE="
set "QDRANT_URL_VAL="
set "QDRANT_CLE_VAL="
set "JSONBIN_CLE_VAL="
set "JSONBIN_BIN_VAL="
set "ADMIN_MDP_VAL="
set "POOL_VAL="

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="API_KEYS" set "TOUTES_CLES=%%B"
    if /i "%%A"=="API_KEY"  if not defined CLE_DIRECTE set "CLE_DIRECTE=%%B"
    if /i "%%A"=="QDRANT_URL" set "QDRANT_URL_VAL=%%B"
    if /i "%%A"=="QDRANT_API_KEY" set "QDRANT_CLE_VAL=%%B"
    if /i "%%A"=="JSONBIN_API_KEY" set "JSONBIN_CLE_VAL=%%B"
    if /i "%%A"=="JSONBIN_BIN_ID" set "JSONBIN_BIN_VAL=%%B"
    if /i "%%A"=="ADMIN_MDP" set "ADMIN_MDP_VAL=%%B"
    if /i "%%A"=="API_POOL" set "POOL_VAL=%%B"
)

REM --- Premiere cle de la liste (partage le quota, la rotation reste cote serveur) ---
if defined TOUTES_CLES (
    for /f "tokens=1 delims=," %%C in ("!TOUTES_CLES!") do set "CLE_GEMINI=%%C"
)
if not defined CLE_GEMINI set "CLE_GEMINI=!CLE_DIRECTE!"

echo.
echo ================================================================
echo    VALEURS A COLLER DANS RENDER : service blamune
echo    Environment -" Add environment variable
echo ================================================================
echo.
echo --- OBLIGATOIRE ------------------------------------------------
echo.
echo   API_KEY =
echo     !CLE_GEMINI!
echo     ^(cle Gemini gratuite ; si elle est morte ou pas AIza...,
echo      cree-en une sur aistudio.google.com/app/apikey^)
echo.
echo   JSONBIN_API_KEY =
call :afficher "!JSONBIN_CLE_VAL!"
echo   JSONBIN_BIN_ID =
call :afficher "!JSONBIN_BIN_VAL!"
echo.
echo --- OPTIONNEL : pilier de secours (Groq + GPT-OSS) -------------
echo.
echo   API_POOL =
if not defined POOL_VAL set "POOL_VAL=(absente du .env local)"
echo     !POOL_VAL!
echo     ^(contient ta cle Groq : colle cette ligne telle quelle.
echo      Le serveur ne l'utilise QU'APRES l'epuisement des cles
echo      Gemini - invisible pour les visiteurs^)
echo.
echo --- OPTIONNEL : memoire vectorielle du savoir ------------------
echo.
echo   QDRANT_URL =
call :afficher "!QDRANT_URL_VAL!"
echo   QDRANT_API_KEY =
call :afficher "!QDRANT_CLE_VAL!"
echo.
echo --- OPTIONNEL : mot de passe admin -----------------------------
echo.
if defined ADMIN_MDP_VAL (
    echo   ADMIN_MDP =
    call :afficher "!ADMIN_MDP_VAL!"
) else (
    echo   ADMIN_MDP : gere dans le dashboard, ou laisse genere
    echo               ^(affiche une fois dans les logs Render^).
)
echo.
echo ================================================================
echo    Ensuite : Save Changes (Render redeploye tout seul),
echo    puis verifie avec le site : un message doit obtenir
echo    une vraie reponse IA.
echo ================================================================
echo.

REM --- Copie fiable : un fichier texte a ouvrir, pas une selection console ---
REM La selection a la souris dans cette console tronque les lignes longues :
REM une cle coupee en deux se colle telle quelle dans Render et donne HTTP
REM 401 sans expliquer pourquoi. Le fichier Notepad reste entier.
powershell -NoProfile -Command "$t=Get-Content '.env' | Where-Object { $_ -match '^(API_POOL|API_KEYS|API_KEY|JSONBIN_API_KEY|JSONBIN_BIN_ID|QDRANT_URL|QDRANT_API_KEY|ADMIN_MDP)=' }; @('Copier chaque ligne ENTIEREMENT, du premier au dernier caractere, sans saut de ligne au milieu.') + $t | Set-Content -Path (Join-Path $env:TEMP 'cles_render_blamune.txt') -Encoding UTF8"
if exist "%TEMP%\cles_render_blamune.txt" (
    echo    Fichier fiable pour copier-coller : %TEMP%\cles_render_blamune.txt
    echo    Il vient de s'ouvrir dans Notepad : selectionne LA LIGNE ENTIERE,
    echo    copie, colle dans Render.        ^(Ce fichier contient des cles :
    echo     ne l'envoie a personne^)
    start "" notepad "%TEMP%\cles_render_blamune.txt"
) else (
    echo    AVERTISSEMENT : fichier de copie non genere -^ PowerShell a
    echo    echoue. Copie a la souris DANS CETTE CONSOLE avec precaution :
    echo    clic droit sur la barre de titre -^ Edition -^ Selectionner,
    echo    puis Enter pour copier sans transition de ligne.
)
echo.
pause
exit /b 0

:afficher
if "%~1"=="" (
    echo     ^(absente du .env local : passe, ou complete le .env^)
) else (
    echo     %~1
)
exit /b 0
