# ============================================================
#  SERVEUR ADMIN BLAMUNE - Port 8081
#  Acces local uniquement (127.0.0.1)
#  Appelle le serveur normal (port 8080) pour les donnees
# ============================================================
param([int]$PortAdmin = 8081, [int]$PortBot = 8080)

$Racine = $PSScriptRoot
if (-not $Racine) {
    try { $Racine = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) } catch {}
}
if (-not $Racine) { $Racine = (Get-Location).Path }
$DossierAdmin = Join-Path $Racine "admin"
$ServeurBot = "http://localhost:$PortBot"

function Log([string]$t) {
    Write-Host ("[" + (Get-Date -Format HH:mm:ss) + "] [Admin] " + $t)
}

# --- Client HTTP reutilisable (TCP brut, evite Invoke-RestMethod qui bug sur PS5.1) ---
function Appeler-Bot([string]$endpoint, [int]$tentative = 0, [string]$extraHeaders = "") {
    $tcp = $null
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient("127.0.0.1", $PortBot)
        $tcp.SendTimeout = 30000
        $tcp.ReceiveTimeout = 30000
        $stream = $tcp.GetStream()
        $request = "GET $endpoint HTTP/1.1`r`nHost: localhost:$PortBot`r`nConnection: close`r`n$extraHeaders`r`n"
        $reqBytes = [System.Text.Encoding]::ASCII.GetBytes($request)
        $stream.Write($reqBytes, 0, $reqBytes.Length)
        $stream.Flush()
        $sb = New-Object System.Text.StringBuilder
        $buf = New-Object byte[] 65536
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            while ($sw.ElapsedMilliseconds -lt 30000) {
                if ($stream.DataAvailable) {
                    $n = $stream.Read($buf, 0, $buf.Length)
                    if ($n -le 0) { break }
                    $sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $n)) | Out-Null
                } else {
                    Start-Sleep -Milliseconds 50
                }
            }
        } catch {
            Log "Lecture reponse bot interrompue: $($_.Exception.Message)"
        }
        $raw = $sb.ToString()
        $idx = $raw.IndexOf("`r`n`r`n")
        if ($idx -ge 0) {
            $body = $raw.Substring($idx + 4)
            if ($body) { try { return ($body | ConvertFrom-Json) } catch { return $null } }
        }
        return $null
    } catch {
        if ($tentative -lt 1) {
            Log "Appel bot echoue (tentative 1), retry dans 3s : $($_.Exception.Message)"
            Start-Sleep -Seconds 3
            return Appeler-Bot $endpoint 1 $extraHeaders
        }
        Log "Appel bot echoue : $($_.Exception.Message)"
        return $null
    } finally {
        if ($tcp) { try { $tcp.Close() } catch {} }
    }
}

# --- Utilitaires reseau ---
try {
    Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
public class AdminHttpReader {
    public static string LireRequete(NetworkStream flux, int timeout) {
        flux.ReadTimeout = timeout;
        var sb = new StringBuilder();
        var buf = new byte[8192];
        int totalRead = 0;
        while (totalRead < 8192) {
            int n = flux.Read(buf, 0, Math.Min(8192, buf.Length));
            if (n <= 0) break;
            sb.Append(Encoding.UTF8.GetString(buf, 0, n));
            totalRead += n;
            if (sb.ToString().Contains("\r\n\r\n")) break;
        }
        string full = sb.ToString();
        int headerEnd = full.IndexOf("\r\n\r\n");
        if (headerEnd < 0) return full;
        string headers = full.Substring(0, headerEnd);
        int contentLength = 0;
        foreach (string line in headers.Split(new[] {"\r\n"}, StringSplitOptions.None)) {
            if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) {
                int.TryParse(line.Substring(15).Trim(), out contentLength);
                break;
            }
        }
        int bodyHave = System.Text.Encoding.UTF8.GetByteCount(full.Substring(headerEnd + 4));
        while (bodyHave < contentLength) {
            int n = flux.Read(buf, 0, buf.Length);
            if (n <= 0) break;
            full += Encoding.UTF8.GetString(buf, 0, n);
            bodyHave += n;
        }
        return full;
    }
}
'@
} catch {}

function Lire-Requete([System.Net.Sockets.NetworkStream]$flux) {
    return [AdminHttpReader]::LireRequete($flux, 5000)
}

function Verifier-AdminAuth([string]$requete) {
    $ego = ""
    $headers = $requete
    $bodyStart = $requete.IndexOf("`r`n`r`n")
    if ($bodyStart -ge 0) { $headers = $requete.Substring(0, $bodyStart) }
    if ($headers -match '(?mi)^X-EGO:\s*(\S+)') { $ego = $Matches[1] }
    $premiereLigne = ($requete -split "`r?`n")[0]
    if ($ego -eq "" -and $premiereLigne -match '[?&]ego=([^&\s]+)') { $ego = [System.Web.HttpUtility]::UrlDecode($Matches[1]) }
    if ($ego -eq "") { return $false }
    $verif = Appeler-Bot "/verifier?ego=$ego"
    if ($verif -and $verif.ok -and $verif.pseudo -eq "admin") { return $true }
    return $false
}

function Reponse-HTTP([int]$code, [string]$type, [string]$corps, [string]$corsOrigin = '*', [hashtable]$extraHeaders = $null) {
    $status = switch($code) { 200 { "OK" } 201 { "Created" } 204 { "No Content" } 400 { "Bad Request" } 401 { "Unauthorized" } 403 { "Forbidden" } 404 { "Not Found" } 429 { "Too Many Requests" } 500 { "Internal Server Error" } default { "OK" } }
    $headers = "HTTP/1.1 $code $status`r`n"
    $headers += "Content-Type: $type; charset=utf-8`r`n"
    $headers += "Access-Control-Allow-Origin: $corsOrigin`r`n"
    $headers += "Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS`r`n"
    $headers += "Access-Control-Allow-Headers: Content-Type`r`n"
    $headers += "Connection: close`r`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($corps)
    $headers += "Content-Length: $($bytes.Length)`r`n"
    $headers += "X-Content-Type-Options: nosniff`r`n"
    $headers += "X-Frame-Options: DENY`r`n"
    $headers += "X-XSS-Protection: 1; mode=block`r`n"
    $headers += "Referrer-Policy: no-referrer`r`n"
    if ($extraHeaders) {
        foreach ($key in $extraHeaders.Keys) {
            $headers += "$key`: $($extraHeaders[$key])`r`n"
        }
    }
    $headers += "`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $result = New-Object byte[] ($headerBytes.Length + $bytes.Length)
    [Buffer]::BlockCopy($headerBytes, 0, $result, 0, $headerBytes.Length)
    [Buffer]::BlockCopy($bytes, 0, $result, $headerBytes.Length, $bytes.Length)
    return $result
}

function Reponse-Octets([int]$code, [string]$type, [byte[]]$octets, [string]$corsOrigin = '*') {
    $status = switch($code) { 200 { "OK" } 201 { "Created" } 204 { "No Content" } 400 { "Bad Request" } 401 { "Unauthorized" } 403 { "Forbidden" } 404 { "Not Found" } 429 { "Too Many Requests" } 500 { "Internal Server Error" } default { "OK" } }
    $headers = "HTTP/1.1 $code $status`r`n"
    $headers += "Content-Type: $type`r`n"
    $headers += "Access-Control-Allow-Origin: $corsOrigin`r`n"
    $headers += "Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS`r`n"
    $headers += "Access-Control-Allow-Headers: Content-Type`r`n"
    $headers += "Connection: close`r`n"
    $headers += "Content-Length: $($octets.Length)`r`n"
    $headers += "X-Content-Type-Options: nosniff`r`n"
    $headers += "X-Frame-Options: DENY`r`n"
    $headers += "X-XSS-Protection: 1; mode=block`r`n"
    $headers += "Referrer-Policy: no-referrer`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $result = New-Object byte[] ($headerBytes.Length + $octets.Length)
    [Buffer]::BlockCopy($headerBytes, 0, $result, 0, $headerBytes.Length)
    [Buffer]::BlockCopy($octets, 0, $result, $headerBytes.Length, $octets.Length)
    return $result
}

function Type-Contenu([string]$nom) {
    $ext = [System.IO.Path]::GetExtension($nom).ToLower()
    switch ($ext) {
        '.html' { return 'text/html' }
        '.css'  { return 'text/css' }
        '.js'   { return 'application/javascript' }
        '.ico'  { return 'image/x-icon' }
        '.png'  { return 'image/png' }
        '.svg'  { return 'image/svg+xml' }
        '.json' { return 'application/json' }
        default { return 'application/octet-stream' }
    }
}

function Lire-FichierAdmin([string]$chemin) {
    $nom = $chemin.TrimStart('/')
    if ($nom -eq '' -or $nom -eq 'admin') { $nom = 'admin.html' }
    if ($nom.IndexOf('..') -ge 0) { return $null }
    $fichier = Join-Path $DossierAdmin $nom
    if (Test-Path -LiteralPath $fichier -PathType Leaf) {
        try {
            return [System.IO.File]::ReadAllBytes($fichier)
        } catch { return $null }
    }
    return $null
}

# --- SECURITE : Rate limiting admin ---
$script:rateLimitAdmin = @{}
$script:RATE_LIMIT_ADMIN_MAX = 60
$script:RATE_LIMIT_ADMIN_FENETRE = 60
$script:logAdmin = Join-Path $Racine "admin_access.log"

function Securite-Admin-VerifierRateLimit([string]$ip) {
    $maintenant = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if (-not $script:rateLimitAdmin.ContainsKey($ip)) {
        $script:rateLimitAdmin[$ip] = @{ compteur = 1; debut = $maintenant }
        return $true
    }
    $rl = $script:rateLimitAdmin[$ip]
    if (($maintenant - $rl.debut) -gt $script:RATE_LIMIT_ADMIN_FENETRE) {
        $rl.compteur = 1
        $rl.debut = $maintenant
        return $true
    }
    $rl.compteur++
    if ($rl.compteur -gt $script:RATE_LIMIT_ADMIN_MAX) {
        Securite-Admin-Logger "RATE_LIMIT" $ip "Depassement quota admin ($($rl.compteur) req/min)"
        return $false
    }
    return $true
}

function Securite-Admin-Logger([string]$type, [string]$ip, [string]$details) {
    $ligne = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [$type] IP=$ip | $details"
    try { Add-Content -LiteralPath $script:logAdmin -Value $ligne -Encoding UTF8 } catch {}
}

function Securite-Admin-NettoyerRateLimit {
    $maintenant = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $clesASupprimer = [System.Collections.ArrayList]@()
    foreach ($cle in $script:rateLimitAdmin.Keys) {
        if (($maintenant - $script:rateLimitAdmin[$cle].debut) -gt $script:RATE_LIMIT_ADMIN_FENETRE * 2) {
            $null = $clesASupprimer.Add($cle)
        }
    }
    foreach ($cle in $clesASupprimer) { $script:rateLimitAdmin.Remove($cle) }
}

# --- Serveur TCP ---
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $PortAdmin)
try {
    $listener.Start()
} catch {
    Write-Host "ERREUR : impossible d'ouvrir le port $PortAdmin (deja utilise ?)."
    Write-Host $_.Exception.Message
    exit 1
}

Log "Demarrage sur http://localhost:$PortAdmin"
Log "Connecte au serveur bot : $ServeurBot"

try {
    $script:prochainNettoyageRateLimitAdmin = 0
    while ($true) {
        $client = $null
        try {
            $client = $listener.AcceptTcpClient()
        } catch {
            Start-Sleep -Milliseconds 100
            continue
        }
        $maintenantTs = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        if ($maintenantTs -gt $script:prochainNettoyageRateLimitAdmin) {
            Securite-Admin-NettoyerRateLimit
            $script:prochainNettoyageRateLimitAdmin = $maintenantTs + 300
        }
        try {
            $client.ReceiveTimeout = 30000
            $client.SendTimeout = 30000
            $client.NoDelay = $true
            $flux = $client.GetStream()
            $requete = Lire-Requete $flux
            $ligne = ($requete -split "`r?`n")[0]
            $parts = $ligne -split ' '
            $httpMethod = if ($parts.Count -ge 1) { $parts[0] } else { "GET" }
            $url = "/"
            if ($parts.Count -ge 2) { $url = $parts[1] }
            $path = $url
            if ($url.IndexOf('?') -ge 0) { $path = $url.Split('?', 2)[0] }
            $rep = $null

            # SECURITE : extraire IP reelle
            $clientIP = "local"
            if ($client.Client.RemoteEndPoint -ne $null) { $clientIP = $client.Client.RemoteEndPoint.Address.ToString() }

            # SECURITE : extraire et valider Origin pour CORS
            $corsOrigin = '*'
            $originMatch = [regex]::Match($requete, '(?m)^Origin:\s*(.+)$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
            if ($originMatch.Success) {
                $originHeader = $originMatch.Groups[1].Value.Trim()
                if ($originHeader -match '^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$') {
                    $corsOrigin = $originHeader
                } elseif ($originHeader -match '^https?://[a-zA-Z0-9-]+\.vercel\.app$') {
                    $corsOrigin = $originHeader
                } elseif ($originHeader -match '^https?://[a-zA-Z0-9-]+\.ngrok-free\.dev$') {
                    $corsOrigin = $originHeader
                } else {
                    $corsOrigin = 'null'
                }
            }

            # SECURITE : rate limiting admin (sauf OPTIONS)
            if ($httpMethod -ne "OPTIONS") {
                if (-not (Securite-Admin-VerifierRateLimit $clientIP)) {
                    Securite-Admin-Logger "RATE_LIMIT" $clientIP "$httpMethod $path"
                    $rep = Reponse-HTTP 429 "application/json" '{"erreur":"Trop de requetes. Reessaie dans une minute."}' $corsOrigin @{ "Retry-After" = "60" }
                    $outBytes = $rep
                    try { $flux.Write($outBytes, 0, $outBytes.Length); $flux.Flush() } catch {}
                    try { $client.Close() } catch {}
                    continue
                }
                Securite-Admin-Logger "ACCES" $clientIP "$httpMethod $path"
            }

            if ($httpMethod -eq "OPTIONS") {
                $optsEnTete = "HTTP/1.1 204 No Content`r`nAccess-Control-Allow-Origin: $corsOrigin`r`nAccess-Control-Allow-Methods: GET, POST, HEAD, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Max-Age: 86400`r`nConnection: close`r`n`r`n"
                $rep = [System.Text.Encoding]::ASCII.GetBytes($optsEnTete)

            } elseif ($path -eq "/admin/data" -and $httpMethod -eq "GET") {
                if (-not (Verifier-AdminAuth $requete)) {
                    $json = '{"ok":false,"erreur":"Non autorise"}'
                    $rep = Reponse-HTTP 403 "application/json" $json $corsOrigin
                } else {
                $ping = Appeler-Bot "/ping"
                $botUp = ($ping -ne $null)
                $stats = if ($botUp) { Appeler-Bot "/stats" } else { $null }
                $connexions = if ($botUp) { Appeler-Bot "/connexions" } else { $null }
                $tousMessages = if ($botUp) { Appeler-Bot "/tous-les-messages" 0 "X-UID: admin`r`n" } else { $null }

                # Lire vocabulaire et savoir localement
                $vocab = @()
                $vocabPath = Join-Path $Racine "vocabulaire.txt"
                if (Test-Path -LiteralPath $vocabPath) {
                    try {
                        $vocab = @(Get-Content -LiteralPath $vocabPath -Encoding UTF8 | Where-Object { $_.Trim() -ne '' })
                    } catch {}
                }

                $savoir = @()
                $savoirPath = Join-Path $Racine "savoir.txt"
                if (Test-Path -LiteralPath $savoirPath) {
                    try {
                        $lignes = Get-Content -LiteralPath $savoirPath -Encoding UTF8
                        $liste = New-Object System.Collections.ArrayList
                        foreach ($l in $lignes) {
                            $l = $l.Trim()
                            if ($l -eq '') { continue }
                            $pos = $l.IndexOf('|')
                            if ($pos -ge 0) {
                                $cle = $l.Substring(0, $pos).Trim()
                                $repSavoir = $l.Substring($pos + 1).Trim()
                                $null = $liste.Add(@{ cle = $cle; reponse = $repSavoir })
                            }
                        }
                        $savoir = $liste.ToArray()
                    } catch {}
                }

                $profilData = @{ nom=""; plat=""; hobby=""; motsFavoris=@(); genre=""; aime=""; aimePas=""; age="" }
                $dossierUsers = Join-Path $Racine "users"
                if (Test-Path -LiteralPath $dossierUsers) {
                    $firstUid = (Get-ChildItem -LiteralPath $dossierUsers -Directory | Select-Object -First 1).Name
                    if ($firstUid) {
                        $memoirePath = Join-Path (Join-Path $dossierUsers $firstUid) "memoire.txt"
                        if (Test-Path -LiteralPath $memoirePath) {
                            try {
                                $lignes = Get-Content -LiteralPath $memoirePath -Encoding UTF8
                                if ($lignes.Count -ge 1) { $profilData.nom = $lignes[0].Trim() }
                                if ($lignes.Count -ge 2) { $profilData.plat = $lignes[1].Trim() }
                                if ($lignes.Count -ge 3) { $profilData.hobby = $lignes[2].Trim() }
                                if ($lignes.Count -ge 4) { $profilData.motsFavoris = @($lignes[3].Trim() -split ',' | Where-Object { $_.Trim() -ne '' }) }
                                if ($lignes.Count -ge 5) { $profilData.genre = $lignes[4].Trim() }
                                if ($lignes.Count -ge 6) { $profilData.aime = $lignes[5].Trim() }
                                if ($lignes.Count -ge 7) { $profilData.aimePas = $lignes[6].Trim() }
                                if ($lignes.Count -ge 8) { $profilData.age = $lignes[7].Trim() }
                            } catch {}
                        }
                    }
                }

                $allMessages = if ($tousMessages -and $tousMessages.messages) {
                    @($tousMessages.messages)
                } else {
                    @()
                }
                $recentMessages = if ($allMessages.Count -gt 200) { $allMessages[($allMessages.Count - 200)..($allMessages.Count - 1)] } else { $allMessages }
                $jsonObj = @{
                    ok = $true
                    profil = $profilData
                    savoir = $savoir
                    vocabulaire = $vocab
                    stats = if ($stats) {
                        @{
                            messagesTotal = if ($stats.messagesTotal) { $stats.messagesTotal } else { 0 }
                            messagesMode1 = if ($stats.messagesMode1) { $stats.messagesMode1 } else { 0 }
                            messagesMode2 = if ($stats.messagesMode2) { $stats.messagesMode2 } else { 0 }
                            sessionsTotal = if ($stats.sessionsTotal) { $stats.sessionsTotal } else { 0 }
                            demarrages    = if ($stats.demarrages) { $stats.demarrages } else { 0 }
                            tempsMoyen    = if ($stats.tempsMoyen) { $stats.tempsMoyen } else { 0 }
                            demarrage     = if ($stats.demarrage) { $stats.demarrage } else { "?" }
                        }
                    } else { @{} }
                    config = if ($stats) {
                        @{
                            api_provider   = if ($stats.apiProvider) { $stats.apiProvider } else { "?" }
                            api_configured = if ($stats.apiConfigured) { $stats.apiConfigured } else { $false }
                        }
                    } else { @{} }
                    mode = if ($ping -and $ping.mode) { $ping.mode } else { "2" }
                    botEtat = if ($ping -and $ping.etat) { $ping.etat } elseif ($stats) { "pret" } else { "eteint" }
                    uptime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    connexions = if ($connexions -and $connexions.connexions) {
                        $c = @($connexions.connexions)
                        $c
                    } else { @() }
                    tousMessages = $recentMessages
                }
                $json = $jsonObj | ConvertTo-Json -Depth 3 -Compress
                $rep = Reponse-HTTP 200 "application/json" $json $corsOrigin
                }

            } elseif ($path -eq "/admin/users" -and $httpMethod -eq "GET") {
                if (-not (Verifier-AdminAuth $requete)) {
                    $json = '{"ok":false,"erreur":"Non autorise"}'
                    $rep = Reponse-HTTP 403 "application/json" $json $corsOrigin
                } else {
                $dossierUsers = Join-Path $Racine "users"
                $comptesPath = Join-Path $Racine "comptes.json"
                $comptesMap = @{}
                if (Test-Path -LiteralPath $comptesPath) {
                    try {
                        $comptesJson = Get-Content -LiteralPath $comptesPath -Raw -Encoding UTF8 | ConvertFrom-Json
                        foreach ($prop in $comptesJson.PSObject.Properties) {
                            $c = $prop.Value
                            if ($c.uid) {
                                $comptesMap[$c.uid] = @{
                                    pseudo = if ($c.pseudo) { $c.pseudo } else { "" }
                                    email  = if ($c.email) { $c.email } else { "" }
                                    cree   = if ($c.cree) { $c.cree } else { "" }
                                }
                            }
                        }
                    } catch {
                        Log "ERREUR: comptes.json corrompu: $($_.Exception.Message)"
                    }
                }
                $users = [System.Collections.ArrayList]@()
                if (Test-Path -LiteralPath $dossierUsers) {
                    Get-ChildItem -LiteralPath $dossierUsers -Directory | ForEach-Object {
                        $uid = $_.Name
                        $nbMsg = 0
                        foreach ($hf in @("historique_mode1.json","historique_mode2.json")) {
                            $histPath = Join-Path $_.FullName $hf
                            if (Test-Path -LiteralPath $histPath) {
                                try {
                                    $h = Get-Content -LiteralPath $histPath -Raw | ConvertFrom-Json
                                    $nbMsg += if ($h -is [array]) { $h.Count } else { 1 }
                                } catch {}
                            }
                        }
                        $info = if ($comptesMap.ContainsKey($uid)) { $comptesMap[$uid] } else { @{ pseudo = ""; email = ""; cree = "" } }
                        $null = $users.Add(@{
                            uid      = $uid
                            pseudo   = $info.pseudo
                            email    = $info.email
                            cree     = $info.cree
                            messages = $nbMsg
                        })
                    }
                }
                $json = @{ ok = $true; users = @($users) } | ConvertTo-Json -Depth 5 -Compress
                $rep = Reponse-HTTP 200 "application/json" $json $corsOrigin
                }

            } elseif ($path -eq "/admin/ping" -and ($httpMethod -eq "GET" -or $httpMethod -eq "HEAD")) {
                $json = @{ ok = $true; uptime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") } | ConvertTo-Json -Compress
                $rep = Reponse-HTTP 200 "application/json" $json $corsOrigin

            } else {
                $nomSite = $path.TrimStart('/')
                if ($nomSite -eq '' -or $nomSite -eq 'admin') { $nomSite = 'admin.html' }
                $fichier = Lire-FichierAdmin $nomSite
                if ($fichier -ne $null) {
                    $rep = Reponse-Octets 200 (Type-Contenu $nomSite) $fichier $corsOrigin
                } else {
                    $rep = Reponse-HTTP 404 "text/html" "Page introuvable" $corsOrigin
                }
            }

            if ($rep -ne $null) {
                try {
                    $flux.Write($rep, 0, $rep.Length)
                    $flux.Flush()
                } catch {
                    # Client deconnecte
                }
            }
        } catch {
            Log "Erreur requete : $($_.Exception.Message)"
        } finally {
            try { $client.Close() } catch {}
        }
    }
} finally {
    try { $listener.Stop() } catch {}
    Log "Serveur admin arrete."
}
