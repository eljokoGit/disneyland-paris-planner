# Collecteur de temps d'attente

Service **indépendant** de l'application. Il ne fait qu'une chose : interroger
ThemeParks.wiki toutes les 5 minutes et écrire ce qu'il voit.

Il est séparé exprès : redémarrer l'app pendant qu'on la développe ne doit pas
trouer l'historique.

## Lancer

```bash
node collecteur/service.js              # en continu
node collecteur/service.js --une-fois   # un seul relevé, pour vérifier
```

Sur le serveur, il tourne comme second conteneur : `docker compose up -d`
démarre l'app **et** le collecteur, avec `restart: unless-stopped`.

## Ce qu'il écrit

`data/attentes/AAAA-MM-JJ-jourN.jsonl`, un fichier par jour et par parc.

Première ligne, l'en-tête, qui donne la correspondance id → nom :

```json
{"type":"entete","jour":1,"parc":"Disney Adventure World","date":"2026-09-01",
 "intervalleMinutes":5,"attractions":{"630e2675-…":"Frozen Ever After", …}}
```

Puis une ligne par relevé :

```json
{"t":"08:45","iso":"2026-09-01T06:45:55.000Z",
 "w":{"630e2675-…":40},          ← attente standby, en minutes
 "sr":{"f0d4b531-…":10},          ← file Single Rider quand elle existe
 "pa":{"630e2675-…":16},          ← prix du Premier Access, en euros
 "f":["25556e4e-…"]}              ← attractions fermées à cet instant

Le prix du Premier Access bouge dans la journée selon la demande : c'est une
série, pas une constante. L'état des files virtuelles gratuites (disponible /
complète) est lu en direct mais pas archivé — il change trop vite pour qu'un
relevé toutes les 5 min en dise quoi que ce soit.
```

Rien n'est jamais réécrit, uniquement ajouté.

## Ce qu'il n'écrit pas

**Rien quand le parc est fermé.** Sans ça, 288 lignes de « tout est fermé »
s'accumuleraient chaque nuit pour rien. Les spectacles sont également exclus :
ils n'ont pas de file d'attente.

## Politesse envers l'API

Un seul appel par parc toutes les 5 minutes, avec `If-None-Match`. Un 304 ne
déclenche aucune écriture. C'est la cadence de rafraîchissement annoncée par la
documentation : interroger plus vite ne donnerait rien de plus.

## S'assurer qu'il tourne

Trois filets, du plus interne au plus externe.

**1. Chien de garde interne.** Si aucun relevé n'aboutit pendant 20 minutes, le
service sort en code 1 au lieu de survivre. Un process vivant mais muet est pire
qu'un process mort : personne ne s'en aperçoit.

**2. Battement de cœur.** À chaque tour, `data/attentes/etat-collecteur.json`
est réécrit : heure du dernier tour, du dernier succès, nombre de relevés,
dernière erreur. C'est ce fichier que lisent les deux surveillances ci-dessous.

```bash
node collecteur/sante.js     # code 0 s'il collecte, 1 s'il s'est tu
```

**3. Relance automatique.**

*Sur le serveur* : `restart: unless-stopped` relance le conteneur quand le chien
de garde le fait sortir. Un `healthcheck` affiche en plus l'état dans
`docker ps`, sans avoir à lire les logs.

*Sur Windows* : `collecteur/superviseur.ps1` vérifie que le process tourne **et**
qu'il collecte, puis relance si besoin.

```powershell
powershell -ExecutionPolicy Bypass -File collecteur\superviseur.ps1
```

À appeler toutes les 10 minutes par le Planificateur de tâches. Il écrit ce
qu'il fait dans `data/attentes/superviseur.log`.

**4. Et surtout : c'est visible dans l'app.** L'onglet Attentes affiche le
nombre de relevés enregistrés et l'ancienneté du dernier. Si le collecteur se
tait, un bandeau orange le dit — en précisant que les temps affichés restent à
jour, seul l'archivage est arrêté.

## Interdit

Ne jamais arrêter ce service. En particulier, **jamais de `taskkill /F /IM node.exe`** :
cette commande tue aussi le collecteur, et chaque minute d'arrêt est un trou définitif
dans l'historique. Pour arrêter le serveur de l'application, utiliser `outils/arreter-app.ps1`,
qui ne vise que `backend/server.js`.
