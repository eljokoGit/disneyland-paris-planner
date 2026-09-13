import React, { useCallback, useEffect, useState } from 'react'
import { t, tp, h, langue, locale } from '../i18n/index.js'

const ORDRES = [
  { id: 'attente', libelle: 'Attente' },
  { id: 'nom', libelle: 'Nom' },
]

function cle() {
  const k = localStorage.getItem('disney-cle')
  return k ? '?k=' + encodeURIComponent(k) : ''
}

function depuis(iso) {
  if (!iso) return null
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return t("à l'instant")
  return t('il y a {n} min', { n: min })
}

// Le détail d'une attraction : ce que le collecteur a archivé, heure par heure.
// Hors du composant parent — une fonction définie à l'intérieur crée un nouveau
// type de composant à chaque rendu et React démonte tout le sous-arbre.
function DetailHeures({ histo, jours, live }) {
  if (!histo || !histo.heures.length) {
    return (
      <div className="detail-heures vide-histo">
        {t("Rien d'archivé pour cette attraction — le collecteur ne l'a pas encore vue ouverte.")}
      </div>
    )
  }
  const plafond = Math.max(histo.pointe, live || 0, 10)
  const maintenant = new Date().getHours()
  const nJours = jours.length

  return (
    <div className="detail-heures">
      <div className="dh-resume">
        <span><b>{histo.creux}</b> {t('min au plus calme')}</span>
        <span><b>{histo.pointe}</b> {t('min à la pointe')}</span>
        <span>{t('{n} relevés', { n: histo.releves })}</span>
      </div>
      {histo.heures.map((x) => (
        <div key={x.heure} className={'dh-ligne' + (x.heure === maintenant ? ' actuelle' : '')}>
          <span className="dh-heure">{String(x.heure).padStart(2, '0') + (langue() === 'fr' ? 'h' : ':00')}</span>
          <span className="dh-piste">
            <span
              className={'dh-barre ' + (x.moyenne <= 20 ? 'court' : x.moyenne <= 45 ? 'moyen' : 'long')}
              style={{ width: Math.max(2, Math.round((x.moyenne / plafond) * 100)) + '%' }}
            />
          </span>
          <span className="dh-valeur">{x.moyenne}</span>
          <span className="dh-plage">{x.mini === x.maxi ? '' : `${x.mini}–${x.maxi}`}</span>
        </div>
      ))}
      <div className="dh-note">
        {nJours <= 1
          ? t('Une seule journée collectée : ce sont des relevés bruts, pas encore des moyennes.')
          : t('Moyennes sur {n} journées collectées.', { n: nJours })}
        {' '}{t("Les heures sans barre sont celles où rien n'a été relevé.")}
      </div>
    </div>
  )
}

export default function Attentes({ plan, situation }) {
  const [jour, setJour] = useState(situation.numeroJour)
  const [ordre, setOrdre] = useState('attente')
  const [data, setData] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [histo, setHisto] = useState(null)
  const [ouverte, setOuverte] = useState(null)

  const charger = useCallback(async (n) => {
    try {
      const r = await fetch(`/api/attentes/${n}${cle()}`)
      if (!r.ok) throw new Error('HTTP ' + r.status)
      setData(await r.json())
      setErreur(null)
    } catch (e) {
      setErreur(true)
    }
  }, [])

  // L'historique ne bouge que toutes les cinq minutes : on le charge une fois
  // par jour affiché, pas à chaque rafraîchissement du direct.
  const chargerHisto = useCallback(async (n) => {
    try {
      const r = await fetch(`/api/historique/${n}${cle()}`)
      setHisto(r.ok ? await r.json() : null)
    } catch {
      setHisto(null)
    }
  }, [])

  useEffect(() => { charger(jour) }, [jour, charger])
  useEffect(() => { chargerHisto(jour); setOuverte(null) }, [jour, chargerHisto])
  useEffect(() => {
    const minuteur = setInterval(() => charger(jour), 60000)
    return () => clearInterval(minuteur)
  }, [jour, charger])

  const parc = plan.jours.find((j) => j.numero === jour)
  // Cet onglet ne parle que d'attente. Les files virtuelles — alertes et heure
  // obtenue — vivent dans Résas, et nulle part ailleurs.
  const attractions = (data?.entites || []).filter((e) => e.type === 'ATTRACTION')
  const triees = [...attractions].sort((a, b) => {
    if (ordre === 'nom') return a.nom.localeCompare(b.nom, locale())
    const va = a.ouverte && a.attente != null ? a.attente : 100000
    const vb = b.ouverte && b.attente != null ? b.attente : 100000
    return va - vb || a.nom.localeCompare(b.nom, locale())
  })

  return (
    <div className="contenu">
      <div className="rangee" style={{ marginTop: 4 }}>
        {(plan.jours || []).filter((j) => !j.masque).map((j) => (
          <button key={j.numero} className={'bouton petit ' + (jour === j.numero ? '' : 'creux')}
            onClick={() => setJour(j.numero)}>
            {t('Jour {n}', { n: j.numero })}
          </button>
        ))}
      </div>

      <div className="attentes-entete">
        <div>
          <b>{parc ? tp(parc.parc) : ''}</b>
          <div className="attentes-maj">
            {erreur ? t("Temps d'attente injoignables.")
              : data?.majLe
                ? (data.erreur
                    ? t('Relevé {quand} — dernière donnée connue', { quand: depuis(data.majLe) })
                    : t('Relevé {quand}', { quand: depuis(data.majLe) }))
                : t('Chargement…')}
          </div>
        </div>
        <div className="attentes-tri">
          {ORDRES.map((o) => (
            <button key={o.id} className={ordre === o.id ? 'actif' : ''} onClick={() => setOrdre(o.id)}>
              {t(o.libelle)}
            </button>
          ))}
        </div>
      </div>

      {data?.collecteur && !data.collecteur.actif && (
        <div className="collecteur-muet">
          <b>{t("L'historique ne s'enregistre plus.")}</b>
          <div>
            {data.collecteur.absent
              ? t("Le collecteur n'a jamais démarré.")
              : t('Aucun relevé enregistré depuis {n} min.', { n: data.collecteur.minutes })}
            {' '}{t("Les chiffres ci-dessous restent à jour — c'est l'archivage qui est arrêté.")}
          </div>
        </div>
      )}

      {triees.map((e) => {
        const histoAttraction = histo?.attractions?.[e.id] || null
        const deplie = ouverte === e.id
        return (
          <div key={e.id} className={'attente-bloc' + (deplie ? ' deplie' : '')}>
            <button
              type="button"
              className={'attente-ligne' + (e.dansLePlan ? ' du-plan' : '') + (e.ouverte ? '' : ' fermee')}
              aria-expanded={deplie}
              onClick={() => setOuverte(deplie ? null : e.id)}
            >
              <div className={'attente-chiffre' + (e.enPanne ? ' panne' : !e.ouverte ? ' off' : e.attente == null ? ' inconnu' : e.attente <= 20 ? ' court' : e.attente <= 45 ? ' moyen' : ' long')}>
                {e.enPanne ? '⚠' : !e.ouverte ? '✕' : e.attente == null ? '?' : e.attente}
                {e.ouverte && e.attente != null && <span className="unite">min</span>}
              </div>
              <div className="attente-nom">
                {e.dansLePlan && <span className="etiq-plan">{t('au plan')}</span>}
                {e.nom}
                {/* Une panne n'est pas une fermeture : ça repart souvent dans
                    l'heure. Les confondre ferait renoncer pour rien. */}
                {e.enPanne && <div className="attente-statut panne">{t('EN PANNE — ça peut repartir')}</div>}
                {!e.enPanne && !e.ouverte && (
                  <div className="attente-statut">{e.statut === 'REFURBISHMENT' ? t('en travaux') : t('fermée')}</div>
                )}
                {e.fermetureHm && e.ouverte && (
                  <div className="attente-horaire">{t('ferme à {h}', { h: h(e.fermetureHm) })}</div>
                )}
                {e.singleRider != null && <div className="attente-sr">{t('Single Rider : {n} min', { n: e.singleRider })}</div>}
                {histoAttraction && <div className="attente-moy">{t('Moyenne relevée : {n} min', { n: histoAttraction.moyenne })}</div>}
              </div>
              <span className="attente-chevron" aria-hidden="true">{deplie ? '▴' : '▾'}</span>
            </button>
            {deplie && (
              <DetailHeures histo={histoAttraction} jours={histo?.jours || []} live={e.ouverte ? e.attente : null} />
            )}
          </div>
        )
      })}

      {!triees.length && !erreur && <p className="vide">{t('Aucune attraction remontée.')}</p>}

      {data?.collecteur?.actif && (
        <div className="collecteur-ok">
          {t('Historique : {n} relevés enregistrés, dernier il y a {min} min.', { n: data.collecteur.releves, min: data.collecteur.minutes })}
        </div>
      )}

      <div className="carte" style={{ marginTop: 18 }}>
        <div className="quoi">{t('À lire avec des pincettes')}</div>
        <div className="pourquoi">{tp(data?.avertissement || plan.fileAttente.avertissement)}</div>
      </div>
    </div>
  )
}
