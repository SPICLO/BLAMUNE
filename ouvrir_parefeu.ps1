# =====================================================================
#  BLAMUNE - Ouvrir le pare-feu Windows pour le serveur
#  A executer en tant qu'administrateur (clic droit -> Executer en tant qu'admin)
# =====================================================================

$Port = 8080
$RegleNom = "BLAMUNE-Serveur-Web"

Write-Host ""
Write-Host "  Ouverture du pare-feu pour BLAMUNE (port $Port)..." -ForegroundColor Cyan
Write-Host ""

# Verifier si la regle existe deja
$existante = Get-NetFirewallRule -DisplayName $RegleNom -ErrorAction SilentlyContinue
if ($existante) {
    Write-Host "  La regle '$RegleNom' existe deja." -ForegroundColor Yellow
    Write-Host "  Port $Port deja ouvert." -ForegroundColor Green
} else {
    try {
        New-NetFirewallRule -DisplayName $RegleNom -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Description "BLAMUNE - Serveur web local" | Out-Null
        Write-Host "  Regle creee : $RegleNom" -ForegroundColor Green
        Write-Host "  Port $Port ouvert pour les connexions entrantes." -ForegroundColor Green
    } catch {
        Write-Host "  ERREUR: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Execute ce script en tant qu'administrateur." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "  Appuie sur Entree pour continuer..."
Read-Host
