# Superviseur du collecteur, pour Windows.
#
# Vérifie que le process tourne ET qu'il collecte réellement. Le relance sinon.
# Un process vivant mais muet est le cas qui compte : sans cette vérification,
# l'historique s'arrête sans que personne s'en aperçoive.
#
#   powershell -ExecutionPolicy Bypass -File collecteur\superviseur.ps1
#
# Prévu pour être appelé toutes les 10 minutes par le Planificateur de tâches.

$racine   = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$battement = Join-Path $racine "data\attentes\etat-collecteur.json"
$journal   = Join-Path $racine "data\attentes\superviseur.log"
$silenceMax = 20   # minutes

function Trace($m) {
  $ligne = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
  Add-Content -Path $journal -Value $ligne -Encoding utf8
  Write-Output $ligne
}

$process = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
           Where-Object { $_.CommandLine -like '*collecteur*service.js*' }

$muet = $true
if (Test-Path $battement) {
  try {
    $s = Get-Content $battement -Raw | ConvertFrom-Json
    $ref = if ($s.dernierSucces) { $s.dernierSucces } else { $s.demarreLe }
    $minutes = ((Get-Date).ToUniversalTime() - [datetime]::Parse($ref).ToUniversalTime()).TotalMinutes
    $muet = $minutes -gt $silenceMax
    if (-not $muet) { Trace ("ok - dernier releve il y a {0:N0} min, {1} au total" -f $minutes, $s.releves) }
    else { Trace ("MUET depuis {0:N0} min" -f $minutes) }
  } catch { Trace "battement illisible : $($_.Exception.Message)" }
} else {
  Trace "aucun battement"
}

if ($process -and -not $muet) { exit 0 }

if ($process) {
  Trace "process vivant mais muet - arret du pid $($process.ProcessId)"
  $process | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 2
} else {
  Trace "process absent"
}

Trace "relance du collecteur"
# --use-system-ca : sans ce drapeau, Node ignore le magasin de certificats de
# Windows. Le bouclier mail d'Avast intercepte la connexion SMTP et la re-signe
# avec sa propre racine, installee dans ce magasin : sans le drapeau, l'envoi
# des alertes echoue sur « self-signed certificate in certificate chain ».
Start-Process -FilePath "node" -ArgumentList "--use-system-ca", "collecteur/service.js" `
  -WorkingDirectory $racine -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $racine "data\attentes\collecteur.log") `
  -RedirectStandardError  (Join-Path $racine "data\attentes\collecteur-erreurs.log")
