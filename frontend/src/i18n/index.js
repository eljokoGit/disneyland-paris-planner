// Langue de l'interface.
//
// Le FRANÇAIS EST LA CLÉ. On écrit t('Dans les temps') dans le code, et le
// dictionnaire espagnol traduit cette phrase-là. Deux raisons :
//   - le code reste lisible tel qu'il était, en français comme tout le reste ;
//   - une traduction qui manque retombe sur le français, jamais sur une clé
//     technique du genre « bandeau.alheure » au milieu de l'écran.
// `outils/verifier-traductions.mjs` liste ce qui manque.
//
// La langue est un réglage DU TÉLÉPHONE, pas de la famille : chacun lit la
// sienne. Elle vit donc dans le navigateur, pas dans l'état partagé.
import React, { useEffect, useState } from 'react'
import es from './es.js'
import planEs from './plan-es.json'

export const LANGUES = [
  { id: 'fr', nom: 'Français', locale: 'fr-FR' },
  { id: 'es', nom: 'Español', locale: 'es-ES' },
]
const CLE = 'disney-langue'

function initiale() {
  try {
    const l = localStorage.getItem(CLE)
    if (LANGUES.some((x) => x.id === l)) return l
  } catch { /* stockage refusé : on devine */ }
  // Premier lancement : un téléphone réglé en espagnol s'ouvre en espagnol.
  const nav = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : []
  return nav.some((x) => /^es\b/i.test(x || '')) ? 'es' : 'fr'
}

let courante = initiale()
if (typeof document !== 'undefined') document.documentElement.lang = courante
const abonnes = new Set()

export const langue = () => courante
export const locale = () => (LANGUES.find((x) => x.id === courante) || LANGUES[0]).locale

export function choisirLangue(l) {
  if (!LANGUES.some((x) => x.id === l) || l === courante) return
  courante = l
  try { localStorage.setItem(CLE, l) } catch { /* elle ne tiendra que la session */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l
  abonnes.forEach((f) => f(l))
}

// Le composant racine s'y abonne : changer de langue le fait re-rendre.
export function useLangue() {
  const [l, setL] = useState(courante)
  useEffect(() => {
    abonnes.add(setL)
    return () => { abonnes.delete(setL) }
  }, [])
  return l
}

const remplir = (s, vars) => (vars
  ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m))
  : s)

// Texte de l'interface. `{nom}` se remplit avec `vars`.
export function t(fr, vars) {
  const texte = courante === 'es' && Object.prototype.hasOwnProperty.call(es.ui, fr) ? es.ui[fr] : fr
  return remplir(texte, vars)
}

// Même chose, avec du gras : t('Vous y seriez avec <b>{n} min</b>', …).
export function tr(fr, vars) {
  return t(fr, vars).split(/(<b>.*?<\/b>)/g).filter(Boolean).map((morceau, i) => {
    const m = morceau.match(/^<b>(.*)<\/b>$/)
    return m ? React.createElement('b', { key: i }, m[1]) : morceau
  })
}

// Contenu du PLAN et phrases fabriquées par le moteur : titres, notes, lieux,
// consignes. Ils ne sont pas dans le code, ils viennent de plan.json — d'où un
// dictionnaire à part, et des motifs pour ce qui est calculé (« TRANSITION :
// marche vers frozen », « Séance suivante à 14h05. »).
export function tp(fr) {
  if (fr == null || courante === 'fr' || typeof fr !== 'string') return fr
  if (Object.prototype.hasOwnProperty.call(planEs, fr)) return planEs[fr]
  if (Object.prototype.hasOwnProperty.call(es.moteur, fr)) return es.moteur[fr]
  for (const [motif, traduire] of es.motifs) {
    const m = fr.match(motif)
    if (m) return traduire(m)
  }
  return fr
}

// Heures : « 10h30 » en français, « 10:30 » en espagnol.
export const h = (hm) => {
  if (!hm) return '--:--'
  return courante === 'es' ? hm : hm.replace(':', 'h')
}

// Pluriel simple : pl(n, 'action', 'actions').
export const pl = (n, un, plusieurs) => (Math.abs(n) === 1 ? un : plusieurs)
