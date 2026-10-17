@echo off
chcp 65001 >nul
title BLAMUNE - Proxy DeepSeek (IA gratuite)
cd /d "%~dp0"

REM OUVRIR_DEEPSEEK_PROXY.BAT
REM Demarre le proxy deepproxy/ sur http://127.0.0.1:9655.
REM Le serveur BLAMUNE (server.js) doit pointer dessus dans .env :
REM   API_PROVIDER=openai
REM   API_URL=http://127.0.0.1:9655/v1
REM   API_MODEL=deepseek-chat
REM Pour arreter : ferme cette fenetre. BLAMUNE retombe alors sur le bot
REM local et les replis, sans plantage.

if not exist "deepproxy\server.js" (
    echo.
    echo   Le dossier deepproxy est absent.
    echo   Recupere-le une fois pour toutes :
    echo     git clone https://github.com/atharvotech/FreeDeepseekAPI-EN.git deepproxy
    echo.
    pause
    exit /b 1
)

if not exist "deepproxy\deepseek-auth.json" (
    echo.
    echo   Aucune autorisation DeepSeek trouvee (deepproxy\deepseek-auth.json).
    echo   Lance d'abord ouvrir_deepseek_auth.bat : tu t'y connectes une fois,
    echo   ensuite ce fichier suffira (tant que la session n'a pas expire).
    echo.
    pause
    exit /b 1
)

echo.
echo   Proxy DeepSeek : http://127.0.0.1:9655
echo   Le chat BLAMUNE doit etre lance en parallèle pour l'utiliser.
echo   Pour arreter, ferme cette fenetre.
echo.
set "NON_INTERACTIVE=1"
node deepproxy\server.js

echo.
echo   Le proxy s'est arrete. Verifications possibles :
echo     - session expiree ? relance ouvrir_deepseek_auth.bat ;
echo     - journal complet ci-dessus ("data.biz_data is null", 401, 429...).
echo.
pause
