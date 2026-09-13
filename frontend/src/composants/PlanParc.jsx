import React, { useState } from 'react'
import { t, tp } from '../i18n/index.js'

// Trois points au plus sur le plan :
//   jaune   où on est
//   bleu    où on va ensuite
//   violet  la cible d'une escapade solo
// Les traits entre eux donnent la distance d'un coup d'œil.
function Traces({ ici, la, escapade }) {
  if (!ici) return null
  return (
    <svg className="pp-traces" viewBox="0 0 100 100" preserveAspectRatio="none">
      {la && (
        <line
          className="pp-trait pp-trait-suivant" vectorEffect="non-scaling-stroke"
          x1={ici.x} y1={ici.y} x2={la.x} y2={la.y}
        />
      )}
      {escapade && (
        <line
          className="pp-trait pp-trait-escapade" vectorEffect="non-scaling-stroke"
          x1={ici.x} y1={ici.y} x2={escapade.x} y2={escapade.y}
        />
      )}
    </svg>
  )
}

// Une balise <img> ne peut pas porter l'en-tête x-cle : sur le serveur, où la
// clé est active, l'image du plan revenait en 401 et le cadre restait vide.
// C'est invisible en local, où la clé n'est pas configurée.
function avecCle(url) {
  if (!url) return url
  let k = ''
  try { k = localStorage.getItem('disney-cle') || '' } catch { k = '' }
  if (!k) return url
  return url + (url.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(k)
}

export default function PlanParc({ jour, zoneActuelle, zoneSuivante, zoneEscapade, planOfficiel }) {
  const zones = jour.zones || []
  const [vue, setVue] = useState(planOfficiel && planOfficiel.image ? 'officiel' : 'schema')

  const zoneIci = zones.find((z) => z.id === zoneActuelle)
  const zoneLa = zones.find((z) => z.id === zoneSuivante && z.id !== zoneActuelle)
  const zoneEsc = zones.find((z) => z.id === zoneEscapade && z.id !== zoneActuelle)

  return (
    <div className="plan-parc">
      {planOfficiel && (
        <div className="pp-onglets">
          <button className={vue === 'officiel' ? 'actif' : ''} onClick={() => setVue('officiel')}>
            {t('Plan officiel')}
          </button>
          <button className={vue === 'schema' ? 'actif' : ''} onClick={() => setVue('schema')}>
            {t('Schéma')}
          </button>
        </div>
      )}

      {vue === 'officiel' && planOfficiel ? (
        planOfficiel.image ? (
          <>
            <div className="pp-officiel">
              <img src={avecCle(planOfficiel.url)} alt={t('Plan du {parc}', { parc: tp(jour.parc) })} />
              <Traces
                ici={zoneIci && zoneIci.pin} la={zoneLa && zoneLa.pin} escapade={zoneEsc && zoneEsc.pin}
              />
              {zoneEsc && zoneEsc.pin && (
                <span className="pp-point pp-escapade" style={{ left: zoneEsc.pin.x + '%', top: zoneEsc.pin.y + '%' }} />
              )}
              {zoneLa && zoneLa.pin && (
                <span className="pp-point pp-suivant" style={{ left: zoneLa.pin.x + '%', top: zoneLa.pin.y + '%' }} />
              )}
              {zoneIci && zoneIci.pin && (
                <span className="pp-point pp-ici" style={{ left: zoneIci.pin.x + '%', top: zoneIci.pin.y + '%' }} />
              )}
            </div>
            <div className="pp-legende">
              {zoneIci && zoneIci.pin
                ? <span><i className="pp-p pp-ici" /> {tp(zoneIci.nom)}{zoneIci.pinEstime ? ' ' + t('(position estimée)') : ''}</span>
                : <span>{t('Repère non calibré sur ce plan.')}</span>}
              {zoneLa && zoneLa.pin && <span><i className="pp-p pp-suivant" /> {t('ensuite : {zone}', { zone: tp(zoneLa.nom) })}</span>}
              {zoneEsc && zoneEsc.pin && <span><i className="pp-p pp-escapade" /> {t('escapade : {zone}', { zone: tp(zoneEsc.nom) })}</span>}
            </div>
          </>
        ) : (
          <a className="bouton creux petit" href={avecCle(planOfficiel.url)} target="_blank" rel="noreferrer">
            {t('Ouvrir le plan officiel (PDF)')}
          </a>
        )
      ) : (
        <>
          <svg viewBox="0 0 100 100" role="img" aria-label={t('Schéma du {parc}', { parc: tp(jour.parc) })}>
            <rect x="0" y="0" width="100" height="100" className="pp-fond" />
            {zones.map((z) => {
              const actuelle = z.id === zoneActuelle
              const suivante = !actuelle && z.id === zoneSuivante
              const escapade = !actuelle && !suivante && z.id === zoneEscapade
              return (
                <g key={z.id}>
                  <rect
                    x={z.x} y={z.y} width={z.w} height={z.h} rx="2"
                    className={'pp-zone'
                      + (actuelle ? ' pp-actuelle' : suivante ? ' pp-suivante' : escapade ? ' pp-zone-escapade' : '')}
                  />
                  <text
                    x={z.x + z.w / 2} y={z.y + z.h / 2}
                    className={'pp-nom' + (actuelle ? ' pp-nom-actuelle' : '')}
                  >
                    {tp(z.nom).split(' ').map((mot, i, mots) => (
                      <tspan key={i} x={z.x + z.w / 2} dy={i === 0 ? -(mots.length - 1) * 1.6 : 3.4}>{mot}</tspan>
                    ))}
                  </text>
                </g>
              )
            })}
            <g className="pp-boussole"><text x="95" y="7">N</text><text x="95" y="96">S</text></g>
          </svg>
          <div className="pp-legende">
            <span><i className="pp-p pp-ici" /> {zoneIci ? t('on est ici — {zone}', { zone: tp(zoneIci.nom) }) : t('on est ici')}</span>
            {zoneLa && <span><i className="pp-p pp-suivant" /> {t('ensuite — {zone}', { zone: tp(zoneLa.nom) })}</span>}
            {zoneEsc && <span><i className="pp-p pp-escapade" /> {t('escapade — {zone}', { zone: tp(zoneEsc.nom) })}</span>}
          </div>
        </>
      )}
    </div>
  )
}
