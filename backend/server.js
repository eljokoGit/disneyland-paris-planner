// Déploiement : ce fichier vit sur le PC du parent et arrive ici par Syncthing
// (dossier « Disney-App »). Sur le serveur, watch-and-rebuild.sh surveille
// backend/ frontend/ shared/ et le Dockerfile, et reconstruit le conteneur dès
// que l'arbre est stable. data/ est délibérément hors de cette surveillance :
// plan.json est rechargé à chaud, un rebuild couperait les téléphones.

import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ecrireAtomique, ecrireJsonAtomique, lireJson, journaliser, surveiller, nettoyerTemporaires } from './lib/fichiers.js'
import { creerCollecteur } from './lib/attentes.js'
import { moyennesJour } from './lib/historique.js'
import { briefRecalcul } from '../shared/brief.js'
import { verifierPlan } from '../shared/contraintes.js'
import { lireHoraires } from '../collecteur/horaires.js'
import { situation, resumeTexte, calculerJour, ordreSacrifice, hmVersMinutes, minutesVersHm } from '../shared/moteur.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const F_PLAN = path.join(RACINE, 'plan.json')
const F_ETAT = path.join(RACINE, 'etat-courant.json')
const F_JOURNAL = path.join(RACINE, 'journal.jsonl')
const STATIQUE = process.env.STATIC_DIR || path.join(__dirname, '..', 'frontend', 'dist')
const PORT = Number(process.env.PORT) || 3000
const CLE = process.env.APP_CLE || ''
const FUSEAU = process.env.TZ_APP || 'Europe/Paris'

const ETAT_VIDE = {
  version: 2, jourActif: 1,
  etapesFaites: {}, etapesSupprimees: [], ancresDecrochees: [],
  durees: {}, ordreSacrifice: {},
  // { "j1-e18": { motif: "Météo", horodatage } } — imposé, pas choisi.
  annulees: {},
  // Files virtuelles qu'on NE suit PAS. Tout est suivi par défaut : on ne
  // stocke que les exclusions décidées par le parent. { "<attractionId>": true }
  filesNonSuivies: {},
  // Créneaux obtenus sur des files hors plan. { "<attractionId>": "15:30" }
  creneauxLibres: {},
  // { "esc-4": true } — escapades solo déjà utilisées.
  escapades: {},
  parametres: {}, creneaux: {},
  // Date (Europe/Paris) à laquelle la PROGRESSION ci-dessus appartient. Sert à
  // repartir d'une journée vierge quand on change de jour.
  // Le Click & Collect a-t-il ete utilise ? Il fait tomber le plancher du
  // repas de 50 a 40 min. Le code le lisait deja ; rien ne le reglait.
  clickCollect: false,
  journeeDate: null,
  majLe: null,
}

// Ce qui est de la PROGRESSION, et disparaît donc au changement de jour. Le
// reste survit : `filesNonSuivies` sont les alertes mail que le parent a choisies.
//
// Un retrait ou une durée DÉCIDÉS AU RECALCUL n'ont rien à faire ici : ils
// s'écrivent dans le plan (`actif: false`, `duree`), que minuit ne touche pas.
// Le 4 septembre au matin, faute de ça, le déjeuner et Le Pays des Contes de
// Fées retirés la veille étaient revenus tout seuls.
const CHAMPS_PROGRESSION = {
  etapesFaites: {}, etapesSupprimees: [], ancresDecrochees: [],
  durees: {}, annulees: {}, creneauxLibres: {},
  escapades: {}, parametres: {}, creneaux: {},
}

let plan = null
let etat = null

async function chargerPlan() {
  const p = await lireJson(F_PLAN)
  if (!p) throw new Error(`plan.json introuvable ou illisible dans ${RACINE}`)
  plan = p
  return p
}

async function chargerEtat() {
  const e = await lireJson(F_ETAT)
  etat = { ...ETAT_VIDE, ...(e || {}) }
  return etat
}

async function sauverEtat(evenement) {
  etat.majLe = new Date().toISOString()
  // L'état en mémoire fait foi et les clients sont prévenus même si le disque
  // refuse : mieux vaut une sauvegarde ratée qu'un serveur mort.
  try {
    await ecrireJsonAtomique(F_ETAT, etat)
  } catch (err) {
    console.error('[état] écriture impossible :', err.code || err.message)
  }
  if (evenement) {
    try { await journaliser(F_JOURNAL, evenement) }
    catch (err) { console.error('[journal] écriture impossible :', err.code || err.message) }
  }
  diffuser('etat')
}

// Heure locale du parc, indépendante du fuseau du serveur.
function maintenantMinutes() {
  const s = new Intl.DateTimeFormat('fr-FR', {
    timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  return hmVersMinutes(s.replace('h', ':'))
}

// La date du jour à Paris, en AAAA-MM-JJ. Pas `toISOString()`, qui rend la date
// UTC : le 3 septembre à 01h du matin heure de Paris, elle dirait encore le 2.
function dateDuJour() {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// REPARTIR D'UNE JOURNÉE VIERGE QUAND LE JOUR CHANGE.
//
// Sans ça, la progression d'hier reste : le 3 septembre à 8h45, l'application
// se serait ouverte sur une journée à moitié faite, avec les étapes de la
// veille cochées et une attraction annulée. Rien ne nettoyait ça, et la panne
// est silencieuse — on ne s'en aperçoit qu'en la subissant, dans le parc.
//
// Deux précautions, parce qu'une remise à zéro qui part de travers efface une
// vraie journée :
//   - l'état complet est ARCHIVÉ avant d'être vidé, donc rien n'est perdu ;
//   - seule la progression est effacée. Les alertes que le parent a réglées et les
//     préparatifs d'avant-voyage survivent.
// La journée du voyage a-t-elle COMMENCÉ ? C'est le garde-fou : une fois que
// Le parent est dans le parc, plus rien n'a le droit d'effacer sa progression. Il
// reste les recalculs, qui ne touchent qu'aux étapes à venir.
//
// « Commencée » se mesure sur l'horloge, pas sur ce qui est coché : arriver en
// retard et n'avoir rien validé ne veut pas dire que la journée n'a pas
// démarré. On prend l'heure de la première étape du plan.
function journeeEnCours() {
  const jour = dateDuJour()
  const duJour = (plan.jours || []).find((j) => j.date === jour)
  if (!duJour) return null
  const calc = calculerJour(plan, duJour.numero, etat, indexAttentes(duJour.numero))
  const debut = calc && calc.etapes.length ? calc.etapes[0].debut : null
  if (debut == null) return null
  return maintenantMinutes() >= debut ? { jour: duJour, debut } : null
}

async function nouvelleJourneeSiJourChange() {
  const jour = dateDuJour()
  if (etat.journeeDate === jour) return false

  // GARDE-FOU. Effacer la progression d'une journée déjà commencée serait la
  // pire panne possible : le parent dans le parc, l'application qui oublie tout ce
  // qui est fait. On ne l'autorise jamais.
  //
  // Le passage du jeudi soir au vendredi matin reste possible : à minuit, la
  // journée du vendredi n'a pas commencé, et ce qu'on efface appartient à la
  // veille. Ce qui est interdit, c'est d'effacer la journée du jour même.
  const enCours = journeeEnCours()
  if (enCours && etat.journeeDate === jour) {
    console.log(`[journée] ${jour} a commencé à ${minutesVersHm(enCours.debut)} : remise à zéro REFUSÉE`)
    return false
  }

  const premiere = etat.journeeDate == null
  const aQuelqueChose = Object.keys(CHAMPS_PROGRESSION)
    .some((k) => Object.keys(etat[k] || {}).length > 0)

  // Au tout premier démarrage il n'y a rien à archiver ni à vider : on pose la
  // date, sans faire croire à une remise à zéro.
  if (premiere && !aQuelqueChose) {
    etat.journeeDate = jour
    await sauverEtat(null)
    return false
  }

  try {
    const dossier = path.join(RACINE, 'etats-precedents')
    fs.mkdirSync(dossier, { recursive: true })
    const nom = `etat-${etat.journeeDate || 'inconnu'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    fs.writeFileSync(path.join(dossier, nom), JSON.stringify(etat, null, 1))
    console.log(`[journée] état archivé dans ${nom}`)
  } catch (err) {
    // Ne pas vider si on n'a pas su archiver : mieux vaut une journée sale
    // qu'une journée perdue.
    console.error('[journée] archivage impossible, remise à zéro ANNULÉE :', err.message)
    return false
  }

  // Ce qui part, en clair, dans le journal : un retrait effacé en silence ne se
  // découvre qu'en le subissant.
  const titreDe = (id) => ((trouverEtape(id) || {}).etape || {}).titre || id
  const efface = {
    faites: Object.keys(etat.etapesFaites || {}).length,
    retraits: (etat.etapesSupprimees || []).map(titreDe),
    durees: Object.entries(etat.durees || {}).map(([id, d]) => `${titreDe(id)} ${d} min`),
    annulees: Object.keys(etat.annulees || {}).map(titreDe),
    reprise: etat.repriseA ? `${etat.repriseA} (jour ${etat.repriseJour})` : null,
  }

  for (const [k, vide] of Object.entries(CHAMPS_PROGRESSION)) {
    etat[k] = Array.isArray(vide) ? [] : {}
  }
  // La reprise appartient à la journée où elle a été posée. Elle survivait à
  // minuit : le 13 septembre, celle du 4 (10h00, jour 2) calait encore le calcul.
  delete etat.repriseA
  delete etat.repriseJour
  delete etat.repriseAvant

  // Se placer sur la journée dont la date est celle d'aujourd'hui. Le plan les
  // porte ; personne ne les comparait au calendrier, et il fallait donc penser
  // à basculer soi-même le vendredi matin.
  const duJour = (plan.jours || []).find((j) => j.date === jour)
  if (duJour) etat.jourActif = duJour.numero

  etat.journeeDate = jour
  await sauverEtat({ evenement: 'journee-remise-a-zero', date: jour, jourActif: etat.jourActif, efface })
  console.log(`[journée] nouvelle journée ${jour} — progression remise à zéro, jour actif ${etat.jourActif}`)
  return true
}

// Empreinte du frontend servi. Quand le code est redéployé, le nom des bundles
// change : les pages déjà ouvertes doivent se recharger toutes seules. Sans ça,
// Le parent reste sur une version périmée sans le savoir — c'est exactement ce que
// l'app promet d'éviter.
let versionCache = { mtime: 0, valeur: 'dev' }
function versionFront() {
  try {
    const f = path.join(STATIQUE, 'index.html')
    const st = fs.statSync(f)
    if (st.mtimeMs !== versionCache.mtime) {
      versionCache = {
        mtime: st.mtimeMs,
        valeur: crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12),
      }
    }
  } catch {}
  return versionCache.valeur
}

// ---------------------------------------------------------------- SSE
const clients = new Set()

function diffuser(type) {
  const charge = JSON.stringify({ type, v: versionFront(), a: new Date().toISOString() })
  for (const res of clients) {
    try { res.write(`event: maj\ndata: ${charge}\n\n`) } catch { clients.delete(res) }
  }
}

// ------------------------------------------------- temps d'attente en direct
let collecteur = null

// Le collecteur est un service à part : l'app ne peut pas le relancer, mais elle
// peut dire qu'il s'est tu. Un historique qui s'arrête sans que personne ne le
// voie, c'est le pire cas.
function santeCollecteur() {
  try {
    const brut = fs.readFileSync(path.join(RACINE, 'attentes', 'etat-collecteur.json'), 'utf8')
    const s = JSON.parse(brut.charCodeAt(0) === 0xfeff ? brut.slice(1) : brut)
    const ref = s.dernierSucces || s.demarreLe
    const minutes = Math.round((Date.now() - new Date(ref).getTime()) / 60000)
    const limite = (s.intervalleMinutes || 5) * 4
    return { actif: minutes <= limite, minutes, releves: s.releves || 0,
             derniereErreur: s.derniereErreur || null }
  } catch {
    return { actif: false, minutes: null, releves: 0, absent: true }
  }
}

function attentesJour(jour) {
  const d = collecteur && collecteur.lire(jour)
  if (!d) return null
  return { entites: d.entites, majLe: d.majLe, erreur: d.erreur }
}

// Index par id, pour rapprocher une attraction du plan de sa donnée live.
function indexAttentes(jour) {
  const d = attentesJour(jour)
  if (!d) return {}
  const h = (horairesDuJour() || {}).attractions || {}
  const ix = {}
  for (const e of d.entites) {
    const creneaux = h[e.id] && h[e.id].creneaux
    ix[e.id] = creneaux
      ? { ...e, ouvertureHm: creneaux[0].ouverture, fermetureHm: creneaux[creneaux.length - 1].fermeture }
      : e
  }
  return ix
}

// ---------------------------------------------------------------- app
const app = express()
app.use(express.json({ limit: '256kb' }))
app.disable('x-powered-by')

// Lien secret : pas de compte, pas d'authentification lourde.
app.use('/api', (req, res, next) => {
  if (!CLE) return next()
  const fournie = req.get('x-cle') || req.query.k
  if (fournie === CLE) return next()
  res.status(401).type('text/plain; charset=utf-8').send('Clé absente ou invalide.')
})

// Le serveur tourne en continu : la date change pendant qu'il tourne, pas
// seulement à son démarrage. On vérifie donc à chaque appel — c'est une
// comparaison de chaînes, ça ne coûte rien.
// Un VERROU, parce que les requêtes arrivent par paquets. Le téléphone appelle
// /api/snapshot, le flux temps réel et la vérification de version quasi en même
// temps : sans ça, trois requêtes constatent ensemble que le jour a changé et
// archivent trois fois. Le test l'a montré.
let bascule = null
function basculerSiBesoin() {
  if (!bascule) {
    bascule = nouvelleJourneeSiJourChange()
      .finally(() => { bascule = null })
  }
  return bascule
}

app.use('/api', (req, res, next) => {
  basculerSiBesoin().then(() => next(), () => next())
})

const ok = (res, corps) => res.json({ ok: true, ...corps })

// Horaires du jour, relevés une fois par le collecteur. Mis en cache : le
// fichier ne change pas de la journée.
// On ne met JAMAIS un échec en cache : le collecteur écrit ce fichier après son
// premier tour, donc l'app démarre forcément avant qu'il existe. En mémorisant
// l'absence, on s'interdisait les horaires jusqu'au lendemain.
let horairesCache = { date: null, data: null }
function horairesDuJour() {
  const auj = new Date().toLocaleDateString('sv-SE', { timeZone: FUSEAU })
  if (horairesCache.date === auj && horairesCache.data) return horairesCache.data
  const data = lireHoraires(path.join(RACINE, 'attentes'), auj)
  if (data) horairesCache = { date: auj, data }
  return data
}

function instantane() {
  const maintenant = maintenantMinutes()
  const ix = indexAttentes(etat.jourActif || 1)
  const s = situation(plan, etat, maintenant, ix)
  return {
    plan, etat, maintenant, maintenantHm: minutesVersHm(maintenant),
    jours: plan.jours.map((j) => calculerJour(plan, j.numero, etat, indexAttentes(j.numero))),
    situation: s && {
      numeroJour: s.numeroJour, nbFaites: s.nbFaites, total: s.total,
      enCours: s.enCours, suivante: s.suivante,
      dansLaJournee: s.dansLaJournee, horsCreneau: s.horsCreneau,
      retard: s.retard, avance: s.avance, resteEnCours: s.resteEnCours,
      prochaineAncre: s.prochaineAncre, marge: s.marge,
      aRecuperer: s.aRecuperer, analyse: s.analyse, alerte: s.alerte,
    },
    ordreSacrifice: ordreSacrifice(plan, etat.jourActif || 1, etat),
    plansOfficiels: { 1: descriptionPlan(1), 2: descriptionPlan(2) },
    versionFront: versionFront(),
    resume: resumeTexte(plan, etat, maintenant, ix),
    attentes: {
      majLe: (attentesJour(etat.jourActif || 1) || {}).majLe || null,
      erreur: (attentesJour(etat.jourActif || 1) || {}).erreur || null,
      avertissement: plan.fileAttente.avertissement,
      collecteur: santeCollecteur(),
      // Le frontend recalcule la journée avec le moteur partagé : il lui faut
      // l'index, sinon les étapes n'auraient aucun temps d'attente hors ligne.
      index: ix,
    },
  }
}

// §7.4 — résumé lisible par un humain, pas un dump JSON.
app.get('/api/etat', (req, res) => {
  res.type('text/plain; charset=utf-8').send(
    resumeTexte(plan, etat, maintenantMinutes(), indexAttentes(etat.jourActif || 1)) + '\n')
})

app.get('/api/snapshot', (req, res) => res.json(instantane()))

// Toutes les attractions du parc, pas seulement celles du plan.
// Les dernières lignes brutes archivées par le collecteur.
//
// Les archives vivent sur le serveur et sont hors Syncthing (un seul écrivain
// par fichier) : sans ce point d'entrée, je ne peux pas vérifier ce que le
// collecteur écrit vraiment — et pendant les deux journées, le parent sera dans le
// parc, pas devant un terminal. Lecture seule, derrière la clé.
app.get('/api/attentes/:jour/archive', (req, res) => {
  const n = Number(req.params.jour)
  if (![1, 2].includes(n)) return res.status(400).json({ ok: false, erreur: 'jour 1 ou 2 attendu' })
  const combien = Math.min(Number(req.query.n) || 1, 50)
  const dossier = path.join(RACINE, 'attentes')
  let fichiers = []
  try {
    fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith(`-jour${n}.jsonl`)).sort()
  } catch {
    return res.status(503).json({ ok: false, erreur: 'aucune archive' })
  }
  if (!fichiers.length) return res.status(503).json({ ok: false, erreur: 'aucune archive pour ce jour' })
  const fichier = fichiers[fichiers.length - 1]
  let lignes = []
  try {
    lignes = fs.readFileSync(path.join(dossier, fichier), 'utf8').trim().split(String.fromCharCode(10)).filter(Boolean)
  } catch (err) {
    return res.status(500).json({ ok: false, erreur: err.message })
  }
  res.json({
    ok: true, fichier, total: lignes.length,
    lignes: lignes.slice(-combien).map((l) => { try { return JSON.parse(l) } catch { return { brut: l } } }),
  })
})

app.get('/api/attentes/:jour', (req, res) => {
  const n = Number(req.params.jour)
  if (![1, 2].includes(n)) return res.status(400).json({ ok: false, erreur: 'jour 1 ou 2 attendu' })
  const d = attentesJour(n)
  if (!d) return res.status(503).json({ ok: false, erreur: 'collecteur non démarré' })
  // Les horaires vivent dans indexAttentes : sans ça, l'onglet Attentes ne
  // savait pas qu'une attraction ferme avant le parc.
  const ixHoraires = indexAttentes(n)
  const dansLePlan = new Set()
  for (const j of plan.jours) {
    if (j.numero !== n) continue
    for (const e of j.etapes) for (const a of e.attractions || []) dansLePlan.add(a.id)
  }
  res.json({
    jour: n,
    majLe: d.majLe,
    erreur: d.erreur,
    avertissement: plan.fileAttente.avertissement,
    collecteur: santeCollecteur(),
    entites: d.entites.map((e) => ({
      ...e,
      ouvertureHm: (ixHoraires[e.id] || {}).ouvertureHm || null,
      fermetureHm: (ixHoraires[e.id] || {}).fermetureHm || null,
      dansLePlan: dansLePlan.has(e.id),
    })),
  })
})

// Écriture du plan par l'API. C'EST CE QUI REND LE RECALCUL POSSIBLE DEPUIS LE
// PARC : sans ça, modifier plan.json demanderait un accès SSH au serveur.
//
// Trois garde-fous, parce qu'un plan cassé le jeudi matin n'est pas rattrapable :
//   - il doit se PARSER et passer un contrôle de forme minimal ;
//   - il doit se CALCULER pour les deux jours avant d'être accepté ;
//   - l'ancien est sauvegardé, horodaté, et restaurable.
app.put('/api/plan', express.json({ limit: '4mb' }), async (req, res) => {
  // `suppressionsAcceptees` accompagne l'envoi, il ne fait pas partie du plan :
  // sans ce tri, il s'écrivait dans plan.json et repartait avec chaque envoi.
  const { suppressionsAcceptees: _acceptees, ...nouveau } = req.body || {}
  const refus = (m) => res.status(400).json({ ok: false, erreur: m })

  if (!nouveau || typeof nouveau !== 'object') return refus('Corps JSON attendu.')
  if (!Array.isArray(nouveau.jours) || nouveau.jours.length !== 2) {
    return refus('Le plan doit contenir exactement deux jours.')
  }
  if (!Array.isArray(nouveau.parametres) || !nouveau.parametres.length) {
    return refus('Le plan doit contenir ses paramètres.')
  }
  for (const j of nouveau.jours) {
    if (!Array.isArray(j.etapes) || !j.etapes.length) return refus(`Jour ${j.numero} sans étapes.`)
  }

  try {
    for (const n of [1, 2]) {
      const calc = calculerJour(nouveau, n, etat, indexAttentes(n))
      if (!calc || !calc.etapes.length) throw new Error(`jour ${n} illisible`)
    }
  } catch (err) {
    return refus('Le moteur refuse ce plan : ' + err.message)
  }

  // Les contraintes du parent, vérifiées mécaniquement. Pendant les deux jours
  // je recalculerai sous pression depuis un téléphone : une règle qui n'est
  // écrite qu'en prose est une règle que je peux oublier. Celle-ci refuse.
  //
  // Le plan en place sert de référence : c'est par rapport à lui qu'on détecte
  // une étape disparue. Une suppression voulue s'annonce dans
  // `suppressionsAcceptees` — sinon elle est refusée, comme le parent l'a demandé.
  // Ce que les contraintes protègent, c'est l'HORAIRE DE LA JOURNÉE : les étapes,
  // leur ordre, leurs durées, les séances sur lesquelles elles s'ancrent. Le
  // reste du fichier — la liste du sac, les réglages à faire dans l'appli
  // Disney, les règles écrites en prose — n'est pas le plan. Le soumettre au
  // même contrôle rendait le système bloquant sur lui-même : tant qu'une séance
  // avait bougé sous nos pieds, on ne pouvait plus corriger une phrase.
  const horaire = (p) => JSON.stringify({
    jours: (p.jours || []).map((j) => ({ numero: j.numero, etapes: j.etapes })),
    parametres: p.parametres,
    scenariosCreneau: p.scenariosCreneau,
    contraintes: p.contraintes,
  })
  const horaireIntact = horaire(nouveau) === horaire(plan)

  const acceptees = Array.isArray(req.body?.suppressionsAcceptees) ? req.body.suppressionsAcceptees : []
  const controle = horaireIntact ? { violations: [], avertissements: [] } : verifierPlan(nouveau, {
    etat,
    attentesParJour: (n) => indexAttentes(n),
    reference: plan,
    calculerJour,
  })
  if (horaireIntact) console.log("[plan] horaire inchangé — contrôle des contraintes sans objet")
  const bloquantes = controle.violations.filter((v) =>
    // Entre parenthèses : « j1-e1 » ne doit pas accepter la suppression de « j1-e14 ».
    !(v.regle === 'aucune-suppression' && acceptees.some((id) => v.message.includes(`(${id})`))))
  if (bloquantes.length) {
    return res.status(422).json({
      ok: false,
      erreur: 'Ce plan viole des contraintes.',
      violations: bloquantes,
      avertissements: controle.avertissements,
      aide: 'Pour supprimer une étape volontairement, listez son identifiant dans suppressionsAcceptees.',
    })
  }

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
  const sauvegarde = path.join(RACINE, 'plans-precedents', `plan-${horodatage}.json`)
  try {
    fs.mkdirSync(path.dirname(sauvegarde), { recursive: true })
    fs.copyFileSync(F_PLAN, sauvegarde)
  } catch (err) {
    return res.status(500).json({ ok: false, erreur: 'Sauvegarde impossible : ' + err.message })
  }

  try {
    await ecrireJsonAtomique(F_PLAN, nouveau)
  } catch (err) {
    return res.status(500).json({ ok: false, erreur: "Écriture impossible : " + err.message })
  }

  await chargerPlan()
  await journaliser(F_JOURNAL, {
    evenement: 'plan-remplace', version: plan.version, sauvegarde: path.basename(sauvegarde),
  })
  diffuser('plan')
  console.log(`[plan] remplacé par l'API — ancien conservé dans ${path.basename(sauvegarde)}`)

  res.json({
    ok: true,
    sauvegarde: path.basename(sauvegarde),
    jours: plan.jours.map((j) => ({ numero: j.numero, etapes: j.etapes.length })),
    avertissements: controle.avertissements,
  })
})

// Vérifier un plan SANS l'enregistrer : me dire, avant d'envoyer, si ce que je
// propose respecte les contraintes.
app.post('/api/plan/verifier', express.json({ limit: '4mb' }), (req, res) => {
  const candidat = req.body && req.body.jours ? req.body : plan
  const controle = verifierPlan(candidat, {
    etat,
    attentesParJour: (n) => indexAttentes(n),
    reference: plan,
    calculerJour,
  })
  res.json(controle)
})

app.get('/api/plans-precedents', (req, res) => {
  const d = path.join(RACINE, 'plans-precedents')
  let fichiers = []
  try { fichiers = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().reverse() } catch { /* aucun */ }
  res.json({ fichiers })
})

// Lire une sauvegarde SANS la remettre en place. La liste existait, pas la
// lecture : la seule façon de voir un ancien plan était de l'appliquer, en
// écrasant celui en service.
app.get('/api/plans-precedents/:fichier', (req, res) => {
  const nom = String(req.params.fichier || '')
  if (!/^plan-[\w-]+\.json$/.test(nom)) return res.status(400).json({ ok: false, erreur: 'Nom de fichier invalide.' })
  const source = path.join(RACINE, 'plans-precedents', nom)
  if (!fs.existsSync(source)) return res.status(404).json({ ok: false, erreur: 'Sauvegarde introuvable.' })
  res.type('application/json').send(fs.readFileSync(source, 'utf8'))
})

app.post('/api/plan/restaurer', async (req, res) => {
  const nom = String(req.body?.fichier || '')
  if (!/^plan-[\w-]+\.json$/.test(nom)) return res.status(400).json({ ok: false, erreur: 'Nom de fichier invalide.' })
  const source = path.join(RACINE, 'plans-precedents', nom)
  if (!fs.existsSync(source)) return res.status(404).json({ ok: false, erreur: 'Sauvegarde introuvable.' })
  await ecrireAtomique(F_PLAN, fs.readFileSync(source, 'utf8'))
  await chargerPlan()
  await journaliser(F_JOURNAL, { evenement: 'plan-restaure', fichier: nom })
  diffuser('plan')
  res.json({ ok: true, restaure: nom })
})

// Le même brief que le bouton de l'app, en texte brut : utile depuis une
// session Remote quand le parent n'a pas le téléphone sous la main.
app.get('/api/brief', (req, res) => {
  const n = maintenantMinutes()
  res.type('text/plain; charset=utf-8')
  res.send(briefRecalcul(plan, etat, n, indexAttentes(etat.jourActif || 1)))
})

// Moyennes horaires archivées par le collecteur. Sert le détail d'une attraction
// quand on la touche dans l'onglet Attentes : le direct dit ce qu'il en est
// maintenant, l'historique dit si c'est habituel.
app.get('/api/historique/:jour', (req, res) => {
  const n = Number(req.params.jour)
  if (![1, 2].includes(n)) return res.status(400).json({ ok: false, erreur: 'jour 1 ou 2 attendu' })
  const d = moyennesJour(path.join(RACINE, 'attentes'), n)
  if (!d) return res.status(503).json({ ok: false, erreur: 'aucun historique collecté' })
  res.json(d)
})

// Plan officiel du parc, optionnel : déposer le fichier dans data/plans/
// sous le nom jour1.<ext> ou jour2.<ext> (jpg, png, pdf, webp).
const DOSSIER_PLANS = path.join(RACINE, 'plans')
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf']

function fichierPlan(jour) {
  for (const ext of EXTENSIONS) {
    const f = path.join(DOSSIER_PLANS, `jour${jour}.${ext}`)
    if (fs.existsSync(f)) return f
  }
  return null
}

// Le frontend doit savoir s'il peut AFFICHER le plan (image) ou seulement
// l'ouvrir (PDF) : on ne dessine pas un repère par-dessus un PDF.
function descriptionPlan(jour) {
  const f = fichierPlan(jour)
  if (!f) return null
  const ext = path.extname(f).slice(1).toLowerCase()
  return { ext, image: ext !== 'pdf', url: `/api/plan-parc/${jour}` }
}

app.get('/api/plan-parc/:jour', (req, res) => {
  const n = Number(req.params.jour)
  if (![1, 2].includes(n)) return res.status(400).type('text/plain').send('jour 1 ou 2')
  const f = fichierPlan(n)
  if (!f) return res.status(404).type('text/plain; charset=utf-8').send('Aucun plan déposé pour ce jour.')
  res.sendFile(f)
})

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 3000\n\n')
  res.write(`event: maj\ndata: ${JSON.stringify({ type: 'bonjour', v: versionFront() })}\n\n`)
  clients.add(res)
  // Le battement porte l'empreinte du frontend : une page ouverte detecte
  // une nouvelle mise en ligne en 20 s au plus et se recharge seule.
  const battement = setInterval(() => {
    try {
      res.write(`event: maj\ndata: ${JSON.stringify({ type: 'battement', v: versionFront() })}\n\n`)
    } catch {}
  }, 20000)
  req.on('close', () => { clearInterval(battement); clients.delete(res) })
})

// ------------------------------------------------------- mutations d'état
function trouverEtape(id) {
  for (const j of plan.jours) {
    const e = j.etapes.find((x) => x.id === id)
    if (e) return { jour: j, etape: e }
  }
  return null
}

app.post('/api/etape/:id/terminee', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  const heure = minutesVersHm(maintenantMinutes())
  etat.etapesFaites[req.params.id] = { marqueeA: heure }
  await sauverEtat({ evenement: 'etape-terminee', etape: req.params.id, titre: t.etape.titre, marqueeA: heure })
  ok(res, { instantane: instantane() })
})

app.post('/api/etape/:id/reprendre', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  delete etat.etapesFaites[req.params.id]
  await sauverEtat({ evenement: 'etape-reprise', etape: req.params.id, titre: t.etape.titre })
  ok(res, { instantane: instantane() })
})

app.post('/api/etape/:id/supprimer', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  if (!etat.etapesSupprimees.includes(req.params.id)) etat.etapesSupprimees.push(req.params.id)
  await sauverEtat({
    evenement: 'etape-supprimee', etape: req.params.id, titre: t.etape.titre,
    gain: t.etape.duree, motif: req.body?.motif || null,
  })
  ok(res, { instantane: instantane() })
})

app.post('/api/etape/:id/restaurer', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  etat.etapesSupprimees = etat.etapesSupprimees.filter((x) => x !== req.params.id)

  // Retirée AU RECALCUL : le retrait vit dans plan.json, c'est donc là qu'il se
  // défait. Même précaution que PUT /api/plan — l'ancien plan est sauvegardé
  // avant d'être réécrit. Remettre une étape ne peut violer « ne rien rater » ;
  // si elle déborde, l'écran le montre comme pour tout ajout.
  if (t.etape.actif === false) {
    const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      fs.mkdirSync(path.join(RACINE, 'plans-precedents'), { recursive: true })
      fs.copyFileSync(F_PLAN, path.join(RACINE, 'plans-precedents', `plan-${horodatage}.json`))
      const nouveau = JSON.parse(JSON.stringify(plan))
      const e = nouveau.jours.flatMap((j) => j.etapes).find((x) => x.id === req.params.id)
      e.actif = true
      delete e.retrait
      await ecrireJsonAtomique(F_PLAN, nouveau)
      await chargerPlan()
      diffuser('plan')
    } catch (err) {
      return res.status(500).json({ ok: false, erreur: 'Plan non réécrit : ' + err.message })
    }
  }

  await sauverEtat({ evenement: 'etape-restauree', etape: req.params.id, titre: t.etape.titre, duPlan: t.etape.actif === false })
  ok(res, { instantane: instantane() })
})

// Annulation imposée : météo, panne, salle complète. L'étape sort du planning
// et remonte en tête du résumé, pour qu'une session Remote la replanifie.
app.post('/api/etape/:id/annuler', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  const motif = String(req.body?.motif || '').trim() || 'motif non précisé'
  // « Pas le temps » n'est pas une annulation imposée : l'attraction existe
  // toujours, on choisit de la sauter. La distinction compte au recalcul —
  // une étape sautée se replace ailleurs, une étape fermée est perdue.
  const choisi = req.body?.choisi === true
  etat.annulees[req.params.id] = { motif, choisi, horodatage: new Date().toISOString() }
  etat.etapesSupprimees = etat.etapesSupprimees.filter((x) => x !== req.params.id)
  await sauverEtat({
    evenement: choisi ? 'etape-sautee' : 'etape-annulee', etape: req.params.id,
    titre: t.etape.titre, lieu: t.etape.lieu, motif, choisi,
    dureeLiberee: t.etape.duree,
  })
  ok(res, { instantane: instantane() })
})

app.post('/api/etape/:id/retablir', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  delete etat.annulees[req.params.id]
  await sauverEtat({ evenement: 'etape-retablie', etape: req.params.id, titre: t.etape.titre })
  ok(res, { instantane: instantane() })
})

// Décroche une étape de son ancre : elle repasse en flottante (cas « aucun créneau »).
app.post('/api/etape/:id/decrocher', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  const decrocher = req.body?.decrochee !== false
  etat.ancresDecrochees = etat.ancresDecrochees.filter((x) => x !== req.params.id)
  if (decrocher) etat.ancresDecrochees.push(req.params.id)
  await sauverEtat({
    evenement: decrocher ? 'ancre-decrochee' : 'ancre-raccrochee',
    etape: req.params.id, titre: t.etape.titre,
  })
  ok(res, { instantane: instantane() })
})

// Raccourcir (ou rétablir) la durée d'un bloc flâner ou repas.
app.post('/api/etape/:id/duree', async (req, res) => {
  const t = trouverEtape(req.params.id)
  if (!t) return res.status(404).json({ ok: false, erreur: 'Étape inconnue' })
  const v = req.body?.minutes
  const avant = etat.durees[req.params.id] ?? t.etape.duree
  if (v == null || v === '') delete etat.durees[req.params.id]
  else {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 600) {
      return res.status(400).json({ ok: false, erreur: 'Durée en minutes attendue (0-600)' })
    }
    etat.durees[req.params.id] = Math.round(n)
  }
  await sauverEtat({
    evenement: 'duree', etape: req.params.id, titre: t.etape.titre,
    avant, apres: etat.durees[req.params.id] ?? t.etape.duree,
  })
  ok(res, { instantane: instantane() })
})

// Escapade solo marquée comme utilisée (ou remise à disposition).
app.post('/api/escapade/:id', async (req, res) => {
  const jour = plan.jours.find((j) => (j.escapades && j.escapades.creneaux || []).some((c) => c.id === req.params.id))
  const creneau = jour && jour.escapades.creneaux.find((c) => c.id === req.params.id)
  if (!creneau) return res.status(404).json({ ok: false, erreur: 'Escapade inconnue' })
  const utilisee = req.body?.utilisee !== false
  if (utilisee) etat.escapades[creneau.id] = true
  else delete etat.escapades[creneau.id]
  await sauverEtat({
    evenement: utilisee ? 'escapade-utilisee' : 'escapade-annulee',
    escapade: creneau.id, libelle: creneau.libelle, retour: creneau.retour,
  })
  ok(res, { instantane: instantane() })
})

// Réordonner les activités à sacrifier.
app.post('/api/sacrifice', async (req, res) => {
  const jourNum = Number(req.body?.jour)
  const jour = plan.jours.find((j) => j.numero === jourNum)
  if (!jour) return res.status(400).json({ ok: false, erreur: 'jour 1 ou 2 attendu' })
  const connus = new Set((jour.ordreSacrifice || []).map((s) => s.etape))
  const ordre = (req.body?.ordre || []).filter((id) => connus.has(id))
  if (!ordre.length) return res.status(400).json({ ok: false, erreur: 'ordre vide ou inconnu' })
  etat.ordreSacrifice[String(jourNum)] = ordre
  await sauverEtat({ evenement: 'ordre-sacrifice', jour: jourNum, ordre })
  ok(res, { instantane: instantane() })
})

app.post('/api/parametre/:id', async (req, res) => {
  const p = plan.parametres.find((x) => x.id === req.params.id)
  if (!p) return res.status(404).json({ ok: false, erreur: 'Paramètre inconnu' })
  const valeur = String(req.body?.valeur || '').trim()
  if (valeur && hmVersMinutes(valeur) == null) {
    return res.status(400).json({ ok: false, erreur: 'Heure attendue au format HH:MM' })
  }
  const avant = etat.parametres[p.id] ?? p.valeur
  if (valeur) etat.parametres[p.id] = valeur
  else delete etat.parametres[p.id]
  await sauverEtat({ evenement: 'parametre', parametre: p.id, libelle: p.libelle, avant, apres: valeur || p.valeur })
  ok(res, { instantane: instantane() })
})

// Saisie d'un créneau de file virtuelle : recale l'étape ancrée correspondante.
app.post('/api/creneau/:id', async (req, res) => {
  const p = plan.parametres.find((x) => x.id === req.params.id)
  if (!p) return res.status(404).json({ ok: false, erreur: 'Paramètre inconnu' })
  const obtenu = !!req.body?.obtenu
  const heure = String(req.body?.heure || '').trim()
  const scenario = plan.scenariosCreneau.find((s) => s.parametre === p.id)

  if (obtenu) {
    if (hmVersMinutes(heure) == null) return res.status(400).json({ ok: false, erreur: 'Heure attendue au format HH:MM' })
    etat.creneaux[p.id] = { obtenu: true, heure, horodatage: new Date().toISOString() }
    etat.parametres[p.id] = heure
    if (scenario) {
      etat.ancresDecrochees = etat.ancresDecrochees.filter((x) => x !== scenario.etape)
      etat.etapesSupprimees = etat.etapesSupprimees.filter((x) => x !== scenario.etape)
    }
  } else {
    etat.creneaux[p.id] = { obtenu: false, horodatage: new Date().toISOString() }
    // Aucun créneau : l'étape se décroche de son ancre et repasse en flottante.
    if (scenario && !etat.ancresDecrochees.includes(scenario.etape)) etat.ancresDecrochees.push(scenario.etape)
  }
  await sauverEtat({ evenement: 'creneau', parametre: p.id, libelle: p.libelle, obtenu, heure: heure || null })
  ok(res, { instantane: instantane(), scenario })
})

// Suivre ou ne plus suivre une file virtuelle. Tout est suivi par défaut :
// ce point d'entrée sert à faire taire une file, et à la réactiver.
app.post('/api/file/:id', async (req, res) => {
  const id = String(req.params.id)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ ok: false, erreur: 'Identifiant invalide.' })
  const suivie = req.body?.suivie !== false

  const exclues = { ...etat.filesNonSuivies }
  if (suivie) delete exclues[id]
  else exclues[id] = true
  etat.filesNonSuivies = exclues

  await sauverEtat({ evenement: suivie ? 'file-suivie' : 'file-ignoree', attraction: id })
  res.json({ ok: true, instantane: instantane() })
})

// Créneau obtenu sur une file virtuelle qui n'est PAS au plan : une rencontre
// prise en bonus. On note l'heure pour ne pas l'oublier, sans toucher au plan.
app.post('/api/creneau-libre/:id', async (req, res) => {
  const id = String(req.params.id)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ ok: false, erreur: 'Identifiant invalide.' })
  const heure = String(req.body?.heure || '').trim()
  const libres = { ...(etat.creneauxLibres || {}) }
  if (heure) {
    if (hmVersMinutes(heure) == null) return res.status(400).json({ ok: false, erreur: 'Heure attendue au format HH:MM' })
    libres[id] = heure
  } else delete libres[id]
  etat.creneauxLibres = libres
  await sauverEtat({ evenement: heure ? 'creneau-libre' : 'creneau-libre-efface', attraction: id, heure: heure || null })
  ok(res, { instantane: instantane() })
})

// Remise à zéro explicite. Sert quand la date ne suffit pas — typiquement pour
// effacer des essais faits la veille du départ, comme ce 2 septembre.
app.post('/api/journee/reinitialiser', async (req, res) => {
  // Le garde-fou vaut d'abord ici : c'est le bouton qui pourrait être poussé
  // par erreur depuis le parc. Une fois la journée commencée, on ne remet plus
  // rien à zéro — on recalcule les étapes qui restent.
  const enCours = journeeEnCours()
  if (enCours) {
    return res.status(409).json({
      ok: false,
      erreur: `La journée du ${enCours.jour.date} a commencé à ${minutesVersHm(enCours.debut)}.`
        + ' Plus de remise à zéro : seulement des recalculs des étapes restantes.',
    })
  }
  const avant = {
    etapesFaites: Object.keys(etat.etapesFaites || {}).length,
    annulees: Object.keys(etat.annulees || {}).length,
    creneaux: Object.keys(etat.creneaux || {}).length,
  }
  etat.journeeDate = null   // force le passage
  const fait = await nouvelleJourneeSiJourChange()
  ok(res, { fait, avant, jourActif: etat.jourActif, instantane: instantane() })
})

// Déclarer qu'on commande par le Click & Collect de l'appli Disney. C'est ce
// qui autorise un repas à 40 min au lieu de 50 : cinq personnes au comptoir ne
// se pressent pas, mais cinq personnes qui récupèrent une commande, si.
app.post('/api/click-collect', async (req, res) => {
  const actif = req.body?.actif !== false
  etat.clickCollect = actif
  await sauverEtat({ evenement: 'click-collect', actif })
  ok(res, { actif, instantane: instantane() })
})

// L'heure a laquelle la journee REPART vraiment, quand le passe enregistre ne
// vaut plus rien. Sans elle, une matinee aux horaires faux decale l'apres-midi
// entiere : la chaine additionne des durees, elle ne regarde pas la montre.
// On stocke un fait, pas l'horloge, pour que le plan reste verifiable.
// Un jour masque ne peut pas rester le jour ACTIF : l'app l'afficherait alors
// que le selecteur de jour, lui, ne le propose plus — on serait coince dessus
// sans moyen d'en sortir. Verifie a chaque demarrage et a chaque chargement de
// plan.
function corrigerJourActifSiMasque() {
  const j = (plan.jours || []).find((x) => x.numero === (etat.jourActif || 1))
  if (!j || !j.masque) return false
  const libre = (plan.jours || []).find((x) => !x.masque)
  if (!libre) return false
  etat.jourActif = libre.numero
  return true
}

app.post('/api/reprise', async (req, res) => {
  const hm = String(req.body?.a || '').trim()
  if (hm && hmVersMinutes(hm) == null) {
    return res.status(400).json({ ok: false, erreur: 'heure attendue au format HH:MM' })
  }
  if (hm) {
    const n = Number(req.body?.jour) || etat.jourActif || 1
    etat.repriseA = hm
    etat.repriseJour = n
    // On retient DEVANT QUELLE ETAPE la journee repart. Sans ce reperage, la
    // coupure suivrait les cases cochees et ramenerait la suite en arriere a
    // chaque etape terminee.
    const j = plan.jours.find((x) => x.numero === n)
    const suivante = ((j && j.etapes) || []).find((e) => e.actif !== false
      && !(etat.etapesFaites || {})[e.id]
      && !(etat.annulees || {})[e.id]
      && !(etat.etapesSupprimees || []).includes(e.id))
    etat.repriseAvant = req.body?.avant || (suivante && suivante.id) || null
  } else {
    delete etat.repriseA
    delete etat.repriseJour
    delete etat.repriseAvant
  }
  await sauverEtat({ evenement: 'reprise', a: hm || null, jour: etat.repriseJour || null })
  ok(res, { repriseA: etat.repriseA || null, repriseJour: etat.repriseJour || null, repriseAvant: etat.repriseAvant || null, instantane: instantane() })
})

app.post('/api/jour', async (req, res) => {
  const n = Number(req.body?.jour)
  if (![1, 2].includes(n)) return res.status(400).json({ ok: false, erreur: 'jour 1 ou 2 attendu' })
  etat.jourActif = n
  await sauverEtat({ evenement: 'jour-actif', jour: n })
  ok(res, { instantane: instantane() })
})

app.get('/api/journal', async (req, res) => {
  let brut = ''
  try { brut = fs.readFileSync(F_JOURNAL, 'utf8') } catch {}
  const lignes = brut.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
  res.json(lignes.filter(Boolean))
})

// ------------------------------------------------------------- frontend
if (fs.existsSync(STATIQUE)) {
  app.use(express.static(STATIQUE, { maxAge: '1h', index: false }))
  app.get('*', (req, res) => res.sendFile(path.join(STATIQUE, 'index.html')))
}

// ------------------------------------------------------------- démarrage
await nettoyerTemporaires(RACINE)
await chargerPlan()
await chargerEtat()
if (corrigerJourActifSiMasque()) await sauverEtat({ evenement: 'jour-actif-corrige', jour: etat.jourActif })
if (!fs.existsSync(F_ETAT)) await ecrireJsonAtomique(F_ETAT, etat)

// §7.2 — rechargement à chaud : quand plan.json change, on propage sans redéploiement.
surveiller(F_PLAN, async () => {
  try {
    await chargerPlan()
    if (corrigerJourActifSiMasque()) await sauverEtat({ evenement: 'jour-actif-corrige', jour: etat.jourActif })
    console.log('[plan] rechargé à chaud')
    await journaliser(F_JOURNAL, { evenement: 'plan-recharge', version: plan.version })
    diffuser('plan')
  } catch (err) {
    console.error('[plan] rechargement impossible :', err.message)
  }
})

// L'état peut aussi être édité à la main depuis une session Remote.
surveiller(F_ETAT, async () => {
  const disque = await lireJson(F_ETAT)
  if (!disque) {
    console.warn('[état] fichier modifié mais illisible — état en mémoire conservé')
    return
  }
  if (JSON.stringify(disque) === JSON.stringify(etat)) return // notre propre écriture
  etat = { ...ETAT_VIDE, ...disque }
  console.log('[état] rechargé depuis le disque')
  diffuser('etat')
})

// Dernier filet : quoi qu'il arrive, le serveur reste debout.
process.on('unhandledRejection', (err) => {
  console.error('[rejet non géré]', err && (err.stack || err.message || err))
})
process.on('uncaughtException', (err) => {
  console.error('[exception non gérée]', err && (err.stack || err.message || err))
})

collecteur = creerCollecteur({
  parcs: plan.fileAttente.parcs,
  intervalleMinutes: plan.fileAttente.intervalleMinutes,
  surMaj: () => diffuser('attentes'),
})
collecteur.demarrer()

// `serveur` doit être le serveur HTTP, pas le collecteur : le gestionnaire
// d'erreur ci-dessous ne sert à rien s'il est posé sur le mauvais objet, et
// EADDRINUSE repart alors dans le garde-fou global — le zombie est de retour.
const serveur = app.listen(PORT, () => {
  console.log(`Plan Disneyland — http://localhost:${PORT}`)
  console.log(`  données : ${RACINE}`)
  console.log(`  fuseau  : ${FUSEAU} (il est ${minutesVersHm(maintenantMinutes())})`)
  console.log(`  clé     : ${CLE ? 'activée' : 'désactivée (accès libre)'}`)
  console.log(`  statique: ${fs.existsSync(STATIQUE) ? STATIQUE : 'absent (mode dev, lancer Vite)'}`)
})

// Un échec de démarrage est FATAL et doit le rester : sans ce gestionnaire, le
// garde-fou global attrape l'erreur et laisse un processus vivant qui n'écoute
// sur rien. Un zombie est pire qu'un plantage — on croit le serveur démarré.
serveur.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
Le port ${PORT} est déjà occupé : un serveur tourne probablement déjà.`)
    console.error(`  Qui l'occupe :   netstat -ano | findstr :${PORT}`)
    console.error(`  L'arrêter :      taskkill /PID <pid> /F`)
    console.error(`  Ou autre port :  $env:PORT=3001; node server.js
`)
  } else {
    console.error(`
[démarrage] impossible d'écouter sur le port ${PORT} : ${err.message}
`)
  }
  process.exit(1)
})

