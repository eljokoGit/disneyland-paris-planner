// Test de la remise à zéro de journée, sur une copie isolée des données.
// Rien n'est écrit dans le dépôt ni sur le serveur.
//
// AUCUNE DATE EN DUR. La première version datait l'état « sale » du
// 2 septembre et laissait les dates du plan sur les 3 et 4 : écrit un
// 2 septembre, le test ne passait plus que ce jour-là. Lancé pendant le voyage,
// le garde-fou refusait la remise à zéro — à raison — et le test échouait sur
// un comportement correct. Les dates se calculent maintenant depuis aujourd'hui,
// et le plan est repoussé dans un futur où aucune journée n'a commencé.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BAC = path.join(os.tmpdir(), 'test-reinit')
const PORT = 3220

const echecs = []
const verifier = (titre, condition, detail = '') => {
  console.log(`  ${condition ? '✅' : '❌'} ${titre}${detail ? ' — ' + detail : ''}`)
  if (!condition) echecs.push(titre)
}

const dateParis = (d) => new Intl.DateTimeFormat('fr-CA',
  { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const AUJ = dateParis(new Date())
const HIER = dateParis(new Date(Date.now() - 36 * 3600 * 1000))

fs.rmSync(BAC, { recursive: true, force: true })
fs.cpSync(path.join(RACINE, 'data'), BAC, { recursive: true })
// Des archives laissées par un autre lancement fausseraient le décompte.
fs.rmSync(path.join(BAC, 'etats-precedents'), { recursive: true, force: true })

// Le plan dans un futur lointain : aucune journée n'a commencé, le garde-fou
// ne s'en mêle pas, et le jour actif n'a aucune date sur laquelle se caler.
const FP = path.join(BAC, 'plan.json')
const plan = JSON.parse(fs.readFileSync(FP, 'utf8').replace(/^\uFEFF/, ''))
plan.jours[0].date = '2099-01-01'
plan.jours[1].date = '2099-01-02'
// Un jour masqué ferait basculer le jour actif au démarrage : hors sujet ici.
for (const j of plan.jours) delete j.masque
// Un retrait DÉCIDÉ AU RECALCUL : il vit dans le plan et doit survivre à minuit.
const retire = plan.jours[1].etapes.find((e) => e.actif !== false && e.type !== 'transition' && e.type !== 'arrivee')
retire.actif = false
retire.retrait = { motif: 'test', le: HIER }
fs.writeFileSync(FP, JSON.stringify(plan, null, 1))

// Un état « sale », celui d'une journée d'essais.
const F = path.join(BAC, 'etat-courant.json')
const sale = {
  version: 2, jourActif: 1,
  etapesFaites: { 'j1-e1': {}, 'j1-e2': {}, 'j1-e9': {} },
  etapesSupprimees: ['j1-e14'], ancresDecrochees: ['j1-e3'],
  durees: { 'j1-e8': 55 }, ordreSacrifice: {},
  annulees: { 'j2-e2': { motif: 'Pas le temps', choisi: true } },
  filesNonSuivies: { 'une-file-coupee': true },
  creneauxLibres: { x: '15:30' },
  escapades: { 'esc-4': true },
  parametres: { j1_woody: '13:20' }, creneaux: { j1_rencontre_royale: { obtenu: false } },
  journeeDate: AUJ, majLe: null,
}
fs.writeFileSync(F, JSON.stringify(sale, null, 1))

const lire = () => JSON.parse(fs.readFileSync(F, 'utf8').replace(/^\uFEFF/, ''))
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

const demarrer = (env = {}) => spawn(process.execPath, [path.join(RACINE, 'backend/server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: BAC, ...env },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let srv = demarrer()
let journal = ''
srv.stdout.on('data', (d) => { journal += d })
srv.stderr.on('data', (d) => { journal += d })
await attendre(3500)

const appel = (chemin, methode = 'GET') =>
  fetch(`http://localhost:${PORT}${chemin}`, { method: methode }).then((r) => r.json())

console.log('1. MÊME JOUR : rien ne doit bouger')
await appel('/api/snapshot')
let e = lire()
verifier('la progression est intacte', Object.keys(e.etapesFaites).length === 3,
  Object.keys(e.etapesFaites).length + ' étapes faites')
verifier("l'étape annulée est toujours là", !!e.annulees['j2-e2'])

console.log('')
console.log('2. LE JOUR CHANGE : la progression part, les préférences restent')
srv.kill(); await attendre(700)
// On simule le lendemain en reculant la date portée par l'état.
const avant = lire(); avant.journeeDate = HIER
fs.writeFileSync(F, JSON.stringify(avant, null, 1))
srv = demarrer(); journal = ''
srv.stdout.on('data', (d) => { journal += d })
await attendre(3500)
// Six requêtes d'un coup : c'est ce que fait le téléphone au réveil.
const reponses = await Promise.all(Array.from({ length: 6 }, () => appel('/api/snapshot')))
e = lire()
verifier('étapes faites effacées', Object.keys(e.etapesFaites).length === 0)
verifier('annulations effacées', Object.keys(e.annulees).length === 0)
verifier('ancres décrochées effacées', e.ancresDecrochees.length === 0)
verifier('durées forcées effacées', Object.keys(e.durees).length === 0)
verifier('escapades effacées', Object.keys(e.escapades).length === 0)
verifier('créneaux effacés', Object.keys(e.creneaux).length === 0)
verifier('ALERTES MAIL CHOISIES CONSERVÉES', !!e.filesNonSuivies['une-file-coupee'])
verifier('date de journée à aujourd’hui', e.journeeDate === AUJ)

const jour2 = reponses[0].jours.find((j) => j.jour.numero === 2)
verifier('UN RETRAIT ÉCRIT DANS LE PLAN SURVIT À MINUIT',
  !jour2.etapes.some((x) => x.id === retire.id)
    && jour2.etapesSupprimees.some((x) => x.id === retire.id && x.retireDuPlan),
  retire.titre)

const lignes = fs.readFileSync(path.join(BAC, 'journal.jsonl'), 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l) } catch { return {} } })
const bascule = lignes.reverse().find((l) => l.evenement === 'journee-remise-a-zero')
verifier('le journal dit ce qui a été effacé',
  !!bascule && !!bascule.efface && bascule.efface.retraits.length === 1 && bascule.efface.faites === 3,
  bascule && bascule.efface ? JSON.stringify(bascule.efface) : 'aucun détail')

const archives = fs.existsSync(path.join(BAC, 'etats-precedents'))
  ? fs.readdirSync(path.join(BAC, 'etats-precedents')) : []
verifier('état archivé UNE SEULE fois', archives.length === 1, archives.length + ' archive(s)')
if (archives.length) {
  const arch = JSON.parse(fs.readFileSync(path.join(BAC, 'etats-precedents', archives[0]), 'utf8'))
  verifier("l'archive contient bien la progression d'avant",
    Object.keys(arch.etapesFaites).length === 3)
}

console.log('')
console.log('3. JOUR ACTIF : aucune journée du plan ne tombe aujourd’hui, il ne bouge pas')
verifier('jour actif inchangé', e.jourActif === 1, 'jourActif = ' + e.jourActif)

console.log('')
console.log('4. DÉCLENCHEUR MANUEL')
srv.kill(); await attendre(700)
const remis = lire()
remis.etapesFaites = { 'j1-e1': {}, 'j1-e2': {} }
remis.annulees = { 'j2-e2': { motif: 'test' } }
fs.writeFileSync(F, JSON.stringify(remis, null, 1))
srv = demarrer(); await attendre(3500)
const r = await appel('/api/journee/reinitialiser', 'POST')
e = lire()
verifier('le déclencheur manuel efface aussi', Object.keys(e.etapesFaites).length === 0,
  r.avant ? 'avant : ' + r.avant.etapesFaites + ' étapes' : 'refusé : ' + r.erreur)
verifier('il rend un compte rendu', r.fait === true && !!r.avant && r.avant.etapesFaites === 2)

console.log('')
console.log('5. ARCHIVAGE IMPOSSIBLE : on ne doit RIEN effacer')
srv.kill(); await attendre(700)
const casse = lire()
casse.etapesFaites = { 'j1-e1': {}, 'j1-e2': {}, 'j1-e3': {} }
casse.journeeDate = HIER
fs.writeFileSync(F, JSON.stringify(casse, null, 1))
// On remplace le dossier d'archives par un FICHIER : mkdir échouera.
fs.rmSync(path.join(BAC, 'etats-precedents'), { recursive: true, force: true })
fs.writeFileSync(path.join(BAC, 'etats-precedents'), 'pas un dossier')
srv = demarrer(); journal = ''
srv.stdout.on('data', (d) => { journal += d })
srv.stderr.on('data', (d) => { journal += d })
await attendre(3500)
await appel('/api/snapshot')
e = lire()
verifier('la progression est PRÉSERVÉE quand on ne sait pas archiver',
  Object.keys(e.etapesFaites).length === 3, Object.keys(e.etapesFaites).length + ' étapes restantes')
verifier("l'échec est dit dans le journal", /archivage impossible/.test(journal))

srv.kill()
console.log('')
console.log(echecs.length ? `❌ ${echecs.length} test(s) en échec : ${echecs.join(', ')}` : '✅ tous les tests passent')
process.exit(echecs.length ? 1 : 0)
