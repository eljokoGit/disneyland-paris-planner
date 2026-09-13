# Les données du plan Disneyland

Deux fichiers JSON, un journal. Pas de base de données. Ce fichier suffit à
comprendre le format sans relire le code.

| Fichier | Qui l'écrit | Qui le lit |
|---|---|---|
| `plan.json` | **Claude, en session Remote** | l'app |
| `etat-courant.json` | **l'app** | Claude |
| `journal.jsonl` | l'app (append-only) | Claude, et le parent après coup |
| `attentes/*.jsonl` | **le collecteur** (service à part) | Claude, le parent |

Ce dossier est synchronisé entre le PC du parent et le serveur par Syncthing
(dossier `disney-data`, Send & Receive des deux côtés). Voir
[`../deploiement/syncthing.md`](../deploiement/syncthing.md).

## Règle de conduite

**Toujours annoncer la modification au parent. Jamais de changement silencieux.**
Il est debout dans un parc avec une enfant de 5 ans : une étape qui bouge sans
qu'il le sache est pire qu'une étape en retard.

**Un seul écrivain par fichier.** Syncthing ne fusionne pas : deux côtés qui
écrivent le même fichier entre deux synchros produisent un `.sync-conflict-*`.
`plan.json` est à moi. `etat-courant.json` et `journal.jsonl` sont à l'app.
**Ne jamais les éditer à la main** — pour agir sur l'état, passer par
`POST /api/…`. `journal.jsonl` est particulièrement exposé : Syncthing
synchronise des fichiers entiers, deux appends concurrents perdraient des lignes.

## Lire la situation en une commande

```
curl -s localhost:3021/api/etat
```

Renvoie un résumé texte, pas un dump JSON :

```
Jour 1 — jeudi 3 septembre 2026, 15h12 — Disney Adventure World
Étape 9/18 : CAVALCADE des Princesses Disney (Adventure Way), 14h50–15h25
Décalage : +20 min (dont +20 min saisis à la main)
Prochaine ancre : SPECTACLE : Mickey et le Magicien, 17h25 (départ 17h00, marge 0 min)
Créneaux : Rencontre Royale Elsa & Anna obtenue 10h45 ✓
Faites : 1,2,3,4,5,6,7,8
```

En cas de chevauchement, le résumé liste aussi les coupes possibles dans l'ordre
de sacrifice. Ajouter `?k=<APP_CLE>` si la clé est activée.

## Écritures atomiques — obligatoire des deux côtés

L'app écrit dans un fichier temporaire puis fait `rename`. **Faire pareil.**
Sans ça, l'app lira un JSON à moitié écrit pendant qu'on sauvegarde, et
inversement.

```bash
python - <<'EOF'
import io, json, os
p = json.load(io.open('data/plan.json', encoding='utf-8'))
# ... modification ...
io.open('data/plan.json.tmp','w',encoding='utf-8').write(json.dumps(p, ensure_ascii=False, indent=2))
os.replace('data/plan.json.tmp', 'data/plan.json')   # rename atomique
EOF
```

Le serveur détecte le changement en moins de 3 s et le pousse aux téléphones
connectés par SSE. **Aucun redéploiement, aucun rafraîchissement à demander.**

## Ce qu'on a le droit de modifier dans `plan.json`

1. **L'heure d'un paramètre** — `parametres[].valeur` (créneau obtenu, séance
   confirmée ou déplacée).
   *Attention* : une valeur saisie dans l'app vit dans `etat-courant.json` et
   **prime** sur celle du plan. Pour qu'une modif du plan soit visible, vérifier
   qu'il n'y a pas de surcharge du même id dans `etat.parametres`.
2. **La durée d'une étape** — `jours[].etapes[].duree`, en minutes.
3. **L'activation d'une étape** — `jours[].etapes[].actif` à `false`, avec
   `retrait: { motif, le }`, et son id dans `suppressionsAcceptees` au
   `PUT /api/plan`. C'est LA façon de retirer une étape au recalcul.
   `etat.etapesSupprimees` n'est PAS un équivalent : c'est le bouton « Retirer »
   de l'app, pour la journée en cours, et il est vidé à minuit — c'est ce qui a
   ramené le déjeuner et Le Pays des Contes de Fées le 4 septembre au matin.
4. **Un créneau obtenu, une reprise, pour une journée qu'on garde** —
   `parametres[].obtenu: true` engage une ancre dormante comme si le créneau
   avait été saisi dans Résas, et `jours[].reprise: { a: "HH:MM", avant: "id" }`
   fait repartir le calcul à cette heure devant cette étape. L'état porte les
   mêmes informations en direct, mais il est vidé à minuit ; le plan, non.
   À retirer si le plan resert pour un autre voyage.
5. **L'ordre des étapes** — réordonner le tableau `jours[].etapes`.
   C'est ce qu'exige le scénario « créneau après 15h00 » du jour 1.

Ne pas toucher aux `id` : `etat-courant.json` et `journal.jsonl` y renvoient.

## `plan.json` — schéma

```
version, genere, source
voyage           { titre, groupe, profil, personnes }
parametres[]     { id, numero, jour, libelle, valeur "HH:MM", nature, commentaire,
                   type "seance"|"creneau"|"ouverture", seances[], note }
                 seances[] = toutes les séances relevées dans l'appli. C'est ce
                 qui permet de dire, en cas de retard, si l'ancre est DÉCALABLE
                 (une séance existe plus tard) ou BLOQUÉE (c'est la dernière).
                 nature ∈ confirme | releve | hypothese | a-confirmer | non-utilise
jours[]          { numero 1|2, date, libelle, parc, ouverture, fermeture,
                   etapes[], zones[], ordreSacrifice[], jamaisSacrifier,
                   respiration }
  escapades      { cible, regle, rappels[], creneaux[] }   (jour 1 seulement)
    cible.zone   id d'une zone : sert à poser le repère violet de l'escapade sur
                 le plan, et à tracer le trajet depuis l'endroit où on est.
    creneaux[]   { id, etapes[], libelle, debut, retour, duree, coute,
                   vigilance?, risque? }
                 Créneaux FIXES, écrits à la main. L'app ne les calcule pas :
                 elle les rattache aux étapes citées dans `etapes[]` et les
                 affiche. Un créneau peut couvrir plusieurs étapes (14+15).
                 Si l'étape de fin ne se termine plus à `retour` (le plan a
                 bougé), l'app le signale au lieu de recalculer.
  zones[]        { id, nom, direction, x, y, w, h, photos[], pin?, pinEstime? }
    pin          { x, y } en POURCENTAGES de l'image déposée dans data/plans/,
                 coin haut-gauche = 0,0. Dessine le point « vous êtes ici » sur
                 le plan officiel. Sans pin, le plan reste consultable sans repère.
                 Calibré sur jour1.webp et jour2.webp — si vous remplacez une
                 image par une autre (cadrage différent), il faut recalibrer.
                 Trois repères au plus : jaune = où on est, bleu = où on va,
                 magenta = cible d'escapade, reliés par un trait pointillé.
                 Le plan s'affiche en entier, sans défilement : les repères et
                 le trait entre eux doivent se voir d'un seul coup d'œil.
                 Sur une étape de type transition, le repère jaune se place sur
                 la zone de l'étape PRÉCÉDENTE : le trajet montre d'où on part.
    pinEstime    true quand le land n'est plus nommé sur la carte et que la
                 position est déduite des bâtiments (Toon Studio, Production
                 Courtyard). L'app le dit sous le plan.
    photos[]     { nom, ou } — spots photo de la zone. Une étape affiche ceux de
                 SA zone, sous le lien « Photo ». Source : sourcePhotos (racine).
                 Le schéma des lands affiché dans l'app. x/y/w/h sont des
                 pourcentages dans un carré de 100×100, nord en haut, comme la
                 carte du parc. Les rectangles ne doivent pas se chevaucher.
                 L'orientation vient du vocabulaire de l'Excel source
                 (« descendre sur Adventure Way », « remonter Main Street »).
  etapes[]       { id "j1-e7", numero, actif, type, titre, lieu, duree (min),
                   ancre | null, note, avertissements[], zone, direction }
    ancreSiCreneau  ancre DORMANTE : ne s'applique qu'une fois le créneau
                   réellement obtenu. Sans ça, une simple hypothèse figerait la
                   suite de la journée (cas de Woody, étape 15).
    attractions[] { id, nom, attenteIncluse? }
                 Table de correspondance avec l'API : `id` est l'identifiant
                 ThemeParks.wiki. Une étape peut en avoir plusieurs (bloc flâner).
                 `attenteIncluse` = la file que la durée de l'étape absorbe ;
                 au-delà, l'étape est signalée en danger. Sans correspondance,
                 l'app l'affiche comme telle — jamais de disparition silencieuse.
    zone         id d'une entrée de jours[].zones — sert à surligner le schéma
    direction    point cardinal de la zone, affiché à côté du lieu
    avertissements[] { type: "consigne" | "remarque", texte }
                 consigne = change ce qu'on fait sur place (où se placer, quelle
                 entrée, quoi vérifier) → mis en évidence en bleu.
                 remarque = information (peut effrayer, deux petites chutes)
                 → discrète, elle ne doit pas crier.
    type         arrivee | attraction | spectacle | rencontre | activite
                 | transition | flaner | repas | sortie
    ancre        { parametre: "<id>", avance: <min> }
  ordreSacrifice[] { rang, etape, cible, portee "etape"|"partiel", gain, detail }
                 PRIORITÉ, pas liste fermée : toute activité de type attraction,
                 spectacle, rencontre ou activite est supprimable. Ce qui figure
                 ici est proposé en premier, le reste suit dans l'ordre du jour.
                 Les transitions ne se suppriment pas, les flâner et repas se
                 réduisent (voir PLANCHERS dans shared/moteur.js).
scenariosCreneau[] { parametre, jour, etape, titre, cas[] }
pointsDecision[]   { id, jour, heure, etape, titre, declencheur, action }
prerequis[]        { id "pr-2", titre, quand, detail, lie[] }
                   PLUS AFFICHÉ depuis le 13 septembre 2026 (onglet Prépa désactivé).
                   Ce qu'il faut avoir préparé AVANT de partir (change, batterie,
                   gourdes). Ne se décide pas à l'heure de l'activité concernée.
reservations       { reglesFilesVirtuelles[], actions[] }
                   actions[] PLUS AFFICHÉES depuis le 13 septembre 2026 (notifications
                   désactivées) ; reglesFilesVirtuelles reste dans Résas.
  actions[]        { id, phase "avant"|"matin"|"vague", jour, heure, vague,
                     parametreCible, titre, pourquoi, critique,
                     impossible?, dependDe? }
                   impossible : texte expliquant pourquoi cette vague n'est pas
                     jouable (8h45 : billets non scannés). Affichée barrée dans
                     Résas, jamais proposée dans « À ne pas rater ».
                   dependDe : id d'une étape qui doit être TERMINÉE avant que la
                     vague soit proposée. Une seule réservation active à la fois,
                     et la suivante ne se réserve qu'une fois la première
                     consommée : la vague Woody attend que j1-e3 soit faite.
                   Une vague est un événement d'HORLOGE : elle apparaît dès que
                   son heure est atteinte, quelle que soit l'étape en cours.
fileAttente        { base, destination, parcs{1,2}, intervalleMinutes,
                     avertissement, verifie }
                   API ThemeParks.wiki, gratuite et sans clé. Identifiants
                   vérifiés le 1er septembre 2026 :
                     jour 1  Disney Adventure World  ca888437-ebb4-4d50-aed2-d227f7096968
                     jour 2  Disneyland Park         dae968d5-630d-4719-8b06-3d107e944401
                   Sondage CÔTÉ SERVEUR uniquement, toutes les 5 min, avec ETag
                   et If-None-Match (304 = rien n'a changé). Jamais depuis le
                   navigateur : cinq téléphones = cinq fois la même requête.

rappels[]          { id, titre, texte }
                   Volontairement court. Tout ce qui concerne UNE étape vit sur
                   l'étape (consigne, remarque ou note) ; n'ajouter ici que ce
                   qui ne se rattache à aucune étape.
```

### Comment les heures se calculent

Le plan n'est **pas** une liste d'heures figées. Rien n'est stocké en dur.

Le planning reste celui qui est écrit. Il n'est **jamais** recalculé à partir de
l'heure à laquelle le parent appuie sur « Terminé » : il n'appuie pas au moment
exact où l'activité se finit, cette heure ne veut rien dire. Le bouton ne fait
qu'avancer le pointeur. Le retard se mesure en comparant **l'heure réelle** au
créneau prévu de l'activité en cours.

- **Étape ancrée** (`ancre != null`) : `debut = parametre − avance`. Elle ne
  bouge pas, sauf si on change le paramètre.
- **Étape flottante** (`ancre == null`) : `debut = fin(precedente)`,
  `fin = debut + duree`.

Devant chaque étape ancrée, on compare la fin de la précédente à son début :

| Comparaison | État | Sens |
|---|---|---|
| `fin_precedente > debut` | **CHEVAUCHEMENT de N min** | rouge, action requise |
| `fin_precedente < debut` | battement de N min | neutre, c'est du confort |
| égalité | pile poil | |

Une durée contient **marche + file + activité + sortie**. Pour un spectacle en
salle, elle inclut le temps d'avance et les ~10 min d'évacuation. Ce ne sont pas
des durées d'attraction.

Les étapes `transition` et `flaner` sont les **amortisseurs** du plan, pas du
remplissage. Ne jamais les proposer à la coupe en premier : `ordreSacrifice` dit
quoi sacrifier, dans quel ordre.

## `etat-courant.json` — schéma

Écrit par l'app, sur le serveur. On le **lit uniquement**. L'éditer à la main
expose à deux problèmes : l'app réécrit par-dessus à la prochaine action de
Le parent, et Syncthing peut produire un fichier de conflit. Passer par les
endpoints `POST /api/…`.

```
jourActif         1 | 2
etapesFaites      { "j1-e2": { marqueeA: "10:41" } }
                  marqueeA = l'heure du clic, gardée pour le récit.
                  N'ENTRE PAS dans le calcul des horaires.
etapesSupprimees  [ "j1-e14" ]   ← retirées depuis l'app pour la journée en cours ; VIDÉ À MINUIT
annulees          { "j1-e18": { motif: "Météo", horodatage } }
                  Annulé ≠ supprimé. Une annulation est SUBIE (météo, panne,
                  salle complète) : l'étape sort du planning et remonte en tête
                  du résumé sous « ⛔ ANNULÉES — à replanifier ». C'est le signal
                  qu'une session Remote doit reconstruire quelque chose.
ancresDecrochees  [ "j1-e3" ]    ← l'étape garde son ancre dans plan.json mais
                                    repasse en flottante (cas « aucun créneau »)
durees            { "j1-e4": 29 }   ← flâner ou repas raccourci depuis l'app,
                                       remplace la durée du plan
ordreSacrifice    { "1": ["j1-e11","j1-e14"] }  ← ordre réordonné par le parent,
                                       remplace celui du plan pour ce jour
parametres        { "j2_philharmagique": "18:00" }  ← surcharge le plan
creneaux          { "j1_rencontre_royale": { obtenu: true, heure: "10:45",
                                             horodatage: "..." } }
escapades         { "esc-4": true }   ← escapades solo utilisées
actions           { "j1-v1": "rate", "av-1": "fait", "pr-2": "fait" }
                  fait | rate. La distinction compte pour les vagues de file
                  virtuelle : une vague RATÉE laisse l'app reproposer la
                  suivante ; une vague FAITE, ou un créneau obtenu dans
                  `creneaux`, annule toutes les vagues restantes.
majLe             ISO 8601
```

### Détection du retard

À chaque minute, l'app compare l'heure réelle au créneau `[debut, fin]` de
l'activité en cours, puis calcule ce qu'il reste à tenir avant la prochaine
ancre :

```
fin estimée de l'activité en cours = max(maintenant, fin prévue)
besoin  = somme des durées des étapes d'ici la prochaine ancre
marge   = début de l'ancre − fin estimée − besoin
```

La contrainte est la prochaine ancre, ou l'heure de fin de journée s'il n'y a
plus d'ancre (le jour 2 se termine sans ancre après PhilharMagique).

Si `marge < 0`, il manque `-marge` minutes, et **seulement là** l'app parle. Elle
sépare alors deux choses :

- **information** — ce que le retard coûte aux temps libres et repas à venir,
  avec l'heure de départ obligatoire de chacun. Aucun bouton : réduire un temps
  libre n'est pas une action, c'est une conséquence.
- **décision** — supprimer une activité, dans l'ordre de sacrifice, seulement
  si le temps libre n'absorbe pas tout. C'est le seul geste qui libère du temps.

Après une suppression, le parent prévient Claude en session Remote et donne la
situation réelle (« on ira à l'attraction 2 vers 12h15 ») ; c'est Claude qui
refait les horaires dans `plan.json`. L'app ne recalcule pas la journée toute
seule : les conséquences d'une suppression sont géographiques (une transition
voisine peut devenir fausse) et se décident à la main.

## `journal.jsonl` — append-only

Une ligne JSON par événement, jamais réécrite. Permet de reconstituer le déroulé
réel sans interroger le parent, et il en reste un récit de la journée après coup.

```
{"horodatage":"...","evenement":"etape-terminee","etape":"j1-e2","titre":"...","marqueeA":"10:41"}
```

Événements : `etape-terminee`, `etape-reprise`, `etape-supprimee`,
`etape-restauree`, `etape-annulee`, `etape-retablie`, `ancre-decrochee`, `ancre-raccrochee`,
`parametre`, `creneau`, `action-faite`, `action-ratee`, `action-annulee`,
`jour-actif`,
`duree`, `ordre-sacrifice`, `plan-recharge`.

## `attentes/` — historique des temps d'attente

Écrit par un **service indépendant** (`collecteur/service.js`), pas par l'app :
redémarrer l'application ne doit pas trouer l'historique. Un fichier par jour et
par parc, `AAAA-MM-JJ-jourN.jsonl`.

Première ligne = en-tête avec la correspondance id → nom. Lignes suivantes = un
relevé toutes les 5 min : `t` (heure), `w` (attentes standby), `sr` (Single
Rider), `f` (fermées). Rien n'est écrit quand le parc est fermé.

Détail complet dans [`../collecteur/LISEZ-MOI.md`](../collecteur/LISEZ-MOI.md).

## Les deux inconnues du plan

- **Paramètres 6 et 7** (`j1_rencontre_royale`, `j2_pavillon_princesses`) : des
  **hypothèses**. Ce sont des créneaux de file virtuelle qu'on ne peut obtenir
  que le jour même. C'est la principale variable du plan.
- **Paramètre 13** (`j2_philharmagique`) : **à confirmer** le matin même. La
  liste de séances de l'appli était tronquée, l'heure de la dernière séance de
  PhilharMagique est inconnue.

`scenariosCreneau` contient la conduite à tenir selon l'heure obtenue, y compris
le cas « aucun créneau ». `pointsDecision` contient les 5 arbitrages datés.
