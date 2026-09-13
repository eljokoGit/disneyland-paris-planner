#!/usr/bin/env bash
# LECTURE SEULE. À lancer sur mon-serveur pour retrouver la convention de
# nommage des sous-domaines avant d'en créer un. Ne modifie rien, n'installe rien.
echo "=== domaines servis par nginx ==="
grep -rhE '^\s*server_name' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null \
  | sed 's/^\s*server_name\s*//; s/;$//' | tr ' ' '\n' | grep -v '^$' | sort -u

echo
echo "=== certificats certbot existants ==="
certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains' || \
  ls -1 /etc/letsencrypt/live/ 2>/dev/null

echo
echo "=== ports déjà pris par des conteneurs ==="
docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null

echo
echo "=== blocs proxy_pass en place (modèle à copier) ==="
grep -rhA2 'proxy_pass' /etc/nginx/sites-enabled/ 2>/dev/null | head -30

echo
echo "=== où vivent les stacks docker existantes (convention de chemin) ==="
docker inspect --format '{{.Name}} {{index .Config.Labels "com.docker.compose.project.working_dir"}}' \
  $(docker ps -q) 2>/dev/null | grep -v ' $' | sort -u

echo
echo "=== Syncthing sur ce serveur ==="
if command -v syncthing >/dev/null; then
  syncthing --version
  systemctl is-active "syncthing@$USER" 2>/dev/null || echo "service syncthing@$USER inactif"
  echo "id local : $(id -u):$(id -g)  ← à reporter dans PUID/PGID du .env"
else
  echo "syncthing non installé — sudo apt install syncthing"
fi

echo
echo "=== interface Tailscale (UFW y est scopé) ==="
ip -brief addr show tailscale0 2>/dev/null || echo "tailscale0 absente"
