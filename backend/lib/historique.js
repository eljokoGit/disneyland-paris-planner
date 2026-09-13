// Moyennes horaires calculées à partir de ce que le collecteur a archivé.
//
// Les fichiers d'historique ne bougent qu'une fois toutes les cinq minutes ; on
// garde donc le résultat en cache et on ne relit les .jsonl que si l'un d'eux a
// changé de taille ou de date. Sans ça, chaque clic sur une attraction relirait
// plusieurs milliers de lignes.

import fs from 'node:fs'
import path from 'node:path'

const cache = new Map()   // jour -> { signature, data }

function signature(dossier, fichiers) {
  return fichiers
    .map((f) => {
      const s = fs.statSync(path.join(dossier, f))
      return `${f}:${s.size}:${s.mtimeMs}`
    })
    .join('|')
}

export function moyennesJour(dossier, jour) {
  let fichiers = []
  try {
    fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith(`-jour${jour}.jsonl`)).sort()
  } catch {
    return null
  }
  if (!fichiers.length) return null

  const sig = signature(dossier, fichiers)
  const enCache = cache.get(jour)
  if (enCache && enCache.signature === sig) return enCache.data

  const noms = {}
  const parHeure = {}   // { id: { heure: [valeurs] } }
  const dates = new Set()

  for (const f of fichiers) {
    let lignes
    try { lignes = fs.readFileSync(path.join(dossier, f), 'utf8').trim().split('\n') } catch { continue }
    for (const brut of lignes) {
      let l
      try { l = JSON.parse(brut) } catch { continue }
      if (l.type === 'entete') { Object.assign(noms, l.attractions); continue }
      if (!l.t) continue
      dates.add(f.slice(0, 10))
      const heure = Number(l.t.slice(0, 2))
      for (const [id, min] of Object.entries(l.w || {})) {
        ((parHeure[id] ||= {})[heure] ||= []).push(min)
      }
    }
  }

  const attractions = {}
  for (const id of Object.keys(parHeure)) {
    const heures = []
    let total = 0, n = 0
    for (const h of Object.keys(parHeure[id]).map(Number).sort((a, b) => a - b)) {
      const vals = parHeure[id][h]
      const somme = vals.reduce((s, v) => s + v, 0)
      heures.push({
        heure: h,
        moyenne: Math.round(somme / vals.length),
        mini: Math.min(...vals),
        maxi: Math.max(...vals),
        releves: vals.length,
      })
      total += somme; n += vals.length
    }
    attractions[id] = {
      nom: noms[id] || id,
      heures,
      moyenne: n ? Math.round(total / n) : null,
      pointe: heures.length ? Math.max(...heures.map((x) => x.moyenne)) : null,
      creux: heures.length ? Math.min(...heures.map((x) => x.moyenne)) : null,
      releves: n,
    }
  }

  const data = { jour: Number(jour), jours: [...dates].sort(), attractions }
  cache.set(jour, { signature: sig, data })
  return data
}
