# =====================================================================
#  BLAMUNE - Script de sauvegarde automatique (V2 renforce)
#  - Compression ZIP
#  - Verification integrite post-backup
#  - Backup incrementale (optionnel)
#  - Logging et alertes
# =====================================================================

param(
    [int]$JoursGarder = 30,
    [switch]$Incrementale,
    [switch]$SansCompression
)

$Racine = $PSScriptRoot
if (-not $Racine) { $Racine = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) }
if (-not $Racine) { $Racine = (Get-Location).Path }

$DossierBackup = Join-Path $Racine "backups"
if (-not (Test-Path -LiteralPath $DossierBackup)) {
    New-Item -ItemType Directory -Path $DossierBackup -Force | Out-Null
}

$fichierLog = Join-Path $Racine "sauvegarde.log"
$fichierHashDernier = Join-Path $DossierBackup ".last_backup_hash.json"

function Log-Backup([string]$t) {
    $ligne = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [BACKUP] " + $t
    Write-Host $ligne
    try { Add-Content -LiteralPath $fichierLog -Value $ligne -Encoding UTF8 } catch {}
}

function Calculer-Hash([string]$chemin) {
    if (-not (Test-Path -LiteralPath $chemin)) { return $null }
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $bytes = [System.IO.File]::ReadAllBytes($chemin)
        return ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
    } catch { return $null }
}

function Verifier-IntegriteBackup([string]$dossierSrc, [string]$dossierDst) {
    $erreurs = @()
    $fichiersSrc = Get-ChildItem -LiteralPath $dossierSrc -Recurse -File
    foreach ($f in $fichiersSrc) {
        $relatif = $f.FullName.Substring($dossierSrc.Length).TrimStart('\', '/')
        $fDst = Join-Path $dossierDst $relatif
        if (-not (Test-Path -LiteralPath $fDst)) {
            $erreurs += "Manquant: $relatif"
            continue
        }
        $hashSrc = Calculer-Hash $f.FullName
        $hashDst = Calculer-Hash $fDst
        if ($hashSrc -ne $hashDst) {
            $erreurs += "Corrompu: $relatif"
        }
    }
    return $erreurs
}

function Backup-Incrementale([string]$src, [string]$dst, [hashtable]$hashesPrecedentes) {
    $nbCopies = 0
    $fichiers = Get-ChildItem -LiteralPath $src -Recurse -File
    foreach ($f in $fichiers) {
        $relatif = $f.FullName.Substring($src.Length).TrimStart('\', '/')
        $hashActuel = Calculer-Hash $f.FullName
        if (-not $hashesPrecedentes.ContainsKey($relatif) -or $hashesPrecedentes[$relatif] -ne $hashActuel) {
            $dstFile = Join-Path $dst $relatif
            $dstDir = Split-Path $dstFile -Parent
            if (-not (Test-Path -LiteralPath $dstDir)) {
                New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
            }
            Copy-Item -LiteralPath $f.FullName -Destination $dstFile -Force
            $nbCopies++
        }
    }
    return $nbCopies
}

# --- Demarrage ---
$horodatage = Get-Date -Format "yyyy-MM-dd_HHmmss"
Log-Backup "========================================="
Log-Backup "Sauvegarde demarree"
Log-Backup "Mode: $(if ($Incrementale) { 'Incrementale' } else { 'Complete' })"
Log-Backup "Compression: $(if ($SansCompression) { 'Non' } else { 'Oui (ZIP)' })"
Log-Backup "========================================="

# --- Charger hashes precedentes pour mode incremental ---
$hashesPrecedentes = @{}
if ($Incrementale -and (Test-Path -LiteralPath $fichierHashDernier)) {
    try { $hashesPrecedentes = Get-Content -LiteralPath $fichierHashDernier -Raw | ConvertFrom-Json -AsHashtable } catch { $hashesPrecedentes = @{} }
    Log-Backup "Hashes precedents charges: $($hashesPrecedentes.Count) fichiers"
}

# --- Fichiers a sauvegarder ---
$fichiersASauvegarder = @(
    @{ src = "savoir.txt";       dst = "savoir.txt" },
    @{ src = "comptes.json";     dst = "comptes.json" },
    @{ src = "stats.json";       dst = "stats.json" },
    @{ src = "vocabulaire.txt";  dst = "vocabulaire.txt" },
    @{ src = "vocabulaire_partage.txt"; dst = "vocabulaire_partage.txt" }
)

$dossiersASauvegarder = @("users")

# --- Copie des fichiers ---
$dossierCopie = Join-Path $DossierBackup "_temp_$horodatage"
if (-not (Test-Path -LiteralPath $dossierCopie)) {
    New-Item -ItemType Directory -Path $dossierCopie -Force | Out-Null
}

$nbFichiers = 0
$nbCopies = 0
$hashesNouvelles = @{}

foreach ($f in $fichiersASauvegarder) {
    $src = Join-Path $Racine $f.src
    if (-not (Test-Path -LiteralPath $src)) { continue }

    $hashActuel = Calculer-Hash $src

    if ($Incrementale -and $hashesPrecedentes.ContainsKey($f.src) -and $hashesPrecedentes[$f.src] -eq $hashActuel) {
        continue
    }

    $dst = Join-Path $dossierCopie $f.dst
    try {
        Copy-Item -LiteralPath $src -Destination $dst -Force
        $taille = (Get-Item -LiteralPath $dst).Length
        Log-Backup "  OK : $($f.src) ($taille octets)"
        $nbFichiers++
        $nbCopies++
        $hashesNouvelles[$f.src] = $hashActuel
    } catch {
        Log-Backup "  ERREUR : $($f.src) - $($_.Exception.Message)"
    }
}

foreach ($d in $dossiersASauvegarder) {
    $src = Join-Path $Racine $d
    if (-not (Test-Path -LiteralPath $src)) { continue }

    if ($Incrementale) {
        $dst = Join-Path $dossierCopie $d
        $nbCopies += Backup-Incrementale $src $dst $hashesPrecedentes
    } else {
        $dst = Join-Path $dossierCopie $d
        try {
            Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
            $nbUsers = (Get-ChildItem -LiteralPath $dst -Recurse -File).Count
            Log-Backup "  OK : $d/ ($nbUsers fichiers)"
            $nbFichiers += $nbUsers
            $nbCopies += $nbUsers
        } catch {
            Log-Backup "  ERREUR : $d/ - $($_.Exception.Message)"
        }
    }
}

if ($nbCopies -eq 0 -and $Incrementale) {
    Log-Backup "Aucun fichier modifie depuis la derniere sauvegarde."
    Remove-Item -LiteralPath $dossierCopie -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
}

# --- Verification integrite post-copie ---
Log-Backup ""
Log-Backup "Verification de l'integrite post-copie..."
$erreursIntegrite = @()
foreach ($f in $fichiersASauvegarder) {
    $src = Join-Path $Racine $f.src
    $dst = Join-Path $dossierCopie $f.dst
    if ((Test-Path -LiteralPath $src) -and (Test-Path -LiteralPath $dst)) {
        $hashSrc = Calculer-Hash $src
        $hashDst = Calculer-Hash $dst
        if ($hashSrc -ne $hashDst) {
            $erreursIntegrite += $f.src
        }
    }
}
if ($erreursIntegrite.Count -gt 0) {
    Log-Backup "ERREUR d'integrite pour: $($erreursIntegrite -join ', ')"
} else {
    Log-Backup "Integrite verifiee : OK"
}

# --- Compression ZIP ---
$archiveFinale = Join-Path $DossierBackup "backup_$horodatage.zip"
$dossierFinal = Join-Path $DossierBackup "backup_$horodatage"

if (-not $SansCompression) {
    try {
        Compress-Archive -LiteralPath $dossierCopie -DestinationPath $archiveFinale -CompressionLevel Optimal -Force
        $tailleZip = (Get-Item -LiteralPath $archiveFinale).Length
        Log-Backup "Archive ZIP creee : backup_$horodatage.zip ($([math]::Round($tailleZip / 1024, 1)) Ko)"
        Remove-Item -LiteralPath $dossierCopie -Recurse -Force
    } catch {
        Log-Backup "Erreur compression ZIP, copie non compressee conservee."
        Rename-Item -LiteralPath $dossierCopie -NewName "backup_$horodatage"
    }
} else {
    Rename-Item -LiteralPath $dossierCopie -NewName "backup_$horodatage"
}

# --- Enregistrer hashes pour prochaine incrementale ---
$hashesNouvelles | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $fichierHashDernier -Encoding UTF8

# --- Nettoyage des anciennes sauvegardes ---
Log-Backup ""
Log-Backup "Nettoyage des sauvegardes de plus de $JoursGarder jours..."
$seuil = (Get-Date).AddDays(-$JoursGarder)
$anciennes = Get-ChildItem -LiteralPath $DossierBackup | Where-Object {
    ($_.Name -like "backup_*") -and $_.CreationTime -lt $seuil
}
$supprimes = 0
foreach ($anc in $anciennes) {
    try {
        Remove-Item -LiteralPath $anc.FullName -Recurse -Force
        Log-Backup "  Supprime : $($anc.Name)"
        $supprimes++
    } catch {
        Log-Backup "  Erreur suppression : $($anc.Name)"
    }
}
if ($supprimes -eq 0) { Log-Backup "  Aucune ancienne sauvegarde a supprimer." }

# --- Resume ---
Log-Backup ""
Log-Backup "========================================="
Log-Backup "Sauvegarde terminee !"
Log-Backup "  Fichiers sauvegardes : $nbFichiers"
Log-Backup "  Archives creees      : $nbCopies"
Log-Backup "  Integrite            : $(if ($erreursIntegrite.Count -eq 0) { 'OK' } else { 'ERREUR' })"
if (-not $SansCompression) {
    $tailleFinale = (Get-Item -LiteralPath $archiveFinale -ErrorAction SilentlyContinue).Length
    if ($tailleFinale) { Log-Backup "  Taille ZIP           : $([math]::Round($tailleFinale / 1024, 1)) Ko" }
}
Log-Backup "  Emplacement          : $DossierBackup"
Log-Backup "========================================="
