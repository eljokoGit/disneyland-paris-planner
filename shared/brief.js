// Le brief de recalcul : tout ce qu'il faut pour refaire le plan, en un
// copier-coller. LECTURE SEULE — rien ici ne modifie le plan ni l'état.
//
// Premier critère : je dois pouvoir répondre sans avoir une seule question à
// poser. Donc l'état, les contraintes, les alternatives ET les chiffres du
// moment. Deuxième critère : ça reste lisible par un humain, parce que le parent
// le relira sur son téléphone avant de l'envoyer.
//
// Le moteur ne décide pas à ma place : il constate, il chiffre, et il me passe
// la main. C'est délibéré — les arbitrages (sauter, remplacer, décaler une
// séance, payer un Premier Access) dépendent de la fatigue d'une enfant de
// cinq ans, ce qu'aucune règle écrite d'avance ne saura peser.

import { situation, minutesVersHm } from './moteur.js'
import { enoncerRegles } from './contraintes.js'

const hf = (x) => (x || '--:--').replace(':', 'h')
const hm = (min) => hf(minutesVersHm(min))

export function briefRecalcul(plan, etat = {}, maintenant = null, attentes = {}, commentaire = '') {
  const s = situation(plan, etat, maintenant, attentes)
  if (!s) return 'Plan illisible.'
  const j = s.calc.jour
  const L = []

  // Première ligne : la commande. Le brief invoque lui-même la méthode, au lieu
  // de compter sur mon jugement pour la charger. Le parent colle, c'est tout.
  L.push('/recalcul-plan')
  L.push('')
  L.push('RECALCUL DEMANDÉ')
  L.push(`${j.libelle} — ${j.parc} — il est ${hm(s.maintenant)}`)
  L.push('')

  L.push('OÙ ON EN EST')
  if (s.enCours) {
    L.push(`  Étape ${s.enCours.numero}/${s.total} en cours : ${s.enCours.titre}`)
    L.push(`  (${s.enCours.lieu}), prévue ${hm(s.enCours.debut)}–${hm(s.enCours.fin)}`)
  } else {
    L.push('  Toutes les étapes sont faites.')
  }
  const faites = s.calc.etapes.filter((e) => e.fait)
  if (faites.length) L.push(`  Déjà fait : étapes ${faites.map((e) => e.numero).join(', ')}`)
  for (const e of s.calc.etapesSupprimees || []) L.push(`  SUPPRIMÉ : ${e.titre}`)
  for (const e of s.calc.etapesAnnulees || []) {
    L.push(e.choisi
      ? `  SAUTÉ FAUTE DE TEMPS : ${e.titre} (${e.duree} min) — l'attraction est ouverte, on l'a seulement mise de côté. À REPLACER si c'est possible.`
      : `  PERDU — ${e.motif} : ${e.titre} (${e.duree} min) — indisponible, ne pas chercher à le replacer.`)
  }
  L.push('')

  L.push('LE PROBLÈME')
  if (s.contrainte && s.contrainte.type === 'ancre') {
    L.push(`  Prochain point fixe : ${s.contrainte.titre}`)
    L.push(`  Séance ${hf(s.contrainte.heureEvenement)}, il faut y être à ${hm(s.contrainte.heure)} (${s.contrainte.avance} min d'avance).`)
    L.push(`  Avance restante selon le plan : ${s.avanceRestante} min.`)
    if (s.risqueEnPlus > 0) {
      L.push(`  Les attentes affichées ajoutent ${s.risqueEnPlus} min : il ne resterait que ${s.avanceRestanteReelle} min.`)
    }
    L.push(`  En dessous de ${s.contrainte.avanceMinimale} min d'avance, la queue d'entrée ne passe plus.`)
  } else if (s.contrainte) {
    L.push(`  Contrainte : ${s.contrainte.titre} à ${hm(s.contrainte.heure)}. Marge ${s.marge} min.`)
  } else {
    L.push('  Aucune contrainte immédiate.')
  }
  L.push('')

  if ((s.hypothese || []).length) {
    L.push("BUDGET DU PLAN CONTRE RÉEL, D'ICI LÀ")
    for (const h of s.hypothese) {
      const bits = [`  ${h.titre} — ${h.duree} min prévues`]
      if (h.budget != null) {
        bits.push(h.attente == null
          ? `attente ${h.budget} budgétée, rien d'affiché`
          : `attente ${h.budget} budgétée / ${h.attente} affichée${h.depassementMin > 0 ? ` (+${h.depassementMin})` : ''}`)
      }
      L.push(bits.join(' · '))
    }
    L.push('')
  }

  L.push("CE QUI RESTE À FAIRE")
  for (const e of s.calc.etapes.filter((x) => !x.fait)) {
    const bits = [`  ${e.numero}. ${e.titre} — ${e.duree} min — ${e.lieu}`]
    if (e.ancre) {
      const p = s.calc.params[e.ancre.parametre] || {}
      bits.push(`ANCRÉ sur ${hf(p.valeurEffective)}${p.nature ? ` (${p.nature})` : ''}`)
    }
    const f = e.files && e.files.principale
    if (f && !f.inconnue) {
      bits.push(f.enPanne ? 'EN PANNE' : f.ouverte === false
        ? 'FERMÉE'
        : `affiché ${f.attente == null ? '?' : f.attente + ' min'}${f.budget != null ? ` pour ${f.budget} budgétées` : ''}`)
      if (f.fermetureHm) bits.push(`ferme à ${hf(f.fermetureHm)}`)
    }
    L.push(bits.join(' · '))
  }
  L.push('')

  const alt = (plan.parametres || []).filter((p) => p.jour === j.numero && (p.seances || []).length > 1)
  if (alt.length) {
    L.push('SÉANCES POSSIBLES')
    for (const p of alt) {
      const retenue = (s.calc.params[p.id] || {}).valeurEffective
      L.push(`  ${p.libelle.replace(/^Jour \d+ — /, '')} : ${p.seances.map((x) => (x === retenue ? `[${hf(x)}]` : hf(x))).join('  ')}`)
    }
    L.push('  (entre crochets, la séance que le plan retient)')
    L.push('')
  }

  const subs = j.substitutions || []
  if (subs.length) {
    L.push('SUBSTITUTIONS ACCEPTÉES, ET BONUS POSSIBLES')
    for (const sub of subs) {
      const live = attentes[sub.id]
      const etat2 = !live ? 'attente inconnue' : !live.ouverte ? 'FERMÉE' : `${live.attente == null ? '?' : live.attente} min`
      // L'heure de fermeture évite de proposer le soir une attraction qui a
      // fermé l'après-midi : Main Street Vehicles ferme à 14h45, Thunder Mesa
      // à 17h00, le Disneyland Railroad à 19h45.
      const ferme = live && live.fermetureHm ? ` — ferme à ${hf(live.fermetureHm)}` : ''
      L.push(`  ${sub.nom} — ${sub.zone} — ${etat2}${ferme}${sub.reserve ? ` — RÉSERVE : ${sub.reserve}` : ''}`)
    }
    L.push('')
  }

  const pa = Object.values(attentes).filter((a) => a && a.premierAcces && a.premierAcces.disponible)
  if (pa.length) {
    L.push('PREMIER ACCESS DISPONIBLE (prix par personne)')
    for (const a of pa) {
      L.push(`  ${a.nom || '?'} — ${a.premierAcces.prixTexte || a.premierAcces.prix + ' €'} — passage ${hf(a.premierAcces.retourDebut)}–${hf(a.premierAcces.retourFin)}`)
    }
    L.push('')
  }

  const fv = Object.values(attentes).filter((a) => a && a.fileVirtuelle)
  if (fv.length) {
    L.push('FILES VIRTUELLES')
    for (const a of fv) {
      L.push(`  ${a.nom || '?'} — ${a.fileVirtuelle.disponible
        ? `OUVERTE, passage ${hf(a.fileVirtuelle.retourDebut)}–${hf(a.fileVirtuelle.retourFin)}`
        : 'complète'}`)
    }
    L.push('')
  }

  const cr = etat.creneaux || {}
  if (Object.keys(cr).length) {
    L.push('CRÉNEAUX DE RENCONTRE')
    for (const [id, v] of Object.entries(cr)) {
      const p = (plan.parametres || []).find((x) => x.id === id)
      L.push(`  ${(p && p.libelle) || id} : ${v.obtenu ? `obtenu ${hf(v.heure)}` : 'PAS obtenu'}`)
    }
    L.push('')
  }

  const esc = j.escapades && j.escapades.creneaux
  if (esc && esc.length) {
    const restantes = esc.filter((c) => !(etat.escapades || {})[c.id])
    if (restantes.length) {
      L.push('ESCAPADES SOLO ENCORE POSSIBLES')
      for (const c of restantes) {
        L.push(`  ${c.libelle} — ${c.debut}→${c.retour} (${c.duree} min) — coûte : ${c.coute}`)
      }
      L.push('')

      // LE SINGLE RIDER, POUR UNE ESCAPADE SOLO.
      //
      // Le parent part SEUL : la file qui le concerne n'est pas le standby mais le
      // single rider, et l'écart est énorme — Crush's Coaster affichait 100 min
      // en standby pour 30 en single rider le 3 septembre. Je calculais ses
      // escapades sur le standby, donc je les déclarais impossibles à tort.
      const zoneCourante = (situation(plan, etat, maintenant, attentes).enCours || {}).zone
      const matr = (j.marche && j.marche.matrice) || {}
      const avecSR = Object.entries(attentes)
        .filter(([, v]) => v && v.singleRider != null && v.ouverte !== false)
        .map(([id, v]) => {
          const et = (j.etapes || []).find((x) => (x.attractions || []).some((a) => a.id === id))
          const zone = et ? et.zone : null
          const aller = zoneCourante && zone && matr[zoneCourante] ? (matr[zoneCourante][zone] || 0) : null
          return { nom: v.nom, sr: v.singleRider, standby: v.attente, zone, aller }
        })
        .sort((a, b) => (a.sr + (a.aller || 99) * 2) - (b.sr + (b.aller || 99) * 2))
      if (avecSR.length) {
        L.push('SINGLE RIDER (pour une escapade solo — la file qui compte quand on part seul)')
        for (const x of avecSR.slice(0, 8)) {
          const trajet = x.aller != null ? `, ${x.aller * 2} min de marche aller-retour depuis ${zoneCourante}` : ''
          L.push(`  ${x.nom} — ${x.sr} min en single rider (${x.standby ?? '?'} en standby)${trajet}`)
        }
        L.push('')
      }
    }
  }

  // La matrice ENTIÈRE, pas seulement depuis la zone courante : réordonner une
  // journée demande toutes les paires. La restreindre revenait à me demander de
  // déplacer des étapes sans savoir ce que coûte le trajet.
  const marche = (j.marche && j.marche.matrice) || null
  if (marche) {
    L.push('TEMPS DE MARCHE ENTRE ZONES (minutes, allure famille)')
    const zones = Object.keys(marche)
    for (const a of zones) {
      const vers = zones.filter((b) => b !== a).map((b) => `${b} ${marche[a][b]}`).join(' · ')
      L.push(`  depuis ${a} : ${vers}`)
    }
    if (j.marche.note) L.push(`  ${j.marche.note}`)
    L.push('')
    L.push('ZONES ET ÉTAPES')
    for (const e of j.etapes || []) {
      if (e.actif === false) continue
      L.push(`  ${e.numero}. ${e.titre.slice(0, 46)} — zone ${e.zone || '?'}`)
    }
    L.push('')
  }

  if (plan.voyage) {
    L.push('QUI VOYAGE')
    L.push(`  ${plan.voyage.groupe}`)
    if (plan.voyage.profil) L.push(`  ${plan.voyage.profil}`)
    L.push('')
  }

  const c = plan.contraintes
  if (c) {
    L.push('RÈGLES À RESPECTER — toutes, sans exception')
    L.push('  [DUR] = le serveur REFUSE un plan qui la viole. [MOU] = à justifier.')
    L.push(enoncerRegles(plan))
    if (c.priorite1) L.push(`  PRIORITÉ 1 : ${c.priorite1}`)
    L.push('')
  }

  L.push('AVANT DE ME RÉPONDRE')
  L.push('  Le plan que je renverrai passera par POST /api/plan/verifier puis PUT /api/plan.')
  L.push('  Les règles [DUR] y sont contrôlées mécaniquement : un plan qui en viole une')
  L.push('  est refusé, pas enregistré. Je dois donc les tenir, pas les promettre.')
  L.push('')

  L.push('CE QUE JE TE DEMANDE')
  L.push('  Réordonne la fin de journée pour que TOUTES les attractions prévues tiennent.')
  L.push("  Suis l'ordre des leviers ci-dessus : réordonner, puis comprimer, puis payer un")
  L.push('  Premier Access en réorganisant autour de sa fenêtre imposée. Supprimer est le')
  L.push('  dernier recours et se demande explicitement.')
  L.push('  Dis-moi ce qui change, ce que ça coûte en euros et en marche, et pourquoi tu')
  L.push('  écartes les autres options.')

  L.push('')

  // DERNIERE SECTION, ET LA PLUS FORTE. Tout ce qui precede est fabrique par
  // l'application a partir de l'etat du moment. Ca, c'est le parent qui parle, et
  // il voit ce que l'app ne mesure pas : sa fille qui fatigue, la pluie qui
  // arrive, une file plus courte qu'annoncee, une envie. Place en dernier pour
  // etre lu en dernier, et declare prioritaire pour ne pas etre noye.
  const mot = (commentaire || '').trim()
  L.push('COMMENTAIRES DU PARENT')
  if (mot) {
    for (const ligne of mot.split('\n')) L.push('  ' + ligne)
    L.push('')
    L.push('  ^^^ CECI EST PRIORITAIRE SUR TOUT CE QUI PRECEDE DANS CE MESSAGE.')
    L.push('  En cas de contradiction avec les donnees ci-dessus, le parent a raison :')
    L.push("  il est sur place, l'application ne l'est pas. Applique ce qu'il dit,")
    L.push('  ne le discute pas, et signale seulement si ca casse une regle [DUR].')
  } else {
    L.push('  (rien - le reste du message fait foi)')
  }

  return L.join('\n')
}
