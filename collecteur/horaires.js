// Horaires d'ouverture, attraction par attraction.
//
// Le parc ferme à 22h00, mais chaque attraction a son propre calendrier : le
// 1er septembre 2026, la Galerie de la Belle au Bois Dormant fermait à 20h15,
// Alice et Casey Jr. à 20h30, PhilharMagique à 17h30. Une étape placée après
// la fermeture de son attraction ne peut pas aboutir, et rien dans le plan ne
// le signalait.
//
// Ces horaires sont publiés la veille et ne bougent pas dans la journée : on
// les relève UNE FOIS par jour, pas toutes les cinq minutes.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const BASE = 'https://api.themeparks.wiki/v1'

const dateDuJour = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })

// TOUTES les attractions des deux parcs, pas seulement celles du plan : s'il
// reste du temps, la famille fera des choses non prévues, et il faut alors
// savoir ce qui est encore ouvert. Un relevé par jour, ça ne coûte presque rien.
export async function toutesLesAttractions(plan) {
  const ix = new Map()
  for (const parc of Object.values(plan.fileAttente.parcs)) {
    try {
      const r = await fetch(`${BASE}/entity/${parc}/children`, {
        headers: { 'User-Agent': 'plan-disneyland-prive/1.0' },
        signal: AbortSignal.timeout(20000),
      })
      if (!r.ok) continue
      const d = await r.json()
      for (const c of d.children || []) {
        if (c.entityType === 'ATTRACTION') ix.set(c.id, c.name)
      }
    } catch { /* on fera avec ce qu'on a */ }
  }
  // Les substitutions et cibles d'escapade, au cas où l'une manquerait.
  for (const j of plan.jours || []) {
    for (const sub of j.substitutions || []) if (!ix.has(sub.id)) ix.set(sub.id, sub.nom)
    const esc = j.escapades || {}
    for (const c of [esc.cible, ...(esc.ciblesSuivantes || []), ...(esc.cibles || [])]) {
      if (c && c.attractionId && !ix.has(c.attractionId)) ix.set(c.attractionId, c.nom)
    }
  }
  return ix
}

async function horaireDe(id) {
  const r = await fetch(`${BASE}/entity/${id}/schedule`, {
    headers: { 'User-Agent': 'plan-disneyland-prive/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) return null
  const d = await r.json()
  const auj = dateDuJour()
  const creneaux = (d.schedule || [])
    .filter((x) => x.date === auj && x.type === 'OPERATING')
    .map((x) => ({ ouverture: x.openingTime.slice(11, 16), fermeture: x.closingTime.slice(11, 16) }))
  return creneaux.length ? creneaux : null
}

// Relève les horaires du jour et les écrit dans data/attentes/horaires-<date>.json.
// Rien n'est réécrit si le fichier du jour existe déjà : un appel par attraction
// et par jour, pas davantage.
export async function releverHoraires({ dossier, plan, journaliser = console.log }) {
  const fichier = path.join(dossier, `horaires-${dateDuJour()}.json`)
  if (fs.existsSync(fichier)) return null

  const attractions = await toutesLesAttractions(plan)
  const resultat = { date: dateDuJour(), releveLe: new Date().toISOString(), attractions: {} }
  let ok = 0

  for (const [id, nom] of attractions) {
    try {
      const creneaux = await horaireDe(id)
      resultat.attractions[id] = { nom, creneaux }
      if (creneaux) ok++
    } catch (err) {
      resultat.attractions[id] = { nom, creneaux: null, erreur: err.message }
    }
    // On espace les appels : rien ne presse, et l'API est un service gratuit.
    await new Promise((r) => setTimeout(r, 250))
  }

  const tmp = fichier + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(resultat, null, 2), 'utf8')
  await fsp.rename(tmp, fichier)
  journaliser(`[horaires] ${ok}/${attractions.size} attractions relevées pour le ${resultat.date}`)
  return resultat
}

// Lecture, pour le serveur : les horaires du jour, indexés par attraction.
export function lireHoraires(dossier, date = dateDuJour()) {
  try {
    const brut = fs.readFileSync(path.join(dossier, `horaires-${date}.json`), 'utf8')
    return JSON.parse(brut.replace(/^﻿/, ''))
  } catch {
    return null
  }
}
