import React, { useState } from 'react'
import { formatDuree } from '../../../shared/moteur.js'
import { t, tr, tp, h } from '../i18n/index.js'

const AMORTISSEURS = new Set(['transition', 'flaner', 'repas'])
const SUPPRIMABLES = new Set(['attraction', 'spectacle', 'rencontre', 'activite'])
// Le motif ENVOYÉ reste en français : le brief de recalcul le lit.
const MOTIFS = ['Météo', 'Fermeture ou panne', 'Complet']

function Controle({ etape }) {
  const c = etape.controle
  if (etape.decrochee) return <span className="etiq decrochee">{t('décrochée de son ancre')}</span>
  if (c.type === 'chevauchement') return <span className="etiq chevauchement">{t('chevauchement {n} min', { n: c.minutes })}</span>
  if (c.type === 'battement') return <span className="etiq battement">{t('battement {n} min', { n: c.minutes })}</span>
  if (c.type === 'pile-poil') return <span className="etiq pile-poil">{t('pile poil')}</span>
  if (c.type === 'depart') return <span className="etiq enchaine">{t('départ')}</span>
  return <span className="etiq enchaine">{t('enchaîne')}</span>
}

export default function Journee({ plan, etat, muter, notifier, situation, ordreSacrifice }) {
  const [ouvertes, setOuvertes] = useState({})
  const [annulOuverte, setAnnulOuverte] = useState(null)
  // Une journée peut être masquée (`masque: true` dans le plan) : pendant le
  // voyage, le jour 1 l'a été pour simplifier la vie sur place.
  const joursVisibles = (plan.jours || []).filter((j) => !j.masque)
  const s = situation
  const jour = s.calc.jour
  const courante = s.enCours?.id

  const basculerJour = (n) => {
    muter('/api/jour', { jour: n }, (x) => { x.jourActif = n })
  }

  const basculerFaite = (e) => {
    if (e.fait) {
      muter(`/api/etape/${e.id}/reprendre`, {}, (x) => { delete x.etapesFaites[e.id] })
    } else {
      muter(`/api/etape/${e.id}/terminee`, { heureReelle: e.finHm }, (x) => {
        x.etapesFaites[e.id] = { heureReelle: e.finHm }
      })
    }
  }

  const deplacer = (i, sens) => {
    const ordre = ordreSacrifice.map((c) => c.etape)
    const j = i + sens
    if (j < 0 || j >= ordre.length) return
    ;[ordre[i], ordre[j]] = [ordre[j], ordre[i]]
    muter('/api/sacrifice', { jour: jour.numero, ordre }, (x) => {
      x.ordreSacrifice = { ...(x.ordreSacrifice || {}), [String(jour.numero)]: ordre }
    })
    notifier(t('Ordre modifié'))
  }

  const annuler = (e, motif) => {
    muter(`/api/etape/${e.id}/annuler`, { motif }, (x) => {
      x.annulees = { ...(x.annulees || {}), [e.id]: { motif } }
    })
    notifier(t('{titre} annulé — {n} min libérées', { titre: tp(e.titre), n: e.duree }))
    setAnnulOuverte(null)
  }

  const retirer = (e) => {
    muter(`/api/etape/${e.id}/supprimer`, { motif: 'retiré depuis la journée' }, (x) => {
      if (!x.etapesSupprimees.includes(e.id)) x.etapesSupprimees.push(e.id)
    })
    notifier(t('{titre} retiré — préviens Claude pour refaire le planning', { titre: tp(e.titre) }))
  }

  const retablir = (e) => {
    muter(`/api/etape/${e.id}/retablir`, {}, (x) => {
      x.annulees = { ...(x.annulees || {}) }
      delete x.annulees[e.id]
    })
    notifier(t('{titre} remis au plan', { titre: tp(e.titre) }))
  }

  const restaurer = (e) => {
    muter(`/api/etape/${e.id}/restaurer`, {}, (x) => {
      x.etapesSupprimees = x.etapesSupprimees.filter((y) => y !== e.id)
    })
    notifier(t('{titre} remis au plan', { titre: tp(e.titre) }))
  }

  return (
    <div className="contenu">
      {joursVisibles.length > 1 && (
      <div className="rangee" style={{ marginTop: 4 }}>
        {joursVisibles.map((j) => (
          <button
            key={j.numero}
            className={'bouton petit ' + (etat.jourActif === j.numero ? '' : 'creux')}
            onClick={() => basculerJour(j.numero)}
          >
            {t('Jour {n}', { n: j.numero })}
          </button>
        ))}
      </div>
      )}

      <div className="bloc" style={{ marginTop: 12 }}>
        <div className="bloc-titre">{tp(jour.libelle)} — {tp(jour.parc)}</div>
        <div className="bloc-detail">
          {h(s.calc.etapes[0]?.debutHm)} → {h(s.calc.etapes[s.calc.etapes.length - 1]?.finHm)}
          {' · '}{t('{faites}/{total} faites', { faites: s.nbFaites, total: s.total })}
          {' · '}{t('respiration {duree}', { duree: formatDuree(jour.respiration) })}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {s.calc.etapes.map((e) => {
          const ouverte = !!ouvertes[e.id]
          const classes = ['ligne']
          if (e.fait) classes.push('faite')
          if (e.id === courante) classes.push('courante')
          if (e.ancree) classes.push('ancree')
          return (
            <div key={e.id} className={classes.join(' ')}>
              <div className="heures">
                {h(e.debutHm)}
                <span className="fin">{h(e.finHm)}</span>
                <span className="duree">
                  {e.raccourcie
                    ? t('{n} min (au lieu de {avant})', { n: e.duree, avant: e.dureeInitiale })
                    : `${e.duree} min`}
                </span>
              </div>
              <div>
                <div className="titre-etape"><span className="num">{e.numero}</span>{tp(e.titre)}</div>
                <div className="lieu-etape">
                  {tp(e.lieu)}
                  {e.direction && <span className="cardinal">{tp(e.direction)}</span>}
                </div>
                <div>
                  <Controle etape={e} />
                  {e.ancree && (e.seancesPossibles > 1
                    ? <span className="etiq seance-choisie">{t('{n} séances', { n: e.seancesPossibles })}</span>
                    : <span className="etiq ancre">{t('rendez-vous')}</span>)}
                  {AMORTISSEURS.has(e.type) && <span className="etiq amortisseur">{t('amortisseur')}</span>}
                </div>
                {e.consignes?.length > 0 && (
                  <div className="consigne">
                    <div className="consigne-titre">{t('Sur place')}</div>
                    {e.consignes.map((a, i) => <div key={i}>{tp(a.texte)}</div>)}
                  </div>
                )}
                {e.remarques?.length > 0 && (
                  <div className="remarque">
                    {e.remarques.map((a, i) => <div key={i}>{tp(a.texte)}</div>)}
                  </div>
                )}
                {ouverte && <div className="note">{tp(e.note)}</div>}
                <div className="rangee">
                  <button className="replier" onClick={() => setOuvertes((o) => ({ ...o, [e.id]: !ouverte }))}>
                    {ouverte ? t('Replier') : t('La note')}
                  </button>
                  <button className="replier" onClick={() => basculerFaite(e)}>
                    {e.fait ? t('Faite — annuler') : t('Marquer faite')}
                  </button>
                  <button className="replier" onClick={() => setAnnulOuverte(annulOuverte === e.id ? null : e.id)}>
                    {t('Annulée ?')}
                  </button>
                  {SUPPRIMABLES.has(e.type) && !e.fait && (
                    <button className="replier" onClick={() => retirer(e)}>{t('Retirer')}</button>
                  )}
                </div>
                {annulOuverte === e.id && (
                  <div className="bloc" style={{ borderColor: 'var(--orange)' }}>
                    <div className="bloc-titre">{t("Pourquoi c'est annulé ?")}</div>
                    {MOTIFS.map((m) => (
                      <button key={m} className="bouton petit creux" onClick={() => annuler(e, m)}>{t(m)}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {s.calc.etapesAnnulees.length > 0 && (
        <>
          <div className="section-titre">{t('Annulées — à replanifier')}</div>
          {s.calc.etapesAnnulees.map((e) => (
            <div key={e.id} className="carte" style={{ borderColor: 'var(--orange)' }}>
              <span className="quand" style={{ background: 'var(--orange)' }}>{t(e.motif)}</span>
              <div className="quoi">{e.numero}. {tp(e.titre)}</div>
              <div className="pourquoi">{t('{lieu} — {n} min libérées.', { lieu: tp(e.lieu), n: e.duree })}</div>
              <button className="bouton petit creux" onClick={() => retablir(e)}>{t('Finalement maintenue')}</button>
            </div>
          ))}
        </>
      )}

      {s.calc.etapesSupprimees.length > 0 && (
        <>
          <div className="section-titre">{t('Retirées volontairement')}</div>
          {s.calc.etapesSupprimees.map((e) => (
            <div key={e.id} className="ligne supprimee" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <div className="titre-etape"><span className="num">{e.numero}</span>{tp(e.titre)}</div>
                {e.retireDuPlan && (
                  <div className="lieu-etape">
                    {e.retrait && e.retrait.motif
                      ? t('Retirée au recalcul — {motif}', { motif: tp(e.retrait.motif) })
                      : t('Retirée au recalcul')}
                  </div>
                )}
                <button className="replier" onClick={() => restaurer(e)}>{t('Remettre au plan')}</button>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="section-titre">{t("Ce qu'on sacrifie, dans l'ordre")}</div>
      <p className="pourquoi" style={{ marginBottom: 10 }}>
        {tr("Toute activité peut être retirée du plan. Cette liste dit seulement lesquelles l'app proposera <b>en premier</b> en cas de retard : les autres suivent, dans l'ordre de la journée. Les flèches changent la priorité.")}
      </p>
      {ordreSacrifice.map((c, i) => (
        <div key={c.etape} className="carte">
          <div className="reordonner">
            <span className="rang">{c.rang}</span>
            <span className="quoi-sac">{tp(c.cible)}</span>
            <button className="fleche" disabled={i === 0} onClick={() => deplacer(i, -1)}>↑</button>
            <button className="fleche" disabled={i === ordreSacrifice.length - 1} onClick={() => deplacer(i, 1)}>↓</button>
          </div>
          <div className="pourquoi">{c.gain} min — {tp(c.detail)}</div>
        </div>
      ))}
      <div className="carte critique">
        <div className="quoi">{t('Jamais')}</div>
        <div className="pourquoi">{tp(jour.jamaisSacrifier)}</div>
      </div>

      <div className="section-titre">{t('Points de décision')}</div>
      {plan.pointsDecision.filter((p) => p.jour === jour.numero).map((p) => (
        <div key={p.id} className="carte">
          <span className="quand">{h(p.heure)}</span>
          <div className="quoi">{tp(p.titre)}</div>
          <div className="pourquoi"><b>{tp(p.declencheur)}</b> — {tp(p.action)}</div>
        </div>
      ))}
    </div>
  )
}
