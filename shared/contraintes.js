// Le contrôleur de plan : il refuse ce qui viole une contrainte du parent.
//
// POURQUOI CE FICHIER EXISTE
// Pendant les deux journées, mon travail principal sera de recalculer le plan
// depuis un brief collé sur un téléphone. Le parent ne peut pas passer la journée
// à vérifier que je n'ai rien oublié. Une règle qui n'est écrite que dans une
// consigne en prose est une règle que je peux manquer sous pression.
//
// Ici, chaque contrainte est une FONCTION qui examine un plan et rend un verdict.
// PUT /api/plan l'exécute : un plan qui casse une règle dure est REFUSÉ, pas
// enregistré. Les règles molles remontent en avertissement.
//
// Ajouter une contrainte = ajouter une entrée dans REGLES. Elle sera dès lors
// vérifiée à chaque recalcul, transmise dans le brief, et impossible à oublier.

import { hmVersMinutes, minutesVersHm, dureeEffective, PLANCHERS } from './moteur.js'

const nomEtape = (e) => `${e.numero}. ${e.titre}`

// Les attractions que le plan promet. Priorité 1 du parent : ne rien rater.
// Une étape peut CHANGER DE PLACE librement ; elle ne peut pas DISPARAÎTRE.
function etapesObligatoires(jour) {
  return (jour.etapes || [])
    .filter((e) => e.actif !== false)
    // Les trajets que MES recalculs fabriquent (`t-`, `tr-`) ne sont pas des
    // étapes promises : ils naissent et meurent avec un ordre de journée. Les
    // compter comme « perdus » me faisait défendre mes propres brouillons.
    .filter((e) => !(e.type === 'transition' && /^tr?-/.test(e.id)))
}

export const REGLES = [
  {
    id: 'aucune-suppression',
    dure: true,
    titre: 'Ne rien rater',
    enonce: 'Aucune étape du plan de référence ne peut disparaître. Réordonner est libre ; supprimer exige l’accord explicite du parent.',
    verifier({ jour, reference }) {
      if (!reference) return []
      const presentes = new Set(etapesObligatoires(jour).map((e) => e.id))
      return etapesObligatoires(reference)
        .filter((e) => !presentes.has(e.id))
        // L'identifiant entre parenthèses n'est pas décoratif : c'est lui que
        // `suppressionsAcceptees` doit retrouver. Sans lui, aucune suppression
        // voulue n'a jamais pu passer le serveur.
        .map((e) => `${nomEtape(e)} (${e.id}) a disparu du plan.`)
    },
  },
  {
    id: 'repas-fenetre',
    dure: true,
    titre: 'Fenêtre des repas',
    enonce: 'Le déjeuner commence entre 11h30 et 14h30.',
    verifier({ jour, calc, contraintes }) {
      const f = contraintes.repas && contraintes.repas.fenetre
      if (!f) return []
      const [min, max] = f.map(hmVersMinutes)
      return (calc.etapes || [])
        .filter((e) => !e.fait && e.type === 'repas' && /DÉJEUNER/i.test(e.titre))
        .filter((e) => e.debut < min || e.debut > max)
        .map((e) => `${nomEtape(e)} commence à ${minutesVersHm(e.debut)}, hors de la fenêtre ${f[0]}–${f[1]}.`)
    },
  },
  {
    id: 'repas-ordre',
    dure: true,
    titre: 'Ordre des repas',
    enonce: "Le dîner vient après le déjeuner. Les repas gardent l'ordre du plan.",
    // Règle née de la recherche de plan : rien ne l'écrivait, parce que rien
    // ne réordonnait les repas jusqu'ici. La recherche a aussitôt proposé un
    // dîner à 12h45 suivi d'un déjeuner à 13h55 — et les onze autres règles
    // l'ont laissé passer.
    verifier({ calc, reference }) {
      if (!reference) return []
      const rang = {}
      ;(reference.etapes || []).filter((e) => e.type === 'repas').forEach((e, i) => { rang[e.id] = i })
      const vus = (calc.etapes || []).filter((e) => e.type === 'repas' && rang[e.id] != null)
      const ecarts = []
      for (let i = 1; i < vus.length; i++) {
        if (rang[vus[i].id] < rang[vus[i - 1].id]) {
          ecarts.push(`${nomEtape(vus[i])} (${minutesVersHm(vus[i].debut)}) passe avant ${nomEtape(vus[i - 1])} (${minutesVersHm(vus[i - 1].debut)}).`)
        }
      }
      return ecarts
    },
  },
  {
    id: 'diner-fenetre',
    dure: true,
    titre: 'Fenêtre du dîner',
    enonce: 'Le dîner commence entre 18h00 et 21h00.',
    // Deuxième trou révélé par la recherche, après l'ordre des repas : rien
    // n'écrivait qu'un dîner se prend le soir. Elle en a proposé un à 14h57.
    verifier({ calc, contraintes }) {
      const f = contraintes.repas && contraintes.repas.fenetreDiner
      if (!f) return []
      const [min, max] = f.map(hmVersMinutes)
      return (calc.etapes || [])
        .filter((e) => !e.fait && e.type === 'repas' && /DÎNER/i.test(e.titre))
        .filter((e) => e.debut < min || e.debut > max)
        .map((e) => `${nomEtape(e)} commence à ${minutesVersHm(e.debut)}, hors de la fenêtre ${f[0]}–${f[1]}.`)
    },
  },
  {
    id: 'repas-plancher',
    dure: true,
    titre: 'Plancher des repas',
    enonce: 'Un repas ne descend pas sous 50 min, ou 40 si le Click & Collect a été utilisé. Cinq personnes au comptoir, ça ne se presse pas.',
    verifier({ calc, contraintes, etat }) {
      const r = contraintes.repas || {}
      const cc = !!(etat && etat.clickCollect)
      const plancher = cc ? (r.plancherAvecClickCollect ?? 40) : (r.plancher ?? 50)
      return (calc.etapes || [])
        .filter((e) => !e.fait && e.type === 'repas' && e.duree < plancher)
        .map((e) => `${nomEtape(e)} dure ${e.duree} min, sous le plancher de ${plancher}${cc ? ' (Click & Collect)' : ''}.`)
    },
  },
  {
    id: 'flaner-plancher',
    dure: true,
    titre: 'Plancher des flâneries',
    enonce: 'Un FLÂNER se réduit jusqu’à 10 min, jamais en dessous, et ne disparaît pas.',
    verifier({ calc }) {
      return (calc.etapes || [])
        .filter((e) => !e.fait && e.type === 'flaner' && e.duree < PLANCHERS.flaner)
        .map((e) => `${nomEtape(e)} dure ${e.duree} min, sous le plancher de ${PLANCHERS.flaner}.`)
    },
  },
  {
    id: 'transitions-intactes',
    dure: true,
    titre: 'Les transitions restent',
    enonce: 'Une TRANSITION ne se supprime pas, et ne descend jamais sous la marche réelle plus 5 min de toilettes — 10 min au minimum.',
    // La règle protégeait la DURÉE ÉCRITE. Or ces durées venaient d'une matrice
    // « estimée à la main sur les plans », jamais mesurée : le parent a chronométré
    // World Premiere Plaza → World of Frozen à ~12 min pour 25 budgétées. La
    // règle défendait donc une erreur, et bloquait 88 minutes de la journée.
    //
    // Ce qu'il faut protéger, c'est le BESOIN : le temps de marcher vraiment,
    // plus une pause toilettes avec une enfant de cinq ans. Pas un chiffre.
    verifier({ jour, reference }) {
      if (!reference) return []
      const ix = {}
      for (const e of jour.etapes || []) ix[e.id] = e
      const matrice = (jour.marche && jour.marche.matrice) || {}
      const etapes = jour.etapes || []
      const besoin = (e) => {
        const i = etapes.findIndex((x) => x.id === e.id)
        const avant = etapes.slice(0, i).reverse().find((x) => x.zone)
        const apres = etapes.slice(i + 1).find((x) => x.zone && x.type !== 'transition')
        const d = avant && apres && matrice[avant.zone] ? (matrice[avant.zone][apres.zone] || 0) : 0
        // La borne, c'est POUVOIR MARCHER : la distance réelle, jamais moins
        // de 10 min pour les toilettes. Les 5 min de marge sont un confort
        // qu'on vise, pas un minimum qu'on impose.
        return Math.max(10, d)
      }
      return (reference.etapes || [])
        .filter((e) => e.type === 'transition')
        // Les trajets que MES recalculs ont fabriqués (`t-`, `tr-`) ne sont pas
        // des engagements : ils naissent et meurent avec un ordre de journée.
        // Les protéger revenait à me faire défendre mes propres brouillons, et
        // bloquait toute reconstruction.
        .filter((e) => !/^tr?-/.test(e.id))
        .filter((e) => !ix[e.id] || ix[e.id].duree < besoin(ix[e.id]))
        .map((e) => ix[e.id]
          ? `${nomEtape(e)} dure ${ix[e.id].duree} min ; il en faut ${besoin(ix[e.id])} pour la marche et les toilettes.`
          : `${nomEtape(e)} a disparu ; une transition ne se supprime pas.`)
    },
  },
  {
    id: 'precedences',
    dure: true,
    titre: 'Précédences',
    enonce: 'Certaines étapes doivent en précéder d’autres — le maquillage avant les princesses, pour les photos.',
    verifier({ calc, contraintes }) {
      const rang = {}
      ;(calc.etapes || []).forEach((e, i) => { rang[e.id] = i })
      return (contraintes.precedences || [])
        .filter((p) => rang[p.avant] != null && rang[p.apres] != null && rang[p.avant] > rang[p.apres])
        .map((p) => `${p.avant} doit précéder ${p.apres} — ${p.pourquoi}`)
    },
  },
  {
    id: 'seances-reelles',
    dure: true,
    titre: 'Séances qui existent',
    enonce: 'Une étape dont l’attraction fonctionne par séances doit tomber sur une séance réellement programmée. Vaut aussi pour une étape qui FLOTTE : une ancre dormante n’exempte de rien.',
    verifier({ calc, plan }) {
      const dehors = []
      for (const e of calc.etapes || []) {
        if (e.fait) continue
        const p = e.ancre ? (plan.parametres || []).find((x) => x.id === e.ancre.parametre) : null
        // Trois sources, par ordre de fraîcheur : le relevé du jour, les séances
        // inscrites au paramètre, celles archivées par le collecteur.
        const live = (e.files && e.files.principale && e.files.principale.seances) || []
        const duPlan = (p && p.seances) || []
        const archivees = (p && p.seancesRelevees && p.seancesRelevees.heures) || []
        const liste = live.length ? live : duPlan.length ? duPlan : archivees
        if (!liste.length) continue
        // Une séance doit tomber DANS la fenêtre de l'étape. Sinon le groupe
        // arrive devant une salle vide, ancre dormante ou pas.
        const dedans = liste.filter((h) => {
          const m = hmVersMinutes(h)
          return m != null && m >= e.debut && m <= e.fin
        })
        if (!dedans.length) {
          dehors.push(`${nomEtape(e)} est placé ${minutesVersHm(e.debut)}–${minutesVersHm(e.fin)}, or aucune séance n’y tombe (${liste.join(' ')}).`)
        }
      }
      return dehors
    },
  },
  {
    id: 'heures-ouverture',
    dure: true,
    titre: 'Attractions ouvertes',
    enonce: 'Une étape doit se dérouler pendant que son attraction est ouverte. Main Street Vehicles ferme à 14h45, Thunder Mesa à 17h00.',
    verifier({ calc }) {
      const dehors = []
      for (const e of calc.etapes || []) {
        const f = e.files && e.files.principale
        if (!f || f.inconnue) continue
        if (f.fermetureHm) {
          const ferme = hmVersMinutes(f.fermetureHm)
          if (ferme != null && e.debut >= ferme) {
            dehors.push(`${nomEtape(e)} commence à ${minutesVersHm(e.debut)} ; ${f.nom} ferme à ${f.fermetureHm}.`)
          }
        }
        if (f.ouvertureHm) {
          const ouvre = hmVersMinutes(f.ouvertureHm)
          if (ouvre != null && e.fin <= ouvre) {
            dehors.push(`${nomEtape(e)} finit à ${minutesVersHm(e.fin)} ; ${f.nom} n’ouvre qu’à ${f.ouvertureHm}.`)
          }
        }
      }
      return dehors
    },
  },
  {
    id: 'aucun-chevauchement',
    dure: true,
    titre: 'Pas de chevauchement',
    enonce: 'Aucune étape ancrée ne commence avant la fin de ce qui la précède, au-delà de la marge tolérée.',
    // La marge existe parce que les attentes du plan sont celles ANNONCÉES par
    // Disney, qui surestime : 45 annoncées valent souvent 30 réelles. Refuser
    // une journée pour 7 minutes sur le papier, c'est refuser une journée qui
    // passe en vrai. Le parent l'a tranché : « si un plan ne rentre pas à cause de
    // 15 min, laisse-le passer. »
    //
    // Elle s'applique au TOTAL, pas à chaque étape : dix chevauchements de
    // 14 min ne sont pas une journée qui tient.
    verifier({ calc, contraintes }) {
      const marge = (contraintes && contraintes.margeChevauchement) || 0
      // Une etape FAITE ne se juge plus : le chevauchement qu'elle porte
      // appartient au passe, il ne se corrigera jamais et polluait le total.
      const debords = (calc.etapes || [])
        .filter((e) => !e.fait && e.controle && e.controle.type === 'chevauchement')
      const total = debords.reduce((s, e) => s + (e.controle.minutes || 0), 0)
      if (total <= marge) return []
      return debords.map((e) =>
        `${nomEtape(e)} chevauche ce qui précède de ${e.controle.minutes} min`
        + ` (total ${total} min, marge tolérée ${marge}).`)
    },
  },
  {
    id: 'fin-de-journee',
    dure: true,
    titre: 'Heure de sortie',
    enonce: 'Le jour 2 vise 20h00, 21h00 au maximum et seulement avec l’accord du parent. Le jour 1 ne dépasse pas la fermeture du parc.',
    verifier({ jour, calc, contraintes, plan }) {
      const der = (calc.etapes || [])[calc.etapes.length - 1]
      if (!der) return []
      if (jour.numero === 2) {
        const max = hmVersMinutes((contraintes.departJour2 || {}).maximum || '21:00')
        if (der.fin > max) return [`La journée finit à ${minutesVersHm(der.fin)}, après le maximum de ${minutesVersHm(max)}.`]
        return []
      }
      const p = (plan.parametres || []).find((x) => x.jour === 1 && x.type === 'ouverture')
      const fermeture = p && p.fermeture ? hmVersMinutes(p.fermeture) : hmVersMinutes('22:00')
      if (der.fin > fermeture + 30) return [`La journée finit à ${minutesVersHm(der.fin)}, après la fermeture du parc.`]
      return []
    },
  },
  {
    id: 'profil-enfant',
    dure: false,
    titre: 'Ce que la petite peut faire',
    enonce: 'Cinq ans, pas de sensations fortes. Toute attraction ajoutée doit lui convenir, et les substitutions du plan sont les seules déjà validées.',
    verifier({ jour, reference }) {
      if (!reference) return []
      const connues = new Set([
        ...(reference.etapes || []).flatMap((e) => (e.attractions || []).map((a) => a.id)),
        ...(reference.substitutions || []).map((s) => s.id),
      ])
      return (jour.etapes || [])
        .flatMap((e) => (e.attractions || []).map((a) => ({ e, a })))
        .filter(({ a }) => !connues.has(a.id))
        .map(({ e, a }) => `${nomEtape(e)} introduit ${a.nom}, qui n’est ni au plan de référence ni dans les substitutions validées — vérifier qu’elle convient à une enfant de 5 ans.`)
    },
  },
  {
    id: 'flaneries-collees',
    dure: false,
    titre: 'Deux flâneries ne se suivent pas',
    enonce: 'Deux temps libres consécutifs font un trou, pas une pause. On les répartit.',
    // Regle du parent, 3 septembre : « je veux pas enchainer 2 flaneries ».
    // Une heure de temps libre d un seul tenant, ce n est pas du repos : c est
    // un moment ou personne ne sait quoi faire. Reparties, les memes minutes
    // respirent entre deux activites.
    //
    // Les TRANSITION ne comptent pas comme separation : marcher entre deux
    // flaneries, ca reste du temps libre.
    verifier({ calc }) {
      const utiles = (calc.etapes || []).filter((e) => e.type !== 'transition')
      const colles = []
      for (let i = 1; i < utiles.length; i++) {
        const a = utiles[i - 1], b = utiles[i]
        if (a.type === 'flaner' && b.type === 'flaner') {
          colles.push(`${nomEtape(a)} et ${nomEtape(b)} se suivent (${minutesVersHm(a.debut)} puis ${minutesVersHm(b.debut)}).`)
        }
      }
      return colles
    },
  },
  {
    id: 'pause-toilettes',
    dure: false,
    titre: 'Toilettes toutes les deux heures',
    enonce: "Jamais plus de 2h sans occasion d'aller aux toilettes, et jamais une longue file juste après.",
    // Règle du parent, 2 septembre : « avant toute queue un peu longue il faut
    // prévoir un temps pipi, même toutes les 2h ».
    //
    // Comptent comme occasion : les TRANSITION (marche + toilettes) et les
    // REPAS (on est assis, les toilettes sont là). Pas les spectacles — on y
    // est assis mais coincé — ni les flâneries, qui n'en garantissent aucune.
    //
    // Souple à dessein : la recherche de plan ne sait pas encore fabriquer une
    // pause toute seule. Une violation dure la laisserait sans solution en
    // pleine journée. Elle avertit, et c'est à moi d'insérer la pause.
    verifier({ calc }) {
      const etapes = calc.etapes || []
      if (!etapes.length) return []
      const alertes = []
      let depuis = etapes[0].debut
      let nom = 'le début de la journée'
      for (const e of etapes) {
        if (e.type === 'transition' || e.type === 'repas') {
          if (e.debut - depuis > 120) {
            alertes.push(`${Math.round(e.debut - depuis)} min sans toilettes entre ${nom} et ${nomEtape(e)}.`)
          }
          depuis = e.fin
          nom = nomEtape(e)
        }
      }
      const fin = etapes[etapes.length - 1].fin
      if (fin - depuis > 120) alertes.push(`${Math.round(fin - depuis)} min sans toilettes entre ${nom} et la fin de la journée.`)
      return alertes
    },
  },
  {
    id: 'marche-realiste',
    dure: false,
    titre: 'Temps de marche',
    enonce: 'Deux étapes consécutives dans des zones éloignées demandent une transition. Les temps de marche sont dans jours[].marche.',
    verifier({ jour, calc }) {
      const m = (jour.marche && jour.marche.matrice) || null
      if (!m) return []
      const alertes = []
      const etapes = calc.etapes || []
      for (let i = 1; i < etapes.length; i++) {
        const a = etapes[i - 1], b = etapes[i]
        if (!a.zone || !b.zone || a.zone === b.zone) continue
        if (b.type === 'transition' || a.type === 'transition') continue
        const t = (m[a.zone] || {})[b.zone]
        if (t != null && t >= 8) {
          alertes.push(`${nomEtape(a)} → ${nomEtape(b)} : ${t} min de marche entre ${a.zone} et ${b.zone}, sans transition entre les deux.`)
        }
      }
      return alertes
    },
  },
]

// Passe le plan au crible. `reference` est le plan d'origine, pour détecter les
// disparitions ; sans lui, ces règles-là ne peuvent rien dire et se taisent.
// La date du jour à Paris, AAAA-MM-JJ.
const dateParis = () => new Intl.DateTimeFormat('fr-CA',
  { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

// `attentesParJour(numero)` donne les données en direct DU PARC de ce jour-là.
// `attentes`, une seule table pour les deux jours, reste accepté pour les
// outils : c'est ce que le serveur passait, et le jour 1 était alors contrôlé
// avec les séances du parc du jour 2.
export function verifierPlan(plan, { etat = {}, attentes = {}, attentesParJour = null, reference = null, calculerJour, aujourdhui = dateParis() } = {}) {
  const contraintes = plan.contraintes || {}
  const violations = []
  const avertissements = []

  for (const numero of [1, 2]) {
    const jour = (plan.jours || []).find((j) => j.numero === numero)
    if (!jour) continue
    // UNE JOURNEE VECUE NE SE JUGE PLUS. Ses etapes portent des horaires qui
    // n'ont plus de sens, ses repas sont derriere, et elle ne sera plus jamais
    // poussee. La juger, c'est refuser le plan du LENDEMAIN pour des fautes
    // d'hier — ce qui est arrive au premier recalcul du jour 2.
    if (jour.masque) continue
    const jourRef = reference ? (reference.jours || []).find((j) => j.numero === numero) : null
    // Une journée PASSÉE ne se contrôle pas contre le direct : les séances
    // relevées aujourd'hui décrivent aujourd'hui. Le 13 septembre, la parade
    // était à 17h30 ; celle du 4, à 11h30 — et le plan du 4 était refusé pour ça.
    // Avant et pendant la journée, le direct reste la meilleure source.
    const live = jour.date && jour.date < aujourdhui ? {}
      : attentesParJour ? (attentesParJour(numero) || {}) : attentes
    let calc
    try {
      calc = calculerJour(plan, numero, etat, live)
    } catch (err) {
      violations.push({ regle: 'moteur', titre: 'Plan illisible', message: `Jour ${numero} : ${err.message}` })
      continue
    }
    if (!calc) continue

    for (const regle of REGLES) {
      let messages = []
      try {
        messages = regle.verifier({ plan, jour, calc, contraintes, etat, attentes: live, reference: jourRef }) || []
      } catch (err) {
        messages = [`contrôle impossible : ${err.message}`]
      }
      for (const message of messages) {
        const entree = { regle: regle.id, titre: regle.titre, jour: numero, message }
        if (regle.dure) violations.push(entree)
        else avertissements.push(entree)
      }
    }
  }

  return { ok: violations.length === 0, violations, avertissements }
}

// Le texte que le brief transmet : toutes les règles, dans l'ordre, sans en
// omettre une seule. Ce que je lis au moment de recalculer.
export function enoncerRegles(plan) {
  const c = plan.contraintes || {}
  const L = []
  for (const r of REGLES) {
    L.push(`  ${r.dure ? '[DUR]' : '[MOU]'} ${r.titre} — ${r.enonce}`)
  }
  if (c.ordreDesLeviers) {
    L.push('')
    L.push('  Ordre des leviers, du moins coûteux au plus coûteux :')
    for (const l of c.ordreDesLeviers) L.push(`    ${l}`)
  }
  if (c.premierAcces) {
    L.push('')
    for (const k of ['quandLeProposer', 'prefererAuSacrifice', 'creneauImpose', 'unSeulALaFois', 'parPersonne', 'commentLeProposer']) {
      if (c.premierAcces[k]) L.push(`  Premier Access — ${c.premierAcces[k]}`)
    }
  }
  if (c.substitutions) {
    L.push('')
    L.push(`  Substitutions — ${c.substitutions.note || 'autorisées'}`)
  }
  return L.join('\n')
}
