@echo off
chcp 65001 >nul
title BLAMUNE - Autorisation DeepSeek
cd /d "%~dp0"

REM OUVRIR_DEEPSEEK_AUTH.BAT
REM Prepare la session DeepSeek web utilisee par le proxy (deepproxy/).
REM
REM Tout ce qu'il faut savoir a l'usage :
REM   1. une fenetre Chrome/Edge s'ouvre sur chat.deepseek.com ;
REM   2. connecte-toi a ton compte (ou cree-le) ;
REM   3. envoie un message court (ex. "ok") pour initialiser la session ;
REM   4. reviens dans CETTE fenetre et appuie sur Entree.
REM
REM Le resultat est enregistre dans deepproxy\deepseek-auth.json.
REM ATTENTION : ce fichier vaut les cookies de ton compte DeepSeek. Il est
REM ignore par git ; ne l'envoie jamais a personne, ne le versionne pas.
REM
REM Si l'outil place la session expire plus tard (erreur 401/403 dans les
REM journaux du serveur) : relance simplement ce fichier pour la renouveler.

if not exist "deepproxy\server.js" (
    echo.
    echo   Le dossier deepproxy est absent.
    echo   Recupere-le une fois pour toutes :
    echo     git clone https://github.com/atharvotech/FreeDeepseekAPI-EN.git deepproxy
    echo.
    pause
    exit /b 1
)

REM Chrome officiel n'est pas installe sur cette machine, mais Edge est
REM present et utilise le meme moteur (Chromium) : le script d'autorisation
REM accepte un navigateur passe par CHROME_PATH. Si un jour tu installes
REM Chrome, la variable est masquee par sa presence : ce test ne l'est que
REM si Edge l'est aussi.
if not defined CHROME_PATH (
    if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
        echo   Chrome officiel absent : utilisation de Microsoft Edge.
        set "CHROME_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    )
)

if not defined CHROME_PATH (
    echo.
    echo   Ni Chrome ni Edge detecte sur cette machine.
    echo   Installe Chrome, ou fixe la variable CHROME_PATH vers
    echo   l'executable du navigateur avant de relancer ce fichier.
    echo.
    pause
    exit /b 1
)

echo.
echo   Fenetre 1/2 : la fenetre du Navigateur va s'ouvrir sur chat.deepseek.com.
echo   Fenetre 2/2 : cette console attend ton signal (voir etapes 2-3-4 plus haut).
echo.
node deepproxy\scripts\auth.js

echo.
echo   Autorisation terminee (ou interrompue). Le fichier attendu est
echo   deepproxy\deepseek-auth.json : lance "ouvrir_deepseek_proxy.bat".
echo.
pause
