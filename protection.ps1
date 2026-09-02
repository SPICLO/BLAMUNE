# =====================================================================
#  BLAMUNE - Script de protection des fichiers (V2 renforce)
#  - Lecture seule sur fichiers critiques
#  - Verification d'integrite SHA256
#  - Monitoring temps reel (FileSystemWatcher)
#  - Alertes sur modification non autorisee
#  - Logging fichier
# =====================================================================

param(
    [switch]$Verifier,
    [switch]$Reparer,
    [switch]$Surveiller
)

$Racine = $PSScriptRoot
if (-not $Racine) { $Racine = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) }
if (-not $Racine) { $Racine = (Get-Location).Path }

$fichiersCritiques = @(
    "bot.cpp",
    "bot.exe",
    "vocabulaire.txt",
    "config.json",
    "serveur_bot.ps1",
    "serveur_admin.ps1",
    "ouvrir_bot.bat",
    "ouvrir_admin.bat",
    "site\app.js",
    "site\index.html",
    "site\style.css",
    "admin\admin.js",
    "admin\admin.html",
    "admin\admin.css"
)

$fichiersDonnees = @(
    "savoir.txt",
    "comptes.json",
    "stats.json"
)

$fichierHash = Join-Path $Racine ".protection_hash.json"
$fichierLog = Join-Path $Racine "protection.log"
$fichierAlertes = Join-Path $Racine "protection_alertes.log"

function Log-Protection([string]$t) {
    $ligne = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [PROTECTION] " + $t
    Write-Host $ligne
    try { Add-Content -LiteralPath $fichierLog -Value $ligne -Encoding UTF8 } catch {}
}

function Log-Alerte([string]$t) {
    $ligne = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [ALERTE] " + $t
    Write-Host $ligne -ForegroundColor Red
    try { Add-Content -LiteralPath $fichierAlertes -Value $ligne -Encoding UTF8 } catch {}
    try { Add-Content -LiteralPath $fichierLog -Value $ligne -Encoding UTF8 } catch {}
}

function Calculer-Hash([string]$chemin) {
    if (-not (Test-Path -LiteralPath $chemin)) { return $null }
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $bytes = [System.IO.File]::ReadAllBytes($chemin)
        $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
        return $hash
    } catch { return $null }
}

function Appliquer-LectureSeule([string]$chemin) {
    if (-not (Test-Path -LiteralPath $chemin)) { return $false }
    try {
        $f = Get-Item -LiteralPath $chemin
        $f.Attributes = $f.Attributes -bor [System.IO.FileAttributes]::ReadOnly
        return $true
    } catch { return $false }
}

function Retirer-LectureSeule([string]$chemin) {
    if (-not (Test-Path -LiteralPath $chemin)) { return $false }
    try {
        $f = Get-Item -LiteralPath $chemin
        $f.Attributes = $f.Attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)
        return $true
    } catch { return $false }
}

function Verifier-TousHashes {
    $hashes = @{}
    if (Test-Path -LiteralPath $fichierHash) {
        try { $hashes = Get-Content -LiteralPath $fichierHash -Raw | ConvertFrom-Json -AsHashtable } catch { $hashes = @{} }
    }
    $modifications = @()
    foreach ($f in $fichiersCritiques + $fichiersDonnees) {
        $chemin = Join-Path $Racine $f
        if (-not (Test-Path -LiteralPath $chemin)) { continue }
        $hashActuel = Calculer-Hash $chemin
        if ($hashes.ContainsKey($f)) {
            if ($hashes[$f] -ne $hashActuel) {
                $modifications += $f
            }
        }
    }
    return $modifications
}

function Enregistrer-TousHashes {
    $hashes = @{}
    foreach ($f in $fichiersCritiques + $fichiersDonnees) {
        $chemin = Join-Path $Racine $f
        if (Test-Path -LiteralPath $chemin) {
            $hashes[$f] = Calculer-Hash $chemin
        }
    }
    $hashes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $fichierHash -Encoding UTF8
}

# ===== PHASE 1 : Verification d'integrite =====
if ($Verifier) {
    Log-Protection "=== Verification de l'integrite des fichiers ==="
    $modifications = Verifier-TousHashes
    if ($modifications.Count -eq 0) {
        Log-Protection "Tous les fichiers sont intacts."
    } else {
        Log-Protection "ATTENTION : $($modifications.Count) fichier(s) modifie(s) !"
        foreach ($m in $modifications) {
            Log-Alerte "MODIFIE : $m"
        }
    }
    Enregistrer-TousHashes
    exit 0
}

# ===== PHASE 2 : Reparer (retirer lecture seule) =====
if ($Reparer) {
    Log-Protection "Reparation : retrait de la lecture seule..."
    foreach ($f in $fichiersCritiques + $fichiersDonnees) {
        $chemin = Join-Path $Racine $f
        if (Test-Path -LiteralPath $chemin) {
            Retirer-LectureSeule $chemin | Out-Null
            Log-Protection "  $f -> ecriture autorisee"
        }
    }
    Log-Protection "Reparation terminee."
    exit 0
}

# ===== PHASE 3 : Monitoring temps reel =====
if ($Surveiller) {
    Log-Protection "=== Demarrage du monitoring temps reel ==="
    Log-Protection "Surveillance de $($fichiersCritiques.Count) fichiers critiques..."
    Log-Protection "Appuyez sur Ctrl+C pour arreter."

    $hashesInitiaux = @{}
    foreach ($f in $fichiersCritiques + $fichiersDonnees) {
        $chemin = Join-Path $Racine $f
        if (Test-Path -LiteralPath $chemin) {
            $hashesInitiaux[$f] = Calculer-Hash $chemin
        }
    }

    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $Racine
    $watcher.IncludeSubdirectories = $true
    $watcher.Filter = "*.*"
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::Size

    $action = {
        $chemin = $Event.SourceEventArgs.FullPath
        $type = $Event.SourceEventArgs.ChangeType
        $fichierRel = $chemin.Replace($using:Racine, "").TrimStart('\', '/')
        $fichiersCrit = $using:fichiersCritiques
        $fichiersDon = $using:fichiersDonnees
        $tousFichiers = $fichiersCrit + $fichiersDon

        $estCritique = $false
        foreach ($fc in $tousFichiers) {
            if ($fichierRel -eq $fc -or $fichierRel.Replace('\', '/') -eq $fc.Replace('\', '/')) {
                $estCritique = $true
                break
            }
        }

        if ($estCritique) {
            $hashActuel = $null
            try {
                $sha = [System.Security.Cryptography.SHA256]::Create()
                $bytes = [System.IO.File]::ReadAllBytes($chemin)
                $hashActuel = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
            } catch {}

            $hashes = $using:hashesInitiaux
            if ($hashes.ContainsKey($fichierRel) -and $hashes[$fichierRel] -ne $hashActuel) {
                $msg = "MODIFICATION DETECTEE : $fichierRel ($type)"
                Write-Host ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [ALERTE] $msg") -ForegroundColor Red
                try {
                    $ligne = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [ALERTE] $msg"
                    Add-Content -LiteralPath $using:fichierAlertes -Value $ligne -Encoding UTF8
                } catch {}
            }
        }
    }

    Register-ObjectEvent $watcher "Changed" -Action $action | Out-Null
    Register-ObjectEvent $watcher "Created" -Action $action | Out-Null
    Register-ObjectEvent $watcher "Deleted" -Action $action | Out-Null
    Register-ObjectEvent $watcher "Renamed" -Action $action | Out-Null

    Log-Protection "Monitoring actif. En attente d'evenements..."
    try {
        while ($true) { Start-Sleep -Seconds 5 }
    } finally {
        $watcher.Dispose()
        Log-Protection "Monitoring arrete."
    }
    exit 0
}

# ===== PHASE 4 : Appliquer la protection =====
Log-Protection "=== Application de la protection ==="
$nbOk = 0
$nbErr = 0
foreach ($f in $fichiersCritiques) {
    $chemin = Join-Path $Racine $f
    if (Test-Path -LiteralPath $chemin) {
        if (Appliquer-LectureSeule $chemin) {
            Log-Protection "  PROTEGE : $f"
            $nbOk++
        } else {
            Log-Protection "  ERREUR   : $f"
            $nbErr++
        }
    }
}

Log-Protection ""
Log-Protection "Protection appliquee sur $nbOk fichier(s)."
if ($nbErr -gt 0) { Log-Protection "Attention : $nbErr fichier(s) non protege(s)." }

Enregistrer-TousHashes
Log-Protection "Integrite enregistree dans .protection_hash.json"

Log-Protection ""
Log-Protection "=== Commandes disponibles ==="
Log-Protection "  .\protection.ps1                -> Appliquer la protection"
Log-Protection "  .\protection.ps1 -Verifier      -> Verifier l'integrite"
Log-Protection "  .\protection.ps1 -Reparer       -> Retirer la protection"
Log-Protection "  .\protection.ps1 -Surveiller    -> Monitoring temps reel"
