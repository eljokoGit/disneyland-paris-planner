// Sonde de santé, appelée par le healthcheck Docker.
// Sort en 0 si le collecteur a réussi un tour récemment, en 1 sinon.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const f = path.join(RACINE, 'attentes', 'etat-collecteur.json')
const LIMITE = Number(process.env.SILENCE_MAX_MIN) || 20

// Un BOM en tête (PowerShell, Notepad) ferait échouer JSON.parse et la sonde
// déclarerait mort un collecteur en pleine forme.
const sansBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t)

try {
  const s = JSON.parse(sansBom(fs.readFileSync(f, 'utf8')))
  const ref = s.dernierSucces || s.demarreLe
  const min = (Date.now() - new Date(ref).getTime()) / 60000
  if (min > LIMITE) {
    console.error(`collecteur muet depuis ${Math.round(min)} min`)
    process.exit(1)
  }
  console.log(`ok — dernier relevé il y a ${Math.round(min)} min, ${s.releves} au total`)
} catch (err) {
  console.error('battement illisible :', err.message)
  process.exit(1)
}
