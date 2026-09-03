# =====================================================================
#  BLAMUNE - Lanceur avec tunnel public
#  Lance le serveur et cree un acces distant automatique.
# =====================================================================

param([string]$Tunnel = "cloudflare")

$Racine = $PSScriptRoot
if (-not $Racine) { $Racine = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) }
if (-not $Racine) { $Racine = (Get-Location).Path }

function Log([string]$t) {
    Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $t) -ForegroundColor Cyan
}

function Log-Erreur([string]$t) {
    Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] ERREUR: " + $t) -ForegroundColor Red
}

function Log-Succes([string]$t) {
    Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $t) -ForegroundColor Green
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Magenta
Write-Host "  BLAMUNE - ACCES PUBLIC" -ForegroundColor Magenta
Write-Host "  ========================================" -ForegroundColor Magenta
Write-Host ""

# Demarrer le serveur
Log "Demarrage du serveur BLAMUNE sur le port 8080..."
$serveurJob = Start-Job -ScriptBlock {
    param($racine)
    Set-Location $racine
    & powershell -NoProfile -ExecutionPolicy Bypass -File "serveur_bot.ps1"
} -ArgumentList $Racine

Log "Serveur demarre (Job ID: $($serveurJob.Id))"

# Attendre que le serveur soit pret (max 30 secondes)
Log "Attente du serveur..."
$pret = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 8080)
        $tcp.Close()
        $pret = $true
        break
    } catch {}
}

if (-not $pret) {
    Log-Erreur "Le serveur n'a pas demarre apres 30 secondes."
    Stop-Job -Id $serveurJob.Id -Force -ErrorAction SilentlyContinue
    Remove-Job -Id $serveurJob.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Log-Succes "Serveur actif sur http://localhost:8080"
Write-Host ""

try {
    if ($Tunnel -eq "cloudflare") {
        $cloudflaredPath = Join-Path $Racine "cloudflared.exe"
        $cloudflaredExe = $null
        
        if (Get-Command "cloudflared" -ErrorAction SilentlyContinue) {
            $cloudflaredExe = "cloudflared"
        } elseif (Test-Path -LiteralPath $cloudflaredPath) {
            $cloudflaredExe = $cloudflaredPath
        } else {
            Log "Cloudflare Tunnel non trouve. Telechargement..."
            try {
                $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
                Invoke-WebRequest -Uri $url -OutFile $cloudflaredPath -UseBasicParsing
                $cloudflaredExe = $cloudflaredPath
                Log-Succes "Telechargement termine !"
            } catch {
                Log-Erreur "Impossible de telecharger cloudflared."
                Log "Essaie avec -Tunnel ngrok"
                return
            }
        }
        
        Write-Host ""
        Write-Host "  ========================================" -ForegroundColor Yellow
        Write-Host "  LIEN PUBLIC (Cloudflare) :" -ForegroundColor Yellow
        Write-Host "  Copie-colle ce lien et envoie-le !" -ForegroundColor Yellow
        Write-Host "  ========================================" -ForegroundColor Yellow
        Write-Host ""
        
        & $cloudflaredExe tunnel --url http://localhost:8080
        
    } elseif ($Tunnel -eq "ngrok") {
        if (-not (Get-Command "ngrok" -ErrorAction SilentlyContinue)) {
            Log-Erreur "Ngrok non trouve. Installe-le depuis https://ngrok.com/download"
            return
        }
        
        Write-Host ""
        Write-Host "  ========================================" -ForegroundColor Yellow
        Write-Host "  LIEN PUBLIC (Ngrok) :" -ForegroundColor Yellow
        Write-Host "  Copie-colle ce lien et envoie-le !" -ForegroundColor Yellow
        Write-Host "  ========================================" -ForegroundColor Yellow
        Write-Host ""
        
        & ngrok http 8080
    }
} finally {
    Log "Arret du serveur..."
    Stop-Job -Id $serveurJob.Id -Force -ErrorAction SilentlyContinue
    Remove-Job -Id $serveurJob.Id -Force -ErrorAction SilentlyContinue
    Log-Succes "Serveur arrete."
}
