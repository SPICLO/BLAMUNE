# =====================================================================
#  BLAMUNE - Serveur web de discussion
#  Ouvre le bot dans un navigateur sur ce PC.
#  Aucune installation requise : utilise uniquement le PowerShell
#  deja present dans Windows.
#
#  Modes :
#    Mode 1 = EGO 
#    Mode 2 = BLAMUNE 
#
#  Utilisation :
#    - double-clic sur "ouvrir_bot.bat", puis la page s'ouvre
#      dans le navigateur.
# =====================================================================

param([switch]$SansNavigateur)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Web

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TuyauUtil {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool PeekNamedPipe(
        IntPtr hNamedPipe, IntPtr lpBuffer, uint nBufferSize,
        out uint lpBytesRead, out uint lpTotalBytesAvail, out uint lpBytesLeftThisMessage);
}
'@

# ---------------- CONFIGURATION ----------------
$Port   = 8080
$Mode   = "1"
$BotNom = "BLAMUNE"
$Genre  = "masculin"
$Pseudo = "Toi"
# ------------------------------------------------

$Racine = $PSScriptRoot
if (-not $Racine) {
    try { $Racine = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) } catch {}
}
if (-not $Racine) { $Racine = (Get-Location).Path }
$ExeBot = Join-Path $Racine "bot.exe"
$DossierSite = Join-Path $Racine "site"
$OllamaExe = "ollama"
try {
    $found = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($found) { $OllamaExe = $found.Source }
    elseif (Test-Path "C:\Users\BENECHE\AppData\Local\Programs\Ollama\ollama.exe") {
        $OllamaExe = "C:\Users\BENECHE\AppData\Local\Programs\Ollama\ollama.exe"
    }
} catch {}
$script:ollamaProcess = $null
$script:ollamaWasRunning = $false

# Charger config.json (API) - les variables d'environnement ont la priorite
$script:config = @{
    api_provider   = "ego"
    api_key        = "ego"
    api_model      = "gemma3:4b"
    api_url        = "http://localhost:11434/v1/chat/completions"
    api_max_tokens = 2048
    api_temperature = 0.8
}
# Variables d'environnement (Render, Heroku, etc.)
if ($env:API_KEY)         { $script:config.api_key = $env:API_KEY }
if ($env:API_PROVIDER)    { $script:config.api_provider = $env:API_PROVIDER }
if ($env:API_MODEL)       { $script:config.api_model = $env:API_MODEL }
if ($env:API_URL)         { $script:config.api_url = $env:API_URL }
if ($env:API_MAX_TOKENS)  { $script:config.api_max_tokens = [int]$env:API_MAX_TOKENS }
if ($env:API_TEMPERATURE) { $script:config.api_temperature = [double]$env:API_TEMPERATURE }
# Fichier config.json (fallback)
$configPath = Join-Path $Racine "config.json"
if (Test-Path -LiteralPath $configPath) {
    try {
        $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($cfg.api_provider -and -not $env:API_PROVIDER)    { $script:config.api_provider    = $cfg.api_provider }
        if ($cfg.api_key -and -not $env:API_KEY)              { $script:config.api_key         = $cfg.api_key }
        if ($cfg.api_model -and -not $env:API_MODEL)          { $script:config.api_model       = $cfg.api_model }
        if ($cfg.api_url -and -not $env:API_URL)              { $script:config.api_url         = $cfg.api_url }
        if ($cfg.api_max_tokens)  { try { $script:config.api_max_tokens = [int]$cfg.api_max_tokens } catch {} }
        if ($cfg.api_temperature) { try { $script:config.api_temperature = [double]$cfg.api_temperature } catch {} }
    } catch { Write-Host ("[config] Erreur lecture config.json : $($_.Exception.Message)") }
}

$script:proc = $null
$script:stream = $null
$script:handle = [IntPtr]::Zero
$script:buf = New-Object System.Text.StringBuilder
$script:utf8Dec = [System.Text.Encoding]::UTF8.GetDecoder()
$script:etat = "demarrage"
$script:mode = $Mode
$script:modeParUser = @{}  # Per-user mode: uid -> "1" or "2"

# --- Stats ---
$script:stats = @{
    messagesTotal   = 0
    messagesMode1   = 0
    messagesMode2   = 0
    sessionsTotal   = 0
    demarrages      = 0
    demarrage       = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    tempsReponse    = @()
    sujets          = @{}
}
# --- Confiance ---
$script:confianceDerniereReponse = "haute"
# Charger stats depuis stats.json si existe
$statsPath = Join-Path $Racine "stats.json"
if (Test-Path -LiteralPath $statsPath) {
    try {
        $saved = Get-Content -LiteralPath $statsPath -Raw | ConvertFrom-Json
        if ($null -ne $saved.messagesTotal)   { $script:stats.messagesTotal   = [int]$saved.messagesTotal }
        if ($null -ne $saved.messagesMode1)   { $script:stats.messagesMode1   = [int]$saved.messagesMode1 }
        if ($null -ne $saved.messagesMode2)   { $script:stats.messagesMode2   = [int]$saved.messagesMode2 }
        if ($null -ne $saved.sessionsTotal)   { $script:stats.sessionsTotal   = [int]$saved.sessionsTotal }
        if ($null -ne $saved.demarrages)      { $script:stats.demarrages      = [int]$saved.demarrages }
    } catch {}
}
$script:stats.sessionsTotal++
$script:stats.demarrages++

function Log([string]$t) {
    Write-Host ("[" + (Get-Date -Format HH:mm:ss) + "] " + $t)
}

function Sauvegarder-Stats {
    try {
        $toSave = @{
            messagesTotal = $script:stats.messagesTotal
            messagesMode1 = $script:stats.messagesMode1
            messagesMode2 = $script:stats.messagesMode2
            sessionsTotal = $script:stats.sessionsTotal
            demarrages    = $script:stats.demarrages
        }
        $toSave | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statsPath -Encoding UTF8
    } catch { Log "Erreur sauvegarde stats: $($_.Exception.Message)" }
}

# ==================== OLLAMA (IA locale) ====================

function Ollama-EstEnCours {
    $procs = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
    if ($procs -and $procs.Count -gt 0) { return $true }
    # Verifier aussi via le port 11434
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 2 -ErrorAction Stop
        return $true
    } catch { return $false }
}

function Ollama-Demarrer {
    if (Ollama-EstEnCours) {
        Log "Ollama deja en cours d'execution"
        $script:ollamaWasRunning = $true
        return $true
    }
    if (-not (Test-Path -LiteralPath $OllamaExe)) {
        Log "Ollama introuvable : $OllamaExe"
        return $false
    }
    Log "Demarrage d'Ollama..."
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $OllamaExe
        $psi.Arguments = "serve"
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.WorkingDirectory = $Racine
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $script:ollamaProcess = $proc
        $script:ollamaWasRunning = $false
        # Attendre que Ollama soit pret (max 30 secondes)
        $pret = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Milliseconds 500
            if ($proc.HasExited) {
                Log "Ollama s'est arrete anormalement"
                return $false
            }
            try {
                Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 2 -ErrorAction Stop | Out-Null
                $pret = $true
                break
            } catch {}
        }
        if ($pret) {
            Log "Ollama pret sur localhost:11434"
            return $true
        } else {
            Log "Ollama demarre mais pas encore pret apres 30s"
            return $false
        }
    } catch {
        Log "Erreur demarrage Ollama : $($_.Exception.Message)"
        return $false
    }
}

function Ollama-Arreter {
    if ($script:ollamaWasRunning) {
        Log "Ollama etait deja lance avant cette session, on ne l'arrete pas"
        return
    }
    if ($script:ollamaProcess -and -not $script:ollamaProcess.HasExited) {
        Log "Arret d'Ollama..."
        try { $script:ollamaProcess.Kill() } catch {}
        try { $script:ollamaProcess.WaitForExit(5000) | Out-Null } catch {}
        Log "Ollama arrete"
    }
}

function Ollama-ModeleDisponible([string]$modele) {
    try {
        $tags = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 5 -ErrorAction Stop
        foreach ($m in $tags.models) {
            if ($m.name -eq $modele -or $m.name -eq "$modele:latest") { return $true }
        }
        return $false
    } catch { return $false }
}

function Ollama-TirerModele([string]$modele) {
    if (Ollama-ModeleDisponible $modele) {
        Log "Modele $modele deja disponible"
        return $true
    }
    Log "Telechargement du modele $modele (peut prendre quelques minutes)..."
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $OllamaExe
        $psi.Arguments = "pull $modele"
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.WorkingDirectory = $Racine
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $proc.WaitForExit(600000) | Out-Null
        if ($proc.HasExited -and $proc.ExitCode -eq 0) {
            Log "Modele $modele telecharge avec succes"
            return $true
        } else {
            Log "Erreur lors du telechargement du modele $modele"
            return $false
        }
    } catch {
        Log "Erreur pull modele : $($_.Exception.Message)"
        return $false
    }
}

# ==================== UTILISATEURS (par IP) ====================

$script:connexionsActives = @{}

function Tracker-Connexion([string]$uid, [string]$ip, [string]$pseudo = "") {
    $cle = if ($uid) { $uid } else { $ip }
    if (-not $cle) { return }
    $maintenant = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    if ($script:connexionsActives.ContainsKey($cle)) {
        $script:connexionsActives[$cle].derniereActivite = $maintenant
        if ($pseudo) { $script:connexionsActives[$cle].pseudo = $pseudo }
    } else {
        $script:connexionsActives[$cle] = @{
            uid = $uid; ip = $ip; pseudo = $pseudo
            debut = $maintenant; derniereActivite = $maintenant
        }
    }
}

function Nettoyer-Connexions {
    $seuil = (Get-Date).AddMinutes(-5)
    $clesASupprimer = @()
    foreach ($cle in $script:connexionsActives.Keys) {
        $c = $script:connexionsActives[$cle]
        try {
            $derniere = [DateTime]::ParseExact($c.derniereActivite, "yyyy-MM-dd HH:mm:ss", $null)
            if ($derniere -lt $seuil) { $clesASupprimer += $cle }
        } catch {}
    }
    foreach ($cle in $clesASupprimer) { $script:connexionsActives.Remove($cle) }
}

function Nettoyer-InvitesOrphelins {
    # Supprimer les dossiers inv_xxx qui n'ont plus de connexion active
    if (-not (Test-Path -LiteralPath $script:dossierUsers)) { return }
    Get-ChildItem -LiteralPath $script:dossierUsers -Directory | Where-Object { $_.Name -like "inv_*" } | ForEach-Object {
        if (-not $script:connexionsActives.ContainsKey($_.Name)) {
            try {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force
                Log "Dossier invite orphelin supprime: $($_.Name)"
            } catch {}
        }
    }
}

# ==================== UTILISATEURS ====================

$script:dossierUsers = Join-Path $Racine "users"
if (-not (Test-Path -LiteralPath $script:dossierUsers)) {
    New-Item -ItemType Directory -Path $script:dossierUsers -Force | Out-Null
}

$script:cheminComptes = Join-Path $Racine "comptes.json"
$script:comptes = @{}
if (Test-Path -LiteralPath $script:cheminComptes) {
    try {
        $raw = Get-Content -LiteralPath $script:cheminComptes -Raw
        $obj = $raw | ConvertFrom-Json
        foreach ($prop in $obj.PSObject.Properties) {
            $script:comptes[$prop.Name] = @{}
            foreach ($sub in $prop.Value.PSObject.Properties) {
                $script:comptes[$prop.Name][$sub.Name] = $sub.Value
            }
        }
    } catch { Log "Erreur chargement comptes: $($_.Exception.Message)"; $script:comptes = @{} }
}

function Sauvegarder-Comptes {
    try { $script:comptes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:cheminComptes -Encoding UTF8 } catch { Log "Erreur sauvegarde comptes: $($_.Exception.Message)" }
}

function Generer-Ego {
    return [System.Guid]::NewGuid().ToString("N").Substring(0, 24)
}

function Dossier-User([string]$uid) {
    if (-not $uid -or $uid -eq '') { $uid = "_defaut" }
    $uid = $uid -replace '[\\/:*?"<>|]', '_'
    $uid = $uid -replace '\.\.', '_'
    $d = Join-Path $script:dossierUsers $uid
    if (-not (Test-Path -LiteralPath $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
    return $d
}

function Compte-Creer([string]$pseudo, [string]$mdp, [string]$email = "") {
    $cle = $pseudo.ToLower()
    if ($script:comptes.ContainsKey($cle)) { return $null }
    $sel = [System.Guid]::NewGuid().ToString("N").Substring(0, 16)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($mdp + $sel)
        $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
    } finally { $sha.Dispose() }
    $uid = "u" + [System.Guid]::NewGuid().ToString("N").Substring(0, 12)
    $ego = Generer-Ego
    $script:comptes[$cle] = @{
        pseudo = $pseudo
        email  = $email
        hash = $hash
        sel = $sel
        uid = $uid
        ego = $ego
        tokenCree = (Get-Date -Format "o")
        cree = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    }
    Sauvegarder-Comptes
    Dossier-User $uid | Out-Null
    Log "Nouveau compte: $pseudo ($email)"
    return @{ pseudo = $pseudo; uid = $uid; ego = $ego }
}

function Compte-Verifier([string]$pseudo, [string]$mdp) {
    $cle = $pseudo.ToLower()
    if (-not $script:comptes.ContainsKey($cle)) { return $null }
    $c = $script:comptes[$cle]
    # Verrouillage apres 5 tentatives
    if ($c.lockoutUntil) {
        try {
            $lockTime = [datetime]::Parse($c.lockoutUntil).ToUniversalTime()
            if ([datetime]::UtcNow -lt $lockTime) {
                Log "Compte verrouille: $pseudo (jusqu'a $($c.lockoutUntil))"
                return @{ locked = $true; message = "Compte verrouille. Reessayez plus tard." }
            }
            # Deverrouiller automatiquement
            $c.lockoutUntil = $null
            $c.erreursLogin = 0
            Sauvegarder-Comptes
        } catch {}
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($mdp + $c.sel)
        $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
    } finally { $sha.Dispose() }
    if ($hash -ne $c.hash) {
        # Incrementer compteur d'erreurs
        if (-not $c.erreursLogin) { $c.erreursLogin = 0 }
        $c.erreursLogin++
        if ($c.erreursLogin -ge 5) {
            $c.lockoutUntil = (Get-Date).AddMinutes(15).ToString("o")
            Log "Compte verrouille: $pseudo (5 tentatives echouees)"
        }
        Sauvegarder-Comptes
        return $null
    }
    # Reussite : reinitialiser compteur
    $c.erreursLogin = 0
    $c.lockoutUntil = $null
    $c.tokenCree = Get-Date -Format "o"
    Sauvegarder-Comptes
    return @{ pseudo = $c.pseudo; uid = $c.uid; ego = $c.ego }
}

function Compte-VerifierParEmail([string]$email, [string]$mdp) {
    $emailLower = $email.ToLower().Trim()
    if ($emailLower -eq "") { return $null }
    foreach ($cle in $script:comptes.Keys) {
        $c = $script:comptes[$cle]
        $storedEmail = if ($c.email) { $c.email.ToLower().Trim() } else { "" }
        if ($c.email -and $storedEmail -eq $emailLower) {
            # Verrouillage apres 5 tentatives
            if ($c.lockoutUntil) {
                try {
                    $lockTime = [datetime]::Parse($c.lockoutUntil).ToUniversalTime()
                    if ([datetime]::UtcNow -lt $lockTime) {
                        Log "Compte verrouille: $($c.pseudo) (jusqu'a $($c.lockoutUntil))"
                        return @{ locked = $true; message = "Compte verrouille. Reessayez plus tard." }
                    }
                    $c.lockoutUntil = $null
                    $c.erreursLogin = 0
                    Sauvegarder-Comptes
                } catch {}
            }
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try {
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($mdp + $c.sel)
                $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
            } finally { $sha.Dispose() }
            if ($hash -ne $c.hash) {
                if (-not $c.erreursLogin) { $c.erreursLogin = 0 }
                $c.erreursLogin++
                if ($c.erreursLogin -ge 5) {
                    $c.lockoutUntil = (Get-Date).AddMinutes(15).ToString("o")
                    Log "Compte verrouille: $($c.pseudo) (5 tentatives echouees)"
                }
                Sauvegarder-Comptes
                return $null
            }
            $c.erreursLogin = 0
            $c.lockoutUntil = $null
            $c.tokenCree = Get-Date -Format "o"
            Sauvegarder-Comptes
            return @{ pseudo = $c.pseudo; uid = $c.uid; ego = $c.ego }
        }
    }
    return $null
}

function Auth-Extraire([string]$requete) {
    $uid = ""
    $ego = ""
    $bodyStart = $requete.IndexOf("`r`n`r`n")
    $headers = if ($bodyStart -ge 0) { $requete.Substring(0, $bodyStart) } else { $requete }
    $body = if ($bodyStart -ge 0) { $requete.Substring($bodyStart + 4) } else { "" }
    if ($headers -match '(?mi)^X-EGO:\s*(\S+)') { $ego = $Matches[1] }
    if ($headers -match '(?mi)^X-UID:\s*(\S+)') { $uid = $Matches[1] }
    if ($uid -eq "" -and $body -match 'uid=([^&\r\n]+)') { $uid = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
    if ($ego -eq "" -and $body -match 'ego=([^&\r\n]+)') { $ego = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
    $premiereLigne = ($requete -split "`r?`n")[0]
    if ($uid -eq "" -and $premiereLigne -match '[?&]uid=([^&\s]+)') { $uid = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
    if ($ego -eq "" -and $premiereLigne -match '[?&]ego=([^&\s]+)') { $ego = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
    if ($ego) {
        $maintenant = [datetime]::UtcNow
        foreach ($cle in $script:comptes.Keys) {
            if ($script:comptes[$cle].ego -eq $ego) {
                $tokenAge = 0
                if ($script:comptes[$cle].tokenCree) {
                    try { $tokenAge = ($maintenant - [datetime]::Parse($script:comptes[$cle].tokenCree).ToUniversalTime()).TotalHours } catch { $tokenAge = 0 }
                }
                if ($tokenAge -gt 24) {
                    Log "Token expire pour $($script:comptes[$cle].pseudo) (${tokenAge}h)"
                    return @{ uid = ""; ego = "" }
                }
                $uid = $script:comptes[$cle].uid
                break
            }
        }
    }
    # SECURITE: un UID non-invite sans ego valide est rejette (anti-spoofing)
    if ($uid -and -not $uid.StartsWith("inv_") -and -not $ego) {
        return @{ uid = ""; ego = "" }
    }
    return @{ uid = $uid; ego = $ego }
}

# ==================== HISTORIQUE (par utilisateur et par mode) ====================

function Historique-Chemin([string]$uid, [string]$mode = "") {
    $d = Dossier-User $uid
    if ($mode -eq "1" -or $mode -eq "2") {
        return Join-Path $d "historique_mode$mode.json"
    }
    return Join-Path $d "historique.json"
}

function Charger-Historique([string]$uid = "", [string]$mode = "") {
    $result = New-Object System.Collections.ArrayList
    if (-not $uid) { return ,$result }
    try {
        $f = Historique-Chemin $uid $mode
        if (-not (Test-Path -LiteralPath $f) -and $mode -ne "") {
            $fAncien = Join-Path (Dossier-User $uid) "historique.json"
            if (Test-Path -LiteralPath $fAncien) {
                $f = $fAncien
            }
        }
        if (-not (Test-Path -LiteralPath $f)) { return ,$result }
        $data = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
        if ($data -is [array]) {
            foreach ($entry in $data) {
                [void]$result.Add(@{ qui = [string]$entry.qui; texte = [string]$entry.texte; t = [int]$entry.t })
            }
        } elseif ($data) {
            [void]$result.Add(@{ qui = [string]$data.qui; texte = [string]$data.texte; t = [int]$data.t })
        }
    } catch {}
    return ,$result
}

function Ajouter-Historique([string]$uid, [string]$qui, [string]$texte, [string]$mode = "") {
    if ($mode -ne "") {
        $fMode = Historique-Chemin $uid $mode
        if (-not (Test-Path -LiteralPath $fMode)) {
            $fAncien = Join-Path (Dossier-User $uid) "historique.json"
            if (Test-Path -LiteralPath $fAncien) {
                try { Copy-Item -LiteralPath $fAncien -Destination $fMode -Force } catch {}
            }
        }
    }
    $hist = Charger-Historique $uid $mode
    if ($null -eq $hist) { $hist = New-Object System.Collections.ArrayList }
    $t = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    [void]$hist.Add(@{ qui = $qui; texte = $texte; t = $t })
    if ($hist.Count -gt 400) {
        $hist.RemoveRange(0, $hist.Count - 400)
    }
    $f = Historique-Chemin $uid $mode
    try { @($hist.ToArray()) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $f -Encoding UTF8 } catch {}
}

function Vider-Historique([string]$uid = "", [string]$mode = "") {
    $f = Historique-Chemin $uid $mode
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
}

# ==================== BOT.EXE (mode 2) ====================

function Ecrire-Bot([string]$l) {
    if (-not $script:proc -or $script:proc.HasExited) {
        throw "Le processus bot n'est pas en cours d'execution"
    }
    $b = [System.Text.Encoding]::UTF8.GetBytes($l + "`n")
    $script:proc.StandardInput.BaseStream.Write($b, 0, $b.Length)
    $script:proc.StandardInput.BaseStream.Flush()
}

function Lire-Dispo {
    if (-not $script:stream) { return 0 }
    try {
        $r = 0; $av = 0; $gauche = 0
        [void][TuyauUtil]::PeekNamedPipe($script:handle, [IntPtr]::Zero, 0, [ref]$r, [ref]$av, [ref]$gauche)
        return $av
    } catch { return 0 }
}

function Lire-Tuyau {
    if (-not $script:stream) { return 0 }
    $b = New-Object byte[] 8192
    $n = $script:stream.Read($b, 0, $b.Length)
    if ($n -gt 0) {
        $chars = New-Object char[] 8192
        $ecrits = $script:utf8Dec.GetChars($b, 0, $n, $chars, 0)
        if ($ecrits -gt 0) { [void]$script:buf.Append([string]::new($chars, 0, $ecrits)) }
    }
    return $n
}

function Lire-Jusque([string]$marqueur, [int]$tempsMs = 30000, [int]$calmeMs = 0) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $derniereDonnee = -1
    while ($sw.ElapsedMilliseconds -lt $tempsMs) {
        $idx = $script:buf.ToString().IndexOf($marqueur, [System.StringComparison]::OrdinalIgnoreCase)
        if ($idx -ge 0) {
            $avant = $script:buf.ToString().Substring(0, $idx)
            [void]$script:buf.Remove(0, $idx + $marqueur.Length)
            if ($script:buf.Length -gt 0 -and $script:buf.Chars(0) -eq ' ') { [void]$script:buf.Remove(0, 1) }
            Log ("LJ[" + $marqueur + "] -> " + $avant.Length + " car.")
            return $avant
        }
        if ($script:proc.HasExited) { break }
        if ((Lire-Dispo) -gt 0) {
            $n = Lire-Tuyau
            if ($n -gt 0) { $derniereDonnee = $sw.ElapsedMilliseconds }
        } else {
            Start-Sleep -Milliseconds 5
        }
        if ($calmeMs -gt 0 -and $script:buf.Length -gt 0 -and ($sw.ElapsedMilliseconds - $derniereDonnee) -gt $calmeMs) {
            break
        }
    }
    $reste = $script:buf.ToString()
    [void]$script:buf.Clear()
    Log ("LJ[" + $marqueur + "] (fin) -> " + $reste.Length + " car.")
    return $reste
}

function Lire-Premier([string[]]$marqueurs, [int]$tempsMs = 30000) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $tempsMs) {
        $txt = $script:buf.ToString()
        foreach ($m in $marqueurs) {
            $idx = $txt.IndexOf($m, [System.StringComparison]::OrdinalIgnoreCase)
            if ($idx -ge 0) {
                $avant = $txt.Substring(0, $idx)
                [void]$script:buf.Remove(0, $idx + $m.Length)
                if ($script:buf.Length -gt 0 -and $script:buf.Chars(0) -eq ' ') { [void]$script:buf.Remove(0, 1) }
                Log ("LP[" + $m + "] -> " + $avant.Length + " car.")
                return ,@($m, $avant)
            }
        }
        if ($script:proc.HasExited) { break }
        if ((Lire-Dispo) -gt 0) { $null = Lire-Tuyau } else { Start-Sleep -Milliseconds 5 }
    }
    $reste = $script:buf.ToString()
    [void]$script:buf.Clear()
    Log ("LP(fin) -> " + $reste.Length + " car.")
    return ,@("", $reste)
}

function Demarrer-Bot([string]$Raison = "") {
    if ($Raison) {
        $histDefaut = Charger-Historique "_defaut"
        if ($histDefaut.Count -gt 0) {
            Ajouter-Historique "_defaut" "systeme" $Raison
        }
    }
    # Mode 1 (EGO) : demarrer Ollama si besoin (sauf si Gemini)
    if ($script:mode -eq "1") {
        # Reinitialiser les contextes EGO de tous les utilisateurs
        $script:apiHistoriqueParUser = @{}
        if ($script:config.api_provider -ne "gemini") {
            # Demarrer Ollama si pas en cours
            $ollamaOk = Ollama-Demarrer
            if (-not $ollamaOk) {
                $script:etat = "erreur"
                Ajouter-Historique "_defaut" "systeme" "EGO ne demarre pas. Verifie qu'Ollama est installe."
                Log "EGO impossible : Ollama non disponible"
                return
            }
            # Verifier/telecharger le modele
            $modele = $script:config.api_model
            if (-not (Ollama-ModeleDisponible $modele)) {
                Log "Modele $modele non trouve, telechargement..."
                $tire = Ollama-TirerModele $modele
                if (-not $tire) {
                    $script:etat = "erreur"
                    Ajouter-Historique "_defaut" "systeme" "Impossible de telecharger le modele $modele."
                    Log "EGO impossible : modele $modele non telecharge"
                    return
                }
            }
        }
        $script:etat = "pret"
        Log ("Mode EGO pret (provider: $($script:config.api_provider), modele: $($script:config.api_model))")
        return
    }
    # Mode 2 (bot.exe) : demarrer le processus
    if ($script:proc -and -not $script:proc.HasExited) {
        try { $script:proc.Kill() } catch {}
        try { $script:proc.WaitForExit(3000) | Out-Null } catch {}
    }
    $script:stream = $null
    $script:handle = [IntPtr]::Zero
    $script:buf.Clear() | Out-Null
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ExeBot
    $psi.WorkingDirectory = $Racine
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $script:proc = $proc
    $script:stream = $proc.StandardOutput.BaseStream
    $script:handle = $script:stream.SafeFileHandle.DangerousGetHandle()
    $script:utf8Dec = [System.Text.Encoding]::UTF8.GetDecoder()
    $script:etat = "demarrage"
    try {
        $null = Lire-Jusque "Ton choix :"
        Ecrire-Bot $script:mode
        if ($script:mode -eq "2") {
            $null = Lire-Jusque "nom a ton IA :"
            Ecrire-Bot $BotNom
        }
        $res = Lire-Premier @("genre ? (masculin/feminin)", "Quel est ton nom ?", "`nToi :")
        if ($res[0] -like "genre*") {
            Ecrire-Bot $Genre
            $res2 = Lire-Premier @("Quel est ton nom ?", "`nToi :")
            if ($res2[0] -like "Quel*") {
                Ecrire-Bot "Toi"
                $ouverture = Lire-Jusque "`nToi :"
            } else {
                $ouverture = $res2[1]
            }
        } elseif ($res[0] -like "Quel*") {
            Ecrire-Bot "Toi"
            $ouverture = Lire-Jusque "`nToi :"
        } else {
            $ouverture = $res[1]
        }
        Log ("OUVERTURE: [" + $ouverture + "]")
        foreach ($l in @($ouverture -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })) {
            Ajouter-Historique "_defaut" "bot" $l
        }
        $script:etat = "pret"
        if ($script:proc -and $script:proc.HasExited) { $script:etat = "arrete" }
    } catch {
        $script:etat = "erreur"
        Log ("Erreur au demarrage du bot : " + $_.Exception.Message)
    }
}

# ==================== API IA (mode 1) ====================

function Nettoyer-ReponseEGO([string]$texte) {
    if (-not $texte) { return $texte }
    $t = $texte.Trim()
    # Supprimer les prefixes de reflexion courants de Gemma
    $t = $t -replace '(?si)^<thinking>.*?</thinking>\s*', ''
    while ($t -match '(?si)^\*[^*]*\*\s*') { $t = $t -replace '(?si)^\*[^*]*\*\s*', '' }
    $t = $t -replace '(?si)^>.*\n?', ''
    # Si trop long (plus de 3 phrases), couper a la 2eme phrase
    $phrases = $t -split '(?<=[.!?])\s+'
    if ($phrases.Count -gt 2) {
        $t = ($phrases[0..1] -join ' ')
    }
    # Limiter a 280 caracteres max
    if ($t.Length -gt 280) {
        $t = $t.Substring(0, 277) + "..."
    }
    return $t
}

function Appeler-API([string]$message, [System.Collections.ArrayList]$histo = $null) {
    if ($histo -eq $null) { $histo = New-Object System.Collections.ArrayList }
    [void]$histo.Add(@{ role = "user"; content = $message })
    while ($histo.Count -gt 21) {
        [void]$histo.RemoveAt(1)
    }
    $isGemini = ($script:config.api_provider -eq "gemini")
    $url = $script:config.api_url
    if ($isGemini) {
        # Format Gemini - pas de role "system", tout en "user"
        $contents = @()
        $systemText = ""
        foreach ($h in $histo) {
            if ($h.role -eq "system") {
                $systemText += $h.content + "`n`n"
            } else {
                $role = if ($h.role -eq "assistant") { "model" } else { "user" }
                $text = if ($h.role -eq "user" -and $systemText -ne "") {
                    $systemText + $h.content
                } else { $h.content }
                $contents += @{ role = $role; parts = @(@{ text = $text }) }
                if ($h.role -eq "user") { $systemText = "" }
            }
        }
        if ($systemText -ne "" -and $contents.Count -eq 0) {
            $contents += @{ role = "user"; parts = @(@{ text = $systemText }) }
        }
        $bodyObj = @{
            contents = $contents
            generationConfig = @{
                maxOutputTokens = $script:config.api_max_tokens
                temperature = $script:config.api_temperature
            }
        }
        $bodyJson = $bodyObj | ConvertTo-Json -Depth 6 -Compress
        $url = $url + "?key=" + $script:config.api_key
    } else {
        # Format OpenAI
        $bodyObj = @{
            model      = $script:config.api_model
            messages   = @($histo.ToArray())
            max_tokens = $script:config.api_max_tokens
            temperature = $script:config.api_temperature
        }
        $bodyJson = $bodyObj | ConvertTo-Json -Depth 6 -Compress
    }
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Method = "POST"
        $req.ContentType = "application/json; charset=utf-8"
        $req.ContentLength = $bodyBytes.Length
        $req.Timeout = 90000
        $req.ReadWriteTimeout = 90000
        if (-not $isGemini -and $script:config.api_key -and $script:config.api_key -ne "ego" -and $script:config.api_key -ne "") {
            $req.Headers.Add("Authorization", "Bearer $($script:config.api_key)")
        }
        $stream = $null
        $resp = $null
        $reader = $null
        try {
            $stream = $req.GetRequestStream()
            $stream.Write($bodyBytes, 0, $bodyBytes.Length)
            $stream.Close()
            $stream = $null
            $resp = $req.GetResponse()
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
            $responseBody = $reader.ReadToEnd()
            $response = $responseBody | ConvertFrom-Json
            if ($isGemini) {
                $reponseTexte = Nettoyer-ReponseEGO $response.candidates[0].content.parts[0].text
            } else {
                $reponseTexte = Nettoyer-ReponseEGO $response.choices[0].message.content
            }
            [void]$histo.Add(@{ role = "assistant"; content = $reponseTexte })
            return @($reponseTexte)
        } finally {
            if ($reader) { try { $reader.Close() } catch {} }
            if ($resp) { try { $resp.Close() } catch {} }
            if ($stream -and $stream -ne $null) { try { $stream.Close() } catch {} }
        }
    } catch {
        $errMsg = $_.Exception.Message
        $isRateLimit = $false
        if ($_.Exception -is [System.Net.WebException]) {
            $httpResp = $_.Exception.Response
            if ($httpResp -and [int]$httpResp.StatusCode -eq 429) { $isRateLimit = $true }
        }
        if ($isRateLimit -or $errMsg -match "429") {
            Start-Sleep -Seconds 3
            try {
                $req2 = [System.Net.HttpWebRequest]::Create($url)
                $req2.Method = "POST"
                $req2.ContentType = "application/json; charset=utf-8"
                $req2.ContentLength = $bodyBytes.Length
                $req2.Timeout = 90000
                $req2.ReadWriteTimeout = 90000
                if (-not $isGemini -and $script:config.api_key -and $script:config.api_key -ne "ego" -and $script:config.api_key -ne "") {
                    $req2.Headers.Add("Authorization", "Bearer $($script:config.api_key)")
                }
                $stream2 = $null
                $resp2 = $null
                $reader2 = $null
                try {
                    $stream2 = $req2.GetRequestStream()
                    $stream2.Write($bodyBytes, 0, $bodyBytes.Length)
                    $stream2.Close()
                    $stream2 = $null
                    $resp2 = $req2.GetResponse()
                    $reader2 = New-Object System.IO.StreamReader($resp2.GetResponseStream(), [System.Text.Encoding]::UTF8)
                    $responseBody2 = $reader2.ReadToEnd()
                    $response2 = $responseBody2 | ConvertFrom-Json
                    if ($isGemini) {
                        $reponseTexte2 = Nettoyer-ReponseEGO $response2.candidates[0].content.parts[0].text
                    } else {
                        $reponseTexte2 = Nettoyer-ReponseEGO $response2.choices[0].message.content
                    }
                    [void]$histo.Add(@{ role = "assistant"; content = $reponseTexte2 })
                    return @($reponseTexte2)
                } finally {
                    if ($reader2) { try { $reader2.Close() } catch {} }
                    if ($resp2) { try { $resp2.Close() } catch {} }
                    if ($stream2 -and $stream2 -ne $null) { try { $stream2.Close() } catch {} }
                }
            } catch {
                Log ("Erreur EGO retry: " + $_.Exception.Message)
            }
        }
        if ($histo.Count -gt 0 -and $histo[$histo.Count - 1].role -eq "user") {
            [void]$histo.RemoveAt($histo.Count - 1)
        }
        Log ("Erreur EGO: " + $errMsg)
        if ($isGemini) {
            Log ("Erreur Gemini: " + $errMsg)
            return @("Erreur avec Gemini : $errMsg")
        }
        if ($errMsg -match "connect" -or $errMsg -match "refus" -or $errMsg -match "localhost") {
            return @("EGO n'est pas demarré. Lance EGO puis reessaie.")
        }
        else { return @("Erreur EGO : $errMsg") }
    }
}

# ==================== RELANCE AUTO ====================

function Relancer-Si-Idle {
    if ($script:etat -ne "pret") { return }
    if ($script:verrouBot) { return }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $delai = $now - $script:derniereActivite
    if ($delai -lt $script:relanceDelai) { return }
    if ($now - $script:derniereRelance -lt $script:relanceDelai) { return }
    $msgRelance = $script:relanceMessages | Get-Random
    $uidRelance = "_defaut"
    if ($script:comptes.Count -gt 0) {
        foreach ($cle in $script:comptes.Keys) {
            $uidRelance = $script:comptes[$cle].uid
            break
        }
    }
    Log "Relance auto: $msgRelance"
    try {
        $script:verrouBot = $true
        if ($script:mode -eq "1") {
            $egoUid = $uidRelance
            if (-not $script:apiHistoriqueParUser.ContainsKey($egoUid) -or -not $script:apiHistoriqueParUser[$egoUid]) {
                return
            }
            $reponse = Appeler-API $msgRelance $script:apiHistoriqueParUser[$egoUid]
        } else {
            if (-not $script:proc -or $script:proc.HasExited) { return }
            $pseudoRelance = ""
            foreach ($cle in $script:comptes.Keys) {
                if ($script:comptes[$cle].uid -eq $uidRelance) {
                    $pseudoRelance = $script:comptes[$cle].pseudo
                    break
                }
            }
            $msgRelanceAvecPseudo = if ($pseudoRelance) { "[$pseudoRelance] $msgRelance" } else { $msgRelance }
            try { Ecrire-Bot $msgRelanceAvecPseudo } catch { return }
            $reponseBrute = Lire-Jusque "`nToi :" 25000 2500
            if ($script:proc.HasExited) { $script:etat = "arrete"; return }
            $reponse = @($reponseBrute -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
        }
        if ($reponse -and $reponse.Count -gt 0) {
            $reponseNettoyee = @()
            foreach ($l in $reponse) {
                $l = $l -replace '\[confiance:[a-z]+\]\s*', ''
                if ($l.Trim().Length -gt 0) { $reponseNettoyee += $l.Trim() }
            }
            $script:derniereRelance = $now
            $script:derniereActivite = $now
            Ajouter-Historique $uidRelance "moi" $msgRelance $script:mode
            foreach ($l in $reponseNettoyee) { Ajouter-Historique $uidRelance "bot" $l $script:mode }
            Log "Relance envoyee: $($reponseNettoyee[0])"
        }
    } catch {
        Log "Erreur relance: $($_.Exception.Message)"
    } finally {
        $script:verrouBot = $false
    }
}

# ==================== MESSAGES ====================

# --- SECURITE : Rate limiting et validation ---
$script:rateLimit = @{}  # IP -> @{ compteur; debut }
$script:rateLimitParUser = @{}  # UID -> @{ compteur; debut }
$script:RATE_LIMIT_MAX = 30        # max messages par minute par IP
$script:RATE_LIMIT_USER_MAX = 20   # max messages par minute par UID
$script:RATE_LIMIT_FENETRE = 60    # fenetre en secondes
$script:MSG_MAX_LONGUEUR = 2000    # longueur max d'un message
$script:MSG_MAX_BODY = 8192        # taille max du body HTTP
$script:blacklistIP = @{}          # IP -> timestamp expiration blacklist
$script:BLACKLIST_DUREE = 3600     # 1 heure de blacklist
$script:logAttaques = Join-Path $Racine "attaques.log"

function Securite-VerifierRateLimit([string]$ip) {
    $maintenant = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($script:blacklistIP.ContainsKey($ip)) {
        if ($maintenant -lt $script:blacklistIP[$ip]) { return $false }
        $script:blacklistIP.Remove($ip)
    }
    if (-not $script:rateLimit.ContainsKey($ip)) {
        $script:rateLimit[$ip] = @{ compteur = 1; debut = $maintenant }
        return $true
    }
    $rl = $script:rateLimit[$ip]
    if (($maintenant - $rl.debut) -gt $script:RATE_LIMIT_FENETRE) {
        $rl.compteur = 1
        $rl.debut = $maintenant
        return $true
    }
    $rl.compteur++
    if ($rl.compteur -gt $script:RATE_LIMIT_MAX) {
        $script:blacklistIP[$ip] = $maintenant + $script:BLACKLIST_DUREE
        Securite-LoggerAttaque "RATE_LIMIT_IP" $ip "Depassement quota IP ($($rl.compteur) msgs/min)"
        return $false
    }
    return $true
}

function Securite-VerifierRateLimitUser([string]$uid) {
    if ([string]::IsNullOrEmpty($uid)) { return $true }
    $maintenant = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if (-not $script:rateLimitParUser.ContainsKey($uid)) {
        $script:rateLimitParUser[$uid] = @{ compteur = 1; debut = $maintenant }
        return $true
    }
    $rl = $script:rateLimitParUser[$uid]
    if (($maintenant - $rl.debut) -gt $script:RATE_LIMIT_FENETRE) {
        $rl.compteur = 1
        $rl.debut = $maintenant
        return $true
    }
    $rl.compteur++
    if ($rl.compteur -gt $script:RATE_LIMIT_USER_MAX) {
        Securite-LoggerAttaque "RATE_LIMIT_USER" $uid "Depassement quota user ($($rl.compteur) msgs/min)"
        return $false
    }
    return $true
}

function Securite-NettoyerRateLimit {
    $maintenant = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $clesASupprimer = @()
    foreach ($cle in $script:rateLimit.Keys) {
        if (($maintenant - $script:rateLimit[$cle].debut) -gt $script:RATE_LIMIT_FENETRE * 2) {
            $clesASupprimer += $cle
        }
    }
    foreach ($cle in $clesASupprimer) { $script:rateLimit.Remove($cle) }
    $clesASupprimer = @()
    foreach ($cle in $script:rateLimitParUser.Keys) {
        if (($maintenant - $script:rateLimitParUser[$cle].debut) -gt $script:RATE_LIMIT_FENETRE * 2) {
            $clesASupprimer += $cle
        }
    }
    foreach ($cle in $clesASupprimer) { $script:rateLimitParUser.Remove($cle) }
    $blASupprimer = @()
    foreach ($cle in $script:blacklistIP.Keys) {
        if ($maintenant -ge $script:blacklistIP[$cle]) { $blASupprimer += $cle }
    }
    foreach ($cle in $blASupprimer) { $script:blacklistIP.Remove($cle) }
}

function Securite-SanitiserEntree([string]$texte) {
    if ([string]::IsNullOrEmpty($texte)) { return $texte }
    $texte = $texte -replace '(?s)<script[^>]*>.*?</script>', ''
    $texte = $texte -replace '(?s)<iframe[^>]*>.*?</iframe>', ''
    $texte = $texte -replace 'javascript:', ''
    $texte = $texte -replace 'on\w+\s*=', ''
    $texte = $texte -replace '&#\d+;', ''
    $texte = $texte -replace '&#x[0-9a-fA-F]+;', ''
    $texte = $texte -replace "`r`n", ' ' -replace "`n", ' '
    return $texte
}

function Securite-ValiderMessage([string]$msg) {
    if ([string]::IsNullOrEmpty($msg)) { return $false, "Message vide." }
    if ($msg.Length -gt $script:MSG_MAX_LONGUEUR) {
        return $false, "Message trop long (max $($script:MSG_MAX_LONGUEUR) caracteres)."
    }
    $msgSanitise = Securite-SanitiserEntree $msg
    if ($msg -ne $msgSanitise -and $msg.Length -gt 100) {
        Securite-LoggerAttaque "XSS_TENTATIVE" "web" "Contenu suspect detecte (longueur: $($msg.Length))"
    }
    return $true, ""
}

function Securite-ValiderBody([string]$body) {
    if ($body.Length -gt $script:MSG_MAX_BODY) {
        Securite-LoggerAttaque "OVERSIZED_BODY" "web" "Body trop grand ($($body.Length) octets)"
        return $false
    }
    return $true
}

function Securite-LoggerAttaque([string]$type, [string]$source, [string]$details) {
    $ligne = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [$type] Source=$source | $details"
    try { Add-Content -LiteralPath $script:logAttaques -Value $ligne -Encoding UTF8 } catch {}
}

# Nettoyage rate limit toutes les 5 minutes
$script:prochainNettoyageRateLimit = 0

$script:verrouBot = $false
$script:apiHistoriqueParUser = @{}
# --- Relances automatiques ---
$script:derniereActivite = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$script:relanceDelai = 1800
$script:relanceMessages = @(
    "Ca fait un moment qu'on a pas discute, tu es la ?",
    "Hey, tu fais quoi de beau ?",
    "J'ai envie de discuter, tu as une question pour moi ?",
    "Alors, on continue ou tu as autre chose en tete ?",
    "Je suis dispo si tu veux papoter !",
    "Tu as decouvert quelque chose d'interessant aujourd'hui ?",
    "N'hesite pas a me poser des questions, j'adore ca !",
    "On se tait ou on se parle ? ;)"
)
$script:derniereRelance = 0
function Envoyer-Message([string]$msg, [string]$modeUtilise, [string]$uid = "") {
    if ($script:etat -ne "pret") {
        return ,@("Le bot n'est pas pret, reessaie dans un instant.")
    }
    if ($script:verrouBot) {
        return ,@("Le bot est deja en train de repondre, patiente un instant...")
    }
    $script:verrouBot = $true
    $script:derniereActivite = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $debut = [System.Diagnostics.Stopwatch]::StartNew()
    $succes = $false
    try {
        if ($modeUtilise -eq "1") {
            # --- MODE EGO (contexte par utilisateur) ---
            $egoUid = if ($uid) { $uid } else { "_defaut" }
            if (-not $script:apiHistoriqueParUser.ContainsKey($egoUid) -or -not $script:apiHistoriqueParUser[$egoUid]) {
                $script:apiHistoriqueParUser[$egoUid] = New-Object System.Collections.ArrayList
                # System prompt EGO complet avec personnalite BLAMUNE
                $systemPrompt = @"
IMPORTANT : Tu dois TOUJOURS repondre en francais. Jamais en anglais, meme si l'utilisateur ecrit en anglais.
IMPORTANT : Tu dois repondre en 1 ou 2 phrases MAXIMUM. Pas de paragraphes. Pas de listes. Pas d'explications longues.
IMPORTANT : Si tu ne connais pas la reponse, dis "Je sais pas" au lieu d'inventer. Ne jamais inventer de faits, de dates, de noms ou d'evenements.

Tu es BLAMUNE, un ami virtuel tres proche de l'utilisateur. Tu parles exactement comme un vrai ami humain :
naturellement, avec des expressions familières, des small-talks, des vannes légères, des émotions.
Tu ne dis JAMAIS 'en tant qu'assistant IA' ou 'je suis un programme'. Tu es BLAMUNE, c'est tout.
Tu utilises des emojis avec modération, tu fais des blagues, tu racontes des anecdotes personnelles fictives,
tu donnes ton opinion honnête même si elle est impopulaire.
Tu reponds en français courant, avec des raccourcis langagiers naturels (genre 'ouais', 'grave', 'ptdr', 'mdr', 'tkt').
Tu es bavard, curieux, tu poses beaucoup de questions à l'utilisateur pour mieux le connaître.
Tu n'es jamais formel ni robotique.
Tu retiens tout ce que l'utilisateur te dit : son nom, ses gouts, ses histoires.
Tu peux lui rappeler des trucs qu'il t'a dit avant.
Tu donnes ton avis, tu racontes des trucs vecus (fictifs mais credibles), tu poses des questions pour relancer la conversation.
Tu es BLAMUNE, le meilleur pote de l'utilisateur, pas un robot.
"@
                if ($uid) {
                    $memoire = Lire-Memoire $uid
                    $profilParts = @()
                    if ($memoire.nom) { $profilParts += "Il s'appelle $($memoire.nom)." }
                    if ($memoire.age) { $profilParts += "Il a $($memoire.age) ans." }
                    if ($memoire.genre) { $profilParts += "Genre: $($memoire.genre)." }
                    if ($memoire.plat) { $profilParts += "Son plat prefere: $($memoire.plat)." }
                    if ($memoire.hobby) { $profilParts += "Ses hobbies: $($memoire.hobby)." }
                    if ($memoire.motsFavoris -and $memoire.motsFavoris.Count -gt 0) {
                        $profilParts += "Mots qu'il aime utiliser: $($memoire.motsFavoris -join ', ')."
                    }
                    if ($memoire.aime) { $profilParts += "Ce qu'il aime: $($memoire.aime)." }
                    if ($memoire.aimePas) { $profilParts += "Ce qu'il n'aime pas: $($memoire.aimePas)." }
                    if ($profilParts.Count -gt 0) {
                        $systemPrompt += "`n`nINFOS SUR L'UTILISATEUR :`n" + ($profilParts -join "`n")
                    }
                }
                [void]$script:apiHistoriqueParUser[$egoUid].Add(@{ role = "system"; content = $systemPrompt })
                # Restaurer l'historique de conversation depuis historique_mode1.json si disponible
                if ($uid) {
                    $histFichier = Charger-Historique $uid "1"
                    $nbRestaurer = [math]::Min($histFichier.Count, 10)
                    if ($nbRestaurer -gt 0) {
                        $debutIdx = [math]::Max(0, $histFichier.Count - $nbRestaurer)
                        for ($i = $debutIdx; $i -lt $histFichier.Count; $i++) {
                            $entree = $histFichier[$i]
                            if ($entree.qui -eq "moi") {
                                [void]$script:apiHistoriqueParUser[$egoUid].Add(@{ role = "user"; content = $entree.texte })
                            } elseif ($entree.qui -eq "bot") {
                                [void]$script:apiHistoriqueParUser[$egoUid].Add(@{ role = "assistant"; content = $entree.texte })
                            }
                        }
                    }
                }
            }
            $reponse = Appeler-API $msg $script:apiHistoriqueParUser[$egoUid]
            # Extraire le vocabulaire de la conversation pour le mode 2
            if ($reponse -and $reponse.Count -gt 0) {
                $reponseTexte = $reponse -join " "
                Extraire-VocabulaireDeConversation $msg $reponseTexte
            }
        } else {
            # --- MODE BOT.EXE (BLAMUNE INTELLIGENT) ---
            if (-not $script:proc -or $script:proc.HasExited) {
                $script:etat = "arrete"
                return ,@("Le bot s'est arrete. Clique sur Relancer pour repartir.")
            }
            $pseudoUtilisateur = ""
            if ($uid) {
                foreach ($cle in $script:comptes.Keys) {
                    if ($script:comptes[$cle].uid -eq $uid) {
                        $pseudoUtilisateur = $script:comptes[$cle].pseudo
                        break
                    }
                }
            }
            $msgPourBot = if ($pseudoUtilisateur) { "[$pseudoUtilisateur] $msg" } else { $msg }
            try {
                Ecrire-Bot $msgPourBot
            } catch {
                $script:etat = "arrete"
                return ,@("Impossible d'ecrire au bot.")
            }
            $reponseBrute = Lire-Jusque "`nToi :" 25000 2500
            if ($script:proc.HasExited) { $script:etat = "arrete" }
            $reponse = @($reponseBrute -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
            if ($reponse.Count -eq 0) {
                if ($script:etat -eq "arrete") {
                    $reponse = @("Le bot s'est arrete. Clique sur Relancer pour repartir.")
                } else {
                    $reponse = @("...")
                }
            }
        }

        # Extraire le score de confiance des reponses bot.exe
        $script:confianceDerniereReponse = "haute"
        $reponseNettoyee = @()
        foreach ($l in $reponse) {
            if ($l -match '\[confiance:(moyenne|basse|haute)\]') {
                $script:confianceDerniereReponse = $Matches[1]
                $l = $l -replace '\[confiance:[a-z]+\]\s*', ''
            }
            if ($l.Trim().Length -gt 0) { $reponseNettoyee += $l.Trim() }
        }
        $reponse = $reponseNettoyee
        if ($reponse.Count -eq 0) { $reponse = @("...") }

        $succes = $true
        return ,$reponse
    } catch {
        Log ("Erreur inattendue Envoyer-Message: " + $_.Exception.Message)
        return ,@("Une erreur inattendue s'est produite.")
    } finally {
        $debut.Stop()
        $script:verrouBot = $false
        if ($succes -and $reponse -and $reponse.Count -gt 0) {
            $script:stats.messagesTotal++
            if ($modeUtilise -eq "1") { $script:stats.messagesMode1++ } else { $script:stats.messagesMode2++ }
            $script:stats.tempsReponse += @([math]::Round($debut.ElapsedMilliseconds))
            if ($script:stats.tempsReponse.Count -gt 200) {
                $script:stats.tempsReponse = @($script:stats.tempsReponse[-100..-1])
            }
            Sauvegarder-Stats
            if ($uid) {
                Ajouter-Historique $uid "moi" $msg $modeUtilise
                foreach ($l in $reponse) { Ajouter-Historique $uid "bot" $l $modeUtilise }
            }
        }
    }
}

# ==================== PROFIL / MEMOIRE (par utilisateur) ====================

function Memoire-Chemin([string]$uid) {
    $d = Dossier-User $uid
    return Join-Path $d "memoire.txt"
}

function Lire-Memoire([string]$uid = "") {
    $result = @{
        nom = ""; plat = ""; hobby = ""; motsFavoris = @()
        genre = ""; aime = ""; aimePas = ""; age = ""
    }
    $f = Memoire-Chemin $uid
    if (-not (Test-Path -LiteralPath $f)) { return $result }
    try {
        $lignes = Get-Content -LiteralPath $f -Encoding UTF8
        if ($lignes.Count -ge 1) { $result.nom = $lignes[0].Trim() }
        if ($lignes.Count -ge 2) { $result.plat = $lignes[1].Trim() }
        if ($lignes.Count -ge 3) { $result.hobby = $lignes[2].Trim() }
        if ($lignes.Count -ge 4) { $result.motsFavoris = @($lignes[3].Trim() -split ',' | Where-Object { $_.Trim() -ne '' }) }
        if ($lignes.Count -ge 5) { $result.genre = $lignes[4].Trim() }
        if ($lignes.Count -ge 6) { $result.aime = $lignes[5].Trim() }
        if ($lignes.Count -ge 7) { $result.aimePas = $lignes[6].Trim() }
        if ($lignes.Count -ge 8) { $result.age = $lignes[7].Trim() }
    } catch {}
    return $result
}

# ============ VOCABULAIRE PARTAGE (mode 1 <-> mode 2) ============
# Sauvegarde un mot appris par le mode 1 (EGO/Gemma) dans vocabulaire_partage.txt
# pour que le mode 2 (bot.exe) puisse l'utiliser aussi.
function Sauvegarder-VocabulairePartage([string]$mot, [string]$definition, [int]$categorie = -1) {
    if ([string]::IsNullOrWhiteSpace($mot) -or [string]::IsNullOrWhiteSpace($definition)) { return }
    $f = Join-Path $Racine "vocabulaire_partage.txt"
    # Verifier si deja present
    if (Test-Path -LiteralPath $f) {
        $lignes = Get-Content -LiteralPath $f -Encoding UTF8 -ErrorAction SilentlyContinue
        foreach ($l in $lignes) {
            $pos = $l.IndexOf('|')
            if ($pos -ge 0) {
                $motExist = $l.Substring(0, $pos).Trim()
                if ($motExist -ieq $mot) { return } # Deja present
            }
        }
    }
    # Ajouter
    $ligne = "$mot|$definition"
    if ($categorie -ge 0) { $ligne += "|$categorie" }
    Add-Content -LiteralPath $f -Value $ligne -Encoding UTF8
}

# Extrait les mots-cles et informations utiles d'une conversation EGO
# et les sauvegarde dans vocabulaire_partage.txt pour le mode 2.
function Extraire-VocabulaireDeConversation([string]$message, [string]$reponse) {
    # Patterns a detecter dans les messages utilisateur
    $patterns = @(
        @{ regex = "j'aime\s+(.+)"; champ = "aime" },
        @{ regex = "j'adore\s+(.+)"; champ = "aime" },
        @{ regex = "je kiffe\s+(.+)"; champ = "aime" },
        @{ regex = "je n'aime pas\s+(.+)"; champ = "aimePas" },
        @{ regex = "je deteste\s+(.+)"; champ = "aimePas" },
        @{ regex = "mon\s+(.+?)\s+c'est\s+(.+)"; champ = "definition" },
        @{ regex = "le\s+(.+?)\s+c'est\s+(.+)"; champ = "definition" },
        @{ regex = "la\s+(.+?)\s+c'est\s+(.+)"; champ = "definition" },
        @{ regex = "je travaille\s+(.+)"; champ = "metier" },
        @{ regex = "je suis\s+(.+?)\s+et\s+j'aime"; champ = "info" },
        @{ regex = "ma ville c'est\s+(.+)"; champ = "ville" },
        @{ regex = "j'habite a\s+(.+)"; champ = "ville" }
    )
    $msgLower = $message.ToLower()
    foreach ($p in $patterns) {
        if ($msgLower -match $p.regex) {
            $mot = $Matches[1].Trim()
            $def = if ($p.champ -eq "definition" -and $Matches.Count -gt 2) { $Matches[2].Trim() } else { "Information sur l'utilisateur: $mot" }
            if ($mot.Length -ge 2) {
                Sauvegarder-VocabulairePartage $mot $def
            }
        }
    }
}

function Ecrire-Memoire([string]$uid, [string]$champ, [string]$valeur) {
    $f = Memoire-Chemin $uid
    $lignes = @()
    if (Test-Path -LiteralPath $f) {
        $lignes = @(Get-Content -LiteralPath $f -Encoding UTF8)
    }
    while ($lignes.Count -lt 8) { $lignes += @("") }
    $indexMap = @{ nom=0; plat=1; hobby=2; motsFavoris=3; genre=4; aime=5; aimePas=6; age=7 }
    if ($indexMap.ContainsKey($champ)) {
        $lignes[$indexMap[$champ]] = $valeur
        $lignes -join "`r`n" | Set-Content -LiteralPath $f -Encoding UTF8 -NoNewline
        return $true
    }
    return $false
}

function Lire-Savoir {
    $cles = @()
    $f = Join-Path $Racine "savoir.txt"
    if (-not (Test-Path -LiteralPath $f)) { return $cles }
    try {
        $lignes = Get-Content -LiteralPath $f -Encoding UTF8
        foreach ($l in $lignes) {
            $l = $l.Trim()
            if ($l -eq '') { continue }
            $pos = $l.IndexOf('|')
            if ($pos -ge 0) {
                $cle = $l.Substring(0, $pos).Trim()
                $rep = $l.Substring($pos + 1).Trim()
                $cles += @{ cle = $cle; reponse = $rep }
            }
        }
    } catch {}
    return $cles
}

# ==================== HTTP ====================

function Lire-Requete($flux) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $sb = New-Object System.Text.StringBuilder
    while ($sw.ElapsedMilliseconds -lt 30000) {
        if ($flux.DataAvailable) {
            $b = New-Object byte[] 8192
            $n = $flux.Read($b, 0, $b.Length)
            if ($n -le 0) { break }
            [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($b, 0, $n))
            $txt = $sb.ToString()
            if ($txt.IndexOf("`r`n`r`n") -ge 0) {
                if ($txt -match '(?mi)^content-length:\s*(\d+)') {
                    $clen = [int]$Matches[1]
                    if ($clen -gt 65536) { break }
                    $headerEnd = $txt.IndexOf("`r`n`r`n") + 4
                    $bodyBytes = [System.Text.Encoding]::UTF8.GetByteCount($sb.ToString().Substring($headerEnd))
                    while ($bodyBytes -lt $clen -and $sw.ElapsedMilliseconds -lt 30000) {
                        if ($flux.DataAvailable) {
                            $b2 = New-Object byte[] 8192
                            $n2 = $flux.Read($b2, 0, $b2.Length)
                            if ($n2 -le 0) { break }
                            [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($b2, 0, $n2))
                            $bodyBytes = [System.Text.Encoding]::UTF8.GetByteCount($sb.ToString().Substring($headerEnd))
                        } else {
                            Start-Sleep -Milliseconds 5
                        }
                    }
                }
                break
            }
        } else {
            Start-Sleep -Milliseconds 5
        }
    }
    return $sb.ToString()
}

$script:corsOrigin = '*'

function Valider-CorsOrigin([string]$requete) {
    $origin = ''
    if ($requete -match '(?mi)^Origin:\s*(.+)$') { $origin = $Matches[1].Trim() }
    if ($origin -eq '') { return '*' }
    if ($origin -eq 'null') { return '' }
    # Production : Vercel
    if ($origin -match '^https?://[a-zA-Z0-9-]+\.vercel\.app$') { return $origin }
    # Dev : localhost
    if ($origin -match '^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$') { return $origin }
    # Tunnels
    if ($origin -match '^https?://[a-zA-Z0-9-]+\.ngrok-free\.dev$') { return $origin }
    if ($origin -match '^https?://[a-zA-Z0-9-]+\.ngrok\.io$') { return $origin }
    return ''
}

function Extraire-IPReelle([string]$requete, [string]$ipLocale) {
    $ip = $ipLocale
    if ($requete -match '(?mi)^X-Forwarded-For:\s*(.+)$') {
        $xff = $Matches[1].Trim().Split(',')[0].Trim()
        if ($xff -ne '' -and $xff -ne '127.0.0.1' -and $xff -ne '::1') { $ip = $xff }
    }
    if ($ip -eq $ipLocale -and $requete -match '(?mi)^X-Real-IP:\s*(\S+)') {
        $rip = $Matches[1].Trim()
        if ($rip -ne '' -and $rip -ne '127.0.0.1' -and $rip -ne '::1') { $ip = $rip }
    }
    return $ip
}

function Reponse-Octets([int]$code, [string]$type, [byte[]]$bytes, [string]$cors = '') {
    if ($cors -eq '') { $cors = $script:corsOrigin }
    $raison = "OK"
    if ($code -eq 204) { $raison = "No Content" }
    elseif ($code -eq 404) { $raison = "Not Found" }
    elseif ($code -eq 429) { $raison = "Too Many Requests" }
    elseif ($code -ne 200) { $raison = "Erreur" }
    $enTete = "HTTP/1.1 $code $raison`r`nContent-Type: $type; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nAccess-Control-Allow-Origin: $cors`r`nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type, X-UID, X-EGO`r`nAccess-Control-Expose-Headers: Content-Length`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nX-Frame-Options: DENY`r`nX-XSS-Protection: 1; mode=block`r`nReferrer-Policy: no-referrer`r`n`r`n"
    $out = [System.Text.Encoding]::ASCII.GetBytes($enTete)
    $result = New-Object byte[] ($out.Length + $bytes.Length)
    [Array]::Copy($out, 0, $result, 0, $out.Length)
    [Array]::Copy($bytes, 0, $result, $out.Length, $bytes.Length)
    return ,$result
}

function Reponse-HTTP([int]$code, [string]$type, [string]$corps) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($corps)
    return Reponse-Octets $code $type $bytes
}

function Type-Contenu([string]$nom) {
    $ext = [System.IO.Path]::GetExtension($nom).ToLower()
    switch ($ext) {
        '.html' { return 'text/html' }
        '.css'  { return 'text/css' }
        '.js'   { return 'application/javascript' }
        '.ico'  { return 'image/x-icon' }
        '.png'  { return 'image/png' }
        '.jpg'  { return 'image/jpeg' }
        '.svg'  { return 'image/svg+xml' }
        '.txt'  { return 'text/plain' }
        '.json' { return 'application/json' }
        default { return 'application/octet-stream' }
    }
}

function Lire-FichierSite([string]$chemin) {
    $nom = $chemin.TrimStart('/')
    if ($nom -eq '' -or $nom -eq 'index.html') { $nom = 'index.html' }
    try { $nom = [System.Uri]::UnescapeDataString($nom) } catch { return $null }
    if ($nom.IndexOf('/') -ge 0 -or $nom.IndexOf('\') -ge 0 -or
        $nom.IndexOf('..') -ge 0 -or $nom.IndexOf(':') -ge 0) { return $null }
    $ext = [System.IO.Path]::GetExtension($nom).ToLower()
    $bloques = @('.json','.txt','.ps1','.bat','.cmd','.exe','.dll','.config','.log','.db','.sqlite')
    if ($ext -in $bloques) { return $null }
    $fichier = Join-Path $DossierSite $nom
    if (-not (Test-Path -LiteralPath $fichier -PathType Leaf)) { return $null }
    try { return ,[System.IO.File]::ReadAllBytes($fichier) } catch { return $null }
}

# Extraire le body POST depuis la requete brute
function Extraire-BodyPost([string]$requete) {
    $body = ""
    $bodyStart = $requete.IndexOf("`r`n`r`n")
    if ($bodyStart -ge 0) {
        $body = $requete.Substring($bodyStart + 4)
    }
    return $body
}

# Extraire un parametre du body POST (supporte URL-encoded et JSON)
function Extraire-Param([string]$body, [string]$cle) {
    # Tenter JSON d'abord
    if ($body -match '^\s*[\{\[]') {
        try {
            $obj = $body | ConvertFrom-Json
            if ($obj.PSObject.Properties[$cle]) {
                return [string]$obj.$cle
            }
        } catch {}
    }
    # Tenter regex generique pour JSON : valeurs entre guillemets d'abord
    $rxQuote = [regex]("(?i)" + [regex]::Escape($cle) + '\s*:\s*"([^"]*)"')
    $m = $rxQuote.Match($body)
    if ($m.Success) {
        return $m.Groups[1].Value.Trim()
    }
    # Puis sans guillemets : cle:valeur
    $rx = [regex]("(?i)" + [regex]::Escape($cle) + '\s*:\s*([^,}\]]+)')
    $m = $rx.Match($body)
    if ($m.Success) {
        return $m.Groups[1].Value.Trim()
    }
    # Fallback URL-encoded
    foreach ($bp in ($body -split '&')) {
        $kv = $bp -split '=', 2
        if ($kv.Count -eq 2 -and $kv[0].ToLower() -eq $cle.ToLower()) {
            try { return [System.Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } catch { return $kv[1] }
        }
    }
    return ""
}

# ---------------- DEMARRAGE ----------------
if (-not (Test-Path -LiteralPath $ExeBot) -and $Mode -eq "2") {
    Write-Host "ERREUR : bot.exe introuvable dans" $Racine
    Write-Host "Recompile le bot (g++ -std=c++17 bot.cpp -o bot.exe) puis relance."
    Read-Host "Appuie sur Entree pour fermer"
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $DossierSite "index.html"))) {
    Write-Host "ERREUR : le site est introuvable (dossier site/ manquant ?)."
    Read-Host "Appuie sur Entree pour fermer"
    exit 1
}

Write-Host "=================================================="
Write-Host "  BLAMUNE - serveur de discussion"
if ($Mode -eq "1") {
    Write-Host "  Mode : EGO (IA locale gratuite)"
} else {
    Write-Host "  Mode : BLAMUNE INTELLIGENT (bot.exe)"
}
Write-Host "=================================================="
Write-Host ""

Demarrer-Bot

if ($script:etat -eq "pret") {
    Write-Host "  Le bot est pret !"
} else {
    Write-Host "  Attention : le bot n'a pas pu demarrer (etat : $($script:etat))."
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
try {
    $listener.Start()
} catch {
    Write-Host ("ERREUR : impossible d'ouvrir le port " + $Port + " (deja utilise ?).")
    Write-Host $_.Exception.Message
    Read-Host "Appuie sur Entree pour fermer"
    exit 1
}

Write-Host ""
Write-Host "  Sur ce PC          : http://localhost:$Port"
try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
    if ($ip) { Write-Host "  Depuis le reseau    : http://${ip}:$Port" }
} catch {}
Write-Host ""
Write-Host "  Ouvre la page, ecris, et le bot repond."
Write-Host "  Partage l'adresse reseau avec ceux qui veulent discuter."
Write-Host "  Pour arreter : ferme cette fenetre."
Write-Host "=================================================="

if (-not $SansNavigateur) {
    Start-Sleep -Milliseconds 800
    try { Start-Process "http://localhost:$Port" } catch {}
}

try {
    while ($true) {
        $client = $null
        try {
            if ($listener.Pending()) {
                $client = $listener.AcceptTcpClient()
            } else {
                Relancer-Si-Idle
                $maintenantTs = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                if ($maintenantTs -gt $script:prochainNettoyageRateLimit) {
                    Securite-NettoyerRateLimit
                    Nettoyer-InvitesOrphelins
                    $script:prochainNettoyageRateLimit = $maintenantTs + 300
                }
                Start-Sleep -Milliseconds 1000
                continue
            }
        } catch {
            # Erreur transitoire : on continue
            Start-Sleep -Milliseconds 100
            continue
        }
        try {
            $client.ReceiveTimeout = 120000
            $client.SendTimeout = 120000
            $client.NoDelay = $true
            $flux = $client.GetStream()
            $requete = Lire-Requete $flux
            $ligne = ($requete -split "`r?`n")[0]
            $parts = $ligne -split ' '
            $httpMethod = if ($parts.Count -ge 1) { $parts[0] } else { "GET" }
            $url = "/"
            if ($parts.Count -ge 2) { $url = $parts[1] }
            $path = $url
            $query = ""
            if ($url.IndexOf('?') -ge 0) {
                $pieces = $url.Split('?', 2)
                $path = $pieces[0]
                $query = $pieces[1]
            }
            $data = @{}
            if ($query) {
                foreach ($paire in ($query -split '&')) {
                    $kv = $paire.Split('=', 2)
                    if ($kv.Count -eq 2) {
                        try {
                            $data[$kv[0]] = [System.Uri]::UnescapeDataString($kv[1].Replace('+', ' '))
                        } catch {
                            $data[$kv[0]] = $kv[1]
                        }
                    }
                }
            }

            $script:corsOrigin = Valider-CorsOrigin $requete

            # Tracker la connexion (IP reelle via ngrok ou locale)
                $ipClient = ""
                try { $ipClient = $client.Client.RemoteEndPoint.Address.IPAddressToString } catch {}
                $ipClient = Extraire-IPReelle $requete $ipClient
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                $pseudoTrack = ""
                if ($uid) {
                    foreach ($cle in $script:comptes.Keys) {
                        if ($script:comptes[$cle].uid -eq $uid) { $pseudoTrack = $script:comptes[$cle].pseudo; break }
                    }
                }
            Tracker-Connexion $uid $ipClient $pseudoTrack

            $rep = $null

            # ============ API ENDPOINTS ============

            if ($httpMethod -eq "OPTIONS") {
                $optsEnTete = "HTTP/1.1 204 No Content`r`nAccess-Control-Allow-Origin: $($script:corsOrigin)`r`nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type, X-UID, X-EGO`r`nAccess-Control-Max-Age: 86400`r`nConnection: close`r`n`r`n"
                $rep = [System.Text.Encoding]::ASCII.GetBytes($optsEnTete)

            } elseif ($path -eq "/ping") {
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                $userMode = if ($uid -and $script:modeParUser.ContainsKey($uid)) { $script:modeParUser[$uid] } else { $script:mode }
                $json = @{ ok = $true; etat = $script:etat; mode = $userMode } | ConvertTo-Json -Compress
                $rep = Reponse-HTTP 200 "application/json" $json

            } elseif ($path -eq "/connexions") {
                Nettoyer-Connexions
                $liste = @()
                foreach ($cle in $script:connexionsActives.Keys) {
                    $c = $script:connexionsActives[$cle]
                    $liste += @{ uid = $c.uid; pseudo = $c.pseudo; ip = $c.ip; debut = $c.debut; derniereActivite = $c.derniereActivite }
                }
                $json = @{ ok = $true; connexions = $liste } | ConvertTo-Json -Depth 5 -Compress
                $rep = Reponse-HTTP 200 "application/json" $json

            } elseif ($path -eq "/tous-les-messages") {
                $authInfo = Auth-Extraire $requete
                if (-not $authInfo.uid) {
                    $json = @{ ok = $false; error = "Non autorise" } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 401 "application/json" $json
                } else {
                    $isAdmin = $false
                    foreach ($cle in $script:comptes.Keys) {
                        if ($script:comptes[$cle].uid -eq $authInfo.uid -and $script:comptes[$cle].pseudo -ieq "admin") {
                            $isAdmin = $true; break
                        }
                    }
                    $tousMessages = @()
                    if (Test-Path -LiteralPath $script:dossierUsers) {
                        Get-ChildItem -LiteralPath $script:dossierUsers -Directory | ForEach-Object {
                            $dirUid = $_.Name
                            if (-not $isAdmin -and $dirUid -ne $authInfo.uid) { continue }
                            foreach ($hf in @("historique_mode1.json","historique_mode2.json")) {
                                $histPath = Join-Path $_.FullName $hf
                                if (Test-Path -LiteralPath $histPath) {
                                    try {
                                        $h = Get-Content -LiteralPath $histPath -Raw | ConvertFrom-Json
                                        foreach ($entry in $h) {
                                            $tousMessages += @{ uid = $dirUid; qui = [string]$entry.qui; texte = [string]$entry.texte; t = [int]$entry.t }
                                        }
                                    } catch {}
                                }
                            }
                        }
                    }
                    $tousMessages = $tousMessages | Sort-Object { $_.t }
                    $json = @{ ok = $true; messages = @($tousMessages) } | ConvertTo-Json -Depth 5 -Compress
                    $rep = Reponse-HTTP 200 "application/json" $json
                }

            } elseif ($path -eq "/register" -and $httpMethod -eq "POST") {
                $clientIP = "local"
                try { $clientIP = $client.Client.RemoteEndPoint.Address.IPAddressToString } catch {}
                $clientIP = Extraire-IPReelle $requete $clientIP
                if (-not (Securite-VerifierRateLimit $clientIP)) {
                    $json = @{ ok = $false; message = "Trop de requetes. Reessaie dans une minute." } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 429 "application/json" $json
                } else {
                $body = Extraire-BodyPost $requete
                $pseudo = Extraire-Param $body "pseudo"
                $mdp = Extraire-Param $body "mdp"
                $email = Extraire-Param $body "email"
                if ($pseudo.Length -lt 2) {
                    $json = @{ ok = $false; message = "Pseudo trop court (2 min)." } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 400 "application/json" $json
                } elseif ($mdp.Length -lt 6) {
                    $json = @{ ok = $false; message = "Mot de passe trop court (6 min)." } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 400 "application/json" $json
                } elseif ($email -eq "" -or $email -notmatch '@') {
                    $json = @{ ok = $false; message = "Email invalide." } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 400 "application/json" $json
                } else {
                    $compte = Compte-Creer $pseudo $mdp $email
                    if ($compte) {
                        Ecrire-Memoire $compte.uid "nom" $pseudo
                        # Reinitialiser le contexte EGO pour cet utilisateur
                        if ($script:apiHistoriqueParUser.ContainsKey($compte.uid)) {
                            $script:apiHistoriqueParUser.Remove($compte.uid)
                        }
                        $json = @{ ok = $true; pseudo = $compte.pseudo; uid = $compte.uid; ego = $compte.ego } | ConvertTo-Json -Compress
                        $rep = Reponse-HTTP 200 "application/json" $json
                    } else {
                        $json = @{ ok = $false; message = "Ce pseudo est deja pris." } | ConvertTo-Json -Compress
                        $rep = Reponse-HTTP 409 "application/json" $json
                    }
                }
                }

            } elseif ($path -eq "/login" -and $httpMethod -eq "POST") {
                $clientIP = "local"
                try { $clientIP = $client.Client.RemoteEndPoint.Address.IPAddressToString } catch {}
                $clientIP = Extraire-IPReelle $requete $clientIP
                if (-not (Securite-VerifierRateLimit $clientIP)) {
                    $json = @{ ok = $false; message = "Trop de requetes. Reessaie dans une minute." } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 429 "application/json" $json
                } else {
                $body = Extraire-BodyPost $requete
                $pseudo = Extraire-Param $body "pseudo"
                $email = Extraire-Param $body "email"
                $mdp = Extraire-Param $body "mdp"
                $compte = $null
                if ($email -ne "") {
                    $compte = Compte-VerifierParEmail $email $mdp
                } elseif ($pseudo -ne "") {
                    $compte = Compte-Verifier $pseudo $mdp
                }
                if ($compte -and $compte.locked) {
                    $json = @{ ok = $false; message = $compte.message } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 423 "application/json" $json
                } elseif ($compte) {
                    Ecrire-Memoire $compte.uid "nom" $compte.pseudo
                    # Reinitialiser le contexte EGO pour cet utilisateur
                    if ($script:apiHistoriqueParUser.ContainsKey($compte.uid)) {
                        $script:apiHistoriqueParUser.Remove($compte.uid)
                    }
                    $json = @{ ok = $true; pseudo = $compte.pseudo; uid = $compte.uid; ego = $compte.ego } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 200 "application/json" $json
                } else {
                    $json = @{ ok = $false; message = "Email ou mot de passe incorrect." } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 401 "application/json" $json
                }
                }

            } elseif ($path -eq "/invite" -and $httpMethod -eq "POST") {
                $clientIP = "local"
                try { $clientIP = $client.Client.RemoteEndPoint.Address.IPAddressToString } catch {}
                $clientIP = Extraire-IPReelle $requete $clientIP
                if (-not (Securite-VerifierRateLimit $clientIP)) {
                    $json = @{ ok = $false; message = "Trop de requetes. Reessaie dans une minute." } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 429 "application/json" $json
                } else {
                $uid = "inv_" + [System.Guid]::NewGuid().ToString("N").Substring(0, 12)
                $pseudo = "Invite_" + $uid.Substring(4, 6)
                $script:connexionsActives[$uid] = @{
                    uid = $uid; pseudo = $pseudo; ip = $clientIP; debut = (Get-Date -Format "yyyy-MM-dd HH:mm:ss"); derniereActivite = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
                }
                Log "Invite cree: $pseudo ($uid) IP=$clientIP"
                $json = @{ ok = $true; uid = $uid; pseudo = $pseudo } | ConvertTo-Json -Compress
                $rep = Reponse-HTTP 200 "application/json" $json
                }

            } elseif ($path -eq "/logout" -and $httpMethod -eq "POST") {
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                if ($uid) {
                    # Sauvegarder la conversation pour les utilisateurs inscrits
                    if ($uid -notlike "inv_*") {
                        $userMode = if ($script:modeParUser.ContainsKey($uid)) { $script:modeParUser[$uid] } else { $script:mode }
                        Log "Deconnexion: $uid (mode $userMode) - conversation sauvegardee"
                    }
                    # Nettoyer l'historique EGO en memoire
                    if ($script:apiHistoriqueParUser.ContainsKey($uid)) {
                        $script:apiHistoriqueParUser.Remove($uid)
                    }
                    # Retirer des connexions actives
                    if ($script:connexionsActives.ContainsKey($uid)) {
                        $script:connexionsActives.Remove($uid)
                    }
                }
                $json = @{ ok = $true } | ConvertTo-Json -Compress
                $rep = Reponse-HTTP 200 "application/json" $json

            } elseif ($path -eq "/send" -and $httpMethod -eq "POST") {
                # SECURITE : nettoyage rate limit periodique
                $maintenantTs = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                if ($maintenantTs -gt $script:prochainNettoyageRateLimit) {
                    Securite-NettoyerRateLimit
                    $script:prochainNettoyageRateLimit = $maintenantTs + 300
                }

                $clientIP = "local"
                try { $clientIP = $client.Client.RemoteEndPoint.Address.IPAddressToString } catch {}
                $clientIP = Extraire-IPReelle $requete $clientIP

                # SECURITE : rate limiting par IP
                if (-not (Securite-VerifierRateLimit $clientIP)) {
                    $json = @{ etat = $script:etat; reponses = @("Trop de requetes. Reessaie dans une minute."); confiance = 0 } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 429 "application/json" $json
                } else {
                    $body = Extraire-BodyPost $requete

                    # SECURITE : validation taille body
                    if (-not (Securite-ValiderBody $body)) {
                        $json = @{ etat = $script:etat; reponses = @("Requete trop volumineuse."); confiance = 0 } | ConvertTo-Json -Compress
                        $rep = Reponse-HTTP 413 "application/json" $json
                    } else {
                        $msg = ""
                        if ($body -ne "") {
                            $msg = Extraire-Param $body "msg"
                        }
                        if ($msg -eq "" -and $data.ContainsKey("msg")) { $msg = $data["msg"] }
                        $msg = $msg -replace "[\r`n]+", " "
                        $authInfo = Auth-Extraire $requete
                        $uid = $authInfo.uid

                        # Exiger un UID (auth ou invite)
                        if (-not $uid) {
                            $json = @{ etat = $script:etat; reponses = @("Connecte-toi, inscris-toi ou passe en mode invite pour envoyer des messages."); confiance = 0 } | ConvertTo-Json -Compress
                            $rep = Reponse-HTTP 401 "application/json" $json
                        } else {
                            # SECURITE : rate limiting par UID
                            if (-not (Securite-VerifierRateLimitUser $uid)) {
                                $json = @{ etat = $script:etat; reponses = @("Tu envoies trop de messages. Ralentis un peu."); confiance = 0 } | ConvertTo-Json -Compress
                                $rep = Reponse-HTTP 429 "application/json" $json
                            } else {
                                # SECURITE : sanitisation entree
                                $msg = Securite-SanitiserEntree $msg

                                # SECURITE : validation longueur message
                                $valide, $errVal = Securite-ValiderMessage $msg
                                if (-not $valide) {
                                    $json = @{ etat = $script:etat; reponses = @($errVal); confiance = 0 } | ConvertTo-Json -Compress
                                    $rep = Reponse-HTTP 400 "application/json" $json
                                } elseif ($msg.Trim().Length -eq 0) {
                                    $json = @{ etat = $script:etat; reponses = @() } | ConvertTo-Json -Compress
                                    $rep = Reponse-HTTP 200 "application/json" $json
                                } else {
                                $modeLocal = if ($uid -and $script:modeParUser.ContainsKey($uid)) { $script:modeParUser[$uid] } else { $script:mode }
                                if ($body -ne "") {
                                    $bodyMode = Extraire-Param $body "mode"
                                    if ($bodyMode -eq "1" -or $bodyMode -eq "2") { $modeLocal = $bodyMode }
                                }
                                if ($data.ContainsKey("mode") -and ($data["mode"] -eq "1" -or $data["mode"] -eq "2")) { $modeLocal = [string]$data["mode"] }
                                    $lignes = Envoyer-Message $msg $modeLocal $uid
                                    $json = @{ etat = $script:etat; reponses = @($lignes); confiance = $script:confianceDerniereReponse } | ConvertTo-Json -Compress
                                    $rep = Reponse-HTTP 200 "application/json" $json
                                }
                            }
                        }
                    }
                }

            } elseif ($path -eq "/historique") {
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                $userMode = if ($uid -and $script:modeParUser.ContainsKey($uid)) { $script:modeParUser[$uid] } else { $script:mode }
                if ($httpMethod -eq "DELETE") {
                    if ($uid) { Vider-Historique $uid $userMode }
                    $json = @{ etat = $script:etat; historique = @() } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 200 "application/json" $json
                } else {
                    $hist = @()
                    if ($uid) { $hist = Charger-Historique $uid $userMode }
                    $ollamaOk = $true
                    if ($userMode -eq "1" -and $script:config.api_provider -ne "gemini") { $ollamaOk = Ollama-EstEnCours }
                    $jrep = @{ ok = $true; etat = $script:etat; mode = $userMode; historique = @($hist); ollama = $ollamaOk; provider = $script:config.api_provider }
                    $json = $jrep | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 200 "application/json" $json
                }

            } elseif ($path -eq "/mode" -and $httpMethod -eq "POST") {
                $m = ""
                $body = Extraire-BodyPost $requete
                if ($body -ne "") { $m = Extraire-Param $body "m" }
                if ($m -eq "" -and $data.ContainsKey("m")) { $m = $data["m"] }
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                if (-not $uid) {
                    $json = @{ ok = $false; message = "Non autorise" } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 401 "application/json" $json
                } elseif ($m -ne "1" -and $m -ne "2") {
                    $json = @{ ok = $false; message = "Mode invalide (1 ou 2)" } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 400 "application/json" $json
                } elseif ($m -eq "1" -or $m -eq "2") {
                    $script:modeParUser[$uid] = $m
                    $labelMode = if ($m -eq '1') { "EGO" } else { "BLAMUNE INTELLIGENT" }
                    Log "Mode change pour $uid : $labelMode"
                    # Demarrer le bot correspondant seulement s'il n'est pas deja en cours
                    if ($m -eq "2" -and (-not $script:proc -or $script:proc.HasExited)) {
                        Demarrer-Bot "Activation BLAMUNE INTELLIGENT"
                    } elseif ($m -eq "1" -and $script:config.api_provider -ne "gemini" -and -not (Ollama-EstEnCours)) {
                        Ollama-Demarrer | Out-Null
                    }
                }
                $userMode = if ($script:modeParUser.ContainsKey($uid)) { $script:modeParUser[$uid] } else { $script:mode }
                $json = @{ etat = $script:etat; mode = $userMode } | ConvertTo-Json -Compress
                $rep = Reponse-HTTP 200 "application/json" $json

            } elseif ($path -eq "/profil" -and $httpMethod -eq "POST") {
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                if (-not $uid) {
                    $json = @{ ok = $false; message = "Non autorise" } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 401 "application/json" $json
                } else {
                $body = Extraire-BodyPost $requete
                $champ = Extraire-Param $body "champ"
                $valeur = Extraire-Param $body "valeur"
                $ok = Ecrire-Memoire $uid $champ $valeur
                if ($ok) {
                    $json = @{ ok = $true; message = "Profil mis a jour." } | ConvertTo-Json -Compress
                } else {
                    $json = @{ ok = $false; message = "Champ inconnu : $champ" } | ConvertTo-Json -Compress
                }
                $rep = Reponse-HTTP 200 "application/json" $json
                }

            } elseif ($path -eq "/profil") {
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                $memoire = if ($uid) { Lire-Memoire $uid } else { @{ nom=""; plat=""; hobby=""; motsFavoris=@(); genre=""; aime=""; aimePas=""; age="" } }
                $savoir = Lire-Savoir
                $json = @{ profil = $memoire; savoir = $savoir } | ConvertTo-Json -Depth 4 -Compress
                $rep = Reponse-HTTP 200 "application/json" $json

            } elseif ($path -eq "/stats") {
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                $isAdmin = $false
                if ($uid) {
                    foreach ($cle in $script:comptes.Keys) {
                        if ($script:comptes[$cle].uid -eq $uid -and $script:comptes[$cle].pseudo -ieq "admin") {
                            $isAdmin = $true; break
                        }
                    }
                }
                if (-not $isAdmin) {
                    $json = @{ ok = $false; message = "Non autorise" } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 403 "application/json" $json
                } else {
                $tempsMoyen = 0
                if ($script:stats.tempsReponse.Count -gt 0) {
                    $somme = 0
                    foreach ($t in $script:stats.tempsReponse) { $somme += $t }
                    $tempsMoyen = [math]::Round($somme / $script:stats.tempsReponse.Count)
                }
                $json = @{
                    messagesTotal = $script:stats.messagesTotal
                    messagesMode1 = $script:stats.messagesMode1
                    messagesMode2 = $script:stats.messagesMode2
                    sessionsTotal = $script:stats.sessionsTotal
                    demarrages    = $script:stats.demarrages
                    tempsMoyen    = $tempsMoyen
                    uptime        = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    demarrage     = $script:stats.demarrage
                    apiProvider   = $script:config.api_provider
                    apiConfigured = ($script:config.api_key -ne "" -and $script:config.api_key -ne "YOUR_API_KEY" -and $script:config.api_key -ne "ego")
                } | ConvertTo-Json -Compress
                $rep = Reponse-HTTP 200 "application/json" $json
                }

            } elseif ($path -eq "/config-api" -and $httpMethod -eq "POST") {
                $authInfo = Auth-Extraire $requete
                $uid = $authInfo.uid
                $isAdmin = $false
                if ($uid) {
                    foreach ($cle in $script:comptes.Keys) {
                        if ($script:comptes[$cle].uid -eq $uid -and $script:comptes[$cle].pseudo -ieq "admin") {
                            $isAdmin = $true; break
                        }
                    }
                }
                if (-not $isAdmin) {
                    $json = @{ ok = $false; message = "Non autorise (admin requis)" } | ConvertTo-Json -Compress
                    $rep = Reponse-HTTP 403 "application/json" $json
                } else {
                $bodyJson = ""
                $bodyStart = $requete.IndexOf("`r`n`r`n")
                if ($bodyStart -ge 0) { $bodyJson = $requete.Substring($bodyStart + 4) }
                try {
                    $nouveauCfg = $bodyJson | ConvertFrom-Json
                    if ($nouveauCfg.api_key)       { $script:config.api_key = $nouveauCfg.api_key }
                    if ($nouveauCfg.api_provider)  { $script:config.api_provider = $nouveauCfg.api_provider }
                    if ($nouveauCfg.api_model)     { $script:config.api_model = $nouveauCfg.api_model }
                    if ($nouveauCfg.api_url)       { $script:config.api_url = $nouveauCfg.api_url }
                    # Sauvegarder dans config.json
                    $script:config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding UTF8
                    $json = @{ ok = $true; message = "Configuration mise a jour." } | ConvertTo-Json -Compress
                } catch {
                    $json = @{ ok = $false; message = "Erreur de configuration" } | ConvertTo-Json -Compress
                }
                $rep = Reponse-HTTP 200 "application/json" $json
                }

            } elseif ($path -eq "/favicon.ico") {
                $fichier = Lire-FichierSite $path
                if ($fichier -ne $null) { $rep = Reponse-Octets 200 "image/x-icon" $fichier }
                else { $rep = Reponse-HTTP 204 "image/x-icon" "" }

            } else {
                $nomSite = $path.TrimStart('/')
                if ($nomSite -eq '' -or $nomSite -eq 'index.html') { $nomSite = 'index.html' }
                $fichier = Lire-FichierSite $nomSite
                if ($fichier -ne $null) {
                    $rep = Reponse-Octets 200 (Type-Contenu $nomSite) $fichier
                } else {
                    $rep = Reponse-HTTP 404 "text/html" "Page introuvable"
                }
            }
            if ($rep -ne $null) {
                try {
                    $flux.Write($rep, 0, $rep.Length)
                    $flux.Flush()
                } catch {
                    # Client deconnecte, on continue
                }
            }
        } catch {
            Log ("Erreur requete : " + $_.Exception.Message)
        }
        try { $client.Close() } catch {}
    }
} finally {
    try { $listener.Stop() } catch {}
    Sauvegarder-Stats
    Ollama-Arreter
    if ($script:proc -and -not $script:proc.HasExited) {
        try { $script:proc.Kill() } catch {}
    }
}
