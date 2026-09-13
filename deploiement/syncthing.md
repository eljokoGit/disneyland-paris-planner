# Syncthing — du PC Windows vers mon-serveur

C'est le chemin de déploiement **et** le chemin par lequel une session Claude
Code Remote agit sur le plan. Sans lui, éditer `plan.json` sur le PC ne change
rien pour l'app.

## Deux dossiers, pas un

| Dossier | Chemin | Windows | Serveur | Contenu |
|---|---|---|---|---|
| `disney-code` | racine du projet | **Send Only** | **Receive Only** | backend, frontend, shared, Dockerfile… |
| `disney-data` | `<projet>/data` | Send & Receive | Send & Receive | `plan.json`, `etat-courant.json`, `journal.jsonl` |

`disney-data` est **imbriqué** dans `disney-code`. C'est supporté par Syncthing
à une condition : le parent doit ignorer le chemin de l'enfant. C'est fait,
`/data` est la première règle du `.stignore` racine.

**Pourquoi séparer.** Le code ne bouge que dans un sens (PC → serveur) : en le
passant en Send Only / Receive Only, aucun conflit n'est possible et le serveur
ne peut pas dériver. Les données, elles, circulent dans les deux sens. Mélanger
les deux régimes dans un seul dossier, c'est se garantir des
`.sync-conflict-*` sur `server.js` un jeudi à 15h.

## Le contrat de propriété — c'est lui qui évite les conflits

Syncthing ne sait pas fusionner. Deux côtés qui écrivent le même fichier entre
deux synchros = fichier de conflit. La parade n'est pas technique, elle est
disciplinaire : **un seul écrivain par fichier.**

| Fichier | Écrit par | Lu par | Sens réel |
|---|---|---|---|
| `plan.json` | **Claude, sur le PC** | l'app | PC → serveur |
| `etat-courant.json` | **l'app, sur le serveur** | Claude | serveur → PC |
| `journal.jsonl` | **l'app, sur le serveur** | Claude, le parent | serveur → PC |

Bien que le dossier soit en Send & Receive, chaque fichier n'a de fait qu'un
seul écrivain. **Ne jamais éditer `etat-courant.json` ni `journal.jsonl` à la
main** : c'est la seule façon de créer un conflit ici. Pour agir sur l'état,
passer par l'app ou par un `POST /api/…`.

`journal.jsonl` est append-only et Syncthing synchronise des fichiers entiers,
pas des deltas : un append simultané des deux côtés perdrait des lignes. Raison
de plus pour que seul le serveur y touche.

## Écritures atomiques : pourquoi ça marche

L'app écrit dans un temporaire puis fait `rename`. Syncthing ne voit donc jamais
un JSON à moitié écrit — il ne détecte que le fichier final, complet. Les
temporaires sont exclus par `data/.stignore`.

Faire pareil en session Remote (`data/README.md` donne le script).

## Installation

### Sur le serveur

```bash
sudo apt install syncthing
sudo systemctl enable --now syncthing@$USER
```

L'interface est sur `127.0.0.1:8384`. Y accéder via Tailscale :

```bash
ssh -L 8384:127.0.0.1:8384 mon-serveur
```

Puis créer le dossier cible :

```bash
mkdir -p /CHEMIN/VERS/Disney-app/data     # cf. inspecter-serveur.sh
id -u && id -g                            # à reporter dans PUID/PGID du .env
```

### Appairage : déjà fait

Syncthing tourne déjà sur le PC du parent (8 dossiers : Proto-Preserie-Convergence,
Amazon-PPC-KB, cowork-bridge, Secrets, Photos Backup, Cagnotte-Mitch,
Comptes-App) et l'appareil **« Serveur Linux »** y est déjà connu.

Il n'y a donc **rien à appairer** : il suffit d'ajouter les deux dossiers et de
les partager avec cet appareil, en reprenant les réglages réseau des dossiers
existants (l'adressage passe déjà par le tailnet, UFW y étant scopé).

### Les deux dossiers

**`disney-code`**
- Windows : `C:\chemin\vers\Disney-app`, Folder ID `disney-code`, type
  **Send Only**.
- Serveur : `/CHEMIN/VERS/Disney-app`, même Folder ID, type **Receive Only**.
- Le `.stignore` est déjà dans le dépôt, Syncthing le reprend tel quel.

**`disney-data`**
- Windows : `C:\chemin\vers\Disney-app\data`, Folder ID `disney-data`, type
  **Send & Receive**.
- Serveur : `/CHEMIN/VERS/Disney-app/data`, même Folder ID, **Send & Receive**.
- Versionnage : **Simple, 10 versions**. `plan.json` est le fruit de plusieurs
  itérations, une mauvaise écriture doit être rattrapable. Le versionnage crée
  un `.stversions/` local, non synchronisé.

Sur `disney-code`, laisser le versionnage à « Aucun » : le code est déjà sur le
PC, et `.stversions/` polluerait l'empreinte du watcher.

### Démarrer l'app

```bash
cd /CHEMIN/VERS/Disney-app
cp .env.exemple .env          # APP_CLE, PUID, PGID
docker compose up -d --build
./watch-and-rebuild.sh &      # ou le service systemd
```

## Ce qui se passe ensuite, concrètement

**Je change du code sur le PC.** Syncthing pousse. `watch-and-rebuild.sh` voit
l'empreinte bouger, attend qu'elle se stabilise sur deux relevés consécutifs
— pour ne pas reconstruire un arbre à moitié arrivé — puis
`docker compose up -d --build`. Une trentaine de secondes en tout.

**Je change `plan.json` sur le PC.** Syncthing pousse. Le serveur voit le
`rename` dans `data/`, recharge à chaud et pousse aux téléphones par SSE. Trois
à dix secondes, **aucun rebuild, aucun redéploiement**. C'est exactement le cas
d'usage du §7.2 : le parent est debout dans un parc, il ne redémarre pas un
conteneur.

`watch-and-rebuild.sh` ignore `data/` : une modif du plan ne déclenche jamais de
rebuild. C'est volontaire, et c'est ce qui rend le pilotage temps réel viable.

**le parent appuie sur « Étape terminée ».** L'app écrit `etat-courant.json` sur le
serveur, Syncthing le remonte vers le PC en ~10 s. Mais pour lire la situation,
`curl /api/etat` reste la voie rapide et fiable : elle ne dépend ni de la
synchro ni de l'état du PC.

## En cas de conflit

`watch-and-rebuild.sh` **suspend le rebuild** s'il trouve un
`*.sync-conflict-*` et le dit dans ses logs, plutôt que de déployer un arbre
douteux.

```bash
find /CHEMIN/VERS/Disney-app -name '*.sync-conflict-*'
```

Sur du code, la bonne version est presque toujours celle du PC (Send Only) :
supprimer le fichier de conflit. Sur `plan.json`, comparer avant de trancher,
puis supprimer. Le rebuild reprend au relevé suivant.

## Le poste de pilotage

Le PC Windows reste allumé en permanence, avec Claude Desktop. C'est **lui** le
poste de pilotage : pendant les deux journées, la session Claude Code Remote
s'exécute dessus, j'édite `C:\chemin\vers\Disney-app\data\plan.json`, et
Syncthing pousse au serveur qui recharge à chaud. Rien à installer sur
mon-serveur.

Le chemin complet, quand j'annonce au parent « je décale Mickey et le Magicien
à 18h30 » :

```
Claude Desktop (PC)  →  plan.json réécrit atomiquement
        ↓  Syncthing, dossier disney-data           ~1-3 s
serveur  →  fs.watch sur data/  →  rechargement     ~1-3 s
        ↓  SSE
téléphone du parent : la journée est recalculée
```

Une dizaine de secondes bout en bout, sans rebuild ni rafraîchissement.

### Deux réglages qui rendent ça immédiat

**Délai du surveillant de fichiers.** Par défaut Syncthing attend 10 s avant de
propager une modification. Sur `disney-data`, descendre à 1 s : Folder →
Advanced → **`fsWatcherDelayS` = 1**. Les fichiers sont minuscules et changent
rarement, le coût est nul. Laisser `disney-code` au défaut : un rebuild n'est
pas pressé.

**La mise en veille.** « Toujours allumé » et « ne dort jamais » ne sont pas la
même chose : un PC en veille suspend Syncthing *et* Tailscale, et c'est
exactement le scénario qui mord un jeudi à 15h12. À vérifier avant le 3
septembre :

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

L'écran peut s'éteindre sans conséquence, c'est `monitor-timeout-ac`.

### Si le PC tombe quand même

Rien n'est perdu et la journée continue : l'app tourne sur le serveur,
indépendante du PC. Le parent garde le contrôle complet depuis son téléphone — les
étapes, les décalages, les créneaux, les coupes. Seule ma capacité à éditer le
plan disparaît.

Et le filet reste : le bouton **« Copier l'état »** met le résumé texte dans le
presse-papier, le parent me le colle dans la conversation, je réponds sans avoir
besoin d'accéder à quoi que ce soit.
