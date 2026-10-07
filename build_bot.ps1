<#
.SYNOPSIS
    Compile BLAMUNE (bot local C++) en bot.exe.

.DESCRIPTION
    Cherche un compilateur g++ dans le PATH, puis dans les emplacements
    habituels de Dev-C++. Utilise C++14 car la version de g++
    fournie avec Dev-C++ refuse C++17.

.EXAMPLE
    .\build_bot.ps1
#>
$ErrorActionPreference = 'Stop'

$gcc = Get-Command g++ -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
if (-not $gcc -and (Test-Path 'C:\Program Files (x86)\Dev-Cpp\MinGW64\bin\g++.exe')) {
    $gcc = 'C:\Program Files (x86)\Dev-Cpp\MinGW64\bin\g++.exe'
}
if (-not $gcc -and (Test-Path 'C:\Program Files\Dev-Cpp\MinGW64\bin\g++.exe')) {
    $gcc = 'C:\Program Files\Dev-Cpp\MinGW64\bin\g++.exe'
}

if (-not $gcc) {
    Write-Error 'g++ introuvable. Installe Dev-C++ ou ajoute MinGW au PATH.'
}

$source = Join-Path $PSScriptRoot 'bot.cpp'
$output = Join-Path $PSScriptRoot 'bot.exe'
Write-Host "Compilation : $source -> $output"
& $gcc -std=c++14 $source -o $output -lwininet
Write-Host 'Compilation terminée : bot.exe'
