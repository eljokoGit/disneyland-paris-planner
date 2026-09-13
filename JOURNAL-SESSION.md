# Journal de la session — 30 août au 2 septembre 2026

Tout ce qui a été discuté et construit, dans l'ordre. Sert de mémoire commune :
ce qui a été décidé, ce qui a été essayé et écarté, et pourquoi.

---

## 1. Le point de départ

Le parent fournit un brief et un fichier Excel : `Disneyland-Paris-plan-2-jours_18.xlsx`.
Deux journées à piloter — **jeudi 3 septembre 2026** à Disney Adventure World,
**vendredi 4** au Parc Disneyland. Le groupe : le parent, l'autre parent, ses deux
parents, sa fille de cinq ans (fan de Frozen et des
princesses, ne veut pas de sensations fortes).

Le modèle de données est posé dès le départ, et n'a pas bougé depuis :

- Une étape **ancrée** démarre à `paramètre − avance`. Elle ne bouge pas.
- Une étape **flottante** démarre à la fin de la précédente.
- Un **contrôle** compare la fin de la précédente au début de l'ancre : CHEVAUCHEMENT, battement, ou pile poil.
- Les **TRANSITION** et les **FLÂNER** sont des amortisseurs délibérés, jamais la première chose qu'on coupe.

Le plan a été vérifié contre l'Excel : 18 étapes le jour 1, 20 le jour 2,
mêmes durées, mêmes titres, même ordre, mêmes heures calculées.

## 2. Le déploiement, première tentative

Le parent rappelle que l'application doit tourner sur son serveur Linux, avec
Syncthing. Reproche justifié : j'étais parti trop vite, sans lui dire où j'en
étais. Consigne retenue — **avancer étape par étape, sans jargon**.

## 3. L'écran « Maintenant » simplifié

Trop d'informations. Le parent veut l'activité en cours, et la suivante quand il
marque « terminé ». Surtout :

> « j'ai l'impression que tu prends en compte l'heure où je clique sur Terminé
> — je fais pas ça, je vais jamais penser à cliquer EXACTEMENT quand on finit »

Corrigé une première fois, puis mal à nouveau. Il a fallu qu'il le redise :
**« encore une fois : ne jamais prendre l'heure du clic »**. L'heure du clic a
été retirée entièrement du calcul. C'est aujourd'hui un commentaire en tête du
moteur, pour que ça ne revienne pas.

Ajoutés dans la foulée : bandeau « dans les temps », retour en arrière, note
dépliable, actions à ne pas rater, distinction FAIT / RATÉ pour les vagues,
section prérequis, possibilité de déclarer une attraction annulée.

## 4. Les escapades solo

Le parent donne une spécification complète pour le jour 1 : quatre créneaux fixes
vers Avengers Assemble Flight Force, avec ce qu'il accepte de rater à chaque fois.

Le jour 2 viendra plus tard, avec une difficulté supplémentaire — **le groupe
change à chaque escapade** : Big Thunder avec le grand-père, Pirates avec ses deux
parents, Hyperspace Mountain seul. Ni Big Thunder ni Pirates n'ont de file
Single Rider, ce que l'API a confirmé.

## 5. Les plans des parcs

Le parent fournit deux images ; je refuse les premières — elles sont antérieures à
2014, sans World of Frozen ni Adventure Way. Il en fournit de justes. Pins
calibrés, chemins en pointillés entre les zones, escapades dans une couleur
distincte.

## 6. Les temps d'attente en direct

Intégration de **ThemeParks.wiki** : sondage toutes les cinq minutes côté
serveur uniquement, `If-None-Match` et 304, correspondance attraction par
attraction inscrite dans `plan.json`.

Le parent demande un **service séparé** pour que la collecte ne s'arrête pas pendant
qu'on travaille sur l'app. Puis un système qui s'assure qu'il tourne. Puis un
artefact pour visualiser les moyennes horaires.

**Ce que les mesures ont révélé** :

| | budget du plan | mesuré |
| --- | --- | --- |
| Frozen Ever After | 35 min | 56 à 8h, 66 à 9h, **72 à 10h** |
| Ratatouille | 30 min | 45 à 10h, **52 à 16h** |
| Big Thunder Mountain | — | 47 à 9h, 75 à 10h, **100 l'après-midi** |
| Crush's Coaster | — | jamais sous **63**, 77 en moyenne |
| Tower of Terror | — | **19 en moyenne**, 5 au creux |

## 7. Le Premier Access

Question du parent sur les files payantes. Découverte qui change tout : le
créneau de retour est **imposé, pas choisi**. Frozen Ever After à 16 € proposait
un retour à 19h25 — le pass ne rapproche pas l'attraction, il la déplace.

Le parent tranche : **mieux vaut payer que supprimer une étape**. Inscrit dans les
contraintes, avec l'ordre des leviers — réordonner, comprimer, payer, supprimer
en dernier recours et seulement avec son accord.

## 8. Le recalcul automatique : la conception

Le parent doute qu'un moteur puisse trancher seul :

> « entre les files d'attente et les réservations aléatoires, ça va être
> complètement impossible de s'en tenir au plan »

Il propose lui-même la bonne architecture : un bouton qui copie dans le
presse-papier un **brief** décrivant la situation, qu'il me colle pour que je
recalcule. L'app constate et chiffre ; elle ne décide pas.

Critère posé : le brief doit me permettre de répondre **sans une seule question**.

## 9. Ce qui manquait pour recalculer

Le parent demande que je rassemble **toutes** les données nécessaires. Produits :

- Les **temps de marche** entre zones, 28 paires par parc, estimés à la main
  sur les plans et calibrés sur ses propres transitions. Une calibration par
  distance à vol d'oiseau a été essayée puis rejetée : elle donnait 13 minutes
  pour un trajet connu de 8.
- Les **substitutions** acceptées : 5 le jour 1, 11 le jour 2, tirées de son
  Excel, jamais ce qu'il écarte pour intensité ou peur.
- Ses réponses à quatre questions : Premier Access, repas, départ du jour 2,
  substitutions — toutes inscrites dans `contraintes`.
- Les **précédences** : le maquillage avant les princesses, pour les photos.

## 10. Les files virtuelles

Le collecteur ne gardait que les `ATTRACTION`. Or **les rencontres de
personnages sont typées SHOW** par l'API : les six files virtuelles étaient
invisibles depuis le début, dans l'app comme dans les archives.

Corrigé. Puis mise en place des alertes par mail — client SMTP écrit à la main,
sans dépendance, sur le serveur mail du parent (`mail.exemple.com`, port
587, STARTTLS, AUTH LOGIN).

**Le spam.** Deux collecteurs envoyaient chacun leurs mails, et chaque
reconstruction du conteneur effaçait la mémoire de ce qui avait déjà été
annoncé. Corrigé par un drapeau `MAIL_ACTIF` qui désigne un seul expéditeur, et
une mémoire écrite sur disque.

**Le filtre, deux fois de trop.** J'ai voulu écarter des « fausses » ouvertures
en me fondant sur l'heure de début de la fenêtre de retour. Le parent a vérifié sur
place : à 17h36 la file était fermée, à 18h16 elle était ouverte — **avec la
même fenêtre dans les deux cas**. Ce champ ne distingue rien. Filtre retiré,
définitivement.

Règle finale, posée par le parent : **une file ouverte, un mail. Rien d'autre.**

## 11. Le déploiement, pour de bon

Inspection du serveur avant de rien inventer. Convention trouvée :
`<projet>.exemple.com`, un enregistrement DNS par sous-domaine vers
203.0.113.10, un vhost nginx vers `127.0.0.1:30xx`, un certificat certbot.

Choix du parent : **disney.exemple.com**, accessible depuis internet,
protégé par un lien secret.

Mis en place : DNS, archive du code, `.env`, conteneurs Docker, vhost nginx,
certificat Let's Encrypt, vérification que le flux temps réel traverse nginx
sans être bufferisé.

## 12. Les incidents de déploiement

Trois blocages silencieux, tous liés à la même chaîne.

**Un conflit Syncthing a écrasé du code.** Le fichier de conflit contenait
l'**ancienne** version de `backend/server.js` ; je l'ai promue en supposant le
contraire. Trois endpoints perdus, réécrits. Leçon inscrite : un fichier
`.sync-conflict-*` ne contient pas forcément la bonne version.

**Un conflit suspend la reconstruction, sans le dire.** Le script se met en
pause — c'est voulu — mais il adoptait quand même la nouvelle empreinte : une
fois le conflit résolu, le changement restait sur le carreau. Corrigé.

**`plan.json` avait deux chemins** — l'API et Syncthing. Deux écrivains, donc un
conflit à chaque envoi. Il ne passe plus que par l'API.

**Le serveur avait un vieux `.stignore`** excluant tout `data/`, vestige d'une
conception à deux dossiers abandonnée. C'est pourquoi une coupure des mails
annoncée n'est jamais arrivée. Corrigé des deux côtés.

**Les fins de ligne.** Mes éditions depuis Windows avaient converti
`watch-and-rebuild.sh` en CRLF. Bash le refusait, systemd le relançait toutes
les dix secondes : plus aucune reconstruction pendant seize heures, sans le
moindre signal. Corrigé, et verrouillé par un `.gitattributes`.

Le parent a refusé l'accès SSH, avec raison :

> « vu comment t'arrête pas de faire de la merde je vais pas te donner accès en
> ssh à mon serveur »

Conséquence assumée : je vérifie désormais chaque déploiement avec
`outils/verifier-deploiement.mjs` au lieu d'annoncer qu'il est fait.

## 13. Les erreurs de conception qu'il a corrigées

**Le bouton qui proposait l'absurde.** L'app proposait de supprimer Ratatouille
— 55 minutes — pour rattraper 4 minutes de décalage, alors que l'avance de 25
minutes du spectacle absorbait tout. Les boutons n'apparaissent plus que si
l'avance est réellement épuisée.

**Le chiffre sans son hypothèse.** « Vous y seriez avec 21 min d'avance » est une
projection qui suppose que chaque étape tient sa durée. L'app affiche maintenant
le budget prévu, le temps réellement affiché, et l'écart.

**La limite d'escapade, calculée à l'envers.** Je cherchais la prochaine ancre et
tombais sur Woody — alors que Woody figure précisément dans ce que le créneau
suivant propose de rater. J'annonçais un retour à 18h05 quand la vraie limite
était 21h05. Le parent l'a vu immédiatement :

> « mon escapade pourrait faire de 17h25 à 19h40 voire + que ça !!!! car ce sont
> toutes des activités que j'étais ok pour rater »

**Une escapade ne comprime rien** : le groupe continue le plan. La seule question
est quelle étape il ne peut pas rater.

**Les créneaux suivants proposés après coup.** Les quatre créneaux du jour 1
visent la même attraction : ce sont quatre occasions de la faire une fois. Une
fois utilisée, les autres disparaissent.

**L'onglet Résas**, qu'il a fallu redire trois fois : tous les événements
réservables avec un bouton d'alerte, puis les mêmes avec la saisie de l'heure
obtenue. C'est fait.

**Trop d'informations sur la carte d'escapade** : sept blocs pour une décision
qui tient en une ligne. Réduite à trois lignes, le reste derrière « Détails ».

## 14. Woody

L'API expose deux entités distinctes, ce que la capture de l'application
officielle a confirmé :

| | accès |
| --- | --- |
| **Meet Woody** | séances fixes, aucune réservation |
| **Rencontre avec un Personnage de Toy Story** | file virtuelle, aucune séance |

Les deux vagues de réservation du plan ne réservaient donc rien. Supprimées.

**Le problème de fond, non résolu** : les séances de Woody s'arrêtent à **13h50**,
identiques le 1er et le 2 septembre. L'étape est placée à 18h40. Elle doit être
replacée — ce qui déplace le déjeuner ou la Cavalcade. Fait partie du chantier
de rebudgétage.

## 15. Ce qui a été construit pour tenir les contraintes

Après que le parent a exprimé sa crainte — *« j'ai l'impression que tu ne prends pas
toutes les contraintes en compte quand tu recalcules »* — deux garde-fous :

**`shared/contraintes.js`** — douze règles, chacune une fonction qui examine un
plan. Dix sont dures : `PUT /api/plan` renvoie 422 et n'enregistre rien.
Vérifié sur sept violations délibérées, toutes refusées.

**Le skill `recalcul-plan`** — se charge dès qu'un recalcul commence, lit les
contraintes depuis les fichiers, impose l'ordre des leviers, exige la
vérification mécanique avant d'écrire, et dit quoi faire quand le parent énonce une
contrainte nouvelle : l'inscrire, pas seulement l'appliquer une fois.

Le **brief** transmet désormais les douze règles, le profil du groupe et la
matrice de marche entière — sans elle je déplaçais des étapes sans savoir ce
que coûtait le trajet.

## 16. La revue

Neuf lecteurs sur neuf dimensions, 224 constats bruts, arrêtée avant la phase de
contre-expertise pour préserver le quota. Quatorze constats vérifiés par lecture
directe et rendus dans un rapport séparé.

Corrigés depuis : les fins de ligne, les alertes de file du parc 2, le renvoi
vers un écran de saisie qui n'existe plus.

Restent ouverts : les boutons rétrécis (corrigé partiellement), « Obtenu » qui
n'enregistre pas l'heure, la file hors ligne qui se bloque sur une erreur
serveur, la documentation périmée.

---

## L'état au 2 septembre, 11h00

**En service** : `disney.exemple.com`, deux conteneurs, collecteur autonome
calé à h+1, alertes mail, écriture du plan à distance, déploiement automatique
en une vingtaine de secondes depuis le PC.

**Le PC du parent n'est plus nécessaire** au fonctionnement — seulement pour que
je modifie le code ou le plan.

**Reste à faire avant jeudi** :

1. Le **rebudgétage** avec deux jours de relevés — mercredi soir. Frozen, Woody
   et les budgets d'attente bougent ensemble.
2. Ouvrir l'app sur les **cinq téléphones** avec le lien complet, avant d'être
   en 4G dans le parc.
3. Décider des corrections restantes du rapport de revue.
4. Vendredi matin : basculer sur le jour 2 — ce n'est pas automatique.
