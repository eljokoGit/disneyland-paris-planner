// Accès serveur, tolérant au réseau.
// Le réseau est mauvais dans les parcs : toute mutation est appliquée localement
// tout de suite, puis mise en file et rejouée dès que le serveur redevient joignable.

const CLE_CACHE = 'disney-cache-v1'
const CLE_FILE = 'disney-file-v1'

export function cleSecrete() {
  const url = new URL(window.location.href)
  const k = url.searchParams.get('k')
  if (k) {
    localStorage.setItem('disney-cle', k)
    url.searchParams.delete('k')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    return k
  }
  return localStorage.getItem('disney-cle') || ''
}

function entetes() {
  const h = { 'Content-Type': 'application/json' }
  const k = localStorage.getItem('disney-cle')
  if (k) h['x-cle'] = k
  return h
}

export function lireCache() {
  try { return JSON.parse(localStorage.getItem(CLE_CACHE) || 'null') } catch { return null }
}
export function ecrireCache(instantane) {
  try { localStorage.setItem(CLE_CACHE, JSON.stringify(instantane)) } catch {}
}

export function lireFile() {
  try { return JSON.parse(localStorage.getItem(CLE_FILE) || '[]') } catch { return [] }
}
export function ecrireFile(file) {
  try { localStorage.setItem(CLE_FILE, JSON.stringify(file)) } catch {}
}

export async function chargerInstantane() {
  const r = await fetch('/api/snapshot', { headers: entetes(), cache: 'no-store' })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const data = await r.json()
  ecrireCache(data)
  return data
}

export async function envoyer(chemin, corps) {
  const r = await fetch(chemin, { method: 'POST', headers: entetes(), body: JSON.stringify(corps || {}) })
  if (!r.ok) {
    // On garde le code : il dit si réessayer a une chance de servir.
    const err = new Error('HTTP ' + r.status)
    err.statut = r.status
    err.message = await r.text().then((t) => {
      try { return JSON.parse(t).erreur || err.message } catch { return err.message }
    }).catch(() => err.message)
    throw err
  }
  return r.json()
}

// Une panne réseau se répare toute seule : on réessaiera. Un refus du serveur,
// non — la même requête sera refusée à l'identique dans une heure. Confondre
// les deux, c'est ce qui bloquait la file : l'opération refusée restait en tête
// et empêchait TOUTES les suivantes de partir, définitivement et sans rien dire.
//
// 401/403 font exception : la clé peut avoir été mal lue, et jeter la file
// entière pour ça perdrait le travail de la journée. 408/429 aussi : le serveur
// demande d'attendre, pas d'abandonner.
export function estDefinitif(err) {
  const c = err && err.statut
  if (!c) return false                                  // pas de réponse = réseau
  if (c === 401 || c === 403 || c === 408 || c === 429) return false
  return c >= 400 && c < 500
}

// Rejoue la file dans l'ordre. S'arrête à la première panne RÉSEAU pour ne pas
// désordonner les événements ; écarte au contraire les opérations que le
// serveur refuse, et continue — sinon plus rien ne repart jamais.
export async function viderFile() {
  let file = lireFile()
  const rejetees = []
  while (file.length) {
    const op = file[0]
    try {
      await envoyer(op.chemin, op.corps)
    } catch (err) {
      if (!estDefinitif(err)) return { restant: file.length, rejetees }
      rejetees.push({ chemin: op.chemin, a: op.a, raison: err.message })
    }
    file = file.slice(1)
    ecrireFile(file)
  }
  return { restant: 0, rejetees }
}

export function empiler(chemin, corps) {
  const file = lireFile()
  file.push({ chemin, corps, a: new Date().toISOString() })
  ecrireFile(file)
}

// Version du frontend au moment où cette page a été chargée. Si le serveur en
// annonce une autre, c'est qu'une nouvelle version est en ligne : on recharge.
let versionChargee = null

export function verifierVersion(v) {
  if (!v || v === 'dev') return false
  if (versionChargee === null) { versionChargee = v; return false }
  return v !== versionChargee
}

// Flux serveur : rechargement à chaud du plan et état partagé entre téléphones.
export function ouvrirFlux(surMaj, surEtatConnexion) {
  let source = null
  let relance = null

  const connecter = () => {
    const k = localStorage.getItem('disney-cle')
    source = new EventSource('/api/stream' + (k ? '?k=' + encodeURIComponent(k) : ''))
    source.addEventListener('maj', (e) => {
      surEtatConnexion(true)
      let t = 'etat', v = null
      try { const d = JSON.parse(e.data); t = d.type; v = d.v } catch {}
      if (verifierVersion(v)) {
        console.info('[maj] nouvelle version du frontend, rechargement')
        window.location.reload()
        return
      }
      if (t !== 'battement') surMaj(t)
    })
    source.onerror = () => {
      surEtatConnexion(false)
      source.close()
      clearTimeout(relance)
      relance = setTimeout(connecter, 4000)
    }
  }
  connecter()
  return () => { clearTimeout(relance); source && source.close() }
}
