// Collecteur de temps d'attente — SERVICE INDÉPENDANT.
//
// Volontairement séparé de l'application : redémarrer l'app pendant qu'on la
// développe ne doit pas trouer l'historique. Ce process ne fait qu'une chose,
// et il la fait sans interruption.
//
//   node collecteur/service.js            tourne en continu
//   node collecteur/service.js --une-fois un seul relevé, puis sort
//
// Écrit dans data/attentes/AAAA-MM-JJ-jourN.jsonl, un fichier par jour et par
// parc. Première ligne = en-tête (correspondance id → nom), lignes suivantes =
// un relevé chacune. Rien n'est jamais réécrit.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerCollecteur } from '../backend/lib/attentes.js'
import { creerAlertes } from './alertes.js'
import { releverHoraires } from './horaires.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const DOSSIER = path.join(RACINE, 'attentes')
const UNE_FOIS = process.argv.includes('--une-fois')
const FUSEAU = 'Europe/Paris'

const plan = JSON.parse(fs.readFileSync(path.join(RACINE, 'plan.json'), 'utf8'))
const PARCS = plan.fileAttente.parcs
const INTERVALLE = Number(process.env.INTERVALLE_MIN) || plan.fileAttente.intervalleMinutes || 5
// Minutes après l'heure du premier relevé : 1 => 14h01, 14h06, 14h11…
const DECALAGE = Number(process.env.DECALAGE_MIN ?? plan.fileAttente.decalageMinutes ?? 1)

const horodatage = () => new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date())
const dateDuJour = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSEAU })
const heureDuJour = () => new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date()).replace('h', ':')

const nomParc = { 1: 'Disney Adventure World', 2: 'Disneyland Park' }
const BATTEMENT = path.join(DOSSIER, 'etat-collecteur.json')

// Au-delà de ce silence sans un seul tour réussi, on considère le process
// coincé et on le tue : Docker le relance. Un process vivant qui ne collecte
// rien est pire qu'un process mort — personne ne s'en aperçoit.
const SILENCE_MAX_MIN = Number(process.env.SILENCE_MAX_MIN) || 20

const sante = {
  demarreLe: new Date().toISOString(),
  pid: process.pid,
  dernierTour: null,
  dernierSucces: null,
  toursOk: 0,
  toursErreur: 0,
  derniereErreur: null,
  releves: 0,
}

async function ecrireBattement() {
  const tmp = BATTEMENT + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify({ ...sante, intervalleMinutes: INTERVALLE }, null, 2), 'utf8')
  await fsp.rename(tmp, BATTEMENT)
}
const entetesEcrites = new Set()
// Dernier état écrit, par jour : sert à n'archiver que les changements.
const dernierFv = {}
const dernieresSeances = {}

async function fichierDuJour(jour, entites, tous = []) {
  const chemin = path.join(DOSSIER, `${dateDuJour()}-jour${jour}.jsonl`)
  const cle = chemin
  if (!entetesEcrites.has(cle) && !fs.existsSync(chemin)) {
    const noms = {}
    for (const e of entites) noms[e.id] = e.nom
    for (const e of tous) if (e.fileVirtuelle || (e.seances || []).length) noms[e.id] = e.nom
    await fsp.appendFile(chemin, JSON.stringify({
      type: 'entete', jour: Number(jour), parc: nomParc[jour], date: dateDuJour(),
      intervalleMinutes: INTERVALLE, attractions: noms,
    }) + '\n', 'utf8')
  }
  entetesEcrites.add(cle)
  return chemin
}

// Noms des entités, tenus à jour à chaque tour : l'en-tête du fichier du jour
// est écrit une fois pour toutes le matin et ne connaît pas les spectacles
// apparus depuis.
const nomsConnus = {}

const alertes = creerAlertes({
  dossierData: RACINE,
  dossierCollecteur: __dirname,
  journaliser: (m) => console.log(`[${horodatage()}] ${m}`),
})

async function ecrire(jour, entites) {
  // On ne garde que les attractions : les spectacles n'ont pas de file, et
  // écrire 288 lignes de « tout est fermé » chaque nuit ne sert personne.
  const attractions = entites.filter((e) => e.type === 'ATTRACTION')
  if (!attractions.some((e) => e.ouverte)) return 0

  const chemin = await fichierDuJour(jour, attractions, entites)
  const w = {}, sr = {}, pa = {}, par = {}, fermees = []
  for (const e of attractions) {
    if (!e.ouverte) { fermees.push(e.id); continue }
    if (typeof e.attente === 'number') w[e.id] = e.attente
    if (typeof e.singleRider === 'number') sr[e.id] = e.singleRider
    if (e.premierAcces && e.premierAcces.prix != null) pa[e.id] = e.premierAcces.prix
    // LA FENÊTRE DE RETOUR, et pas seulement le prix.
    //
    // On ne gardait que le prix — qui, mesuré sur deux jours, ne bouge jamais :
    // Frozen 16 €, Ratatouille 12 €, Raiponce 5 €, du matin au soir. La donnée
    // utile est ailleurs : la fenêtre de retour est IMPOSÉE à l'achat et avance
    // au fil de la journée. Acheter tôt donne un retour tôt — mais sans série,
    // impossible de dire au parent ce que « tôt » lui rapporte vraiment.
    //
    // Archivée en clair « 17:45-18:45 » : c'est court, et ça se relit sans clé.
    if (e.premierAcces && e.premierAcces.retourDebut) {
      par[e.id] = e.premierAcces.retourDebut + '-' + (e.premierAcces.retourFin || '?')
    }
  }
  // Les files virtuelles et les séances vivent sur des entités typées SHOW par
  // l'API : le filtre ATTRACTION ci-dessus les écartait, et on n'avait donc
  // aucune trace des heures d'ouverture d'une file ni du calendrier d'un
  // spectacle. On les archive, mais seulement QUAND ÇA CHANGE : recopier le
  // même état toutes les cinq minutes gonflerait le fichier pour rien.
  const fv = {}, seances = {}
  for (const e of entites) {
    nomsConnus[e.id] = e.nom
    if (e.fileVirtuelle) {
      fv[e.id] = e.fileVirtuelle.disponible
        ? ['ouverte', e.fileVirtuelle.retourDebut, e.fileVirtuelle.retourFin]
        : [e.fileVirtuelle.etat || 'complete']
    }
    if ((e.seances || []).length) seances[e.id] = e.seances
  }

  const ligne = { t: heureDuJour(), iso: new Date().toISOString(), w }
  if (Object.keys(sr).length) ligne.sr = sr
  if (Object.keys(pa).length) ligne.pa = pa
  // Archivée à CHAQUE relevé, pas seulement quand elle change : c'est une
  // courbe qu'on veut (l'heure d'achat contre l'heure de passage), pas un
  // journal d'événements.
  if (Object.keys(par).length) ligne.par = par
  if (fermees.length) ligne.f = fermees
  const cleFv = JSON.stringify(fv)
  if (Object.keys(fv).length && cleFv !== dernierFv[jour]) {
    const avant = dernierFv[jour] ? JSON.parse(dernierFv[jour]) : {}
    ligne.fv = fv
    dernierFv[jour] = cleFv
    // Le mail part APRÈS l'archivage et sans être attendu : une panne de SMTP
    // ne doit ni retarder ni interrompre la collecte.
    alertes.surTransitions({ jour, avant, apres: fv, noms: nomsConnus, entites })
      .catch((e) => console.log(`[${horodatage()}] [mail] ${e.message}`))
  }
  const cleS = JSON.stringify(seances)
  if (Object.keys(seances).length && cleS !== dernieresSeances[jour]) { ligne.s = seances; dernieresSeances[jour] = cleS }
  await fsp.appendFile(chemin, JSON.stringify(ligne) + '\n', 'utf8')
  return Object.keys(w).length
}

async function main() {
  await fsp.mkdir(DOSSIER, { recursive: true })
  const c = creerCollecteur({ parcs: PARCS, intervalleMinutes: INTERVALLE })

  console.log(`Collecteur de temps d'attente`)
  console.log(`  dossier    : ${DOSSIER}`)
  console.log(`  intervalle : ${INTERVALLE} min, calé sur h+${DECALAGE} min`)
  console.log(`  parcs      : ${Object.keys(PARCS).map((j) => `jour ${j}`).join(', ')}`)
  console.log(`  (rien n'est écrit tant que le parc est fermé)`)

  const tour = async () => {
    sante.dernierTour = new Date().toISOString()
    let unSucces = false
    for (const jour of Object.keys(PARCS)) {
      try {
        await c.collecter(jour)
        const d = c.lire(jour)
        if (d.erreur) throw new Error(d.erreur)
        const n = await ecrire(jour, d.entites)
        sante.releves += n
        unSucces = true
        console.log(`[${horodatage()}] jour ${jour} : ${n ? `${n} attentes` : 'parc fermé, rien à écrire'}`)
      } catch (err) {
        // Un tour raté ne doit jamais arrêter le service.
        sante.toursErreur++
        sante.derniereErreur = { quand: new Date().toISOString(), message: err.message }
        console.error(`[${horodatage()}] jour ${jour} : ${err.message}`)
      }
    }
    if (unSucces) { sante.toursOk++; sante.dernierSucces = new Date().toISOString() }

    // Horaires du jour : chaque attraction a les siens, et ils ne bougent pas
    // dans la journée. Un seul relevé, le premier tour où le parc est ouvert.
    // Sans ça, on proposerait Main Street Vehicles en soirée alors qu'elle
    // ferme à 14h45.
    if (unSucces) {
      releverHoraires({ dossier: DOSSIER, plan, journaliser: (m) => console.log(`[${horodatage()}] ${m}`) })
        .catch((e) => console.error(`[${horodatage()}] [horaires] ${e.message}`))
    }
    try { await ecrireBattement() } catch {}

    // Chien de garde : muet trop longtemps, on sort en erreur pour être relancé.
    const silence = sante.dernierSucces
      ? (Date.now() - new Date(sante.dernierSucces).getTime()) / 60000
      : (Date.now() - new Date(sante.demarreLe).getTime()) / 60000
    if (silence > SILENCE_MAX_MIN) {
      console.error(`[${horodatage()}] aucun relevé depuis ${Math.round(silence)} min — arrêt pour relance`)
      process.exit(1)
    }
  }

  await tour()
  if (UNE_FOIS) return

  // Relevés calés sur l'horloge, pas sur l'heure de démarrage : à DECALAGE
  // minutes après l'heure, puis tous les INTERVALLE minutes. Avec un décalage
  // de 1 et un intervalle de 5 : 14h01, 14h06, 14h11…
  //
  // Les vagues de files virtuelles s'ouvrent à des heures rondes ; arriver une
  // minute après, plutôt qu'à un moment quelconque, réduit le délai de détection.
  //
  // On reprogramme après CHAQUE tour au lieu d'utiliser setInterval : un tour
  // lent, une mise en veille ou un changement d'heure décaleraient un intervalle
  // fixe pour toujours. Là, chaque tour se recale sur l'horloge.
  const prochainCreneau = () => {
    const m = new Date()
    const minutes = m.getHours() * 60 + m.getMinutes()
    // Combien de minutes jusqu'au prochain multiple d'INTERVALLE décalé de DECALAGE.
    let attente = (INTERVALLE - (((minutes - DECALAGE) % INTERVALLE) + INTERVALLE) % INTERVALLE)
    if (attente === 0) attente = INTERVALLE
    const cible = new Date(m)
    cible.setMinutes(m.getMinutes() + attente, 0, 0)
    return Math.max(1000, cible.getTime() - m.getTime())
  }

  const programmer = () => setTimeout(async () => {
    try { await tour() } catch (e) { console.error(`[${horodatage()}] tour : ${e.message}`) }
    programmer()
  }, prochainCreneau())

  console.log(`  prochain relevé dans ${Math.round(prochainCreneau() / 1000)} s`)
  programmer()
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { console.log(`\n[${horodatage()}] arrêt demandé`); process.exit(0) })
  }
  process.on('unhandledRejection', (e) => console.error('[rejet non géré]', e && e.message))
  process.on('uncaughtException', (e) => console.error('[exception non gérée]', e && e.message))
}

main()
