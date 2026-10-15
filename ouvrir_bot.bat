@echo off
chcp 65001 >nul
title BLAMUNE - Serveur web
cd /d "%~dp0"

REM bot.exe est ignore par git (.gitignore) : sur un clone frais il est
REM absent. Sans cette etape, ouvrir_bot.bat echouait immediatement sur un
REM clone neuf avec pour seule aide une ligne de commande g++ affichee en
REM console. On le compile donc une fois, puis on lance le serveur.
if not exist "bot.exe" (
    echo.
    echo   Premier lancement : compilation du bot C++ ^(une seule fois^).
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_bot.ps1"
    if errorlevel 1 (
        echo.
        echo   ECHEC DE LA COMPILATION.
        echo   Installe g++ ^(Dev-C++ ou MinGW^) ou lance build_bot.bat pour le detail.
        pause
        exit /b 1
    )
    echo.
)

echo.
echo   Double-clique sur ce fichier pour lancer BLAMUNE.
echo   Le navigateur s'ouvrira automatiquement.
echo   Pour arreter, ferme cette fenetre.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "serveur_bot.ps1"
echo.
echo  Le serveur s'est arrete.
pause