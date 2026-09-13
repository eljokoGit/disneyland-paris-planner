import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  chargerInstantane, cleSecrete, empiler, envoyer, lireCache, lireFile, ouvrirFlux,
  verifierVersion, viderFile, estDefinitif,
} from './api.js'
import { calculerJour, ordreSacrifice, hmVersMinutes, minutesVersHm, resumeTexte, situation } from '../../shared/moteur.js'
import Maintenant from './pages/Maintenant.jsx'
import Journee from './pages/Journee.jsx'
import Reservations from './pages/Reservations.jsx'
import Attentes from './pages/Attentes.jsx'
import Reglages from './pages/Reglages.jsx'
import { t, useLangue } from './i18n/index.js'

const ETAT_VIDE = {
  version: 2, jourActif: 1, etapesFaites: {}, etapesSupprimees: [],
  ancresDecrochees: [], durees: {}, ordreSacrifice: {}, annulees: {},
  parametres: {}, creneaux: {},
}

function minutesLocales() {
  const s = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  return hmVersMinutes(s.replace('h', ':'))
}

export default function App() {
  // Changer de langue fait re-rendre toute l'app : les pages lisent la langue
  // courante à chaque rendu, et la clé ci-dessous les remonte proprement.
  const langue = useLangue()
  const cacheInitial = lireCache()
  const [plan, setPlan] = useState(cacheInitial?.plan || null)
  const [etat, setEtat] = useState({ ...ETAT_VIDE, ...(cacheInitial?.etat || {}) })
  const [onglet, setOnglet] = useState('maintenant')
  const [enLigne, setEnLigne] = useState(true)
  const [enAttente, setEnAttente] = useState(lireFile().length)
  const [toast, setToast] = useState(null)
  const [maintenant, setMaintenant] = useState(minutesLocales())
  const [erreur, setErreur] = useState(null)
  const [plansOfficiels, setPlansOfficiels] = useState(cacheInitial?.plansOfficiels || {})
  const [attentes, setAttentes] = useState(cacheInitial?.attentes || {})
  const fileOccupee = useRef(false)

  useEffect(() => { cleSecrete() }, [])

  // Horloge : une minute de granularité suffit, et ça économise la batterie.
  useEffect(() => {
    const t = setInterval(() => setMaintenant(minutesLocales()), 10000)
    return () => clearInterval(t)
  }, [])

  const rafraichir = useCallback(async () => {
    try {
      const inst = await chargerInstantane()
      if (verifierVersion(inst.versionFront)) { window.location.reload(); return }
      setPlan(inst.plan)
      setPlansOfficiels(inst.plansOfficiels || {})
      setAttentes(inst.attentes || {})
      setEnLigne(true)
      setErreur(null)
      // Une mutation en attente n'a pas encore atteint le serveur :
      // on garde l'état local, sinon l'écran reculerait sous les doigts.
      if (lireFile().length === 0) setEtat({ ...ETAT_VIDE, ...inst.etat })
    } catch (err) {
      setEnLigne(false)
      // Un 401 n'est PAS une panne de réseau : le serveur répond, c'est la clé
      // qui manque. Le dire « injoignable » envoie chercher un problème là où
      // il n'y en a pas — c'est arrivé au premier essai sur le téléphone, le
      // lien ayant perdu son ?k= en passant par une messagerie.
      if (String(err.message).includes('401')) setErreur('CLE')
      else if (!plan) setErreur('INJOIGNABLE')
    }
  }, [plan])

  const notifier = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast(null), 2600)
  }, [])

  const rejouer = useCallback(async () => {
    if (fileOccupee.current) return
    fileOccupee.current = true
    try {
      const { restant, rejetees } = await viderFile()
      setEnAttente(restant)
      // Une opération écartée laisse l'écran en avance sur le serveur : il faut
      // le resynchroniser, et le dire — se taire ferait croire qu'elle a pris.
      if (rejetees.length) {
        notifier(rejetees.length === 1
          ? t('Une action a été refusée par le serveur : {raison}', { raison: rejetees[0].raison })
          : t('{n} actions ont été refusées par le serveur', { n: rejetees.length }))
      }
      if (restant === 0) await rafraichir()
    } finally { fileOccupee.current = false }
  }, [rafraichir, notifier])

  useEffect(() => {
    rafraichir()
    const fermer = ouvrirFlux(
      () => rafraichir(),
      (ok) => { setEnLigne(ok); if (ok) rejouer() },
    )
    const surRetour = () => rejouer()
    window.addEventListener('online', surRetour)
    const t = setInterval(() => { if (lireFile().length) rejouer() }, 8000)
    return () => { fermer(); window.removeEventListener('online', surRetour); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toute mutation : effet local immédiat, envoi ensuite, file d'attente si le réseau lâche.
  const muter = useCallback(async (chemin, corps, majLocale) => {
    setEtat((precedent) => {
      const suivant = JSON.parse(JSON.stringify(precedent))
      majLocale(suivant)
      return suivant
    })
    try {
      await envoyer(chemin, corps)
      setEnLigne(true)
      if (lireFile().length === 0) {
        const inst = await chargerInstantane()
        setPlan(inst.plan)
        setEtat({ ...ETAT_VIDE, ...inst.etat })
      }
    } catch (err) {
      // Mettre en file une opération que le serveur refuse, c'est la condamner
      // à bloquer toutes les suivantes. Le serveur a répondu : il est joignable,
      // il a dit non. On corrige l'écran sur ce qu'il dit, et on prévient.
      if (estDefinitif(err)) {
        setEnLigne(true)
        notifier(t('Refusé par le serveur : {raison}', { raison: err.message }))
        try {
          const inst = await chargerInstantane()
          setPlan(inst.plan)
          if (lireFile().length === 0) setEtat({ ...ETAT_VIDE, ...inst.etat })
        } catch {}
        return
      }
      empiler(chemin, corps)
      setEnAttente(lireFile().length)
      setEnLigne(false)
    }
  }, [notifier])

  const vue = useMemo(() => {
    if (!plan) return null
    return {
      situation: situation(plan, etat, maintenant, attentes.index || {}),
      calc: calculerJour(plan, etat.jourActif || 1, etat, attentes.index || {}),
      ordreSacrifice: ordreSacrifice(plan, etat.jourActif || 1, etat),
      resume: resumeTexte(plan, etat, maintenant, attentes.index || {}),
    }
  }, [plan, etat, maintenant, attentes])

  // Clé absente : ce n'est pas une panne, et ça se répare sur place. Inutile de
  // renvoyer le parent chercher le lien d'origine dans une conversation.
  if (erreur === 'CLE') {
    return (
      <div className="contenu">
        <div className="bloc" style={{ marginTop: 20 }}>
          <div className="bloc-titre">{t("Clé d'accès manquante")}</div>
          <p className="vide" style={{ textAlign: 'left' }}>
            {t("Le serveur répond, mais ce navigateur n'a pas la clé. Elle se perd quand le lien passe par une messagerie qui coupe la fin de l'adresse.")}
          </p>
          <form onSubmit={(ev) => {
            ev.preventDefault()
            const k = new FormData(ev.target).get('cle').toString().trim()
            if (!k) return
            localStorage.setItem('disney-cle', k)
            window.location.reload()
          }}>
            <input name="cle" className="champ-cle" placeholder={t('Collez la clé ici')}
              autoCapitalize="off" autoCorrect="off" spellCheck="false" />
            <button className="bouton" type="submit" style={{ marginTop: 10 }}>{t('Entrer')}</button>
          </form>
        </div>
      </div>
    )
  }
  if (erreur) return <div className="contenu"><p className="vide">{erreur === 'INJOIGNABLE' ? t('Serveur injoignable et aucun plan en cache.') : erreur}</p></div>
  if (!plan || !vue?.situation) return <div className="contenu"><p className="vide">{t('Chargement…')}</p></div>

  const communs = { plan, etat, muter, notifier, maintenant, plansOfficiels,
    attentes: attentes.index || {}, infoAttentes: attentes, ...vue }
  const alerte = vue.situation.alerte

  return (
    <div className="appli" key={langue}>
      {!enLigne && (
        <div className="bandeau-hors-ligne">
          {enAttente > 0
            ? (enAttente === 1 ? t('HORS LIGNE — 1 action en attente') : t('HORS LIGNE — {n} actions en attente', { n: enAttente }))
            : t('HORS LIGNE — affichage en cache')}
        </div>
      )}

      {onglet === 'maintenant' && <Maintenant {...communs} />}
      {onglet === 'journee' && <Journee {...communs} />}
      {onglet === 'resas' && <Reservations {...communs} />}
      {onglet === 'attentes' && <Attentes {...communs} />}
      {onglet === 'reglages' && <Reglages {...communs} />}

      <nav className="onglets">
        {[
          ['maintenant', '⏱', t('Maintenant')],
          ['journee', '📋', t('Journée')],
          ['attentes', '⏳', t('Attentes')],
          ['resas', '🎟', t('Résas')],
          ['reglages', '⚙', t('Réglages')],
        ].map(([id, pic, libelle]) => (
          <button key={id} className={onglet === id ? 'actif' : ''} onClick={() => setOnglet(id)}>
            <span className="pic">{pic}</span>
            {libelle}
            {id === 'maintenant' && alerte && <span className="pastille">!</span>}
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
