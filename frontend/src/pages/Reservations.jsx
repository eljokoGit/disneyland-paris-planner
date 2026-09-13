import React, { useEffect, useState } from 'react'
import { t, tr, tp, h } from '../i18n/index.js'

// Les six événements réservables par file virtuelle, des DEUX parcs, sans
// filtre sur le jour actif. Le parent l'a demandé trois fois : tout, toujours.
function toutesLesFiles(plan, etat) {
  const parAttraction = {}
  for (const sc of plan.scenariosCreneau || []) {
    for (const j of plan.jours || []) {
      const e = (j.etapes || []).find((x) => x.id === sc.etape)
      for (const a of (e && e.attractions) || []) parAttraction[a.id] = sc.parametre
    }
  }
  const liste = plan.fileAttente.filesVirtuelles || {}
  const exclues = etat.filesNonSuivies || {}
  return Object.entries(liste).flatMap(([jour, files]) => files.map((f) => ({
    ...f,
    jour: Number(jour),
    parametre: parAttraction[f.id] || null,
    suivie: !exclues[f.id],
  })))
}

// ------------------------------------------------ 1. alertes par mail
function LigneAlerte({ f, muter, notifier }) {
  const basculer = () => {
    const suivie = !f.suivie
    muter(`/api/file/${f.id}`, { suivie }, (n) => {
      n.filesNonSuivies = { ...(n.filesNonSuivies || {}) }
      if (suivie) delete n.filesNonSuivies[f.id]
      else n.filesNonSuivies[f.id] = true
    })
    notifier(suivie ? t('{nom} : alertes activées', { nom: tp(f.nom) }) : t('{nom} : alertes coupées', { nom: tp(f.nom) }))
  }
  return (
    <div className={'fv-ligne-alerte' + (f.dansLePlan ? ' du-plan' : '')}>
      <div className="fva-nom">
        <span className="etiq-jour">{t('J{n}', { n: f.jour })}</span>
        {tp(f.nom)}
      </div>
      <button className={'bouton petit' + (f.suivie ? '' : ' creux')} onClick={basculer}>
        {f.suivie ? t('Alertes mail : ON') : t('Alertes mail : OFF')}
      </button>
    </div>
  )
}

// ------------------------------------------------ 2. heure obtenue
function LigneCreneau({ f, etat, muter, notifier }) {
  const creneau = f.parametre ? (etat.creneaux || {})[f.parametre] : null
  const libre = (etat.creneauxLibres || {})[f.id] || null
  const obtenue = creneau && creneau.obtenu ? creneau.heure : libre
  const [saisie, setSaisie] = useState(obtenue || '')
  useEffect(() => { setSaisie(obtenue || '') }, [obtenue])

  const enregistrer = () => {
    if (!saisie) return
    if (f.parametre) {
      // Rattachée au plan : la journée se recale sur cette heure.
      muter(`/api/creneau/${f.parametre}`, { obtenu: true, heure: saisie }, (n) => {
        n.creneaux = { ...(n.creneaux || {}), [f.parametre]: { obtenu: true, heure: saisie } }
        n.parametres = { ...(n.parametres || {}), [f.parametre]: saisie }
      })
      notifier(t('{nom} à {h} — la journée se recale', { nom: tp(f.nom), h: h(saisie) }))
    } else {
      // Hors plan : on note l'heure, rien d'autre ne bouge.
      muter(`/api/creneau-libre/${f.id}`, { heure: saisie }, (n) => {
        n.creneauxLibres = { ...(n.creneauxLibres || {}), [f.id]: saisie }
      })
      notifier(t('{nom} à {h} — noté', { nom: tp(f.nom), h: h(saisie) }))
    }
  }

  const effacer = () => {
    if (f.parametre) {
      muter(`/api/creneau/${f.parametre}`, { obtenu: false }, (n) => {
        n.creneaux = { ...(n.creneaux || {}), [f.parametre]: { obtenu: false } }
      })
    } else {
      muter(`/api/creneau-libre/${f.id}`, { heure: '' }, (n) => {
        n.creneauxLibres = { ...(n.creneauxLibres || {}) }
        delete n.creneauxLibres[f.id]
      })
    }
    setSaisie('')
    notifier(t('Créneau effacé'))
  }

  return (
    <div className={'fv-ligne-creneau' + (f.dansLePlan ? ' du-plan' : '')}>
      <div className="fva-nom">
        <span className="etiq-jour">{t('J{n}', { n: f.jour })}</span>
        {tp(f.nom)}
      </div>
      {obtenue ? (
        <div className="fvc-obtenu">
          {f.parametre
            ? tr('Créneau obtenu : <b>{h}</b> — la journée est calée dessus', { h: h(obtenue) })
            : tr('Créneau obtenu : <b>{h}</b>', { h: h(obtenue) })}
          <button className="replier" onClick={effacer}>{t('Effacer')}</button>
        </div>
      ) : (
        <>
          <label className="fvc-etiquette">{t('Heure du créneau obtenu')}</label>
          <div className="rangee" style={{ marginTop: 4 }}>
            <input type="time" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
            <button className="bouton petit" onClick={enregistrer} disabled={!saisie}>
              {t('Enregistrer')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function Reservations({ plan, etat, muter, notifier }) {
  // Une journée MASQUÉE disparaît d'ici aussi. Filtrer seulement les onglets ne
  // suffisait pas : « Les deux jours » étant l'onglet par défaut, les files
  // virtuelles du jour masqué revenaient quand même dans les deux listes.
  const visibles = new Set((plan.jours || []).filter((j) => !j.masque).map((j) => j.numero))
  const toutes = toutesLesFiles(plan, etat).filter((f) => visibles.has(f.jour))
  const jours = (plan.jours || []).filter((j) => !j.masque)

  // Filtre d'AFFICHAGE seulement, gardé en local. Le sélecteur de l'onglet
  // Journée, lui, change `jourActif` sur le serveur : s'en servir ici
  // basculerait aussi l'onglet Maintenant, et le plan suivi ne serait plus
  // celui de la journée en cours.
  const [filtre, setFiltre] = useState('tout')
  const files = filtre === 'tout' ? toutes : toutes.filter((f) => f.jour === filtre)

  const onglets = jours.length > 1
    ? [
        ['tout', t('Les deux jours'), toutes.length],
        ...jours.map((j) => [j.numero, t('Jour {n}', { n: j.numero }), toutes.filter((f) => f.jour === j.numero).length]),
      ]
    : []

  return (
    <div className="contenu">
      {onglets.length > 0 && (
      <div className="rangee" style={{ marginTop: 4 }}>
        {onglets.map(([valeur, libelle, combien]) => (
          <button
            key={String(valeur)}
            className={'bouton petit ' + (filtre === valeur ? '' : 'creux')}
            onClick={() => setFiltre(valeur)}
          >
            {libelle} ({combien})
          </button>
        ))}
      </div>
      )}

      <div className="section-titre">{t('Alertes par mail')}</div>
      <p className="pourquoi" style={{ marginBottom: 8 }}>
        {t('Un mail à chaque relevé tant que la file est ouverte. Coupez celles qui ne vous intéressent pas.')}
      </p>
      {files.map((f) => (
        <LigneAlerte key={'a-' + f.id} f={f} muter={muter} notifier={notifier} />
      ))}

      <div className="section-titre">{t('Heure obtenue')}</div>
      <p className="pourquoi" style={{ marginBottom: 8 }}>
        {t("Quand vous décrochez un créneau, saisissez l'heure ici. Pour les rencontres du plan, la journée se recale dessus.")}
      </p>
      {files.map((f) => (
        <LigneCreneau key={'c-' + f.id} f={f} etat={etat} muter={muter} notifier={notifier} />
      ))}

      <div className="section-titre">{t('Règles des files virtuelles')}</div>
      <div className="carte">
        {plan.reservations.reglesFilesVirtuelles.map((r, i) => (
          <div key={i} className="pourquoi" style={{ marginTop: i ? 8 : 0 }}>• {tp(r)}</div>
        ))}
      </div>
    </div>
  )
}
