#!/usr/bin/env bash
# Identifie comment le courrier est configuré sur ce serveur, et où se créent
# les comptes d'envoi.
#
# LECTURE SEULE. Ce script ne modifie rien et n'affiche AUCUN mot de passe ni
# empreinte : les lignes qui en contiennent sont masquées.
#
#   bash inspecter-mail.sh

set -u
titre() { printf '\n=== %s ===\n' "$1"; }
masquer() { sed -E 's/(\{[A-Z0-9-]+\}|\$[0-9a-z]\$)[^ :]*/[masqué]/g; s/(password|pass|secret)[[:space:]]*=[[:space:]]*.*/\1 = [masqué]/I'; }

titre "Serveur d'envoi (MTA)"
if command -v postconf >/dev/null 2>&1; then
  echo "Postfix installé."
  postconf -h mydomain myhostname virtual_mailbox_domains virtual_mailbox_maps \
           smtpd_sasl_type smtpd_sasl_path 2>/dev/null | sed 's/^/  /'
elif command -v exim4 >/dev/null 2>&1; then echo "Exim installé."
else echo "Ni Postfix ni Exim trouvés — regardez les conteneurs plus bas."; fi

titre "Boîtes aux lettres (Dovecot)"
if [ -d /etc/dovecot ]; then
  echo "Dovecot installé. D'où viennent les comptes :"
  grep -rhoE '^\s*(userdb|passdb)\s*\{|^\s*driver\s*=\s*\w+|^\s*args\s*=\s*\S+' \
    /etc/dovecot/conf.d/ /etc/dovecot/dovecot.conf 2>/dev/null | sed 's/^/  /' | head -20
  for f in /etc/dovecot/users /etc/dovecot/passwd /etc/dovecot/passwd.db; do
    [ -f "$f" ] && echo "  Fichier de comptes : $f ($(wc -l < "$f") ligne(s))"
  done
else
  echo "Pas de Dovecot : les comptes sont peut-être des utilisateurs système, ou dans un conteneur."
fi

titre "Comptes existants (adresses seulement)"
for f in /etc/dovecot/users /etc/dovecot/passwd; do
  [ -f "$f" ] && { echo "$f :"; cut -d: -f1 "$f" | sed 's/^/  /'; }
done
[ -f /etc/postfix/virtual ] && { echo "/etc/postfix/virtual :"; grep -v '^#' /etc/postfix/virtual | awk 'NF' | sed 's/^/  /' | head -20; }
[ -f /etc/aliases ] && { echo "/etc/aliases :"; grep -v '^#' /etc/aliases | awk 'NF' | sed 's/^/  /' | head -10; }

titre "Conteneurs liés au courrier"
if command -v docker >/dev/null 2>&1; then
  docker ps --format '  {{.Names}}  ({{.Image}})' 2>/dev/null | grep -iE 'mail|smtp|postfix|dovecot|mailcow|mailu' || echo "  aucun"
else echo "  Docker absent"; fi

titre "Ce qui est protégé derrière nginx"
grep -rlE 'auth_basic' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sed 's/^/  /' || echo "  rien trouvé"

titre "Comment créer le compte d'envoi"
cat <<'AIDE'
  Selon ce qui précède :

  - Dovecot avec un fichier de comptes (/etc/dovecot/users) :
      doveadm pw -s SHA512-CRYPT        <- demande un mot de passe, affiche l'empreinte
      puis ajoutez une ligne :  plan@exemple.com:<empreinte>
      et : systemctl reload dovecot

  - Dovecot sur les utilisateurs système :
      sudo adduser --disabled-login plan   puis   sudo passwd plan

  - Un conteneur (Mailcow, Mailu, docker-mailserver) :
      passez par son interface ou sa commande d'ajout d'utilisateur.

  Ensuite, mettez la MÊME adresse dans data/alertes-mail.json ("expediteur")
  et dans collecteur/.env-mail (MAIL_UTILISATEUR).
AIDE
echo
