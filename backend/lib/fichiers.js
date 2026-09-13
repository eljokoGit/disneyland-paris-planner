// Lecture / écriture des deux fichiers de données.
// Toute écriture est ATOMIQUE : fichier temporaire puis rename.
// Sans ça, une session Claude Code Remote peut lire un JSON à moitié écrit
// pendant que l'app sauvegarde, et inversement.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

let enCours = Promise.resolve() // sérialise les écritures dans le process

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// Le rename peut échouer transitoirement : sous Windows si un autre process tient
// le fichier ouvert, sous Linux si Syncthing est en train de le lire. On retente
// au lieu de laisser l'écriture échouer.
const REESSAYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

export async function ecrireAtomique(chemin, contenu, essais = 5) {
  const tache = enCours.then(async () => {
    const tmp = path.join(path.dirname(chemin), `.${path.basename(chemin)}.${process.pid}.${Date.now()}.tmp`)
    await fsp.writeFile(tmp, contenu, 'utf8')
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, chemin)
        return
      } catch (err) {
        if (i >= essais - 1 || !REESSAYABLE.has(err.code)) {
          await fsp.unlink(tmp).catch(() => {})   // ne pas laisser de .tmp orphelin
          throw err
        }
        await attendre(40 * (i + 1))
      }
    }
  })
  enCours = tache.catch(() => {})
  return tache
}

// Les .tmp orphelins d'un process tué polluent le dossier et, via Syncthing,
// les deux machines. On nettoie au démarrage.
export async function nettoyerTemporaires(dossier) {
  try {
    const fichiers = await fsp.readdir(dossier)
    for (const f of fichiers) {
      if (/^\..*\.\d+\.\d+\.tmp$/.test(f)) {
        await fsp.unlink(path.join(dossier, f)).catch(() => {})
        console.warn(`[démarrage] temporaire orphelin supprimé : ${f}`)
      }
    }
  } catch {}
}

export function ecrireJsonAtomique(chemin, objet) {
  return ecrireAtomique(chemin, JSON.stringify(objet, null, 2) + '\n')
}

// Windows écrit volontiers de l'UTF-8 AVEC BOM (PowerShell Set-Content, Notepad,
// certains éditeurs). JSON.parse le refuse. Sans ce nettoyage, un fichier édité
// à la main est ignoré en silence — le pire des comportements.
const sansBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t)

export async function lireJson(chemin, defaut = null) {
  try {
    const brut = sansBom(await fsp.readFile(chemin, 'utf8'))
    if (!brut.trim()) return defaut
    return JSON.parse(brut)
  } catch (err) {
    if (err.code === 'ENOENT') return defaut
    if (err instanceof SyntaxError) {
      // Lecture pendant une écriture non atomique côté tiers : on retente une fois.
      await new Promise((r) => setTimeout(r, 60))
      try { return JSON.parse(sansBom(await fsp.readFile(chemin, 'utf8'))) } catch (e2) {
        console.error(`[lecture] ${chemin} illisible : ${e2.message}`)
        return defaut
      }
    }
    throw err
  }
}

// Journal append-only : une ligne JSON par événement, jamais réécrit.
export async function journaliser(chemin, evenement) {
  const ligne = JSON.stringify({ horodatage: new Date().toISOString(), ...evenement }) + '\n'
  await fsp.appendFile(chemin, ligne, 'utf8')
}

// Surveillance du fichier. On écoute le DOSSIER et pas le fichier : une écriture
// atomique remplace l'inode par rename, ce qui casserait un watch posé sur le fichier.
// Sondage mtime en parallèle, car certains montages Docker ne propagent pas inotify.
export function surveiller(chemin, callback, delai = 150) {
  const dossier = path.dirname(chemin)
  const nom = path.basename(chemin)
  let timer = null
  let dernierMtime = 0

  const declencher = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      fs.stat(chemin, (err, st) => {
        if (err) return
        if (st.mtimeMs === dernierMtime) return
        dernierMtime = st.mtimeMs
        callback()
      })
    }, delai)
  }

  try {
    fs.watch(dossier, { persistent: true }, (_type, fichier) => {
      if (!fichier || fichier === nom) declencher()
    })
  } catch (err) {
    console.warn(`[surveillance] fs.watch indisponible sur ${dossier} :`, err.message)
  }

  setInterval(declencher, 3000).unref?.()
  fs.stat(chemin, (err, st) => { if (!err) dernierMtime = st.mtimeMs })
}
