# Plan Disneyland Paris — 3 et 4 septembre 2026

App mobile pour piloter deux journées de parc à une main, en plein soleil, avec
une enfant de 5 ans dans l'autre bras.

> **À propos de ce dépôt.** Projet personnel, partagé tel quel après le voyage.
> Les données de la famille sont anonymisées, les adresses et le serveur
> remplacés par des exemples (`exemple.com`, `mon-serveur`). Les plans officiels
> du parc ne sont pas inclus : ils sont sous droits (voir `data/plans/LISEZ-MOI.txt`).
> Les alertes mail sont désactivées dans `data/alertes-mail.json`.
>
> Pour l'essayer en local : `npm install` dans `backend/` et `frontend/`,
> `npm run build` dans `frontend/`, puis `node backend/server.js` et
> http://localhost:3000. Sans clé (`APP_CLE` vide), l'accès est libre.

**Critère de réussite** : à 15h12 le jeudi, sortir son téléphone et savoir en
trois secondes si on est dans les temps et ce qu'on fait ensuite.

## Démarrer en local

```bash
cd backend && npm install && cd ../frontend && npm install && npm run build
cd ../backend && node server.js      # http://localhost:3000
```

En développement, deux terminaux : `node --watch server.js` d'un côté,
`npm run dev` de l'autre (Vite proxifie `/api` vers le port 3000).

## Déployer sur mon-serveur

Le code et les données arrivent sur le serveur par **Syncthing**, sur le
tailnet. Deux dossiers, parce qu'ils n'ont pas le même régime :

| Dossier | Windows | Serveur | Pourquoi |
|---|---|---|---|
| `disney-code` (racine) | Send Only | Receive Only | le code ne bouge que dans un sens, aucun conflit possible |
| `disney-data` (`data/`) | Send & Receive | Send & Receive | `plan.json` descend, `etat-courant.json` et `journal.jsonl` remontent |

Procédure complète : [`deploiement/syncthing.md`](deploiement/syncthing.md).
Contrat de propriété des fichiers : [`data/README.md`](data/README.md).

Puis, sur le serveur :

```bash
cp .env.exemple .env      # APP_CLE (openssl rand -hex 16), PUID/PGID (id -u ; id -g)
docker compose up -d --build   # démarre l'app ET le collecteur
./watch-and-rebuild.sh &  # rebuild auto quand le code synchronisé change
```

`docker compose` lance deux conteneurs : l'application, et le **collecteur** de
temps d'attente, volontairement séparé pour que l'historique ne soit pas
interrompu quand on redéploie l'app.

Le conteneur écoute sur `127.0.0.1:3021`, nginx fait le reverse proxy.

`PUID`/`PGID` doivent correspondre au compte qui fait tourner Syncthing : le
conteneur écrit dans `data/`, et si les fichiers deviennent `root:root`,
Syncthing ne peut plus y appliquer les mises à jour venant du PC.

**Le sous-domaine n'est pas choisi.** Lancer `deploiement/inspecter-serveur.sh`
sur mon-serveur pour retrouver la convention en place, valider le nom,
puis remplir `deploiement/nginx-disney.conf.modele` et lancer certbot. Le bloc
`location /api/stream` est indispensable : sans lui nginx bufferise le flux SSE
et le rechargement à chaud ne remonte plus jusqu'au téléphone.

L'accès se fait par lien secret : `https://<domaine>/?k=<APP_CLE>`. La clé est
mémorisée dans le navigateur, l'URL est nettoyée après le premier chargement.

## Les cinq écrans

- **Maintenant** — 90 % de l'usage, et volontairement pauvre. Un bandeau qui dit
  d'un coup d'œil si on est dans les temps et combien de minutes il reste dans le
  créneau en cours, l'activité en cours en très gros avec
  son créneau prévu, un bouton **Terminé**, un retour arrière en cas de clic
  malheureux, et l'activité suivante. La note complète est là mais repliée. Les
  réserves du type « deux petites chutes » sont une remarque discrète ; les
  consignes qui changent ce qu'on fait sur place — où se placer pour le nocturne,
  quelle entrée du château, quelle séance vérifier — ressortent en bleu.
  Un lien discret **Annulé ou fermé ?** permet de sortir du plan un spectacle ou
  une attraction annulée, avec son motif. Le point cardinal de la zone est
  affiché à côté du lieu, **Où est-ce ?** ouvre le plan du parc — le plan
  officiel déposé dans `data/plans/` s'il existe, sinon un schéma des lands —
  avec jusqu'à trois repères reliés par un trait : jaune où l'on est, bleu où
  l'on va, magenta la cible d'une escapade solo. **Photo** liste les spots photo
  de la zone.

  L'app compare l'heure réelle au créneau de l'activité en cours. Elle ne dit
  rien tant que la contrainte suivante tient — prochaine ancre, ou heure de fin
  de journée quand il n'y a plus d'ancre. Quand elle ne tient plus, et seulement
  là, elle distingue deux choses :

  - **une information**, sans bouton : ce que le retard coûte au temps libre ou
    au repas à venir (« village d'Arendelle : 10 min au lieu de 50, tu devras
    partir à 12h00 »). Écourter un temps libre n'est pas une action dans l'app,
    c'est simplement partir plus tôt — le bouton Terminé s'en charge.
  - **une décision**, avec un bouton : supprimer une activité, dans l'ordre de
    sacrifice. C'est le seul levier réel, parce que c'est le seul qui libère du
    temps qui n'existait pas.

  Une suppression réorganise la journée : prévenir Claude en session Remote pour
  qu'il refasse le planning à partir de la situation réelle.
- **Journée** — la timeline complète. Début / fin / durée / état de contrôle /
  lieu / étape / note dépliable. Les étapes ancrées sont visuellement distinctes,
  les amortisseurs (transition, flâner, repas) sont étiquetés comme tels.
  En bas : l'ordre de sacrifice, **réordonnable à la flèche**, et les points de
  décision du jour.
- **Attentes** — tous les temps d'attente du parc du jour, triés par attente
  croissante, les attractions du plan surlignées, les fermées signalées et non
  masquées, avec l'heure du dernier relevé. Données ThemeParks.wiki, collectées
  côté serveur toutes les 5 min.
- **Résas** — les files virtuelles des deux parcs : les alertes par mail, file par
  file, et la saisie de l'heure obtenue. Saisir un créneau recale l'étape ancrée
  et toute la journée suit.
- **Réglages** — la langue (français ou espagnol, propre à chaque téléphone),
  l'état à copier pour Claude et le journal de la journée.

**Langues.** L'interface et le contenu du plan existent en français et en
espagnol. Le français sert de clé : `t('Dans les temps')` dans le code,
`frontend/src/i18n/es.js` pour l'interface, `frontend/src/i18n/plan-es.json`
pour les textes de `plan.json`. Une phrase non traduite s'affiche en français.
`node outils/verifier-traductions.mjs --liste` dit ce qui manque — à relancer
après chaque modification du plan ou de l'interface. Le texte de recalcul pour
Claude et l'état à copier restent en français : c'est la langue dans laquelle
la procédure les lit.

Désactivés le 13 septembre 2026 : l'onglet **Prépa** (sac et réglages de l'appli
Disney) et les trois notifications de l'écran Maintenant — approche d'une vague
de file virtuelle, rappel du Click & Collect à l'entrée, « il faut partir
maintenant ». Les alertes **par mail** du collecteur, elles, restent.

## Architecture

```
collecteur/     service indépendant de collecte des temps d'attente
data/           plan.json, etat-courant.json, journal.jsonl, README.md
                attentes/  historique écrit par le collecteur
                plans/  ← déposer ici le plan officiel (jour1.jpg, jour2.pdf…)
                └── dossier Syncthing « disney-data », volume monté dans le
                    conteneur, éditable en session Claude Code Remote
shared/         moteur.js — le calcul des horaires, importé par les DEUX côtés
backend/        Express, écritures atomiques, fs.watch + SSE
frontend/       React + Vite, cache local + file d'attente hors ligne
deploiement/    syncthing.md, modèles nginx / systemd, inspection du serveur
```

`shared/moteur.js` est le cœur : il calcule les horaires, détecte les
chevauchements et produit le résumé texte. Il est importé tel quel par le
serveur **et** par le navigateur, ce qui permet au téléphone de recalculer seul
quand le réseau tombe, sans jamais diverger du serveur.

## Tolérance au réseau

Le réseau est mauvais dans les parcs. Toute action est appliquée localement
immédiatement, puis envoyée. Si l'envoi échoue, elle part dans une file
`localStorage` rejouée dans l'ordre dès que le serveur redevient joignable ; un
bandeau jaune indique le nombre d'actions en attente. Le dernier instantané est
mis en cache, donc l'app s'ouvre même hors ligne.

## Pilotage par Claude Code Remote

Il n'y a **pas** de système de feedback dans l'app. Pendant la journée, le parent
parle directement à Claude depuis son téléphone. Le contrat est décrit dans
[`data/README.md`](data/README.md) : `plan.json` est édité par Claude,
`etat-courant.json` est écrit par l'app, `journal.jsonl` garde la trace.

Le PC Windows, toujours allumé sous Claude Desktop, est le poste de pilotage :
la session Remote s'y exécute, j'édite `data/plan.json`, Syncthing pousse au
serveur. Une dizaine de secondes jusqu'au téléphone du parent.

Une seule commande pour comprendre la situation :

```bash
curl -s localhost:3021/api/etat
```

Quand `plan.json` change sur le PC, Syncthing le pousse au serveur, qui le
détecte en moins de 3 s et le propage aux téléphones. Pas de rebuild, pas de
redéploiement, pas de rafraîchissement à demander — `watch-and-rebuild.sh`
ignore délibérément `data/`.

## API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/etat` | résumé **texte** lisible par un humain |
| GET | `/api/snapshot` | plan + état + journées calculées (JSON) |
| GET | `/api/stream` | SSE : plan rechargé, état modifié |
| GET | `/api/journal` | le journal complet |
| GET | `/api/plans-precedents` · `/:fichier` | liste des sauvegardes de plan / lecture d'une sauvegarde sans l'appliquer |
| POST | `/api/etape/:id/terminee` | avance le pointeur d'une étape |
| POST | `/api/etape/:id/reprendre` | annule « terminée » |
| POST | `/api/etape/:id/supprimer` · `/restaurer` | coupe volontaire du jour / remise au plan (défait aussi un retrait écrit dans le plan) |
| POST | `/api/etape/:id/annuler` | `{ motif }` — annulation subie (météo, panne, complet) |
| POST | `/api/etape/:id/retablir` | annule l'annulation |
| POST | `/api/etape/:id/decrocher` | l'étape quitte son ancre, repasse en flottante |
| POST | `/api/etape/:id/duree` | `{ minutes }` — raccourcir un flâner ou un repas |
| POST | `/api/sacrifice` | `{ jour, ordre }` — réordonner les activités sacrifiables |
| POST | `/api/parametre/:id` | `{ valeur: "HH:MM" }`, vide = revenir au plan |
| POST | `/api/creneau/:id` | `{ obtenu, heure }` |
| POST | `/api/jour` | `{ jour: 1 \| 2 }` |
| GET | `/api/plan-parc/:jour` | plan officiel déposé dans `data/plans/`, s'il existe |
| GET | `/api/attentes/:jour` | temps d'attente en direct de tout le parc |

## Source des données

`Disneyland-Paris-plan-2-jours_18.xlsx`, 10 onglets. Les horaires de spectacles
ont été **relevés dans l'application Disneyland Paris pour ces deux dates
précises** (jeudi et vendredi étaient identiques) — ce ne sont pas des
estimations. Les 10 étapes ancrées du plan reconstituent l'Excel au poil :
jour 1 08h45 → 22h10, jour 2 08h45 → 20h00, les 10 ancres « pile poil ».
