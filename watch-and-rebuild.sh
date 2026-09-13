#!/usr/bin/env bash
# Reconstruit et redémarre le conteneur quand le CODE change.
# Tourne SUR LE SERVEUR, sur le dossier alimenté par Syncthing.
#
# Deux précautions liées à Syncthing :
#  1. Ses fichiers de transfert (.syncthing.*.tmp) et de conflit
#     (*.sync-conflict-*) sont exclus de l'empreinte, sinon ils déclenchent
#     un rebuild pour rien.
#  2. Une synchro arrive fichier par fichier. On n'agit que si l'empreinte est
#     STABLE sur STABILITE relevés consécutifs, sinon on rebuild un arbre
#     à moitié arrivé.
#
# Ne réagit PAS à data/ : plan.json et etat-courant.json sont rechargés à chaud
# par le serveur (§7.2), les toucher ne doit surtout pas provoquer un rebuild.
#
# Usage : ./watch-and-rebuild.sh   (ou en service systemd, cf. deploiement/)
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RACINE"
INTERVALLE="${INTERVALLE:-10}"
STABILITE="${STABILITE:-2}"

empreinte() {
  find backend frontend shared Dockerfile docker-compose.yml watch-and-rebuild.sh \
    -type f \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    -not -name '.syncthing.*' \
    -not -name '*.tmp' \
    -not -name '*.sync-conflict-*' \
    -printf '%p %T@\n' 2>/dev/null | sort | sha256sum | cut -d' ' -f1
}

conflits() {
  find . -name '*.sync-conflict-*' -not -path '*/node_modules/*' 2>/dev/null
}

rebuild() {
  echo "[$(date '+%H:%M:%S')] changement stabilisé — rebuild"
  if docker compose up -d --build; then
    echo "[$(date '+%H:%M:%S')] déployé"
  else
    echo "[$(date '+%H:%M:%S')] ÉCHEC du rebuild — l'ancien conteneur tourne toujours" >&2
  fi
}

echo "Surveillance de $RACINE (hors data/), toutes les ${INTERVALLE}s."
echo "Rebuild après ${STABILITE} relevés identiques."
REFERENCE="$(empreinte)"
CANDIDATE=""
STABLE=0

while true; do
  sleep "$INTERVALLE"
  ACTUELLE="$(empreinte)"

  if [ "$ACTUELLE" = "$REFERENCE" ]; then
    CANDIDATE=""; STABLE=0
    continue
  fi

  if [ "$ACTUELLE" = "$CANDIDATE" ]; then
    STABLE=$((STABLE + 1))
  else
    CANDIDATE="$ACTUELLE"; STABLE=1
    echo "[$(date '+%H:%M:%S')] synchro en cours…"
  fi

  if [ "$STABLE" -ge "$STABILITE" ]; then
    C="$(conflits)"
    if [ -n "$C" ]; then
      echo "[$(date '+%H:%M:%S')] CONFLIT SYNCTHING — rebuild suspendu :" >&2
      echo "$C" >&2
      echo "Résoudre à la main, puis supprimer les fichiers .sync-conflict-*." >&2
      # On NE met PAS à jour la référence : le changement en attente doit rester
      # en attente. En l'adoptant, le rebuild ne partait jamais une fois le
      # conflit résolu — c'est arrivé le 1er septembre, une modification est
      # restée sur le carreau pendant une heure sans que rien ne l'indique.
      CANDIDATE=""; STABLE=0
      continue
    fi
    rebuild
    REFERENCE="$ACTUELLE"; CANDIDATE=""; STABLE=0
  fi
done
