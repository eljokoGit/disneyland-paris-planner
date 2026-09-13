// Moteur de calcul du plan — partagé entre le backend (Node) et le frontend (React).
//
// Principe : le planning reste celui qui est écrit (ancres + durées). On ne le
// recalcule JAMAIS à partir de l'heure à laquelle le parent appuie sur « Terminé » :
// il n'appuie pas au moment exact où l'activité se finit, cette heure ne veut
// rien dire. Le retard se mesure en comparant l'HEURE RÉELLE au créneau prévu
// de l'activité en cours.

export function hmVersMinutes(hm) {
  if (typeof hm !== 'string') return null
  const m = hm.trim().match(/^(\d{1,2})[:hH](\d{2})/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function minutesVersHm(min) {
  if (min == null || Number.isNaN(min)) return '--:--'
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}

export function formatDuree(min) {
  const a = Math.abs(Math.round(min))
  if (a < 60) return a + ' min'
  const h = Math.floor(a / 60), r = a % 60
  return r === 0 ? h + ' h' : h + ' h ' + String(r).padStart(2, '0')
}

// Les valeurs saisies dans l'app priment sur celles du plan.
export function resoudreParametres(plan, etat = {}) {
  const out = {}
  for (const p of plan.parametres) {
    const saisi = etat.parametres && etat.parametres[p.id]
    out[p.id] = {
      ...p,
      valeurEffective: saisi != null && saisi !== '' ? saisi : p.valeur,
      modifie: saisi != null && saisi !== '' && saisi !== p.valeur,
    }
  }
  return out
}

// Une durée peut être raccourcie depuis l'app (bloc flâner ou repas).
export function dureeEffective(etape, etat = {}) {
  const forcee = (etat.durees || {})[etape.id]
  return Number.isFinite(forcee) ? forcee : etape.duree || 0
}

// Plancher en dessous duquel on ne raccourcit pas : un repas de 15 min à 5
// avec une enfant de 5 ans, ce n'est pas un repas.
//
// 40 min ne vaut QUE si le Click & Collect a servi — sinon c'est 50, cinq
// personnes au comptoir ne se pressent pas. Le moteur disait 40 en toutes
// circonstances pendant que la règle `repas-plancher` en exigeait 50 : le
// moteur proposait donc des compressions que le contrôle refusait ensuite.
export const PLANCHERS = { repas: 50, flaner: 10 }

// Au-dela de cet horizon, l'attente AFFICHEE ne dit plus rien de ce qu'on
// trouvera : une file de 40 min a 11h30 en fait 18 a 14h. Seule la moyenne
// mesuree vaut a cette distance.
export const HORIZON_REEL = 60

export function planchersDe(plan, etat = {}) {
  const r = (plan && plan.contraintes && plan.contraintes.repas) || {}
  const cc = !!(etat && etat.clickCollect)
  return {
    ...PLANCHERS,
    repas: cc ? (r.plancherAvecClickCollect ?? 40) : (r.plancher ?? PLANCHERS.repas),
  }
}

// Ce qu'on peut retirer du plan. Les transitions restent (marche + toilettes),
// les flâner et repas se réduisent au lieu de disparaître, l'arrivée et la
// sortie n'ont pas de sens à supprimer.
export const TYPES_SUPPRIMABLES = new Set(['attraction', 'spectacle', 'rencontre', 'activite'])

export function reductionPossible(etape, etat = {}, plan = null) {
  const plancher = (plan ? planchersDe(plan, etat) : PLANCHERS)[etape.type]
  if (plancher == null) return 0 // transitions et activités : on ne rogne pas
  return Math.max(0, dureeEffective(etape, etat) - plancher)
}

// Ordre de sacrifice : celui du plan, sauf si le parent l'a réordonné dans l'app.
export function ordreSacrifice(plan, numeroJour, etat = {}) {
  const jour = plan.jours.find((j) => j.numero === numeroJour)
  if (!jour) return []
  const base = jour.ordreSacrifice || []
  const perso = (etat.ordreSacrifice || {})[String(numeroJour)]
  const liste = perso
    ? perso.map((id) => base.find((s) => s.etape === id)).filter(Boolean)
      .concat(base.filter((s) => !perso.includes(s.etape)))
    : base
  return liste.map((s, i) => {
    const e = jour.etapes.find((x) => x.id === s.etape)
    return {
      ...s,
      rang: i + 1,
      titreEtape: e ? e.titre : s.etape,
      numeroEtape: e ? e.numero : null,
      duree: e ? dureeEffective(e, etat) : null,
    }
  })
}

// Calcule les horaires d'une journée. Purement nominal : ancres + durées.
//   Étape ancrée    : debut = parametre - avance (elle ne bouge pas)
//   Étape flottante : debut = fin de la précédente
function creneauObtenuDansPlan(plan, id) {
  const p = (plan.parametres || []).find((x) => x.id === id)
  return !!(p && p.obtenu === true)
}

export function calculerJour(plan, numeroJour, etat = {}, attentes = {}) {
  const jour = plan.jours.find((j) => j.numero === numeroJour)
  if (!jour) return null

  const params = resoudreParametres(plan, etat)
  const faites = etat.etapesFaites || {}
  const supprimees = new Set(etat.etapesSupprimees || [])
  // Annulée ≠ supprimée. Une suppression est un arbitrage du parent pour gagner
  // du temps ; une annulation lui est imposée (météo, panne, salle complète).
  // On les distingue pour qu'une session Remote sache quoi reconstruire.
  const annulees = etat.annulees || {}
  const decrochees = new Set(etat.ancresDecrochees || [])
  const creneauxEtat = etat.creneaux || {}
  const ouverture = hmVersMinutes(jour.ouverture) ?? 570

  const zonesParId = {}
  for (const z of jour.zones || []) zonesParId[z.id] = z

  // Escapades solo : créneaux FIXES, définis à l'avance. On ne les calcule pas,
  // on les rattache aux étapes concernées.
  const escapadeParEtape = {}
  for (const c of (jour.escapades && jour.escapades.creneaux) || []) {
    for (const id of c.etapes) escapadeParEtape[id] = c
  }
  const utilisees = etat.escapades || {}

  // Les quatre créneaux du jour 1 visent TOUS Flight Force : ce sont quatre
  // occasions de la faire une fois, pas un programme. Une fois le parent parti,
  // proposer le créneau suivant à l'étape d'après n'a plus d'objet.
  //
  // Le jour 2 est l'inverse : trois créneaux, trois attractions différentes,
  // toutes voulues. La règle porte donc sur la CIBLE, pas sur le créneau.
  const ciblesFaites = new Set()
  for (const c of (jour.escapades && jour.escapades.creneaux) || []) {
    if (!utilisees[c.id]) continue
    ciblesFaites.add(c.cible || '__cible-unique__')
  }

  const actives = jour.etapes.filter(
    (e) => e.actif !== false && !supprimees.has(e.id) && !annulees[e.id]
  )

  // LA MATINEE NE POUSSE PAS L'APRES-MIDI.
  //
  // Le 3 septembre, les etapes deja faites portaient des horaires devenus
  // faux : Woody demarrait avant la fin de l'arrivee, Frozen a 10h15 pour une
  // file prise bien plus tard. Le parent : « tout ce qui est avant Raiponce c'est
  // n'importe quoi ». Or la chaine est une SOMME DE DUREES — ce passe invente
  // decalait silencieusement tout le reste de la journee.
  //
  // `repriseA` coupe le passe de la suite : au moment ou l'on quitte les
  // etapes faites, le curseur repart de cette heure-la. C'est une DONNEE
  // ENREGISTREE, pas l'horloge : le calcul reste reproductible, et le
  // verificateur de contraintes rend le meme verdict a toute heure.
  //
  // La coupure est CLOUEE A UNE ETAPE (`repriseAvant`), pas a « la premiere pas
  // encore faite ». Premiere version, et le piege etait immediat : en cochant
  // les Tapis Volants, la coupure glissait derriere eux et Ratatouille
  // repartait a 12h56 au lieu de 13h36 — tout l'apres-midi s'effondrait de
  // quarante minutes a chaque case cochee.
  //
  // Une reprise peut aussi être ÉCRITE DANS LE PLAN (`jour.reprise`). L'état
  // est vidé à minuit ; une journée vécue qu'on veut garder lisible doit porter
  // elle-même l'heure où elle est repartie. Celle de l'état, posée en direct,
  // prime.
  const repriseEtat = etat.repriseJour === numeroJour ? hmVersMinutes(etat.repriseA) : null
  const reprisePlan = jour.reprise ? hmVersMinutes(jour.reprise.a) : null
  const reprise = repriseEtat != null ? repriseEtat : reprisePlan
  const repriseAvant = reprise == null ? null
    : repriseEtat != null ? etat.repriseAvant || null : (jour.reprise.avant || null)
  let repriseFaite = false

  let curseur = null
  const etapes = []

  actives.forEach((e, i) => {
    // Une ancre « dormante » ne s'applique qu'une fois le créneau réellement
    // obtenu : sinon une simple hypothèse figerait le reste de la journée.
    // Obtenu dans l'état (saisi dans Résas, vidé à minuit) ou dans le plan
    // (`parametres[].obtenu`, pour une journée vécue qu'on garde).
    const ancreDormante = e.ancreSiCreneau
      && !(e.ancre && ((creneauxEtat[e.ancre.parametre] && creneauxEtat[e.ancre.parametre].obtenu)
        || creneauObtenuDansPlan(plan, e.ancre.parametre)))
    const ancreActive = e.ancre && !decrochees.has(e.id) && !ancreDormante ? e.ancre : null

    // UNE ÉTAPE FAITE NE POUSSE PLUS RIEN DEVANT ELLE.
    //
    // La Cavalcade a été vue à 10h20, en passant, alors que le plan la place à
    // 13h30. Cochée « faite », elle occupait quand même ses 35 minutes dans la
    // suite de la journée : l'app annonçait 8 minutes d'avance sur Mickey au
    // lieu de 43, et réclamait un recalcul pour un problème inexistant.
    //
    // Une étape faite est derrière soi, quelle que soit sa place dans la liste.
    // Elle reste visible, cochée, avec sa durée — mais le curseur ne l'attend
    // plus.
    const duree = dureeEffective(e, etat)
    let debut, controle

    // La bascule passe/avenir, une seule fois dans la journee : sur l'etape
    // devant laquelle la reprise a ete posee — cochee ou non depuis.
    if (reprise != null && !repriseFaite
      && (repriseAvant ? e.id === repriseAvant : !faites[e.id])) {
      repriseFaite = true
      curseur = reprise
    }

    if (ancreActive) {
      const p = params[ancreActive.parametre]
      const base = hmVersMinutes(p && p.valeurEffective)
      const theorique = base == null ? curseur ?? ouverture : base - (ancreActive.avance || 0)
      if (curseur === null) controle = { type: 'depart', minutes: 0 }
      else if (curseur > theorique) controle = { type: 'chevauchement', minutes: curseur - theorique }
      else if (curseur < theorique) controle = { type: 'battement', minutes: theorique - curseur }
      else controle = { type: 'pile-poil', minutes: 0 }
      debut = theorique
    } else {
      debut = curseur === null ? ouverture : curseur
      controle = curseur === null ? { type: 'depart', minutes: 0 } : { type: 'enchaine', minutes: 0 }
      if (e.ancre && decrochees.has(e.id)) controle = { type: 'decrochee', minutes: 0 }
    }

    const fin = debut + duree

    etapes.push({
      ...e,
      index: i,
      debut, fin, duree,
      dureeInitiale: e.duree,
      raccourcie: duree !== e.duree,
      debutHm: minutesVersHm(debut),
      finHm: minutesVersHm(fin),
      controle,
      ancree: !!ancreActive,
      decrochee: !!(e.ancre && decrochees.has(e.id)),
      parametreAncre: ancreActive ? ancreActive.parametre : null,
      // Combien de séances cette étape a-t-elle vraiment ? Une ancre n'est un
      // RENDEZ-VOUS que pour deux raisons — un créneau de file virtuelle
      // obtenu, ou un spectacle qui ne joue qu'une fois. Partout ailleurs elle
      // marque une séance CHOISIE parmi plusieurs, donc déplaçable. L'app les
      // affichait toutes « ancrée », ce qui laissait croire qu'on ne pouvait
      // plus rien bouger.
      seancesPossibles: (() => {
        const id = (ancreActive && ancreActive.parametre) || e.seancesDe
        if (!id) return 0
        const p = (plan.parametres || []).find((x) => x.id === id)
        if (!p) return 0
        return (p.seances || []).length || ((p.seancesRelevees || {}).heures || []).length
      })(),
      fait: !!faites[e.id],
      marqueeA: faites[e.id] ? faites[e.id].marqueeA : null,
      reductionPossible: reductionPossible(e, etat, plan),
      photos: (zonesParId[e.zone] && zonesParId[e.zone].photos) || [],
      files: filesEtape(e, duree, attentes),
      escapade: escapadeParEtape[e.id]
        ? {
            ...escapadeParEtape[e.id],
            utilisee: !!utilisees[escapadeParEtape[e.id].id],
            // Vrai quand un AUTRE créneau visant la même attraction a servi.
            cibleDejaFaite: !utilisees[escapadeParEtape[e.id].id]
              && ciblesFaites.has(escapadeParEtape[e.id].cible || '__cible-unique__'),
          }
        : null,
      consignes: (e.avertissements || []).filter((a) => a.type === 'consigne'),
      remarques: (e.avertissements || []).filter((a) => a.type !== 'consigne'),
    })

    // Une étape FAITE garde sa place dans la chaîne : elle a bien été vécue, à
    // son tour. J'ai essayé deux fois de la faire « ne pousser rien » — une
    // fois le curseur revenait à son début, une fois il ne bougeait plus du
    // tout — et les deux fois l'étape suivante démarrait avant la fin de la
    // précédente.
    //
    // La bonne réponse est celle du parent : ce qui a été fait AILLEURS, à un
    // autre moment que prévu, s'ANNULE au lieu de se cocher. Une annulation
    // sort l'étape du calcul, proprement, sans toucher au chaînage.
    curseur = fin
  })

  // Deux heures, et j'ai d'abord calculé la seconde à l'envers.
  //
  // Une escapade ne comprime RIEN : le groupe continue le plan sans le parent. La
  // seule vraie question est « quelle est la première étape qu'il ne peut pas
  // rater ? ». Tout ce qui est couvert par un autre créneau d'escapade est déjà
  // déclaré sacrifiable, et un flâner ou un repas se rate sans conséquence.
  //
  // Mon erreur : je m'arrêtais à la prochaine ANCRE. Pour l'escapade pendant
  // Mickey, ça donnait Woody à 18h50 — alors que Woody figure justement dans ce
  // que le créneau suivant propose de rater. L'app annonçait « retour 18h05 »
  // quand la vraie limite était 21h05, le placement de Cascade of Lights.
  const dansUnCreneau = new Set()
  for (const c of (jour.escapades && jour.escapades.creneaux) || []) {
    for (const id of c.etapes) dansUnCreneau.add(id)
  }
  const ratable = (e) => dansUnCreneau.has(e.id) || e.type === 'flaner' || e.type === 'repas'

  for (const e of etapes) {
    if (!e.escapade) continue
    const derniere = etapes.find((x) => x.id === e.escapade.etapes[e.escapade.etapes.length - 1])
    if (!derniere) continue

    const suite = etapes.filter((x) => x.index > derniere.index)
    const obligatoire = suite.find((x) => !ratable(x))
    const enPlus = obligatoire
      ? suite.filter((x) => x.index < obligatoire.index)
      : suite

    e.escapade.limite = obligatoire ? minutesVersHm(obligatoire.debut) : null
    e.escapade.obligatoireTitre = obligatoire ? obligatoire.titre : null
    e.escapade.obligatoireHm = obligatoire ? minutesVersHm(obligatoire.debut) : null
    e.escapade.margeApresRetour = obligatoire ? obligatoire.debut - derniere.fin : null
    // Ce qu'il raterait EN PLUS s'il poussait jusqu'à la limite.
    e.escapade.enPlus = enPlus.map((x) => x.titre.replace(/^(FLÂNER|DÉJEUNER|DÎNER|SPECTACLE)\s*:?\s*/i, ''))
  }

  // Un créneau d'escapade porte une heure de retour écrite en dur. Si le plan a
  // bougé depuis, cette heure est fausse — et sur le créneau du dîner, ça veut
  // dire rater Cascade of Lights. On ne recalcule pas, on signale.
  for (const e of etapes) {
    if (!e.escapade) continue
    const derniere = e.escapade.etapes[e.escapade.etapes.length - 1]
    const finReelle = etapes.find((x) => x.id === derniere)
    e.escapade.perimee = !!finReelle && finReelle.finHm !== e.escapade.retour
    e.escapade.retourReel = finReelle ? finReelle.finHm : null
  }

  const etapesSupprimees = jour.etapes
    .filter((e) => (supprimees.has(e.id) || e.actif === false) && !annulees[e.id])
    // `retireDuPlan` : décidé au recalcul et écrit dans plan.json, il survit au
    // changement de jour. Sinon c'est un retrait fait dans l'app, pour la
    // journée en cours.
    .map((e) => ({ ...e, supprimee: true, retireDuPlan: e.actif === false }))

  const etapesAnnulees = jour.etapes
    .filter((e) => annulees[e.id])
    .map((e) => ({ ...e, annulee: true, ...annulees[e.id] }))

  return { jour, etapes, etapesSupprimees, etapesAnnulees, fin: curseur, params }
}

// Une ancre est-elle décalable ? C'est ce qui distingue « on peut encore
// rattraper » de « à un moment on sera bloqué ».
export function souplesseAncre(plan, etape, params) {
  if (!etape || !etape.parametreAncre) return null
  const p = params[etape.parametreAncre]
  if (!p) return null

  if (p.type === 'creneau') {
    return {
      genre: 'creneau', titre: etape.titre,
      message: "C'est un créneau de file virtuelle : on peut en retenter un autre.",
      detail: p.note || null,
    }
  }
  if (p.type !== 'seance') return null

  const actuelle = p.valeurEffective
  const suivantes = (p.seances || []).filter((h) => h > actuelle)

  if (suivantes.length) {
    return {
      genre: 'decalable', titre: etape.titre, seances: suivantes,
      message: `Séance suivante à ${suivantes[0].replace(':', 'h')}.`,
      detail: null,
    }
  }
  return {
    genre: 'bloquee', titre: etape.titre,
    message: (p.seances || []).length > 1
      ? "C'est la DERNIÈRE séance : impossible de la décaler."
      : "Séance unique : impossible de la décaler.",
    detail: p.note || "On peut gagner du temps avant, mais à un moment on sera bloqué.",
  }
}

// Deux leviers, et un seul est une décision.
//
//  - Réduire un temps libre ou un repas n'est pas une action : c'est une
//    conséquence. On l'AFFICHE (« tu devras partir à 12h00, il te restera
//    20 min au lieu de 50 »), on ne met pas de bouton dessus.
//  - Supprimer une activité est une vraie décision, avec des conséquences
//    géographiques écrites à la main dans l'ordre de sacrifice. Bouton.
function analyserRetard(plan, calc, etat, enCours, contrainte, aRecuperer) {
  const entre = calc.etapes.filter(
    (e) => e.index > enCours.index && (contrainte.jusqua == null || e.index < contrainte.jusqua)
  )

  // Heure à laquelle il faudra quitter chaque bloc élastique : l'ancre moins
  // tout ce qui doit encore tenir après lui. C'est une heure vraie, elle ne
  // dépend d'aucune projection.
  const elastiques = []
  for (const e of entre) {
    if (PLANCHERS[e.type] == null) continue
    const apres = entre.filter((x) => x.index > e.index).reduce((s, x) => s + x.duree, 0)
    elastiques.push({
      etape: e.id, titre: e.titre, type: e.type,
      duree: e.duree, plancher: PLANCHERS[e.type],
      partirA: minutesVersHm(contrainte.heure - apres),
    })
  }

  const absorbable = elastiques.reduce((s, e) => s + Math.max(0, e.duree - e.plancher), 0)

  // On étale le manque sur les blocs élastiques, dans l'ordre.
  let reste = aRecuperer
  const tempsLibre = []
  for (const e of elastiques) {
    const dispo = Math.max(0, e.duree - e.plancher)
    const pris = Math.min(dispo, reste)
    tempsLibre.push({ ...e, nouvelleDuree: e.duree - pris, perdu: pris })
    reste -= pris
  }

  // Toute activité est supprimable. L'ordre de sacrifice n'est pas une liste
  // fermée : c'est une PRIORITÉ. Ce qui y figure passe devant, le reste suit
  // dans l'ordre du plan.
  const priorites = ordreSacrifice(plan, calc.jour.numero, etat)
    .filter((c) => c.portee === 'etape')
    .map((c) => c.etape)

  const candidats = entre.filter((e) => TYPES_SUPPRIMABLES.has(e.type))
  candidats.sort((a, b) => {
    const ra = priorites.indexOf(a.id), rb = priorites.indexOf(b.id)
    if (ra !== rb) return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb)
    return a.index - b.index
  })

  const detailsSacrifice = {}
  for (const c of ordreSacrifice(plan, calc.jour.numero, etat)) detailsSacrifice[c.etape] = c

  const supprimables = reste > 0
    ? candidats.map((e, i) => ({
        rang: i + 1,
        etape: e.id,
        numeroEtape: e.numero,
        cible: (detailsSacrifice[e.id] && detailsSacrifice[e.id].cible) || e.titre,
        duree: e.duree,
        lieu: e.lieu,
        prioritaire: priorites.includes(e.id),
        detail: (detailsSacrifice[e.id] && detailsSacrifice[e.id].detail) || null,
        suffit: e.duree >= reste,
      }))
    : []

  return {
    tempsLibre,                       // information, jamais un bouton
    supprimables,                     // les seuls boutons
    manqueApresTempsLibre: Math.max(0, reste),
    absorbeParLeTempsLibre: aRecuperer > 0 && reste <= 0,
    absorbable,
  }
}

// Rapproche une étape des temps d'attente en direct. Une attraction du plan sans
// correspondance doit apparaître comme telle, jamais disparaître en silence.
function filesEtape(etape, duree, attentes) {
  const liste = etape.attractions || []
  if (!liste.length) return null

  const items = liste.map((a) => {
    const live = attentes[a.id]
    if (!live) return { ...a, inconnue: true }
    // Ce que la durée de l'étape peut absorber : au-delà, l'étape est en danger.
    const budget = a.attenteIncluse != null ? a.attenteIncluse : null
    const depasse = budget != null && live.attente != null && live.attente > budget
    return {
      ...a,
      inconnue: false,
      statut: live.statut,
      ouverte: live.ouverte,
      enPanne: live.enPanne,
      attente: live.attente,
      singleRider: live.singleRider,
      premierAcces: live.premierAcces || null,
      fileVirtuelle: live.fileVirtuelle || null,
      seances: live.seances,
      ouvertureHm: live.ouvertureHm || null,
      fermetureHm: live.fermetureHm || null,
      budget,
      depasse,
      depassementMin: depasse ? live.attente - budget : 0,
    }
  })

  const principale = items[0]
  return {
    items,
    principale,
    fermee: items.some((i) => !i.inconnue && i.statut === 'CLOSED'),
    enDanger: items.some((i) => i.depasse),
    sansCorrespondance: items.some((i) => i.inconnue),
  }
}

// Situation courante. Le pointeur avance à la main (« Terminé »), le retard se
// mesure à l'horloge.
export function situation(plan, etat = {}, maintenant = null, attentes = {}) {
  const numeroJour = etat.jourActif || 1
  const calc = calculerJour(plan, numeroJour, etat, attentes)
  if (!calc) return null

  const enCours = calc.etapes.find((e) => !e.fait) || null
  const suivante = enCours ? calc.etapes[enCours.index + 1] || null : null
  const nbFaites = calc.etapes.filter((e) => e.fait).length

  // Hors de la fenêtre de la journée (la veille au soir, un essai en août),
  // l'horloge ne veut rien dire : on ne compare rien et on n'alerte pas.
  const debutJournee = calc.etapes[0] ? calc.etapes[0].debut : 0
  const finJournee = calc.etapes.length ? calc.etapes[calc.etapes.length - 1].fin : 1440
  const dansLaJournee =
    maintenant != null && maintenant >= debutJournee - 60 && maintenant <= finJournee + 60

  // L'HEURE DU CLIC N'ENTRE JAMAIS DANS LE CALCUL. Le parent n'appuie pas au moment
  // exact où une activité se termine ; s'en servir fabrique de faux retards —
  // par exemple « en retard de 30 min » alors qu'on est assis dans le spectacle,
  // à l'heure. Le seul signal fiable est l'horloge comparée au créneau prévu.
  const finProjetee = enCours && dansLaJournee
    ? Math.max(maintenant, enCours.fin)
    : enCours ? enCours.fin : null

  // Sur une étape ancrée, l'heure qui compte n'est pas celle de l'étape (qui
  // inclut l'avance) mais celle de la SÉANCE. « Dans les temps » ne dit pas si
  // le spectacle a commencé ou non.
  let seanceEnCours = null
  if (enCours && enCours.ancree && dansLaJournee) {
    const par = calc.params[enCours.parametreAncre]
    const h = par && hmVersMinutes(par.valeurEffective)
    if (h != null && (par.type === 'seance' || par.type === 'creneau')) {
      seanceEnCours = {
        genre: par.type,
        mot: enCours.type === 'rencontre' ? 'rencontre' : 'spectacle',
        heureHm: par.valeurEffective,
        dans: h - maintenant,       // > 0 : pas encore commencée
        commencee: maintenant >= h,
        sortieHm: enCours.finHm,
      }
    }
  }

  let horsCreneau = false, retard = 0, avance = 0
  if (enCours && dansLaJournee) {
    if (finProjetee > enCours.fin) { horsCreneau = true; retard = finProjetee - enCours.fin }
    else if (maintenant < enCours.debut) { horsCreneau = true; avance = enCours.debut - maintenant }
  }

  const depuis = enCours ? enCours.index : calc.etapes.length
  const prochaineAncre = calc.etapes.find((e) => e.ancree && e.index > depuis && !e.fait) || null

  // La contrainte, c'est la prochaine ancre — et s'il n'y en a plus, l'heure de
  // fin de journée. Le jour 2 se termine sans ancre après PhilharMagique : sans
  // ça, traîner en fin de journée ne déclencherait jamais rien.
  const contrainte = !enCours || !dansLaJournee ? null
    : prochaineAncre
      ? {
          type: 'ancre',
          heure: prochaineAncre.debut,          // heure à laquelle il faut Y ÊTRE
          heureEvenement: (calc.params[prochaineAncre.parametreAncre] || {}).valeurEffective || null,
          avance: (prochaineAncre.ancre && prochaineAncre.ancre.avance) || 0,
          parametre: prochaineAncre.parametreAncre,
          // Sous ce seuil, l'avance ne remplit plus son office : la queue
          // d'entrée d'un spectacle en salle ne s'avale pas en 5 minutes.
          avanceMinimale: (prochaineAncre.ancre && prochaineAncre.ancre.avanceMinimale)
            ?? Math.round(((prochaineAncre.ancre && prochaineAncre.ancre.avance) || 0) * 0.6),
          titre: prochaineAncre.titre,
          jusqua: prochaineAncre.index,
        }
      : { type: 'fin-journee', heure: finJournee, titre: 'la fin de la journée', jusqua: null }

  let marge = null, aRecuperer = 0, besoinApres = 0, intermediaires = []
  if (contrainte) {
    intermediaires = calc.etapes
      .filter((e) => e.index > enCours.index && (contrainte.jusqua == null || e.index < contrainte.jusqua))
      // Une etape FAITE ne coute plus rien d ici a l ancre, meme si le plan la
      // place plus loin dans la liste. La Cavalcade, vue a 10h20 en passant,
      // ajoutait ses 35 minutes a la projection et faisait annoncer 8 min
      // d avance sur Mickey au lieu de 18.
      .filter((e) => !e.fait)
    besoinApres = intermediaires.reduce((s, e) => s + e.duree, 0)
    marge = contrainte.heure - finProjetee - besoinApres
    if (marge < 0) aRecuperer = -marge
  }

  // Sur quoi repose le chiffre. « Vous y seriez avec 21 min d'avance » n'est pas
  // une mesure : c'est une projection qui SUPPOSE que chaque étape d'ici là tient
  // sa durée prévue. Si Raiponce prend 45 min au lieu de 30, le calcul est faux.
  // On montre donc l'hypothèse, et on signale les attentes qui la contredisent
  // déjà — c'est la seule façon de savoir quelle confiance accorder au chiffre.
  const hypothese = intermediaires.map((e) => {
    const principale = e.files && e.files.principale
    return {
      id: e.id,
      titre: e.titre.replace(/^(FLÂNER|DÉJEUNER|DÎNER|TRANSITION|SPECTACLE)\s*:?\s*/i, ''),
      duree: e.duree,
      // Attente affichée sur place contre budget prévu pour cette étape.
      attente: principale && !principale.inconnue ? principale.attente : null,
      budget: principale ? principale.budget : null,
      depassementMin: principale && principale.depasse ? principale.depassementMin : 0,
      // L'affichage du moment ne vaut que pour ce qui arrive BIENTÔT. Les Tapis
      // Volants affichaient 40 min à 11h33 pour une étape prévue à 14h00, où la
      // moyenne mesurée est de 18 : l'app annonçait 25 minutes de risque qui
      // n'existaient pas, et réclamait un recalcul.
      //
      // Règle du parent : « budgéter sur les moyennes pour le futur, sur les
      // réelles pour les immédiats ». Faute de moyennes dans le moteur, on
      // applique au moins la moitié qui ne coûte rien : au-delà d'une heure,
      // le direct ne dit rien, donc il ne compte pas.
      imminente: maintenant == null || !dansLaJournee || e.debut - maintenant <= HORIZON_REEL,
    }
  })
  const risqueEnPlus = hypothese.reduce((s, h) => s + (h.imminente ? h.depassementMin : 0), 0)

  // « Restent X min » : combien de temps on peut encore passer ICI avant de
  // devoir bouger — pas le reliquat d'un créneau théorique.
  let resteEnCours = null
  if (enCours && dansLaJournee && maintenant >= enCours.debut) {
    const limite = prochaineAncre ? prochaineAncre.debut - besoinApres : enCours.fin
    resteEnCours = Math.max(0, limite - maintenant)
  }
  // Ce qui reste de l'étape elle-même. Distinct de `resteEnCours`, qui court
  // jusqu'au prochain rendez-vous : « restent 37 min » affiché sous un créneau
  // 15h46–15h56 a fait lire au parent le mauvais des deux.
  const resteEtape = resteEnCours == null ? null : Math.max(0, enCours.fin - maintenant)

  // L'heure d'une étape ancrée inclut déjà l'avance (25 min pour un spectacle en
  // salle). La dépasser de 5 min ne veut pas dire qu'on a raté la séance : ça
  // veut dire qu'on arrivera avec 20 min d'avance au lieu de 25. Ce n'est une
  // vraie alerte que si le retard dépasse toute l'avance.
  const avanceRestante = contrainte && contrainte.type === 'ancre'
    ? contrainte.avance - aRecuperer
    : null
  const gravite = aRecuperer === 0 ? null
    : avanceRestante != null && avanceRestante >= 0 ? 'info' : 'alerte'

  // Le plan raisonne sur des budgets d'attente écrits à l'avance. Les bornes du
  // parc, elles, affichent le réel. Tant que l'écart tient dans l'avance, on le
  // signale sans rien proposer ; dès qu'il la dépasse, il faut décider — même si
  // le calcul sur les durées prévues, lui, disait encore que ça passait.
  const avanceRestanteReelle = avanceRestante != null ? avanceRestante - risqueEnPlus : null
  // Trois paliers, pas deux : confortable, serré (il faut décider), trop tard.
  const seuil = contrainte && contrainte.type === 'ancre' ? contrainte.avanceMinimale : 0
  // ON NE PREVIENT QUE POUR CE QUI EST PROCHE. Un spectacle a 15h50 annonce a
  // 12h03 qu'il manquera 5 minutes : d'ici la, dix choses auront bouge. Le
  // panneau rouge devient du bruit, et le parent finit par ne plus le lire.
  const ancreProche = contrainte == null || maintenant == null || !dansLaJournee
    || contrainte.heure - maintenant <= 150
  const graviteReelle = !ancreProche ? 'info'
    : avanceRestanteReelle == null ? gravite
    : avanceRestanteReelle < 0 ? 'alerte'
    : avanceRestanteReelle < seuil ? 'serre'
    : gravite
  // Vrai seulement quand c'est le réel qui fait basculer, pas le plan seul.
  const bascadeParLeReel = graviteReelle !== gravite && graviteReelle !== 'info' && risqueEnPlus > 0


  // Une attraction du plan qui ferme sans prévenir : ça remonte en alerte.
  // Mais hors des heures du parc TOUT est fermé : n'alerter que dans la journée,
  // sinon l'app hurle toute la nuit et on cesse de la croire.
  const fermetures = !dansLaJournee ? [] : calc.etapes
    .filter((e) => !e.fait && e.files && e.files.fermee)
    .map((e) => ({
      etape: e.id, numero: e.numero, titre: e.titre,
      attractions: e.files.items.filter((i) => i.statut === 'CLOSED').map((i) => i.nom),
    }))

  const analyse = aRecuperer + risqueEnPlus > 0
    ? analyserRetard(plan, calc, etat, enCours, contrainte, aRecuperer + risqueEnPlus)
    : null

  // Dès qu'on prend du retard, dire si l'ancre qui suit peut bouger ou non.
  const souplesse = (retard > 0 || aRecuperer > 0) && prochaineAncre
    ? souplesseAncre(plan, prochaineAncre, calc.params)
    : null


  return {
    numeroJour, calc, enCours, suivante, nbFaites,
    total: calc.etapes.length,
    maintenant, dansLaJournee,
    horsCreneau, retard, avance, resteEnCours, resteEtape, finProjetee, seanceEnCours,
    prochaineAncre, contrainte, marge, aRecuperer, avanceRestante, gravite, fermetures,
    hypothese, risqueEnPlus, besoinApres, avanceRestanteReelle, graviteReelle, bascadeParLeReel,
    // Une séance qui a bougé casse une ancre. C'était une vérification à faire à
    // la main tous les matins ; le collecteur relève désormais les séances du
    // jour, donc l'app peut comparer elle-même et ne parler que si ça diverge.
    seancesDivergentes: calc.etapes
      .filter((e) => !e.fait && e.ancre && e.files && e.files.principale)
      .map((e) => {
        const p = calc.params[e.ancre.parametre] || {}
        const live = e.files.principale.seances || []
        if (!p.valeurEffective || !live.length || live.includes(p.valeurEffective)) return null
        return {
          id: e.id, titre: e.titre,
          prevue: p.valeurEffective,
          reelles: live,
          parametre: e.ancre.parametre,
        }
      })
      .filter(Boolean),

    // Un créneau de file virtuelle est FIXE et non négociable. S'il tombe loin
    // de l'hypothèse du plan, des étapes ancrées se retrouvent derrière des
    // étapes qui finissent après elles : le contrôle le dit, mais seul l'onglet
    // Journée l'affichait, en petite étiquette. Il faut que ça remonte ici.
    // ON NE CRIE PAS POUR CE QUI EST TOLERE, NI POUR CE QUI EST LOIN.
    //
    // Le bandeau rouge « LE PLAN NE TIENT PLUS » s'affichait pour 5 minutes de
    // chevauchement sur un spectacle prevu QUATRE HEURES plus tard — alors que
    // Le parent tolere 15 minutes, et que d'ici la tout aura bouge dix fois. Un
    // avertissement qui se declenche quand tout va bien finit par etre ignore
    // le jour ou il a raison.
    //
    // Deux filtres : le total doit depasser la marge declaree, et il faut que
    // l'etape concernee soit dans les deux prochaines heures. Au-dela, ce n'est
    // pas une urgence, c'est une projection.
    chevauchements: (() => {
      const marge = ((plan.contraintes || {}).margeChevauchement) || 0
      const bruts = calc.etapes
        .filter((e) => !e.fait && e.controle && e.controle.type === 'chevauchement')
      const total = bruts.reduce((n, e) => n + (e.controle.minutes || 0), 0)
      if (total <= marge) return []
      const HORIZON = 120
      return bruts
        .filter((e) => maintenant == null || !dansLaJournee || e.debut - maintenant <= HORIZON)
        .map((e) => ({ id: e.id, titre: e.titre, minutes: e.controle.minutes, heureHm: minutesVersHm(e.debut) }))
    })(),
    analyse, souplesse,
    // Alerte seulement si on est hors créneau ET qu'il y a vraiment à récupérer.
    // Rouge uniquement quand l'avance ne suffit plus : sinon on crie pour rien.
    alerte: horsCreneau && aRecuperer > 0 && gravite === 'alerte',
    // ON NE PARLE QUE S'IL Y A QUELQUE CHOSE À DÉCIDER.
    //
    // Le panneau s'affichait dès qu'un écart existait, même pour dire « rien à
    // faire pour l'instant » — encadré, coloré, sur un spectacle à trois heures
    // de là. Le parent : « c'est lourd ». Un bandeau qui parle pour ne rien dire
    // finit par être ignoré le jour où il compte.
    //
    // Il ne s'ouvre donc que si l'ancre est PROCHE et que l'avance ne suffit
    // plus. Sinon, silence : le plan tient, il n'y a rien à en dire.
    aSignaler: ancreProche && (aRecuperer > 0 || risqueEnPlus > 0)
      && graviteReelle !== 'info',
  }
}

// Résumé texte lisible par un humain — c'est ce que renvoie GET /api/etat.
export function resumeTexte(plan, etat = {}, maintenant = null, attentes = {}) {
  const s = situation(plan, etat, maintenant, attentes)
  if (!s) return 'Plan illisible.'
  const j = s.calc.jour
  const L = []
  const hf = (hm) => (hm || '--:--').replace(':', 'h')

  L.push(`Jour ${j.numero} — ${j.libelle.toLowerCase()}${maintenant != null ? ', ' + hf(minutesVersHm(maintenant)) : ''} — ${j.parc}`)

  if (!s.enCours) {
    L.push(`Toutes les étapes sont faites (${s.nbFaites}/${s.total}).`)
    return L.join('\n')
  }

  L.push(`Étape ${s.enCours.numero}/${s.total} : ${s.enCours.titre} (${s.enCours.lieu}), prévue ${hf(s.enCours.debutHm)}–${hf(s.enCours.finHm)}`)
  if (s.seanceEnCours) {
    const sc = s.seanceEnCours
    const mot = sc.genre === 'creneau' ? 'Créneau' : 'Séance'
    L.push(sc.commencee
      ? `  ${mot} de ${hf(sc.heureHm)} : commencé${sc.genre === 'creneau' ? '' : 'e'} — sortie vers ${hf(sc.sortieHm)}`
      : `  ${mot} à ${hf(sc.heureHm)} : dans ${sc.dans} min — sortie vers ${hf(sc.sortieHm)}`)
  }

  if (!s.dansLaJournee) L.push(`Situation : hors de la journée (elle court de ${hf(s.calc.etapes[0].debutHm)} à ${hf(s.calc.etapes[s.calc.etapes.length - 1].finHm)})`)
  else if (s.retard > 0) L.push(`Situation : on finira l'étape en cours vers ${hf(minutesVersHm(s.finProjetee))}, soit ${s.retard} min après l'heure prévue`)
  else if (s.avance > 0) L.push(`Situation : en avance, l'étape ne devait commencer qu'à ${hf(s.enCours.debutHm)}`)
  // Le chiffre court jusqu'au prochain rendez-vous quand il y en a un, jusqu'à
  // la fin de l'étape sinon. On nomme donc la limite : « il reste 37 min »
  // sous un créneau qui finit dans 3 se lit de travers.
  else if (s.prochaineAncre) {
    L.push(`Situation : dans le créneau prévu — l'étape finit dans ${s.resteEtape} min ; ${s.resteEnCours} min avant de devoir partir pour ${s.prochaineAncre.titre}`)
  } else L.push(`Situation : dans le créneau prévu, il reste ${s.resteEnCours} min dans l'étape`)

  if (s.enCours.consignes.length) {
    L.push('Consignes sur place :')
    s.enCours.consignes.forEach((c) => L.push('  - ' + c.texte))
  }

  if (s.suivante) L.push(`Ensuite : ${s.suivante.titre}, ${hf(s.suivante.debutHm)}`)

  if (s.prochaineAncre) {
    const p = s.calc.params[s.prochaineAncre.parametreAncre]
    const marge = s.marge == null ? 'marge non calculée hors journée' : `marge ${s.marge} min`
    L.push(`Prochaine ancre : ${s.prochaineAncre.titre}, ${hf(p ? p.valeurEffective : s.prochaineAncre.debutHm)} (départ ${hf(s.prochaineAncre.debutHm)}, ${marge})`)
  }

  if (s.souplesse) {
    L.push(`Souplesse de la prochaine ancre : ${s.souplesse.message}`)
    if (s.souplesse.detail) L.push(`  ${s.souplesse.detail}`)
  }

  if (s.aRecuperer > 0 && s.analyse) {
    const a = s.analyse
    const c = s.contrainte
    L.push('')
    if (c.type === 'ancre' && c.avance > 0) {
      L.push(`${c.titre} — séance à ${hf(c.heureEvenement)} (il faut y être à ${hf(minutesVersHm(c.heure))}, ${c.avance} min d'avance).`)
      L.push(s.avanceRestante >= 0
        ? `→ vous y seriez avec ${s.avanceRestante} min d'avance au lieu de ${c.avance}.`
        : `⚠ vous arriveriez ${-s.avanceRestante} min APRÈS le début.`)
    } else {
      L.push(`⚠ ${s.aRecuperer} MIN DE TROP avant ${c.titre} (${hf(minutesVersHm(c.heure))}).`)
    }
    a.tempsLibre.filter((t) => t.perdu > 0).forEach((t) => {
      L.push(`  · ${t.titre} : ${t.duree} → ${t.nouvelleDuree} min (départ obligatoire ${hf(t.partirA)})`)
    })
    if (a.absorbeParLeTempsLibre) {
      L.push('  → le temps libre absorbe tout, aucune activité à supprimer.')
    } else {
      L.push(`  → il manque encore ${a.manqueApresTempsLibre} min. À supprimer, dans l'ordre :`)
      a.supprimables.forEach((c) => L.push(
        `     ${c.rang}. ${c.cible} (${c.duree} min, ${c.lieu})${c.prioritaire ? ' [priorité]' : ''}${c.suffit ? ' — suffit' : ''}`))
      if (!a.supprimables.length) L.push("     rien de supprimable d'ici là.")
    }
  }

  const creneaux = []
  for (const p of plan.parametres) {
    if (p.nature !== 'hypothese' || p.jour !== s.numeroJour) continue
    const c = (etat.creneaux || {})[p.id]
    const nom = p.libelle.replace(/^Jour \d+ — créneau /, '')
    if (c && c.obtenu) creneaux.push(`${nom} obtenue ${hf(c.heure)} ✓`)
    else if (c && c.obtenu === false) creneaux.push(`${nom} AUCUN CRÉNEAU ✗`)
    else creneaux.push(`${nom} non renseignée (hypothèse ${hf(p.valeur)})`)
  }
  L.push('Créneaux : ' + (creneaux.join(' | ') || 'aucun'))

  if (s.enCours && s.enCours.escapade) {
    const esc = s.enCours.escapade
    L.push(`Escapade possible : ${esc.libelle}, ${esc.duree} min, retour ${hf(esc.retour)}`
      + (esc.utilisee ? ' — DÉJÀ UTILISÉE' : '')
      + (esc.perimee ? ` — ⚠ le plan a bougé, l'étape finit maintenant à ${hf(esc.retourReel)}` : ''))
  }

  if (s.enCours && s.enCours.files) {
    const f = s.enCours.files
    const txt = f.items.map((i) => {
      if (i.inconnue) return `${i.nom} : pas de correspondance API`
      if (i.enPanne) return `${i.nom} : EN PANNE`
      if (i.statut === 'CLOSED') return `${i.nom} : FERMÉE`
      const bouts = []
      if (i.attente != null) bouts.push(`${i.attente} min`)
      if (i.singleRider != null) bouts.push(`single rider ${i.singleRider}`)
      if (i.premierAcces && i.premierAcces.disponible) {
        bouts.push(`Premier Access ${i.premierAcces.prixTexte}, passage entre ${i.premierAcces.retourDebut} et ${i.premierAcces.retourFin}`)
      }
      if (i.fileVirtuelle) {
        bouts.push(i.fileVirtuelle.disponible
          ? `file virtuelle DISPONIBLE${i.fileVirtuelle.retourDebut ? ' retour ' + i.fileVirtuelle.retourDebut : ''}`
          : 'file virtuelle COMPLÈTE')
      }
      if (i.depasse) bouts.push(`${i.depassementMin} min DE TROP`)
      return `${i.nom} : ${bouts.join(', ') || 'attente inconnue'}`
    })
    L.push('Files : ' + txt.join(' | '))
  }

  if (s.fermetures.length) {
    L.push('⛔ FERMETURES DÉTECTÉES : ' + s.fermetures.map((f) => `étape ${f.numero} ${f.attractions.join(', ')}`).join(' | '))
  }

  const faites = s.calc.etapes.filter((e) => e.fait).map((e) => e.numero)
  L.push('Faites : ' + (faites.length ? faites.join(',') : 'aucune'))

  const sup = s.calc.etapesSupprimees.map((e) => `${e.numero} ${e.titre}`)
  if (sup.length) L.push('Supprimées (arbitrage) : ' + sup.join(' | '))

  if (s.calc.etapesAnnulees.length) {
    L.push('')
    L.push('⛔ ANNULÉES — à replanifier :')
    s.calc.etapesAnnulees.forEach((e) => {
      L.push(`  - étape ${e.numero} ${e.titre} (${e.lieu}) — ${e.motif || 'motif non précisé'}, ${e.duree} min libérées`)
    })
  }

  const raccourcies = s.calc.etapes.filter((e) => e.raccourcie)
  if (raccourcies.length) {
    L.push('Raccourcies : ' + raccourcies.map((e) => `${e.titre} ${e.dureeInitiale}→${e.duree} min`).join(' | '))
  }

  const modifies = plan.parametres.filter((p) => (etat.parametres || {})[p.id] && etat.parametres[p.id] !== p.valeur)
  if (modifies.length) L.push('Paramètres modifiés : ' + modifies.map((p) => `${p.libelle} → ${etat.parametres[p.id]}`).join(' | '))

  return L.join('\n')
}
