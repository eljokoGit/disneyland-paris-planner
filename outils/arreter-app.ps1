# Arrête UNIQUEMENT le serveur de l'application (backend/server.js).
#
# Le collecteur de temps d'attente tourne dans son propre processus node.exe et
# ne doit JAMAIS être touché : il collecte en continu, un arrêt = un trou
# définitif dans l'historique. Un « taskkill /F /IM node.exe » le tue aussi.
# C'est arrivé le 1er septembre 2026. Ce script existe pour que ça n'arrive plus.

$cibles = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'collecteur' }

if (-not $cibles) {
  Write-Output "Aucun serveur d'application en cours."
  exit 0
}

foreach ($p in $cibles) {
  if ($p.CommandLine -match 'collecteur') {
    Write-Output "REFUS — le PID $($p.ProcessId) ressemble au collecteur, on ne le touche pas."
    continue
  }
  Stop-Process -Id $p.ProcessId -Force
  Write-Output "Serveur arrêté (PID $($p.ProcessId))."
}
