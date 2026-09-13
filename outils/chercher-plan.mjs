// RECHERCHE DE PLAN — essayer toutes les journées possibles, garder les meilleures.
//
//   node --use-system-ca outils/chercher-plan.mjs 1
//   node --use-system-ca outils/chercher-plan.mjs 1 --local
//   node --use-system-ca outils/chercher-plan.mjs 1 --garder 5
//   node --use-system-ca outils/chercher-plan.mjs 1 --ecrire candidat.json
//
// POURQUOI CET OUTIL EXISTE
//
// Jusqu'ici je construisais UNE journée à la main, à l'intuition, et je la
// proposais. Sur le jour 1 il en existe 800 (les séances de Woody, de Mickey,
// d'Arendelle et de la Cavalcade se combinent). J'en essayais une. Il m'est
// arrivé de me contredire — d'annoncer « rien de perdu » en plaçant un
// spectacle à une heure où il ne joue pas.
//
// Ici, la machine les fabrique toutes, applique les 12 règles de
// shared/contraintes.js à chacune, chiffre ce que coûtent les survivantes, et
// les classe. Je n'ai plus à affirmer qu'une option est la meilleure : le
// classement le montre.
//
// CE QUE L'OUTIL NE FAIT PAS
//
// Il optimise l'AGENCEMENT du plan existant. Il ne réordonne pas les zones
// (ça demanderait de fabriquer les transitions, et une transition ne se rogne
// pas), il ne bascule rien sur l'autre jour, il n'invente pas de Premier
// Access. Ces idées-là restent à moi ou au parent.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculerJour, minutesVersHm, hmVersMinutes, planchersDe } from '../shared/moteur.js'
import { verifierPlan } from '../shared/contraintes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.join(__dirname, '..')

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2)
const jourDemande = Number(args.find((a) => /^[12]$/.test(a)) || 1)
const local = args.includes('--local')
const lire = (nom, defaut) => {
  const i = args.indexOf(nom)
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut
}
const GARDER = Number(lire('--garder', 5))
const BUDGET_MS = Number(lire('--budget', 3000))
const ECRIRE = lire('--ecrire', null)
const DETAIL = Number(lire('--detail', 1))   // dérouler la n-ième option, pas seulement la 1re
// Le parent tranche : « supprime les Tapis Volants et prends le pass Frozen ». On
// ne cherche plus, on applique et on chiffre.
const SANS = (lire('--sans', '') || '').split(',').filter(Boolean)
const PA_IMPOSE = lire('--pa', null)
// La fenêtre de retour n'est connue QU'APRÈS l'achat. Tant qu'on planifie, elle
// n'existe pas : on ne peut que la subir plus tard. `--pa-retour HH:MM` sert
// une fois qu'on la connaît vraiment, pour recaler le plan dessus.
const PA_RETOUR = lire('--pa-retour', null)
// LA MARGE. Les attentes mesurees sont celles ANNONCEES par Disney, et Disney
// surestime : 45 annoncees valent souvent 30 reelles. Une journee qui rate de
// quelques minutes sur le papier passe donc en vrai. Le parent l'a tranche :
// « si un plan ne rentre pas a cause de 15 min, laisse-le passer ».
const MARGE = Number(lire('--marge', 15))
// CLICK & COLLECT. Commander par l'appli fait tomber le plancher du repas de 50
// a 40 min, et surtout ca renverse l'ordre de sacrifice : sans lui on rogne les
// flaneries d'abord, avec lui c'est le repas qui cede en premier. Le parent l'a
// tranche : « 85 min de diner c'est trop, 70 aussi, on va faire les click &
// collect » — donc les minutes gagnees vont a la flanerie, pas l'inverse.
const CLICK_COLLECT = args.includes('--click-collect')
// LES REPAS SONT UNE VARIABLE, PAS UN ACQUIS. Le plan portait 80 min de dejeuner
// et 85 de diner parce que personne ne les avait remis en cause. Le parent a
// tranche : « repas 1h max, 45 min idealement ». On les pose donc a 45 des le
// depart — ce qui rend une heure a la journee — et le plancher (40 avec Click &
// Collect, 50 sans) reste la borne basse si la journee se tend.
const REPAS_CIBLE = Number(lire('--repas', 45))
const REPAS_MAX = Number(lire('--repas-max', 60))
const TRACER = args.includes('--tracer')   // dérouler la 1re journée essayée, pour comprendre un échec

// ------------------------------------------------------- plan et état réels
// Par défaut on prend l'état du SERVEUR : ce qui est fait, les créneaux
// obtenus, les ancres décrochées. Recalculer sur un état vide donnerait un
// plan théorique sans rapport avec la journée en cours.
async function contexte() {
  if (local) {
    const plan = JSON.parse(fs.readFileSync(path.join(RACINE, 'data/plan.json'), 'utf8').replace(/^\uFEFF/, ''))
    return { plan, etat: {}, attentes: {}, source: 'fichiers locaux, état vide' }
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(RACINE, '.serveur.json'), 'utf8').replace(/^\uFEFF/, ''))
  const base = cfg.url.replace(/\/$/, '')
  const s = await fetch(base + '/api/snapshot', { headers: { 'x-cle': cfg.cle } }).then((r) => r.json())
  // `--plan-local` : essayer un plan modifie ici AVANT de le pousser, tout en
  // gardant l'etat reel du serveur (etapes faites, creneaux obtenus). C'est le
  // mode normal quand on vient d'ajouter une contrainte.
  if (args.includes('--plan-local')) {
    const local = JSON.parse(fs.readFileSync(path.join(RACINE, 'data/plan.json'), 'utf8').replace(/^﻿/, ''))
    return {
      plan: local, etat: s.etat, attentes: (s.attentes && s.attentes.index) || {},
      source: 'plan LOCAL (non pousse) + etat reel du serveur',
    }
  }
  return {
    plan: s.plan,
    etat: s.etat,
    attentes: (s.attentes && s.attentes.index) || {},
    source: `serveur, état réel (${Object.keys(s.etat.etapesFaites || {}).length} étapes faites)`,
  }
}

// ------------------------------------------------------- l'espace à explorer
// Les seuls choix VRAIMENT libres : sur quelle séance ancrer chaque spectacle.
// Une séance relevée sur place fait foi ; sinon on prend celles du plan.
function seancesPossibles(plan, jour) {
  const prefixe = 'j' + jour + '_'
  const axes = []
  for (const p of plan.parametres) {
    if (!p.id.startsWith(prefixe)) continue
    const liste = (p.seances && p.seances.length ? p.seances
      : (p.seancesRelevees && p.seancesRelevees.heures) || []).filter((h) => hmVersMinutes(h) != null)
    if (liste.length > 1) axes.push({ id: p.id, libelle: p.libelle || p.id, valeurs: liste })
  }
  return axes
}

function* combinaisons(axes) {
  const n = axes.length
  if (!n) { yield {} ; return }
  const compteur = new Array(n).fill(0)
  for (;;) {
    const c = {}
    for (let i = 0; i < n; i++) c[axes[i].id] = axes[i].valeurs[compteur[i]]
    yield c
    let i = n - 1
    while (i >= 0 && ++compteur[i] >= axes[i].valeurs.length) { compteur[i] = 0; i-- }
    if (i < 0) return
  }
}

// ------------------------------------------------------------- la réparation
// Levier 2 de la méthode : comprimer les FLÂNER et les REPAS, jamais sous leur
// plancher, et dans l'ordre de sacrifice que le parent a fixé. On ne touche ni aux
// transitions (marche + toilettes) ni aux attractions.
// `jour.ordreSacrifice` ne sert PAS ici : il dit quelles étapes SUPPRIMER en
// dernier recours (Tapis Volants, puis Ratatouille), pas lesquelles raccourcir.
// L'ordre de compression est le sien propre : les flâneries d'abord, les repas
// ensuite. Dix minutes de promenade en moins se rattrapent ; dix minutes de
// déjeuner en moins, à cinq au comptoir avec une enfant de cinq ans, non.
//
// Et surtout : on ne comprime QUE ce qui se trouve AVANT le chevauchement.
// Raccourcir le dîner ne fera jamais arriver le groupe plus tôt à la Cavalcade
// de 15h10. C'est ce qui laissait échouer des journées à 7 minutes près.
function comprimer(plan, jour, etat, attentes, besoin, avantId) {
  const j = plan.jours.find((x) => x.numero === jour)
  const planchers = planchersDe(plan, { ...etat, clickCollect: CLICK_COLLECT })
  const limite = avantId ? j.etapes.findIndex((e) => e.id === avantId) : j.etapes.length
  const utiles = j.etapes.slice(0, limite < 0 ? j.etapes.length : limite)
  const flaneries = utiles.filter((e) => e.type === 'flaner').map((e) => e.id)
  const repas = utiles.filter((e) => e.type === 'repas').map((e) => e.id)
  const ordre = CLICK_COLLECT ? [...repas, ...flaneries] : [...flaneries, ...repas]
  let reste = besoin
  const retire = { flaner: 0, repas: 0 }
  for (const id of ordre) {
    if (reste <= 0) break
    const e = j.etapes.find((x) => x.id === id)
    if (!e || planchers[e.type] == null) continue
    const marge = Math.max(0, (e.duree || 0) - planchers[e.type])
    const pris = Math.floor(Math.min(marge, reste) / 5) * 5   // on reste sur des multiples de 5
    if (pris > 0) { e.duree -= pris; reste -= pris; retire[e.type] = (retire[e.type] || 0) + pris }
  }
  return { retire, manque: reste }
}

// ------------------------------------------------------- le repositionnement
//
// LE POINT QUI M'AVAIT ÉCHAPPÉ : une ancre FIXE une étape à une heure, elle ne
// la DÉPLACE PAS dans la liste. Ancrer Woody sur la séance de 13h20 sans
// bouger l'étape la laissait en 15e position tout en l'épinglant à 13h10 : un
// chevauchement de 330 minutes, et 800 journées déclarées impossibles.
//
// Choisir une séance et ordonner les étapes ne sont donc pas deux problèmes
// séparés. Quand une ancre change d'heure, son étape doit changer de place.
//
// La règle : chaque étape reçoit une heure de référence — son heure d'ancre si
// elle en a une, sinon celle qu'elle occupait dans le plan d'origine — et la
// journée se réordonne là-dessus. Les étapes déjà faites ne bougent jamais.
function reordonner(plan, jour, etat, attentes, calcOrigine) {
  const j = plan.jours.find((x) => x.numero === jour)
  const faites = etat.etapesFaites || {}
  const departOrigine = {}
  for (const e of calcOrigine.etapes) departOrigine[e.id] = e.debut

  const transitions = j.etapes.filter((e) => e.type === 'transition')
  const corps = j.etapes.filter((e) => e.type !== 'transition')

  const heureDe = (e) => {
    if (e.ancre && !e.ancreSiCreneau) {
      const par = plan.parametres.find((x) => x.id === e.ancre.parametre)
      const h = par && hmVersMinutes(par.valeur)
      if (h != null) return h - (e.ancre.avance || 0)
    }
    return departOrigine[e.id] ?? 0
  }

  const finies = corps.filter((e) => faites[e.id])
  const aPlacer = corps.filter((e) => !faites[e.id])
  const matriceZones = (j.marche && j.marche.matrice) || {}
  const distance = (a, b) => (a && b && matriceZones[a] && matriceZones[a][b]) || 0
  const estAncree = (e) => !!(e.ancre && !e.ancreSiCreneau)

  // LE SQUELETTE : les étapes déjà faites, puis les ancres dans l'ordre de leur
  // heure. Ce sont les points fixes de la journée, ceux qu'on ne négocie pas.
  // L'arrivée ouvre la journée, la sortie la ferme. Ce sont des bornes, pas des
  // étapes qu'on déplace : sans ça, l'insertion au moindre coût plaçait la
  // SORTIE DU PARC à 18h37 avec quatre étapes derrière elle.
  const borneDebut = aPlacer.filter((e) => e.type === 'arrivee')
  const borneFin = aPlacer.filter((e) => e.type === 'sortie')
  const fixe = new Set([...borneDebut, ...borneFin].map((e) => e.id))
  const squelette = [
    ...finies,
    ...borneDebut,
    ...aPlacer.filter((e) => estAncree(e) && !fixe.has(e.id)).sort((a, b) => heureDe(a) - heureDe(b)),
    ...borneFin,
  ]
  const finDeSequence = () => sequence.length - borneFin.length

  // LES AUTRES s'insèrent au MOINDRE COÛT DE MARCHE. Trier par l'heure ne
  // suffit pas : une flânerie dont l'heure d'origine tombe entre deux
  // spectacles vient s'y glisser même si elle est à l'autre bout du parc, et on
  // paie l'aller-retour. C'est ce qui faisait échouer la meilleure journée à
  // 8 minutes près — la promenade s'intercalait entre Arendelle et Woody au
  // lieu de rejoindre le déjeuner, dans sa propre zone.
  //
  // Garde-fou : une étape ne s'éloigne pas de plus de trois heures de l'heure
  // qu'elle occupait, sinon le déjeuner finirait au petit matin.
  const fenetreRepas = ((plan.contraintes && plan.contraintes.repas) || {}).fenetre || null
  const bornesRepas = fenetreRepas
    ? [hmVersMinutes(fenetreRepas[0]), hmVersMinutes(fenetreRepas[1])]
    : null
  const fenetreDiner = ((plan.contraintes && plan.contraintes.repas) || {}).fenetreDiner || null
  const bornesDiner = fenetreDiner
    ? [hmVersMinutes(fenetreDiner[0]), hmVersMinutes(fenetreDiner[1])]
    : null

  // LA PLACE DISPONIBLE, PAS SEULEMENT LA MARCHE.
  //
  // Ranger au moindre coût de marche entassait quatre attractions avant la
  // parade de 11h : 105 minutes d'étapes dans 90 minutes de créneau. La marche
  // était optimale, la journée impossible. Il faut donc raisonner en CRÉNEAUX :
  // entre deux ancres il y a un nombre de minutes fini, et on n'y met que ce
  // qui rentre.
  // L'arrivée est ancrée ET c'est une borne : sans l'exclure ici, elle est
  // placée deux fois.
  const ancres = squelette.filter((e) => estAncree(e) && !fixe.has(e.id) && !faites[e.id])
  const departPremier = finies.concat(borneDebut).reduce(
    (t, e) => Math.max(t, (departOrigine[e.id] ?? 0) + (e.duree || 0)), 0)

  const planchers = planchersDe(plan, { ...etat, clickCollect: CLICK_COLLECT })
  const zoneDepart = (finies.concat(borneDebut).slice(-1)[0] || {}).zone

  const creneaux = []
  let bord = departPremier
  for (const a of ancres) {
    creneaux.push({ debut: bord, fin: heureDe(a), avant: a, contenu: [] })
    bord = heureDe(a) + (a.duree || 0)
  }
  // Le dernier créneau se ferme à la FERMETURE DU PARC. Sans cette borne il
  // était infini, donc toujours candidat : le dîner s'y retrouvait à 22h10,
  // après la fermeture, au lieu que la journée soit franchement déclarée
  // infaisable.
  const fermeture = hmVersMinutes(j.fermeture) ?? 1440
  creneaux.push({ debut: bord, fin: fermeture, avant: null, contenu: [] })

  // Ce qu'une étape coûte VRAIMENT dans un créneau : sa durée, plus le détour
  // qu'elle impose. Une flânerie de 10 min à l'autre bout du parc coûte 38
  // minutes, pas 10 — c'est ce qui la faisait tenir sur le papier entre
  // Arendelle et Woody, et rater Woody de 8 minutes dans les faits.
  const zoneEntree = (c, i) => (i > 0 && creneaux[i - 1].avant ? creneaux[i - 1].avant.zone : zoneDepart)
  const zoneSortie = (c) => (c.avant ? c.avant.zone : null)
  const detour = (c, i, e) => {
    const a = c.contenu.length ? c.contenu[c.contenu.length - 1].zone : zoneEntree(c, i)
    const b = zoneSortie(c)
    return distance(a, e.zone) + (b ? distance(e.zone, b) - distance(a, b) : 0)
  }
  const capacite = (c, i) => {
    const pris = c.contenu.reduce((n, e) => n + (planchers[e.type] != null ? planchers[e.type] : (e.duree || 0)), 0)
    // Le trajet d'ENTRÉE dans le créneau et celui de SORTIE vers l'ancre
    // suivante comptent autant que ceux du milieu. Les oublier surestimait la
    // place de 20 minutes et faisait rater Woody de 7.
    const zones = [zoneEntree(c, i), ...c.contenu.map((e) => e.zone), zoneSortie(c) || zoneEntree(c, i)]
    let marche = 0
    for (let k = 1; k < zones.length; k++) {
      const d = distance(zones[k - 1], zones[k])
      if (d > 0) marche += d + 5   // les TRANSITION ajoutent une marge toilettes
    }
    return c.fin - c.debut - pris - marche
  }

  // Les repas gardent leur ordre : le dîner vient après le déjeuner. Évident
  // pour un humain, invisible pour la machine — rien dans les contraintes ne
  // l'écrivait, parce que jusqu'ici rien ne réordonnait les repas. La recherche
  // proposait un dîner à 11h55 et un déjeuner à 14h01.
  let dernierRepas = -1

  for (const e of aPlacer.filter((x) => !estAncree(x) && !fixe.has(x.id))) {
    const t = heureDe(e)
    // Le plancher, pas la durée pleine : une flânerie de 50 min qui rentre en
    // 10 rentre quand même — la compression fera le reste.
    const besoin = planchers[e.type] != null ? planchers[e.type] : (e.duree || 0)
    const candidats = creneaux
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => {
        if (capacite(c, i) < besoin + detour(c, i, e)) return false
        if (e.type === 'repas' && i < dernierRepas) return false
        // Même critère que la règle `repas-fenetre` : c'est le DÉJEUNER qui a
        // une fenêtre, pas le dîner. Le repérer par son identifiant marchait
        // sur le jour 1 et laissait le jour 2 déjeuner à 17h35.
        if (e.type === 'repas' && bornesRepas && /DÉJEUNER/i.test(e.titre)) {
          if (c.debut > bornesRepas[1] || c.fin < bornesRepas[0]) return false
        }
        if (e.type === 'repas' && bornesDiner && /DÎNER/i.test(e.titre)) {
          if (c.debut > bornesDiner[1] || c.fin < bornesDiner[0]) return false
        }
        return true
      })
    // À capacité suffisante, on choisit le créneau le plus proche de l'heure
    // d'origine de l'étape, puis celui qui coûte le moins de marche.
    // On choisit d'abord sur la MARCHE, l'heure d'origine ne servant qu'à
    // départager. L'inverse envoyait la promenade se caler entre deux
    // spectacles éloignés, simplement parce que son heure d'origine tombait là.
    const proximite = (c) => Math.abs((c.debut + Math.min(c.fin, c.debut + 240)) / 2 - t)
    // EPARPILLER LE TEMPS LIBRE. Ranger au plus court en marche entassait les
    // flaneries et les repas au meme endroit : 25 + 30 de promenade puis 85 de
    // diner, deux heures vingt sans rien voir, alors que la matinee n'avait pas
    // une minute de libre. Une pause vaut mieux repartie que groupee, donc un
    // creneau qui contient deja du temps libre devient moins attirant.
    const libre = (e2) => e2.type === 'flaner' || e2.type === 'repas'
    const entasse = (c) => (libre(e) ? c.contenu.filter(libre).length * 6 : 0)
    candidats.sort((a, b) =>
      ((detour(a.c, a.i, e) + entasse(a.c)) - (detour(b.c, b.i, e) + entasse(b.c)))
      || (proximite(a.c) - proximite(b.c)))
    // Aucun créneau ne convient : la journée est infaisable, il ne faut PAS
    // poser l'étape au hasard. Poser le déjeuner dans le dernier créneau le
    // faisait commencer à 22h20 et transformait un échec franc en journée
    // absurde présentée comme « la plus proche ».
    if (!candidats.length) {
      // Dire QUI ne rentre pas : sans ça, la recherche rend « aucune journee
      // conforme » sans le moindre indice, et on cherche a l aveugle.
      dernierBlocage = { etape: e.titre, type: e.type, besoin, creneaux: creneaux.length }
      return false
    }
    candidats[0].c.contenu.push(e)
    if (e.type === 'repas') dernierRepas = candidats[0].i
  }

  // Dans chaque créneau, l'ordre se décide par la géographie : on part de la
  // zone précédente et on rejoint celle de l'ancre suivante.
  const rangerParZone = (liste, depart, arrivee) => {
    if (liste.length < 2) return liste
    const reste = liste.slice()
    const sortie = []
    let ici = depart
    while (reste.length) {
      let meilleur = 0
      let cout = Infinity
      for (let k = 0; k < reste.length; k++) {
        const c = distance(ici, reste[k].zone)
          + (reste.length === 1 ? distance(reste[k].zone, arrivee) : 0)
        if (c < cout) { cout = c; meilleur = k }
      }
      ici = reste[meilleur].zone || ici
      sortie.push(reste.splice(meilleur, 1)[0])
    }
    return sortie
  }

  const sequence = [...finies, ...borneDebut]
  let zoneCourante = (sequence[sequence.length - 1] || {}).zone
  for (const c of creneaux) {
    const range = rangerParZone(c.contenu, zoneCourante, c.avant ? c.avant.zone : zoneCourante)
    sequence.push(...range)
    if (range.length) zoneCourante = range[range.length - 1].zone || zoneCourante
    if (c.avant) { sequence.push(c.avant); zoneCourante = c.avant.zone || zoneCourante }
  }
  sequence.push(...borneFin)

  const restantes = sequence.slice(finies.length)

  // Les transitions se replacent aux changements de zone. Elles ne se
  // suppriment pas et ne raccourcissent pas (règle `transitions-intactes`) :
  // on les réutilise dans l'ordre, en allongeant si la marche l'exige, et on
  // en fabrique s'il en manque.
  const matrice = (j.marche && j.marche.matrice) || {}
  const marche = (a, b) => (matrice[a] && matrice[a][b]) || 0
  // LES TRAJETS SE REFABRIQUENT, ILS NE SE RECYCLENT PAS.
  //
  // L'ancienne version piochait dans un pot de transitions existantes et
  // jetait les invendues juste après les étapes faites. Deux désastres le
  // 3 septembre : des trajets fantômes empilés à 10h15 menant nulle part, et
  // cinq changements de zone SANS aucun trajet — le groupe se téléportait.
  //
  // Ici, chaque changement de zone reçoit un trajet calculé sur la matrice.
  // Ceux que le plan d'origine porte (`j1-e6`…) sont réutilisés en priorité,
  // pour que la règle « les transitions restent » soit satisfaite ; ceux que
  // MES recalculs ont fabriqués (`t-`, `tr-`) sont jetés, ce sont des
  // brouillons. Aucun trajet n'est laissé derrière.
  const dOrigine = transitions.filter((t) => !/^tr?-/.test(t.id))
  const sortie = [...finies]
  let libre = 0
  let zonePrec = (finies.slice().reverse().find((x) => x.zone) || {}).zone
    || (restantes[0] && restantes[0].zone)

  for (const e of restantes) {
    if (e.zone && zonePrec && e.zone !== zonePrec) {
      const m = marche(zonePrec, e.zone)
      if (m > 0) {
        const reprise = dOrigine[libre++]
        // La borne : pouvoir marcher, plus 5 min de toilettes, jamais moins
        // de 10. On ne recopie plus une durée héritée d'une estimation fausse.
        const duree = Math.ceil(Math.max(10, m + 5) / 5) * 5
        sortie.push(reprise
          ? { ...reprise, duree, zone: e.zone, titre: `TRANSITION : marche vers ${e.zone}`, lieu: `De ${zonePrec} vers ${e.zone}` }
          : { id: `tr-${zonePrec}-${e.zone}-${sortie.length}`, numero: 0, actif: true, type: 'transition',
              titre: `TRANSITION : marche vers ${e.zone}`, lieu: `De ${zonePrec} vers ${e.zone}`,
              duree, zone: e.zone, note: 'Marche et pause toilettes.' })
      }
    }
    sortie.push(e)
    if (e.zone) zonePrec = e.zone
  }

  // Un trajet du plan d'origine qui n'a pas trouvé de changement de zone garde
  // sa place : la règle interdit de le supprimer. On le met juste avant la
  // dernière étape, là où il ne coupe aucun enchaînement.
  for (let k = libre; k < dOrigine.length; k++) {
    sortie.splice(Math.max(finies.length, sortie.length - 1), 0, dOrigine[k])
  }

  j.etapes = sortie.map((e, i) => ({ ...e, numero: i + 1 }))
  return true
}

// Combien de minutes la journée déborde-t-elle ? Un chevauchement veut dire
// qu'une étape empiète sur une ancre : c'est ça qu'il faut résorber.
// TOUS les chevauchements, dans l'ordre. Chacun désigne une étape avant
// laquelle il faut trouver des minutes. Ne traiter que le premier laissait les
// suivants intacts et condamnait la journée pour rien.
function debordement(calc) {
  const liste = []
  for (const e of calc.etapes) {
    if (e.controle && e.controle.type === 'chevauchement') {
      liste.push({ id: e.id, minutes: e.controle.minutes || 0 })
    }
  }
  return { liste, total: liste.reduce((n, x) => n + x.minutes, 0) }
}

// ---------------------------------------------------------------- le score
// Ce que la journée COÛTE, dans les termes du compte rendu que le parent lit :
// minutes de flânerie, minutes de repas, euros, heure de fin.
//
// Les poids sont ici, en clair, et se discutent. Une minute de repas vaut deux
// minutes de flânerie : on est cinq au comptoir, avec deux grands-parents et
// une enfant de cinq ans, et un déjeuner écourté se paie l'après-midi.
// L'euro pèse par PERSONNE : un pass à 20 € pèse autant que 9 min de repas.
// Une minute de serrage pese lourd : deux plans identiques dont l un passe a
// l aise et l autre a 10 minutes pres ne se valent pas. Sans ce poids, la
// recherche les classait a egalite et je proposais le serre.
// Le TEMPS MORT compte autant qu'une flânerie perdue : une heure devant une
// salle fermée n'est pas du repos, c'est de l'attente. Il manquait au score, et
// la recherche proposait donc des journées avec trois heures de vide sans le
// savoir. Le parent : « ya encore beaucoup de trous dans le plan ».
const POIDS = { flanerie: 1, repas: 2, euro: 4.5, minuteApresCible: 1.5, serre: 3, collees: 60, vide: 1 }

// `retire` ne compte que ce que la COMPRESSION a pris. Descendre les repas a la
// cible n'est pas une perte : c'est la nouvelle norme voulue par le parent.
function noter(plan, jour, calc, retire, euros, serre = 0, collees = 0) {
  // Le vide : tout ce qui sépare la fin d'une étape du début de la suivante.
  let vide = 0, prec = null
  for (const e of calc.etapes || []) {
    if (e.fait) continue
    // Le premier trou est celui qui separe MAINTENANT de la premiere etape : le
    // plus penible de tous, puisqu'on le subit debout, tout de suite. Il
    // manquait au calcul, et la recherche proposait des journees qui ne
    // reprenaient qu'une heure et demie plus tard.
    if (!prec && etat && etat.maintenant != null && e.debut > etat.maintenant) vide += e.debut - etat.maintenant
    if (prec && e.debut > prec.fin) vide += e.debut - prec.fin
    prec = e
  }
  const j = plan.jours.find((x) => x.numero === jour)
  const cible = hmVersMinutes(j.finCible || (jour === 2 ? '20:00' : j.fermeture)) ?? 1440
  const fin = calc.etapes.length ? calc.etapes[calc.etapes.length - 1].fin : 0
  const depassement = Math.max(0, fin - cible)
  return {
    vide,
    flanerie: retire.flaner || 0,
    repas: retire.repas || 0,
    euros: euros || 0,
    fin,
    depassement,
    total:
      POIDS.flanerie * (retire.flaner || 0) +
      POIDS.repas * (retire.repas || 0) +
      POIDS.euro * (euros || 0) +
      POIDS.minuteApresCible * depassement +
      POIDS.serre * (serre || 0) +
      POIDS.collees * (collees || 0) +
      POIDS.vide * vide,
  }
}

// --------------------------------------------------------------- la boucle
const { plan: reference, etat, attentes, source } = await contexte()
// L'heure qu'il est, pour que le score compte le vide qui commence MAINTENANT.
if (etat && etat.maintenant == null) {
  const hm = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  etat.maintenant = hmVersMinutes(hm.replace('h', ':'))
}
const axes = seancesPossibles(reference, jourDemande)
const espace = axes.reduce((n, a) => n * a.valeurs.length, 1)

console.log(`RECHERCHE — jour ${jourDemande}`)
console.log(`  source        : ${source}`)
console.log(`  choix libres  : ${axes.map((a) => a.libelle.replace(/^Jour \d+ — /, '') + ' (' + a.valeurs.length + ')').join(', ') || 'aucun'}`)
console.log(`  espace        : ${espace.toLocaleString('fr-FR')} journées possibles`)
console.log('')

// LEVIER 3 : le Premier Access. Payant, mais le plan tient sans rien perdre.
// Le parent l'a tranché : « mieux vaut payer que supprimer une étape ».
//
// LE PRIX S'ANNONCE PAR PERSONNE, JAMAIS MULTIPLIÉ. Qui monte se décide sur le
// moment — la petite et deux adultes, ou tout le monde, ou personne. Supposer
// un nombre de passes, c'est décider à sa place. Le total ne se calcule pas ici.
// LE CRÉNEAU DE RETOUR EST IMPOSÉ, PAS CHOISI. C'est écrit dans le plan de
// Le parent, et je l'avais quand même ignoré : j'ai proposé un pass Frozen avec
// Frozen à 11h30, alors que le pass fait passer entre 17h45 et 18h45. Un
// Premier Access ne supprime pas seulement l'attente — il DÉPLACE l'attraction
// dans une fenêtre qu'on subit.
//
// Prix ET fenêtre viennent du collecteur (champ `premierAcces`), jamais d'une
// supposition : j'avais chiffré à 20 € au pif alors que Ratatouille est à 12.
const jourCible = reference.jours.find((x) => x.numero === jourDemande)
const offresPA = {}
for (const e of jourCible.etapes) {
  for (const a of e.attractions || []) {
    const live = attentes[a.id]
    const pa = live && live.premierAcces
    if (pa && pa.disponible && pa.prix && pa.retourDebut) {
      offresPA[e.id] = { attraction: a.id, nom: live.nom, prix: pa.prix,
        debut: pa.retourDebut, fin: pa.retourFin }
    }
  }
}
// Le parc fermé, l'API n'expose plus aucun Premier Access : à 22h il n'y a pas
// d'offre en direct. Sans ce repli, chaque candidat abandonnait en silence et
// la recherche rendait « aucune journée conforme » sans dire pourquoi.
//
// Le prix, lui, est connu : mesuré toutes les cinq minutes sur deux jours, il
// n'a jamais bougé. On l'accepte donc, en disant qu'il ne vient pas du direct.
const PRIX_CONNUS = { 'Frozen Ever After': 16, Ratatouille: 12, Raiponce: 5 }
if (PA_IMPOSE && !offresPA[PA_IMPOSE]) {
  const etape = jourCible.etapes.find((e) => e.id === PA_IMPOSE)
  if (!etape) {
    console.error(`Étape inconnue : ${PA_IMPOSE}`)
    process.exit(2)
  }
  const attraction = (etape.attractions || [])[0]
  const nom = (attraction && attraction.nom) || ''
  const cle = Object.keys(PRIX_CONNUS).find((n) => nom.includes(n))
  const prix = Number(lire('--prix', cle ? PRIX_CONNUS[cle] : 0))
  if (!attraction || !prix) {
    console.error(`Aucune offre Premier Access en direct pour ${etape.titre}, et pas de prix connu.`)
    console.error('Relancer avec --prix <euros par personne>.')
    process.exit(2)
  }
  offresPA[PA_IMPOSE] = { attraction: attraction.id, nom, prix, debut: null, fin: null, horsLigne: true }
  console.log(`  ⚠ Pas d'offre en direct (parc fermé) : prix ${prix} €/personne pris sur les relevés.`)
}

const candidatsPA = PA_IMPOSE ? [PA_IMPOSE] : [null, ...Object.keys(offresPA)]

// Les attractions dont le passage se réserve par file virtuelle : leur heure
// est imposée et inconnue tant que le créneau n'est pas tombé.
const surFileVirtuelle = new Set(
  Object.values((reference.fileAttente || {}).filesVirtuelles || {}).flat().map((f) => f.id))

let dernierBlocage = null

const titresSupprimes = SANS
  .map((id) => (jourCible.etapes.find((e) => e.id === id) || {}).titre)
  .filter(Boolean)

const debut = process.hrtime.bigint()
const ecoule = () => Number(process.hrtime.bigint() - debut) / 1e6

let essayes = 0
let rejetes = 0
let irreparables = 0
const retenus = []
let moinsPire = { minutes: Infinity, combi: null, calc: null }
let moinsPireRegles = { n: Infinity, combi: null, violations: [] }

for (const combiBase of combinaisons(axes)) {
 for (const pa of candidatsPA) {
  if (ecoule() > BUDGET_MS) break
  essayes++
  const combi = pa ? { ...combiBase, __pa: pa } : combiBase

  const p = JSON.parse(JSON.stringify(reference))
  const jj = p.jours.find((x) => x.numero === jourDemande)

  // ON N'ANCRE PAS CE QUI EST SUR UNE FILE VIRTUELLE.
  //
  // Le créneau d'une file virtuelle n'est pas choisi : il tombe à la vague, il
  // est imposé, et il est INCONNU au moment où l'on planifie. Le plan porte
  // « 10h45 » pour la Rencontre Royale, mais c'est un chiffre inventé — le vrai
  // peut être l'après-midi. L'ancrer dessus faisait percuter deux fenêtres
  // imaginaires, celle-ci et celle du pass Frozen, et condamnait la journée
  // pour une collision qui n'existera peut-être jamais.
  //
  // Les spectacles gardent leur ancre : leurs séances existent, on en choisit
  // une, et une fois choisie il faut y être. Woody en fait partie — il est sur
  // une animation à séances, pas sur la file virtuelle Toy Story.
  for (const e of jj.etapes) {
    if (!e.ancre) continue
    if (!(e.attractions || []).some((a) => surFileVirtuelle.has(a.id))) continue
    // Tant que le creneau est INCONNU, on ne s ancre pas dessus : la valeur du
    // plan est un chiffre invente. Mais des qu il est OBTENU, c est un rendez
    // vous ferme, et il commande la journee entiere.
    //
    // Sans cette nuance, le creneau que le parent vient de decrocher etait ignore
    // et l etape replacee ailleurs — exactement le recalcul qu il demandera
    // demain a 9h45, et il serait faux.
    const par = (p.parametres || []).find((x) => x.id === e.ancre.parametre)
    const saisi = (etat.creneaux || {})[e.ancre.parametre]
    const connu = (par && par.nature && par.nature !== 'hypothese') || (saisi && saisi.obtenu)
    if (connu) { e.ancreSiCreneau = false; continue }
    delete e.ancre
    e.ancreSiCreneau = false
  }

  // TOUT SUR DES MULTIPLES DE 5. « Me mets pas des heures a la minute pres. »
  // La journee demarre a 08h45, donc si chaque duree tombe sur un multiple de
  // 5, chaque horaire y tombe aussi.
  //
  // Les attentes s'arrondissent VERS LE BAS, comme le parent l'a demande : une
  // moyenne de 68 min annoncees devient 65. C'est coherent avec le fait que
  // Disney surestime, et la marge de 15 min encaisse le reste.
  //
  // Les TRANSITION font exception et s'arrondissent vers le HAUT : raccourcir
  // une marche ne la raccourcit pas dans la vraie vie, et la regle interdit de
  // les rogner.
  for (const e of jj.etapes) {
    if (e.type === 'transition') { e.duree = Math.ceil(e.duree / 5) * 5; continue }
    for (const a of e.attractions || []) {
      if (a.attenteIncluse == null) continue
      const fixe = e.duree - a.attenteIncluse
      a.attenteIncluse = Math.floor(a.attenteIncluse / 5) * 5
      e.duree = fixe + a.attenteIncluse
    }
    e.duree = Math.floor(e.duree / 5) * 5
  }

  for (const e of jj.etapes) {
    if (e.type !== 'repas') continue
    e.duree = Math.min(e.duree, Math.max(REPAS_CIBLE, Math.min(e.duree, REPAS_MAX)))
    if (e.duree > REPAS_MAX) e.duree = REPAS_MAX
    if (e.duree > REPAS_CIBLE) e.duree = REPAS_CIBLE
  }

  if (SANS.length) {
    jj.etapes = jj.etapes.filter((e) => !SANS.includes(e.id))
  }
  let euros = 0
  if (pa) {
    const offre = offresPA[pa]
    if (!offre) { irreparables++; continue }
    const e = p.jours.find((x) => x.numero === jourDemande).etapes.find((x) => x.id === pa)
    const a = (e.attractions || []).find((x) => x.id === offre.attraction)
    // L'attente tombe à quelques minutes…
    const gagne = Math.max(0, (a.attenteIncluse || 0) - 5)
    e.duree = Math.max(10, (e.duree || 0) - gagne)
    a.attenteIncluse = 5
    a.premierAccess = true
    // …et l'étape n'est CLOUÉE que si l'on connaît vraiment la fenêtre.
    //
    // Au moment de planifier, on ne la connaît PAS : elle est attribuée à
    // l'achat et avance au fil de la journée — acheter à l'ouverture peut
    // donner un retour le matin. Ancrer sur la fenêtre relevée aujourd'hui à
    // 15h40 revenait à planifier avec une donnée qui n'existera pas le jour J,
    // et déclarait la journée impossible pour rien.
    //
    // Ce qu'on sait en planifiant : l'attente disparaît. Ce qu'on subira : une
    // fenêtre, qu'on saisira le moment venu et qui déclenchera un recalcul.
    if (PA_RETOUR) {
      const idParam = 'pa_' + pa
      p.parametres.push({ id: idParam, libelle: `Retour Premier Access ${offre.nom}`,
        valeur: PA_RETOUR, nature: 'releve', seances: [PA_RETOUR] })
      e.ancre = { parametre: idParam, avance: 0 }
      e.ancreSiCreneau = false
    }
    euros = offre.prix   // €/personne, jamais multiplié
  }
  for (const [id, heure] of Object.entries(combiBase)) {
    const par = p.parametres.find((x) => x.id === id)
    par.valeur = heure
    // Choisir une séance n'a d'effet que si l'ancre s'engage. Certaines ancres
    // sont DORMANTES : elles attendent qu'une heure réelle soit connue avant de
    // fixer l'étape (Woody restait flottant en fin de journée). Puisqu'on
    // choisit ici parmi des séances RELEVÉES sur place, la condition est
    // remplie : on réveille l'ancre, sinon la recherche compare 800 fois la
    // même journée.
    if (par.seancesRelevees && par.seancesRelevees.heures && par.seancesRelevees.heures.length) {
      par.nature = 'releve'
      par.seances = par.seancesRelevees.heures
      const j = p.jours.find((x) => x.numero === jourDemande)
      for (const e of j.etapes) if (e.ancre && e.ancre.parametre === id) e.ancreSiCreneau = false
    }
  }

  // On comprime jusqu'à ce que la journée tienne, ou qu'on ne puisse plus.
  let retire = { flaner: 0, repas: 0 }
  const origine = calculerJour(reference, jourDemande, etat, attentes)
  if (!reordonner(p, jourDemande, etat, attentes, origine)) { irreparables++; continue }
  let calc = calculerJour(p, jourDemande, etat, attentes)
  if (!calc) { irreparables++; continue }
  // On comprime tant que ça SERT. Un chevauchement qui ne recule pas après
  // compression est structurel — une ancre inatteignable, pas une journée trop
  // chargée — et s'acharner ne ferait que détruire les repas pour rien.
  // Chaque tour s'attaque au premier chevauchement, en cherchant les minutes
  // uniquement dans ce qui le précède. Douze tours suffisent largement : il y a
  // moins d'une dizaine d'ancres dans une journée.
  for (let tour = 0; tour < 12; tour++) {
    const d = debordement(calc)
    if (!d.liste.length) break
    let progres = false
    for (const ov of d.liste) {
      const r = comprimer(p, jourDemande, etat, attentes, ov.minutes, ov.id)
      if (r.retire.flaner || r.retire.repas) {
        progres = true
        retire.flaner += r.retire.flaner || 0
        retire.repas += r.retire.repas || 0
      }
    }
    if (!progres) break                                    // plus rien à donner en amont
    const apres = calculerJour(p, jourDemande, etat, attentes)
    if (debordement(apres).total >= d.total) { calc = apres; break }  // structurel
    calc = apres
  }
  if (TRACER && essayes === 1) {
    console.log('TRACE de la 1re journée essayée :', JSON.stringify(combi))
    for (const e of calc.etapes) {
      const ch = e.controle && e.controle.type === 'chevauchement' ? '  ⚠ CHEVAUCHE ' + e.controle.minutes : ''
      console.log(`   ${minutesVersHm(e.debut)}-${minutesVersHm(e.fin)} ${String(e.duree).padStart(3)}min ${e.ancree ? '⚓' : '  '} ${e.titre.slice(0, 40)}${ch}`)
    }
    console.log(`   comprimé : ${retire.flaner} min de flânerie, ${retire.repas} de repas`)
    console.log('')
  }
  const reste = debordement(calc).total
  if (reste > MARGE) {
    irreparables++
    if (reste < moinsPire.minutes) moinsPire = { minutes: reste, combi, calc }
    continue
  }

  // Les 12 règles. Une violation dure n'est pas négociable.
  // Le Click & Collect doit atteindre le CONTROLE aussi, sinon la regle du
  // plancher refuse a 50 les repas que le calcul vient de poser a 45.
  const ctrl = verifierPlan(p, { etat: { ...etat, clickCollect: CLICK_COLLECT }, attentes, reference, calculerJour })
  const dures = ctrl.violations
    .filter((v) => v.jour === jourDemande || v.jour == null)
    // Coherent avec la marge : ce qu'on vient d'accepter ne doit pas etre
    // refuse deux lignes plus bas par la regle des chevauchements.
    .filter((v) => !(v.regle === 'aucun-chevauchement' && reste <= MARGE))
    // Une suppression décidée par le parent n'est pas une violation : c'est un
    // choix. La règle nomme l'étape par son TITRE, pas par son identifiant.
    .filter((v) => !(v.regle === 'aucune-suppression' && titresSupprimes.some((t) => v.message.includes(t))))
  // Deux flaneries collees ne cassent rien mecaniquement, mais le parent n en veut
  // pas : « une heure de temps libre d un seul tenant, ce n est pas du repos ».
  // La regle est molle cote serveur pour ne jamais bloquer une poussee en
  // urgence ; ici, ou l on CHOISIT parmi des centaines de journees, on peut se
  // permettre de l exiger.
  // Interdire net ne marche pas : avec trois flaneries et peu de creneaux, elles
  // finissent presque toujours par se toucher, et la recherche ne rend plus
  // rien. On PENALISE lourdement a la place — une journee qui les separe gagne
  // toujours, mais on garde une reponse quand aucune n y arrive.
  const collees = ctrl.avertissements.filter((v) => v.regle === 'flaneries-collees' && v.jour === jourDemande)

  if (dures.length) {
    rejetes++
    if (dures.length < moinsPireRegles.n) moinsPireRegles = { n: dures.length, combi, violations: dures, calc }
    continue
  }

  retenus.push({ combi, pa, serre: reste, score: noter(p, jourDemande, calc, retire, euros, reste, collees.length), calc, plan: p, avert: ctrl.avertissements.length })
 }
}

retenus.sort((a, b) => a.score.total - b.score.total || a.score.fin - b.score.fin)

// ---------------------------------------------------------------- le rapport
console.log(`  essayées      : ${essayes.toLocaleString('fr-FR')} en ${ecoule().toFixed(0)} ms`)
console.log(`  refusées      : ${rejetes} par les règles · ${irreparables} impossibles à faire tenir`)
console.log(`  retenues      : ${retenus.length}`)
console.log('')

if (!retenus.length) {
  console.log('AUCUNE journée conforme avec les leviers gratuits (réordonner, comprimer).')
  if (!moinsPire.combi && !moinsPireRegles.combi && dernierBlocage) {
    console.log('')
    console.log("AUCUNE journée n'a même pu être CONSTRUITE. Étape qui ne trouve pas de place :")
    console.log(`   ${dernierBlocage.etape} (${dernierBlocage.type}, ${dernierBlocage.besoin} min minimum)`)
    console.log(`   ${dernierBlocage.creneaux} créneaux entre ancres, aucun assez grand ou dans sa fenêtre.`)
  }
  console.log('')
  if (moinsPireRegles.combi) {
    console.log(`LA PLUS PROCHE — elle tient dans le temps, mais viole ${moinsPireRegles.n} règle(s) :`)
    for (const [id, h] of Object.entries(moinsPireRegles.combi)) console.log(`   ${id} : ${h}`)
    for (const v of moinsPireRegles.violations) console.log(`   ✗ ${v.titre} : ${v.message}`)
    console.log('')
    for (const e of moinsPireRegles.calc.etapes) {
      console.log(`   ${minutesVersHm(e.debut)}-${minutesVersHm(e.fin)} ${String(e.duree).padStart(3)}min ${e.ancree ? '⚓' : '  '} ${e.titre.slice(0, 42)}`)
    }
  } else if (moinsPire.combi) {
    console.log(`LA MOINS MAUVAISE — il manque encore ${moinsPire.minutes} min pour la faire tenir :`)
    for (const [id, h] of Object.entries(moinsPire.combi)) console.log(`   ${id} : ${h}`)
    console.log('')
    for (const e of moinsPire.calc.etapes) {
      const ch = e.controle && e.controle.type === 'chevauchement' ? '  ⚠ ' + e.controle.minutes + ' min' : ''
      console.log(`   ${minutesVersHm(e.debut)}-${minutesVersHm(e.fin)} ${String(e.duree).padStart(3)}min ${e.ancree ? '⚓' : '  '} ${e.titre.slice(0, 42)}${ch}`)
    }
  }
  console.log('')
  console.log('Prochain levier : Premier Access (payant), ou renoncer à une étape.')
  process.exit(2)
}

const nomsAxes = Object.fromEntries(axes.map((a) => [a.id, a.libelle.replace(/^Jour \d+ — /, '')]))
console.log(`LES ${Math.min(GARDER, retenus.length)} MEILLEURES`)
console.log('')
retenus.slice(0, GARDER).forEach((r, i) => {
  const s = r.score
  const perdu = [
    s.flanerie ? `${s.flanerie} min de flânerie` : null,
    s.repas ? `${s.repas} min de repas` : null,
    s.euros ? `${s.euros} €/personne` : null,
  ].filter(Boolean).join(' · ') || 'RIEN'
  console.log(`${String(i + 1).padStart(2)}. coût ${String(s.total).padStart(4)}   en moins : ${perdu}`)
  console.log(`     ${s.vide} min de temps mort`)
  if (r.serre > 0) console.log(`     serre de ${r.serre} min, dans la marge de ${MARGE} (Disney surestime ses attentes)`)
  console.log(`     fin ${minutesVersHm(s.fin)}${s.depassement ? ` (${s.depassement} min après la cible)` : ''}${r.avert ? ` · ${r.avert} avertissement(s)` : ''}`)
  for (const [id, h] of Object.entries(r.combi)) {
    if (id === '__pa') continue
    console.log(`     ${nomsAxes[id]} : ${h.replace(':', 'h')}`)
  }
  if (r.pa) {
    const e = reference.jours.find((x) => x.numero === jourDemande).etapes.find((x) => x.id === r.pa)
    const o = offresPA[r.pa]
    console.log(`     PREMIER ACCESS sur ${e.titre} — ${o.prix} €/personne`)
    console.log(PA_RETOUR
      ? `       retour imposé ${PA_RETOUR} (saisi)`
      : `       fenêtre de retour INCONNUE tant qu'on n'a pas acheté — acheter tôt pour viser le matin`)
    if (o.horsLigne) console.log('       prix pris sur les relevés, pas sur le direct')
  }
  console.log('')
})

// Le détail horaire de la meilleure, pour que je puisse le relire.
const best = retenus[Math.min(DETAIL, retenus.length) - 1]
console.log(`DÉTAIL DE LA N°${Math.min(DETAIL, retenus.length)}`)
for (const e of best.calc.etapes) {
  const a = e.ancree ? '⚓' : '  '
  const chg = (reference.jours.find((j) => j.numero === jourDemande).etapes.find((x) => x.id === e.id) || {}).duree !== e.duree ? ' ←' : ''
  console.log(`  ${minutesVersHm(e.debut)}-${minutesVersHm(e.fin)} ${String(e.duree).padStart(3)}min ${a} ${e.titre.slice(0, 46)}${chg}`)
}

if (ECRIRE) {
  const dest = path.isAbsolute(ECRIRE) ? ECRIRE : path.join(process.cwd(), ECRIRE)
  fs.writeFileSync(dest, JSON.stringify(best.plan, null, 1))
  console.log('')
  console.log('Plan n°1 écrit dans', dest)
  console.log('Il reste à le vérifier et à le pousser — cet outil n\'écrit jamais sur le serveur.')
}
