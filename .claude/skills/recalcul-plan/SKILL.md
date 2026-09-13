---
name: recalcul-plan
description: Recalculer le plan des deux journées Disneyland du parent. À charger dès qu'il colle un brief « RECALCUL DEMANDÉ », dit que le plan ne tient plus, qu'une attraction est fermée ou en panne, qu'un créneau de file virtuelle est tombé, qu'une séance a bougé, qu'ils sont en retard ou en avance, qu'il veut ajouter ou déplacer une attraction, ou qu'une contrainte change (horaire, budget, ce qu'on accepte de rater). Vaut aussi pour le rebudgétage des temps d'attente à partir des relevés du collecteur.
---

# Recalculer le plan

Le parent pilote deux journées à Disneyland Paris — jeudi 3 septembre 2026 (Disney
Adventure World) et vendredi 4 (Parc Disneyland) — avec l'autre parent, ses deux
parents et sa fille de cinq ans. Il te parle depuis un téléphone, souvent dans
une file d'attente, une main occupée. **Il ne peut pas batailler avec toi.**

Ce skill existe parce qu'un recalcul fait de tête oublie des contraintes. Ici,
elles ne se retiennent pas : elles se lisent, s'appliquent dans un ordre, et se
vérifient par une machine avant d'être envoyées.

## La source de vérité

Ne jamais recalculer de mémoire ni depuis cette page seule. Les contraintes
vivent dans deux fichiers du dépôt `C:\chemin\vers\Disney-app` :

| Fichier | Ce qu'il contient |
| --- | --- |
| `data/plan.json` → `contraintes` | Les règles du parent en clair : priorité 1, repas, Premier Access, précédences, ordre des leviers, départ du jour 2 |
| `shared/contraintes.js` → `REGLES` | Les mêmes, exécutables. Chaque règle est une fonction qui examine un plan et rend un verdict |
| `GET /api/snapshot` → `attentes.index` | **Le réel du moment** : attente standby, panne, horaires, files virtuelles, et le Premier Access de CHAQUE attraction |

### Le Premier Access se LIT, il ne se suppose pas

Le collecteur remonte le prix et la fenêtre de retour, attraction par attraction,
dans le champ **`premierAcces`** (et non `paye` — s'être trompé de nom m'a fait
croire que la donnée n'existait pas, et inventer un prix) :

```js
premierAcces: { etat, disponible, prix, prixTexte, retourDebut, retourFin }
```

```bash
node --use-system-ca outils/serveur.mjs attentes 1
```

Deux choses à en tirer, **obligatoirement**, avant de proposer un Premier Access :

1. **Le prix réel, par personne.** Le 2 septembre : Frozen 16 €, Ratatouille 12 €,
   Raiponce 5 €. J'avais chiffré « 20 € » de tête pour les trois. Ne jamais
   annoncer un prix qui ne vient pas de ce champ, et ne jamais le multiplier par
   un nombre de personnes.
2. **La fenêtre de retour est IMPOSÉE — et INCONNUE tant qu'on n'a pas acheté.**
   Elle est attribuée à l'achat et avance au fil de la journée : acheter à
   l'ouverture peut donner un retour le matin, acheter à 16h donne un retour le
   soir. On ne la choisit jamais.

   Conséquence pour le recalcul, dans les deux sens :

   - **En planifiant, ne PAS ancrer l'étape** sur la fenêtre relevée à l'instant.
     Cette fenêtre est celle d'aujourd'hui, à cette heure-ci ; elle n'existera
     pas le jour J. S'en servir déclare la journée impossible pour rien — c'est
     ce que j'ai fait, et ça a effacé sept plans valides. Ce qu'on sait en
     planifiant : l'attente disparaît. Rien de plus.
   - **Dès que le parent a acheté**, la fenêtre devient un fait qui déplace tout,
     comme un créneau de file virtuelle. Il la saisit, on recalcule dessus :
     `--pa-retour HH:MM`.

   Le conseil à lui donner reste le même dans tous les cas : **acheter tôt**,
   c'est la seule prise qu'il ait sur l'heure de passage.

`outils/chercher-plan.mjs` lit ces deux champs et ancre l'étape sur la fenêtre.
Toute proposition faite à la main doit faire pareil.

Lis-les **avant** de proposer quoi que ce soit :

```bash
node -e "console.log(JSON.stringify(require('./data/plan.json').contraintes,null,1))"
```

## L'ordre des leviers

Jamais dans le désordre. Chaque niveau ne s'ouvre que si le précédent ne suffit pas.

1. **Réordonner** — gratuit, aucune perte. Toujours essayé en premier, jusqu'au bout.
2. **Comprimer** les FLÂNER et les REPAS jusqu'à leur plancher, jamais en dessous.
   Repas : 50 min, ou 40 seulement si le Click & Collect a servi. Flâner : 10 min.
3. **Premier Access** — payant, mais le plan tient sans rien perdre. Le parent l'a
   tranché : *mieux vaut payer que supprimer une étape*. Le créneau de retour est
   **imposé**, pas choisi ; on n'en détient qu'un à la fois ; le prix est par
   personne de plus de trois ans. Donner le prix individuel, la fenêtre, et ce
   que l'étape devient dans le nouvel ordre.
4. **Supprimer** — dernier recours, et **seulement avec l'accord explicite du parent**.
   Ne jamais le faire de sa propre initiative. Proposer, chiffrer, attendre.

## La procédure, dans l'ordre

### La section COMMENTAIRES DU PARENT passe avant tout

Le brief se termine par une section **COMMENTAIRES DU PARENT**. Tout ce qui la
precede est fabrique par l'application a partir de l'etat du moment. Cette
section-la, c'est le parent qui parle.

**Elle prime sur tout le reste du message.** En cas de contradiction avec les
donnees au-dessus, c'est lui qui a raison : il est sur place, l'application ne
l'est pas. Elle voit une file annoncee a 40 minutes, il voit qu'elle avance
vite. Elle ne voit pas sa fille fatiguer, ni la pluie arriver.

Donc : appliquer ce qu'il ecrit, ne pas le discuter, ne pas le ponderer contre
les mesures. La seule chose a lui signaler est un conflit avec une regle [DUR],
que le serveur refusera de toute facon.

Quand la section dit « (rien) », le reste du message fait foi.

**1. Lire.** Le brief collé, puis `contraintes` dans `data/plan.json`. Si le brief
ne vient pas de l'app, récupérer l'état réel :

```bash
node --use-system-ca outils/serveur.mjs brief
```

**2. Diagnostiquer avant de proposer.** Nommer la cause : une attente qui dépasse
son budget, une séance qui n'existe pas, un créneau tombé loin de l'hypothèse,
une fermeture anticipée. Un recalcul qui ne dit pas ce qui a cassé ne se vérifie pas.

**3. Chercher, ne pas deviner.** Il existe des centaines de journées possibles
— 800 pour le jour 1, rien qu'en combinant les séances de Woody, Mickey,
Arendelle et la Cavalcade. En construire UNE à l'intuition, c'est ce qui m'a
fait annoncer « rien de perdu » en plaçant un spectacle à une heure où il ne
joue pas. **Toujours lancer la recherche avant de proposer :**

```bash
node --use-system-ca outils/chercher-plan.mjs 1 --garder 5
```

Elle fabrique toutes les journées, applique les 12 règles à chacune, chiffre ce
que coûtent les survivantes et les classe. Une seconde. Options utiles :
`--tracer` (dérouler la 1re journée essayée, pour comprendre un échec),
`--local` (fichiers locaux, état vide), `--ecrire candidat.json`.

Quand elle ne rend rien, elle dit **de combien on rate et sur quoi** : c'est le
signal qu'il faut passer au levier suivant, pas s'acharner. Ses poids de score
sont en clair dans le fichier (`POIDS`) — une minute de repas vaut deux minutes
de flânerie — et se discutent avec le parent.

Ce qu'elle NE fait PAS, et qui reste à moi : basculer une étape sur l'autre
jour, choisir sur quelle attraction prendre un Premier Access, comprendre
« ma mère fatigue ». Elle optimise l'agencement, elle ne réinvente pas la
journée.

**4. Construire** le plan final en repartant des meilleures qu'elle propose, en
respectant l'ordre des leviers.

**5. Vérifier mécaniquement.** Ne jamais sauter cette étape :

```bash
node --input-type=module -e "
import fs from 'fs';
import {calculerJour} from './shared/moteur.js';
import {verifierPlan} from './shared/contraintes.js';
const ref=JSON.parse(fs.readFileSync('./data/plan.json','utf8').replace(/^\uFEFF/,''));
const p=JSON.parse(fs.readFileSync('/chemin/vers/candidat.json','utf8'));
const r=verifierPlan(p,{reference:ref,calculerJour});
console.log(r.ok?'CONFORME':'REFUSÉ');
r.violations.forEach(v=>console.log('  VIOLATION',v.titre,':',v.message));
r.avertissements.forEach(v=>console.log('  avert.   ',v.titre,':',v.message));
"
```

Une violation dure n'est pas négociable : le serveur renverra 422 et
n'enregistrera rien. Corriger, ne pas argumenter.

**6. Rendre la réponse au parent.** Format imposé, quatre points, rien d'autre.
Il lit sur un téléphone, souvent debout. Un rapport long ne se lit pas.

```
✅ Tout gardé.            (ou : ❌ X saute — et pourquoi)

EN MOINS
  50 min de flânerie · 36 min de repas

COÛT
  0 €

LA MODIF QUI CHANGE TOUT
  Premier Access Frozen, 16 €/pers → rend 58 min : repas entiers + 22 de flânerie.
  Réserve : la fenêtre de retour est imposée.

À SAVOIR
  Une ligne, seulement si c'est vraiment important.
```

Ne PAS écrire « PERDU » : le parent l'a refusé, ça ne dit pas ce que c'est. Ce dont
il s'agit, c'est du temps libre qu'on raccourcit — flâneries et repas — et
c'est ça qu'il faut nommer. L'argent est une ligne à part : ce n'est pas du
temps en moins, c'est une dépense.

Le tableau horaire complet ne vient QU'EN PLUS, après ces quatre points, et
seulement s'il est court. Ne jamais expliquer pourquoi les autres options sont
écartées si personne ne l'a demandé : le parent demandera.

**6 bis. Se tenir prêt à une autre option.** Il répondra souvent « donne-moi une
autre option ». Garder en tête, sans les rédiger : le levier suivant dans
l'ordre (payer si on a réordonné, supprimer si on a payé), l'option qui protège
ce qu'il a l'air de regretter, et celle qui coûte le moins de marche. Quand il
demande, répondre dans le même format, et dire en une ligne ce qui distingue
cette option de la précédente.

**7. Appliquer seulement après son accord** :

```bash
node --use-system-ca outils/serveur.mjs pousser-plan
```

Le serveur valide, sauvegarde l'ancien plan horodaté, recharge à chaud. Aucun
redémarrage, les téléphones suivent par le flux temps réel.

## Quand le parent énonce une nouvelle contrainte

Il dira des choses comme « le dîner on peut le sauter », « ma mère ne fait pas
ça », « on part à 19h finalement ». **Ce n'est pas une consigne pour ce
recalcul-là : c'est une règle à inscrire.**

1. L'écrire dans `data/plan.json` → `contraintes`, en clair.
2. Si elle est vérifiable, ajouter une entrée dans `REGLES` de
   `shared/contraintes.js` — avec `dure: true` si elle ne se négocie pas.
3. Pousser le plan, commiter le code.
4. Le dire au parent : elle vaudra pour tous les recalculs suivants, pas seulement
   celui-ci.

Une contrainte énoncée et non inscrite sera oubliée. C'est arrivé.

## Ce qui est déjà tranché — ne pas redemander

- **Ne rien rater** est la priorité 1. Réordonner est libre, supprimer non.
- Les **TRANSITION** restent : marche et toilettes toutes les deux à trois heures
  avec une enfant de cinq ans. Elles ne se rognent pas.
- Le prix du Premier Access s'annonce **par personne**, JAMAIS multiplié par un
  nombre de passes. Le parent décide sur le moment qui monte — la petite et deux
  adultes, tout le monde, ou personne. Écrire « 60 € » ou « × 3 », c'est
  décider à sa place. Il l'a repris deux fois.
- Les **substitutions** du plan sont validées ; proposer autre chose demande de
  vérifier que ça convient à une enfant de cinq ans qui n'aime pas les
  sensations fortes.
- Le **départ du jour 2** vise 20h00, 21h00 au maximum et seulement avec son
  accord explicite.
- Les temps d'attente affichés par Disney sont **surestimés** : 45 annoncées
  valent souvent 30 réelles. Le biais joue en faveur du départ.

## Un retrait décidé au recalcul s'écrit dans le PLAN

Le 3 septembre au soir, j'ai retiré le déjeuner et Le Pays des Contes de Fées du
jour 2 avec `POST /api/etape/:id/supprimer`. Ce point d'entrée écrit dans
`etat.etapesSupprimees` — l'état de la JOURNÉE EN COURS, que le changement de
date vide à minuit. Le 4 au matin, les deux étapes étaient revenues et la sortie
passait de 20h05 à 21h45 sans que personne ne l'ait demandé.

Un retrait accepté par le parent au recalcul est une décision de plan :

```js
etape.actif = false
etape.retrait = { motif: 'Sandwichs pendant les flâneries', le: '2026-09-03' }
// et au PUT /api/plan :
{ ...plan, suppressionsAcceptees: ['j2-e10'] }
```

L'étape reste dans `plan.json` (rien ne disparaît en silence), sort du calcul,
et apparaît dans Journée sous « Retirées volontairement » avec son motif — le
bouton « Remettre au plan » la réactive dans le plan lui-même.

Même logique pour une durée : la changer dans `etape.duree`, jamais par
`POST /api/etape/:id/duree`, qui est lui aussi vidé à minuit.

Toujours partir du plan DU SERVEUR (`GET /api/snapshot`), jamais de
`data/plan.json` local : le 3 septembre au soir, un plan du jour 2 construit sur
la copie locale a écrasé la fin réelle du jour 1 (Spider-Man, séances
d'Arendelle et de Mickey) sur le serveur.

## Le passé ne se rejoue pas

Le parent, le 3 septembre depuis le parc : **« tout ce qui est avant Raiponce c'est
n'importe quoi. Ne prends pas en compte tout ce qui est avant Raiponce pour tes
futurs recalculs. »**

Il avait raison, et c'était mesurable. La chaîne d'une journée est une **somme
de durées** : chaque étape démarre à la fin de la précédente. Les étapes déjà
faites en font partie. Or leurs horaires, après une matinée de recalculs, ne
voulaient plus rien dire — Woody démarrait avant la fin de l'arrivée, Frozen
était placée à 10h15 pour une file prise bien plus tard. Ce passé inventé
poussait tout l'après-midi, silencieusement.

Ce qui protège aujourd'hui : `etat.repriseA` (`POST /api/reprise {a:"HH:MM"}`).
Au moment où le calcul quitte les étapes faites, le curseur repart de cette
heure au lieu d'additionner un passé faux.

**À faire à chaque recalcul en cours de journée** — poser la reprise sur
l'heure réelle avant de calculer quoi que ce soit :

```bash
curl -s -X POST "$URL/api/reprise" -H "x-cle: $CLE" -H 'content-type: application/json' -d '{"a":"14:35","jour":1}'
```

Deux conséquences pour le recalcul lui-même :

- **Ne jamais lire les horaires des étapes faites** comme s'ils décrivaient la
  journée. Ils disent ce que le plan croyait, pas ce qui s'est passé.
- **Ne jamais s'en servir pour mesurer.** Une attente réellement subie se lit
  dans les relevés du collecteur, jamais dans la durée écrite d'une étape cochée.

C'est une heure ENREGISTRÉE, pas l'horloge lue au vol : le vérificateur de
contraintes doit rendre le même verdict sur le même plan à n'importe quelle
heure, sinon un plan accepté à 14h devient refusé à 14h05.

## Les pièges qui ont déjà coûté

- **Une escapade ne comprime rien.** Le groupe continue le plan sans le parent. La
  limite de retour est la première étape qu'il ne peut pas rater — pas la
  prochaine ancre.
- **Un créneau de file virtuelle est fixe.** Obtenu à 17h00, il déplace tout ; le
  plan peut devenir incohérent, et le moteur le signale par un chevauchement.
- **L'heure du clic n'entre jamais dans le calcul.** le parent n'appuie pas au moment
  exact où une activité finit. Le seul signal fiable est l'horloge comparée au
  créneau prévu.
- **Vérifier les horaires de fermeture** avant de déplacer une étape en soirée :
  Main Street Vehicles ferme à 14h45, Thunder Mesa à 17h00, PhilharMagique à 17h30.
- **Une séance doit exister.** Woody n'a que huit séances, la dernière à 13h50,
  identiques les 1er et 2 septembre.

## Le rebudgétage

Quand il s'agit de recaler les budgets d'attente plutôt que l'ordre :

```bash
node --use-system-ca outils/serveur.mjs attentes 1
```

Les relevés archivés sont sur le serveur, dans `data/attentes/*.jsonl`, et
`backend/lib/historique.js` en calcule les moyennes horaires. Comparer
`attenteIncluse` de chaque étape à la moyenne mesurée **à l'heure où l'étape est
placée**, pas à la moyenne du jour : Big Thunder fait 47 min à 9h et 100 l'après-midi.
Placer une attraction dans son creux vaut mieux que lui rallonger son budget.
