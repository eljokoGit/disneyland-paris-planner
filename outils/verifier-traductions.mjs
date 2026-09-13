// Liste ce qui manque à la traduction espagnole.
//
//   node outils/verifier-traductions.mjs            → bilan, sortie 1 s'il manque quelque chose
//   node outils/verifier-traductions.mjs --liste    → les phrases manquantes, une par ligne
//   node outils/verifier-traductions.mjs --json F   → écrit les manquantes dans le fichier F
//
// Deux sources :
//   - l'interface : chaque t('…') / tr('…') des fichiers du frontend ;
//   - le plan : tous les textes de plan.json que l'app affiche (titres, lieux,
//     notes, consignes, photos, escapades, points de décision…).
// Une phrase absente du dictionnaire s'affiche en français : ce n'est pas une
// panne, mais c'est un trou, et ce script le montre au lieu de le laisser passer.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(RACINE, 'frontend/src')

const es = (await import(pathToFileURL(path.join(SRC, 'i18n/es.js')).href)).default
const planEs = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n/plan-es.json'), 'utf8'))

// ------------------------------------------------------------ interface
function fichiers(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => {
    const p = path.join(d, x.name)
    if (x.isDirectory()) return x.name === 'i18n' ? [] : fichiers(p)
    return /\.(jsx?|mjs)$/.test(x.name) ? [p] : []
  })
}

// Premier argument littéral de t( ou tr( — guillemets simples ou doubles.
const APPEL = /\btr?\(\s*(['"])((?:\\.|(?!\1).)*)\1/g
const cles = new Map()
const dynamiques = []
for (const f of fichiers(SRC)) {
  const texte = fs.readFileSync(f, 'utf8')
  for (const m of texte.matchAll(APPEL)) {
    const cle = m[2].replace(/\\(['"\\])/g, '$1')
    if (!cles.has(cle)) cles.set(cle, path.relative(SRC, f))
  }
  // t(variable) : la clé ne se lit pas dans le code. On les signale pour
  // vérifier à la main que chaque valeur possible est au dictionnaire.
  for (const m of texte.matchAll(/\btr?\(\s*([a-zA-Z_][\w.]*)\s*[,)]/g)) dynamiques.push(`${path.relative(SRC, f)} : t(${m[1]})`)
}
// Les valeurs passées par variable, connues d'avance.
for (const cle of ['Météo', 'Fermeture ou panne', 'Complet', 'Pas le temps', 'Attente', 'Nom']) cles.set(cle, 'constantes')

const manquantesUi = [...cles.keys()].filter((c) => !Object.prototype.hasOwnProperty.call(es.ui, c))
const inutilesUi = Object.keys(es.ui).filter((c) => !cles.has(c))

// ------------------------------------------------------------ plan
const plan = JSON.parse(fs.readFileSync(path.join(RACINE, 'data/plan.json'), 'utf8').replace(/^\uFEFF/, ''))
const textesPlan = new Map()
const ajouter = (v, ou) => {
  if (typeof v !== 'string' || !v.trim() || /^[\d:]+$/.test(v)) return
  if (!textesPlan.has(v)) textesPlan.set(v, ou)
}
for (const j of plan.jours) {
  ajouter(j.libelle, 'jour'); ajouter(j.parc, 'jour'); ajouter(j.jamaisSacrifier, 'jour')
  for (const e of j.etapes) {
    ajouter(e.titre, `${e.id} titre`); ajouter(e.lieu, `${e.id} lieu`); ajouter(e.note, `${e.id} note`)
    ajouter(e.direction, 'direction')
    for (const a of e.avertissements || []) ajouter(a.texte, `${e.id} consigne`)
    if (e.retrait) ajouter(e.retrait.motif, `${e.id} retrait`)
  }
  for (const z of j.zones || []) {
    ajouter(z.nom, 'zone'); ajouter(z.direction, 'direction')
    for (const f of z.photos || []) { ajouter(f.nom, 'photo'); ajouter(f.ou, 'photo') }
  }
  for (const o of j.ordreSacrifice || []) { ajouter(o.cible, 'sacrifice'); ajouter(o.detail, 'sacrifice') }
  const esc = j.escapades || {}
  for (const c of [esc.cible, ...(esc.cibles || []), ...(esc.ciblesSuivantes || [])].filter(Boolean)) {
    ajouter(c.nom, 'escapade'); ajouter(c.lieu, 'escapade')
  }
  for (const r of esc.rappels || []) { ajouter(r.titre, 'escapade'); ajouter(r.texte, 'escapade') }
  for (const c of esc.creneaux || []) {
    for (const k of ['coute', 'vigilance', 'decision', 'mesure']) ajouter(c[k], 'escapade')
    for (const l of c.table || []) { ajouter(l.si, 'escapade'); ajouter(l.verdict, 'escapade') }
  }
}
for (const x of plan.pointsDecision || []) { ajouter(x.titre, 'décision'); ajouter(x.declencheur, 'décision'); ajouter(x.action, 'décision') }
for (const r of plan.reservations.reglesFilesVirtuelles || []) ajouter(r, 'règles')
ajouter(plan.fileAttente.avertissement, 'attentes')
for (const l of Object.values(plan.fileAttente.filesVirtuelles || {})) for (const f of l) ajouter(f.nom, 'file virtuelle')
ajouter((plan.sourcePhotos || {}).titre, 'photos')
// souplesseAncre affiche la note du paramètre
for (const x of plan.parametres) ajouter(x.note, `${x.id} note`)

const couvert = (v) => Object.prototype.hasOwnProperty.call(planEs, v)
  || Object.prototype.hasOwnProperty.call(es.moteur, v)
  || es.motifs.some(([motif]) => motif.test(v))
const manquantesPlan = [...textesPlan.entries()].filter(([v]) => !couvert(v))

// ------------------------------------------------------------ bilan
if (process.argv.includes('--json')) {
  const sortie = process.argv[process.argv.indexOf('--json') + 1]
  fs.writeFileSync(sortie, JSON.stringify({
    ui: manquantesUi,
    plan: manquantesPlan.map(([fr, ou]) => ({ ou, fr })),
  }, null, 1))
}
if (process.argv.includes('--liste')) {
  for (const c of manquantesUi) console.log('UI   ' + c)
  for (const [c, ou] of manquantesPlan) console.log(`PLAN [${ou}] ${c}`)
}
console.log(`Interface : ${cles.size - manquantesUi.length}/${cles.size} traduites`
  + (inutilesUi.length ? ` · ${inutilesUi.length} entrée(s) du dictionnaire plus utilisée(s)` : ''))
console.log(`Plan      : ${textesPlan.size - manquantesPlan.length}/${textesPlan.size} traduits`)
if (dynamiques.length && process.argv.includes('--liste')) {
  console.log('\nAppels avec une clé variable (à vérifier à la main) :')
  for (const d of dynamiques) console.log('  ' + d)
}
process.exit(manquantesUi.length || manquantesPlan.length ? 1 : 0)
