// Temps d'attente en direct, depuis ThemeParks.wiki.
//
// Politesse imposée par la doc, et respectée ici :
//  - les données du parc changent toutes les 5 min : on n'interroge pas plus vite
//  - on envoie If-None-Match et on accepte un 304 vide quand rien n'a bougé
//  - le sondage est CÔTÉ SERVEUR uniquement : cinq téléphones qui interrogeraient
//    l'API en direct, ce serait cinq fois la même requête pour la même donnée

const BASE = 'https://api.themeparks.wiki/v1'

export function creerCollecteur({ parcs, intervalleMinutes = 5, surMaj = () => {} }) {
  const etat = {}   // { [jour]: { entites, majLe, erreur, etag } }
  for (const jour of Object.keys(parcs)) etat[jour] = { entites: [], majLe: null, erreur: null, etag: null }

  async function collecter(jour) {
    const id = parcs[jour]
    const entrees = {}
    if (etat[jour].etag) entrees['If-None-Match'] = etat[jour].etag
    try {
      const r = await fetch(`${BASE}/entity/${id}/live`, {
        headers: { ...entrees, 'User-Agent': 'plan-disneyland-prive/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      if (r.status === 304) {                       // rien n'a changé
        etat[jour].majLe = new Date().toISOString()
        etat[jour].erreur = null
        return false
      }
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const j = await r.json()
      etat[jour] = {
        entites: (j.liveData || []).map(nettoyer),
        majLe: new Date().toISOString(),
        erreur: null,
        etag: r.headers.get('etag'),
      }
      return true
    } catch (err) {
      // On garde la dernière donnée connue : un chiffre un peu vieux vaut mieux
      // que pas de chiffre du tout, à condition de dire qu'il est vieux.
      etat[jour].erreur = err.message
      console.warn(`[attentes] jour ${jour} : ${err.message}`)
      return false
    }
  }

  function demarrer() {
    const tour = async () => {
      let change = false
      for (const jour of Object.keys(parcs)) change = (await collecter(jour)) || change
      if (change) surMaj()
    }
    tour()
    const t = setInterval(tour, intervalleMinutes * 60000)
    t.unref?.()
    return () => clearInterval(t)
  }

  return { etat, collecter, demarrer, lire: (jour) => etat[String(jour)] || null }
}

// L'API renvoie parfois des séances d'un ancien jour pour un spectacle qui ne
// joue pas : les afficher comme celles du jour serait un mensonge.
function seancesDuJour(showtimes) {
  if (!showtimes || !showtimes.length) return []
  const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })  // AAAA-MM-JJ
  return showtimes
    .filter((s) => (s.startTime || '').slice(0, 10) === auj)
    .map((s) => s.startTime.slice(11, 16))
    .sort()
}

const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : null)

// Tolérance après la FIN de la période de retour : au-delà, il n'y a plus rien
// à réserver, quoi qu'annonce l'état.
//
// Je n'en mets pas davantage. J'ai essayé deux fois de filtrer sur l'heure de
// début de la période, en croyant repérer des rejeux : le parent a vérifié sur
// place, à 17h36 la file était fermée et à 18h16 elle était ouverte — avec la
// MÊME fenêtre de 14h00 dans les deux cas. Ce champ ne distingue rien, et
// filtrer dessus aurait supprimé une vraie ouverture.
//
// Le volume se règle autrement, et c'est fait : un seul expéditeur, et un délai
// de carence qui survit aux redémarrages.
const GRACE_FIN_MIN = 10

function nettoyer(e) {
  const q = e.queue || {}
  const attente = (k) => (q[k] && typeof q[k].waitTime === 'number' ? q[k].waitTime : null)

  // File payante (Premier Access) : l'API donne le PRIX du moment et la fenêtre
  // de retour proposée. Le prix bouge dans la journée selon la demande.
  const pa = q.PAID_RETURN_TIME || null
  const premierAcces = pa ? {
    etat: pa.state || null,
    disponible: pa.state === 'AVAILABLE',
    prix: pa.price && typeof pa.price.amount === 'number' ? pa.price.amount / 100 : null,
    prixTexte: (pa.price && pa.price.formatted) || null,
    retourDebut: hhmm(pa.returnStart),
    retourFin: hhmm(pa.returnEnd),
  } : null

  // File virtuelle gratuite.
  //
  // `returnStart`/`returnEnd` délimitent la PÉRIODE pendant laquelle on peut
  // revenir. Tant que la fin est devant nous, une annonce d'ouverture peut être
  // réelle, même si le début est loin derrière : le 1er septembre, la file de
  // Toy Story a répondu AVAILABLE à 17h36 avec la période 14h00-18h25, puis
  // FINISHED cinq minutes plus tard. Un simple rejeu ne se refermerait pas.
  //
  // Le seul cas qu'on écarte est celui d'une période ENTIÈREMENT écoulée : là,
  // il n'y a plus rien à réserver, quoi qu'annonce l'état.
  //
  // On ne filtre pas plus. Priorité 1 : ne rien rater. Une alerte de trop coûte
  // un regard sur le téléphone ; une alerte manquée coûte la rencontre.
  const rt = q.RETURN_TIME || null
  let fileVirtuelle = null
  if (rt) {
    const fin = rt.returnEnd ? new Date(rt.returnEnd) : null
    const finieMin = fin ? Math.round((Date.now() - fin.getTime()) / 60000) : null
    const periodeEcoulee = finieMin != null && finieMin > GRACE_FIN_MIN
    fileVirtuelle = {
      etat: rt.state || null,
      disponible: rt.state === 'AVAILABLE' && !periodeEcoulee,
      complet: rt.state === 'TEMP_FULL' || rt.state === 'FINISHED' || periodeEcoulee,
      periodeEcoulee,
      retourDebut: hhmm(rt.returnStart),
      retourFin: hhmm(rt.returnEnd),
    }
  }

  return {
    id: e.id,
    nom: e.name,
    type: e.entityType,
    statut: e.status || null,
    ouverte: e.status === 'OPERATING',
    enPanne: e.status === 'DOWN',
    attente: attente('STANDBY'),
    singleRider: attente('SINGLE_RIDER'),
    premierAcces,
    fileVirtuelle,
    seances: seancesDuJour(e.showtimes),
    majLe: e.lastUpdated || null,
  }
}
