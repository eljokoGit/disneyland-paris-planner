import React, { useEffect, useState } from 'react'
import { t, LANGUES, langue, choisirLangue, locale } from '../i18n/index.js'

const LIBELLE_NATURE = {
  confirme: 'confirmé',
  releve: 'relevé dans l\u2019appli',
  hypothese: 'hypothèse',
  'a-confirmer': 'à confirmer',
  'non-utilise': 'non utilisé',
}

function Parametre({ p, etat, muter, notifier }) {
  const valeur = (etat.parametres || {})[p.id] || p.valeur
  const [saisie, setSaisie] = useState(valeur)
  const modifie = valeur !== p.valeur

  // Idem : plan.json rechargé à chaud ou saisie faite sur un autre téléphone.
  useEffect(() => { setSaisie(valeur) }, [valeur])

  const enregistrer = () => {
    muter(`/api/parametre/${p.id}`, { valeur: saisie }, (n) => { n.parametres[p.id] = saisie })
    notifier(`${p.libelle} → ${saisie.replace(':', 'h')}`)
  }
  const reinitialiser = () => {
    setSaisie(p.valeur)
    muter(`/api/parametre/${p.id}`, { valeur: '' }, (n) => { delete n.parametres[p.id] })
    notifier(`${p.libelle} remis à ${p.valeur.replace(':', 'h')}`)
  }

  return (
    <div className="param">
      <label>
        {p.numero}. {p.libelle}
        <span className={'nature ' + p.nature}>{LIBELLE_NATURE[p.nature]}</span>
      </label>
      <div className="commentaire">{p.commentaire}</div>
      <div className="rangee" style={{ marginTop: 0 }}>
        <input type="time" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
        <button className="bouton petit" onClick={enregistrer} disabled={saisie === valeur}>Enregistrer</button>
      </div>
      {modifie && (
        <button className="bouton petit creux" onClick={reinitialiser}>
          Modifié (plan : {p.valeur.replace(':', 'h')}) — revenir au plan
        </button>
      )}
    </div>
  )
}

// Ce que le collecteur sait déjà n'a rien à faire dans un écran de saisie : les
// heures d'ouverture, les séances et les horaires viennent de l'API, relevés
// chaque jour. Les afficher comme des champs à remplir invite à ressaisir à la
// main ce qui est déjà juste, et à se tromper.
//
// Les créneaux de file virtuelle n'y sont pas non plus : ils se saisissent dans
// l'onglet Résas, avec le bouton « obtenu » qui enregistre en même temps que
// l'heure. Deux endroits pour la même chose, c'était une invitation à l'erreur.
const AUTOMATIQUE = new Set(['ouverture', 'seance'])

export default function Reglages({ plan, etat, muter, notifier, resume, situation }) {
  const [journal, setJournal] = useState(null)

  const chargerJournal = async () => {
    try {
      const k = localStorage.getItem('disney-cle')
      const r = await fetch('/api/journal' + (k ? '?k=' + encodeURIComponent(k) : ''))
      setJournal(await r.json())
    } catch { notifier(t('Journal injoignable')) }
  }

  return (
    <div className="contenu">
      {/* Le titre porte les DEUX langues : quelqu'un qui ne lit pas celle qui est
          affichée doit quand même trouver où la changer. Réglage propre à ce
          téléphone — chacun lit la sienne. */}
      <div className="section-titre">Langue · Idioma</div>
      <div className="rangee" style={{ marginTop: 4 }}>
        {LANGUES.map((l) => (
          <button
            key={l.id}
            className={'bouton petit ' + (langue() === l.id ? '' : 'creux')}
            lang={l.id}
            aria-pressed={langue() === l.id}
            onClick={() => choisirLangue(l.id)}
          >
            {l.nom}
          </button>
        ))}
      </div>

      <div className="section-titre">{t('État à copier')}</div>
      <div className="carte">
        {langue() !== 'fr' && <div className="pourquoi" style={{ marginBottom: 8 }}>{t('Le texte pour Claude reste en français.')}</div>}
        <div className="pourquoi" style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
          {resume}
        </div>
        <button
          className="bouton petit"
          onClick={async () => {
            try { await navigator.clipboard.writeText(resume); notifier(t('Copié')) }
            catch { notifier(t('Copie refusée par le navigateur')) }
          }}
        >{t("Copier l'état")}</button>
      </div>

      <div className="section-titre">{t('Journal de la journée')}</div>
      {journal ? (
        journal.length === 0 ? <p className="vide">{t('Rien encore.')}</p> : journal.slice().reverse().map((l, i) => (
          <div key={i} className="ligne" style={{ gridTemplateColumns: '70px 1fr' }}>
            <div className="heures">{new Date(l.horodatage).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</div>
            <div>
              <div className="titre-etape" style={{ fontSize: '1rem' }}>{l.evenement}</div>
              <div className="lieu-etape">{l.titre || l.libelle || ''} {l.heureReelle ? `→ ${l.heureReelle}` : ''}{l.apres != null ? `→ ${l.apres}` : ''}</div>
            </div>
          </div>
        ))
      ) : (
        <button className="bouton petit creux" onClick={chargerJournal}>{t('Afficher le journal')}</button>
      )}
    </div>
  )
}
