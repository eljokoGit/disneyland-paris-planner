// LE GARDE-FOU : une journée commencée ne se remet jamais à zéro.
// On simule « on est le jour J » en calant la date du plan sur aujourd'hui.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BAC = path.join(os.tmpdir(), 'test-garde')
const PORT = 3222

const echecs = []
const verifier = (titre, condition, detail = '') => {
  console.log(`  ${condition ? '✅' : '❌'} ${titre}${detail ? ' — ' + detail : ''}`)
  if (!condition) echecs.push(titre)
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
const auj = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())

const preparer = (dateJour1, dateJour2, etat) => {
  fs.rmSync(BAC, { recursive: true, force: true })
  fs.cpSync(path.join(RACINE, 'data'), BAC, { recursive: true })
  const fp = path.join(BAC, 'plan.json')
  const p = JSON.parse(fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, ''))
  p.jours[0].date = dateJour1
  p.jours[1].date = dateJour2
  fs.writeFileSync(fp, JSON.stringify(p, null, 1))
  fs.writeFileSync(path.join(BAC, 'etat-courant.json'), JSON.stringify({
    version: 2, jourActif: 1,
    etapesFaites: { 'j1-e1': {}, 'j1-e2': {}, 'j1-e3': {} },
    etapesSupprimees: [], ancresDecrochees: [], durees: {}, ordreSacrifice: {},
    annulees: { 'j1-e14': { motif: 'Pluie' } }, filesNonSuivies: {},
    creneauxLibres: {}, escapades: {},
    parametres: {}, creneaux: { j1_rencontre_royale: { obtenu: true, heure: '11:20' } },
    majLe: null, ...etat,
  }, null, 1))
}

const lire = () => JSON.parse(fs.readFileSync(path.join(BAC, 'etat-courant.json'), 'utf8').replace(/^\uFEFF/, ''))
const demarrer = () => spawn(process.execPath, [path.join(RACINE, 'backend/server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: BAC }, stdio: ['ignore', 'pipe', 'pipe'],
})
const appel = (chemin, methode = 'GET') =>
  fetch(`http://localhost:${PORT}${chemin}`, { method: methode }).then(async (r) => ({ code: r.status, corps: await r.json() }))

console.log(`Il est ${heure}. La journée du plan démarre à 08h45 : elle a donc COMMENCÉ.`)
console.log('')

// ---------------------------------------------------------------------------
console.log('1. JOUR J, journée en cours : la remise à zéro AUTOMATIQUE doit refuser')
preparer(auj, '2026-09-05', { journeeDate: auj })
let srv = demarrer()
let journal = ''
srv.stdout.on('data', (d) => { journal += d })
await attendre(3500)
await appel('/api/snapshot')
let e = lire()
verifier('les étapes faites sont INTACTES', Object.keys(e.etapesFaites).length === 3,
  Object.keys(e.etapesFaites).length + ' étapes')
verifier("l'annulation est INTACTE", !!e.annulees['j1-e14'])
verifier('le créneau obtenu est INTACT', e.creneaux.j1_rencontre_royale?.heure === '11:20')

// ---------------------------------------------------------------------------
console.log('')
console.log('2. JOUR J, journée en cours : le bouton MANUEL doit refuser aussi')
let r = await appel('/api/journee/reinitialiser', 'POST')
verifier('refus avec le code 409', r.code === 409, 'code ' + r.code)
verifier("le refus explique pourquoi", /a commencé/.test(r.corps.erreur || ''), r.corps.erreur || '')
e = lire()
verifier('rien n’a été effacé', Object.keys(e.etapesFaites).length === 3)
srv.kill(); await attendre(700)

// ---------------------------------------------------------------------------
console.log('')
console.log('3. LA VEILLE AU SOIR : aucune journée du voyage aujourd’hui, la remise à zéro passe')
preparer('2026-09-30', '2026-10-01', { journeeDate: '2026-08-31' })
srv = demarrer(); await attendre(3500)
await appel('/api/snapshot')
e = lire()
verifier('la progression de la veille est effacée', Object.keys(e.etapesFaites).length === 0)
r = await appel('/api/journee/reinitialiser', 'POST')
verifier('le bouton manuel est autorisé', r.code === 200, 'code ' + r.code)
srv.kill(); await attendre(700)

// ---------------------------------------------------------------------------
console.log('')
console.log('4. BASCULE J1 → J2 : ce qu’on efface appartient à la VEILLE, donc autorisé')
preparer('2026-08-30', auj, { journeeDate: '2026-08-30' })   // jour 2 = aujourd'hui
srv = demarrer(); journal = ''
srv.stdout.on('data', (d) => { journal += d })
await attendre(3500)
await appel('/api/snapshot')
e = lire()
verifier('la progression de la veille est effacée', Object.keys(e.etapesFaites).length === 0)
verifier('le jour actif bascule tout seul sur 2', e.jourActif === 2, 'jourActif = ' + e.jourActif)
verifier('la date de journée est celle du jour', e.journeeDate === auj)
r = await appel('/api/journee/reinitialiser', 'POST')
verifier('mais le bouton manuel refuse désormais', r.code === 409, 'code ' + r.code)
srv.kill()

console.log('')
console.log(echecs.length ? `❌ ${echecs.length} échec(s) : ${echecs.join(' | ')}` : '✅ le garde-fou tient sur les quatre cas')
process.exit(echecs.length ? 1 : 0)
