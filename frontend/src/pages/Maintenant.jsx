import React, { useEffect, useState } from 'react'
import { briefRecalcul } from '../../../shared/brief.js'
import { minutesVersHm } from '../../../shared/moteur.js'
import PlanParc from '../composants/PlanParc.jsx'
import { t, tr, tp, h, langue } from '../i18n/index.js'

// « SPECTACLE : Célébration à Arendelle » ne tient pas dans un bandeau. On garde
// ce qui identifie l'étape, pas la catégorie — en français comme en espagnol,
// d'où les majuscules Unicode et pas seulement [A-ZÉÈ].
const sansCategorie = (titre) => String(titre || '').replace(/^[\p{Lu}' ]+\s*:\s*/u, '')
const court = (titre) => sansCategorie(tp(titre)).split(' — ')[0].trim()
// Deux familles de motifs, et la distinction n'est pas cosmétique : ce qui est
// fermé est perdu, ce qu'on saute reste à replacer. Le brief de recalcul les
// traite différemment. Le motif ENVOYÉ reste en français : le brief le lit.
const MOTIFS_IMPOSES = ['Météo', 'Fermeture ou panne', 'Complet']
const MOTIF_CHOISI = 'Pas le temps'

// Le bandeau répond à une seule question, d'un coup d'œil : est-ce qu'on est
// dans les temps ? Trois états, trois couleurs.
function bandeau(s) {
  if (!s.dansLaJournee) return { classe: 'neutre', texte: t('Hors journée') }

  // L'état d'avancement d'un côté, l'heure de la séance de l'autre :
  // « Dans les temps » parle de la file, « spectacle dans 18 min » du spectacle.
  const base =
    s.alerte ? { classe: 'alerte', texte: t('En retard de {n} min', { n: s.retard }) }
    : s.retard > 0 ? { classe: 'en-retard', texte: t('En retard de {n} min — ça passe', { n: s.retard }) }
    : s.avance > 0 ? { classe: 'en-avance', texte: t('En avance') }
    : { classe: 'a-lheure', texte: t('Dans les temps') }

  const sc = s.seanceEnCours
  if (sc) {
    const rencontre = sc.mot === 'rencontre'
    base.detail = sc.commencee
      ? (rencontre
          ? t('Rencontre commencée — sortie vers {h}', { h: h(sc.sortieHm) })
          : t('Spectacle commencé — sortie vers {h}', { h: h(sc.sortieHm) }))
      : sc.dans === 0
        ? (rencontre ? t('Rencontre maintenant') : t('Spectacle maintenant'))
        : (rencontre ? t('Rencontre dans {n} min', { n: sc.dans }) : t('Spectacle dans {n} min', { n: sc.dans }))
    return base
  }

  if (s.avance > 0) { base.detail = t('démarre dans {n} min', { n: s.avance }); return base }
  // « restent 37 min » affiché sous un créneau « Prévu 15h46 – 15h56 » : deux
  // nombres qui se contredisent à l'écran, et le parent a lu le mauvais. Le chiffre
  // court jusqu'au prochain rendez-vous quand il y en a un : on le nomme,
  // toujours. « restent » ne vaut que quand la limite est la fin de l'étape.
  if (s.resteEnCours != null) {
    base.detail = s.prochaineAncre
      ? t('{n} min avant {rdv}', { n: s.resteEnCours, rdv: court(s.prochaineAncre.titre) })
      : t('restent {n} min', { n: s.resteEnCours })
  }
  return base
}

// Quelle ligne du tableau de décision s'applique à l'attente affichée. Les bornes
// vivent dans plan.json (`max`), pas dans le code : elles se rebudgètent la veille.
function ligneRetenue(table, attente) {
  if (!table || attente == null) return -1
  for (let i = 0; i < table.length; i++) {
    if (table[i].max == null || attente < table[i].max) return i
  }
  return table.length - 1
}

export default function Maintenant({ plan, etat, muter, notifier, maintenant, situation, plansOfficiels, attentes }) {
  const [noteOuverte, setNoteOuverte] = useState(false)
  const [annulOuverte, setAnnulOuverte] = useState(false)
  const [planOuvert, setPlanOuvert] = useState(false)
  const [photoOuverte, setPhotoOuverte] = useState(false)
  const [briefOuvert, setBriefOuvert] = useState(null)
  // Ce que le parent veut me dire en plus de ce que l'app mesure. Il le tape dans
  // le panneau, le brief se refabrique à chaque frappe : il voit son mot
  // arriver à la fin du texte avant de copier.
  const [commentaire, setCommentaire] = useState('')
  const [detailsEsc, setDetailsEsc] = useState(false)
  const [detailHyp, setDetailHyp] = useState(false)
  // Id de l'étape dont on attend l'enregistrement avant de sortir le brief.
  const [briefApres, setBriefApres] = useState(null)
  const s = situation
  const e = s.enCours
  const jour = s.calc.jour
  const escapades = jour.escapades || { cible: {}, rappels: [] }

  // Sur une TRANSITION, l'étape est rattachée à sa zone d'ARRIVÉE. Le trajet utile
  // part donc de la zone de l'étape précédente : « on marche de A vers B ».
  // Sur les autres étapes, on est en A et on ira en B.
  // Attente de la cible d'escapade : elle décide d'y aller ou pas. Le jour 2 a
  // trois cibles différentes selon le créneau ; le jour 1 n'en a qu'une seule.
  const cibleEscapade = (esc) => {
    if (esc && escapades.cibles) {
      const trouvee = escapades.cibles.find((c) => c.attractionId === esc.cible)
      if (trouvee) return trouvee
    }
    return escapades.cible || {}
  }
  const cible = cibleEscapade(e && e.escapade)
  const cibleId = cible.attractionId
  const liveCible = cibleId && attentes ? attentes[cibleId] : null
  const attenteCible = liveCible ? liveCible.attente : null
  const srCible = liveCible ? liveCible.singleRider : null

  // Cibles suivantes, dans l'ordre de priorité : ce qu'on fait s'il reste du
  // temps APRÈS la première. Chacune avec son attente du moment, parce que
  // l'ordre écrit d'avance ne survit pas toujours à la réalité des files.
  const suivantes = (escapades.ciblesSuivantes || []).map((c) => ({
    ...c, live: attentes ? attentes[c.attractionId] : null,
  }))

  const precedenteEtape = e ? s.calc.etapes[e.index - 1] : null
  const enMarche = e && e.type === 'transition' && precedenteEtape
  const zoneDepart = enMarche ? precedenteEtape.zone : e && e.zone
  const zoneArrivee = enMarche ? e.zone : s.suivante ? s.suivante.zone : null
  const b = bandeau(s)

  // La dernière étape marquée faite, pour pouvoir revenir dessus.
  const precedente = e ? s.calc.etapes[e.index - 1] : s.calc.etapes[s.calc.etapes.length - 1]
  const peutRevenir = precedente && precedente.fait

  const terminer = () => {
    muter(`/api/etape/${e.id}/terminee`, {}, (n) => {
      n.etapesFaites[e.id] = { marqueeA: minutesVersHm(maintenant) }
    })
  }

  const revenir = () => {
    muter(`/api/etape/${precedente.id}/reprendre`, {}, (n) => {
      delete n.etapesFaites[precedente.id]
    })
    notifier(t('Retour sur {titre}', { titre: tp(precedente.titre) }))
  }

  const annuler = (motif, choisi = false) => {
    muter(`/api/etape/${e.id}/annuler`, { motif, choisi }, (n) => {
      n.annulees = { ...(n.annulees || {}), [e.id]: { motif, choisi } }
    })
    notifier(choisi
      ? t('{titre} mis de côté — {n} min libérées', { titre: tp(e.titre), n: e.duree })
      : t('{titre} annulé — {n} min libérées', { titre: tp(e.titre), n: e.duree }))
    setAnnulOuverte(false)
    // Sauter une étape change la fin de journée : on enchaîne aussitôt sur le
    // brief, pendant qu'on a la décision en tête. Le recalcul se demande à
    // chaud, pas trois étapes plus loin.
    if (choisi) setBriefApres(e.id)
  }

  // Le presse-papier n'existe que sur une origine sécurisée. Sur le téléphone,
  // en HTTP sur le réseau local, il échoue silencieusement : on retombe alors
  // sur un panneau sélectionnable plutôt que de laisser croire que c'est copié.
  const copierBrief = async () => {
    let texte
    try {
      texte = briefRecalcul(plan, etat || {}, maintenant, attentes || {}, commentaire)
    } catch (err) {
      // Un brief qui plante en silence est pire qu'un brief absent : on le dit.
      notifier(t('Brief impossible : {erreur}', { erreur: err.message }))
      return
    }
    // Le panneau s'ouvre TOUJOURS. Une copie silencieuse qui échoue — page sans
    // focus, origine non sécurisée, navigateur récalcitrant — donne un bouton
    // qui « ne fait rien », et on ne sait pas si c'est passé. Là, on voit le
    // texte, et une ligne dit si le presse-papier a accepté.
    let copie = false
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texte)
        copie = true
      }
    } catch { /* on montrera le texte */ }
    setBriefOuvert({ texte, copie })
  }

  // Un setTimeout aurait appelé copierBrief avec l'état capturé AVANT la
  // mutation : le brief aurait décrit une journée où rien n'a été sauté.
  // On attend donc que l'état porte réellement la décision.
  useEffect(() => {
    if (!briefApres) return
    if (!(etat && etat.annulees && etat.annulees[briefApres])) return
    setBriefApres(null)
    copierBrief()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefApres, etat])

  const marquerEscapade = (esc) => {
    muter(`/api/escapade/${esc.id}`, { utilisee: !esc.utilisee }, (n) => {
      n.escapades = { ...(n.escapades || {}) }
      if (esc.utilisee) delete n.escapades[esc.id]
      else n.escapades[esc.id] = true
    })
    notifier(esc.utilisee ? t('Créneau remis à disposition') : t('Escapade notée'))
  }

  // Le seul vrai levier : supprimer une activité. Réduire un temps libre n'est
  // pas une action, c'est une conséquence — elle s'affiche, elle ne se clique pas.
  const supprimer = (c) => {
    muter(`/api/etape/${c.etape}/supprimer`, { motif: 'retard' }, (n) => {
      if (!n.etapesSupprimees.includes(c.etape)) n.etapesSupprimees.push(c.etape)
    })
    notifier(t('{titre} retiré — préviens Claude pour refaire le planning', { titre: tp(c.cible) }))
  }

  if (!e) {
    return (
      <div className="contenu">
        <p className="vide">{t('Toutes les étapes du jour {n} sont faites. Bravo.', { n: jour.numero })}</p>
        {peutRevenir && (
          <button className="bouton creux petit" onClick={revenir}>
            {t('← Revenir en arrière')}
          </button>
        )}
      </div>
    )
  }

  const butoir = e.escapade ? sansCategorie(tp(e.escapade.obligatoireTitre || '')) : ''
  const principale = e.files && e.files.principale

  return (
    <>
      <div className="entete">
        <span className="jour">{t('Jour {n}', { n: jour.numero })}</span>
        <span className="horloge">{h(minutesVersHm(maintenant))}</span>
      </div>

      <div className={'bandeau ' + b.classe}>
        {b.texte}
        {b.detail && <small>{b.detail}</small>}
      </div>

      {briefOuvert && (
        <div className="brief-panneau" onClick={() => setBriefOuvert(null)}>
          <div className="brief-boite" onClick={(ev) => ev.stopPropagation()}>
            <div className={'brief-titre' + (briefOuvert.copie ? ' ok' : '')}>
              {briefOuvert.copie
                ? t('Copié dans le presse-papier — collez-le à Claude.')
                : t('Le presse-papier a refusé. Touchez le texte, tout se sélectionne, puis copiez.')}
            </div>
            {/* Le texte pour Claude reste en français : c'est la langue dans
                laquelle la procédure de recalcul le lit. On le dit plutôt que
                de laisser croire à un oubli de traduction. */}
            {langue() !== 'fr' && (
              <div className="brief-etiquette">{t('Le texte pour Claude reste en français.')}</div>
            )}
            <textarea className="brief-texte" readOnly
              value={briefRecalcul(plan, etat || {}, maintenant, attentes || {}, commentaire)}
              onFocus={(ev) => ev.target.select()}
              onClick={(ev) => ev.target.select()} />
            <label className="brief-etiquette" htmlFor="mot-du-parent">
              {t('Un mot pour Claude ? Il passera avant tout le reste.')}
            </label>
            <textarea
              id="mot-du-parent"
              className="brief-mot"
              rows={3}
              value={commentaire}
              onChange={(ev) => setCommentaire(ev.target.value)}
              placeholder={t('Ma fille fatigue, on peut sauter le dîner. / Il pleut. / La file annonce 40 mais avance vite.')}
            />
            <div className="brief-boutons">
              <button className="bouton petit" onClick={() => {
                const z = document.querySelector('.brief-texte')
                z.focus(); z.select()
                let ok = false
                try { ok = document.execCommand('copy') } catch { ok = false }
                notifier(ok
                  ? (commentaire.trim() ? t('Copié, avec votre commentaire') : t('Copié'))
                  : t('Copiez à la main : le texte est sélectionné'))
              }}>{t('Sélectionner et copier')}</button>
              <button className="bouton petit creux" onClick={() => setBriefOuvert(null)}>{t('Fermer')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Une séance ancrée ne figure pas dans les horaires du jour : l'ancre
          repose sur une heure qui n'existe pas. C'était la vérification
          matinale « saisir les séances » ; l'app la fait maintenant seule et
          ne parle que si ça diverge. */}
      {(s.seancesDivergentes || []).map((d) => (
        <div key={d.id} className="seance-bougee">
          <div className="sb-titre">{t('Séance introuvable')}</div>
          <div className="sb-quoi">
            {tr("{titre} est ancré sur <b>{h}</b>, qui n'est pas dans les horaires du jour.", { titre: tp(d.titre), h: h(d.prevue) })}
          </div>
          <div className="sb-reelles">
            {t('Séances relevées : {liste}', { liste: d.reelles.map((x) => h(x)).join(' · ') })}
          </div>
          {/* Une séance introuvable ne se corrige pas en tapant une heure : il
              faut replacer l'étape, ce qui déplace tout ce qui suit. C'est un
              recalcul, pas une saisie. */}
          <div className="sb-quoi-faire">
            {t('Cette étape est à replacer, et ça déplace la suite. Copiez la situation et envoyez-la-moi.')}
          </div>
          <button className="bouton petit" onClick={copierBrief}>
            {t('Copier la situation pour Claude')}
          </button>
        </div>
      ))}

      {/* Le plan ne tient plus : un créneau fixe est tombé loin de l'hypothèse,
          et des étapes ancrées se retrouvent avant des étapes qui finissent
          après elles. L'app ne sait pas résoudre ça — elle le dit et passe la
          main. C'est précisément ce que le brief sert à faire. */}
      {(s.chevauchements || []).length > 0 && (
        <div className="plan-casse">
          <div className="pc-titre">{t('Le plan ne tient plus')}</div>
          {s.chevauchements.map((c) => (
            <div key={c.id} className="pc-quoi">
              {tr('{titre} est prévu à {h}, soit <b>{n} min</b> avant la fin de ce qui le précède.', { titre: tp(c.titre), h: h(c.heureHm), n: c.minutes })}
            </div>
          ))}
          <div className="pc-quoi-faire">
            {t("Il faut refaire l'ordre de la journée. Copiez la situation et envoyez-la-moi.")}
          </div>
          <button className="bouton petit" onClick={copierBrief}>
            {t('Copier la situation pour Claude')}
          </button>
        </div>
      )}

      <div className="contenu">
        <div className="en-cours">
          <div className="etiquette">{t('Étape {n} sur {total}', { n: e.numero, total: s.total })}</div>
          <div className="titre">{tp(e.titre)}</div>
          <div className="lieu">
            {tp(e.lieu)}
            {e.direction && <span className="cardinal">{tp(e.direction)}</span>}
          </div>
          {s.seanceEnCours ? (
            <>
              <div className="horaire">
                {s.seanceEnCours.genre === 'creneau'
                  ? t('Créneau {h} — sortie {sortie}', { h: h(s.seanceEnCours.heureHm), sortie: h(s.seanceEnCours.sortieHm) })
                  : t('Séance {h} — sortie {sortie}', { h: h(s.seanceEnCours.heureHm), sortie: h(s.seanceEnCours.sortieHm) })}
              </div>
              <div className="sous-ligne">{t('Sur place depuis {h}', { h: h(e.debutHm) })}</div>
            </>
          ) : (
            <div className="horaire">{t('Prévu {debut} – {fin}', { debut: h(e.debutHm), fin: h(e.finHm) })}</div>
          )}
        </div>

        <div className="liens-etape">
          <button className="replier" onClick={() => setNoteOuverte(!noteOuverte)}>
            {noteOuverte ? t('Masquer') : t('La note')}
          </button>
          <button className="replier" onClick={() => setPlanOuvert(!planOuvert)}>
            {planOuvert ? t('Masquer') : t('Où est-ce ?')}
          </button>
          {e.photos?.length > 0 && (
            <button className="replier" onClick={() => setPhotoOuverte(!photoOuverte)}>
              {photoOuverte ? t('Masquer') : t('Photo')}
            </button>
          )}
        </div>

        {photoOuverte && e.photos?.length > 0 && (
          <div className="spots-photo">
            <div className="sp-titre">{t('Spots photo dans le coin')}</div>
            {e.photos.map((f, i) => (
              <div key={i} className="sp-ligne">
                <b>{tp(f.nom)}</b>
                <div>{tp(f.ou)}</div>
              </div>
            ))}
            {plan.sourcePhotos && <div className="sp-source">{t('Repérages : {source}', { source: tp(plan.sourcePhotos.titre) })}</div>}
          </div>
        )}
        {noteOuverte && <div className="note-etape">{tp(e.note)}</div>}
        {planOuvert && (
          <PlanParc
            jour={jour}
            zoneActuelle={zoneDepart}
            zoneSuivante={zoneArrivee}
            zoneEscapade={e.escapade ? cible.zone : null}
            planOfficiel={(plansOfficiels || {})[jour.numero] || null}
          />
        )}

        {e.files && (
          <div className={'files' + (e.files.enDanger ? ' danger' : '') + (e.files.fermee ? ' fermee' : '')}>
            <div className="files-titre">
              {e.files.fermee ? t("Temps d'attente affichés — fermé") : t("Temps d'attente affichés")}
            </div>
            {e.files.items.map((f) => (
              <div key={f.id} className="files-ligne">
                <span className={'files-chiffre'
                  + (f.inconnue ? ' inconnu' : !f.ouverte ? ' off'
                  : f.attente == null ? ' inconnu' : f.attente <= 20 ? ' court' : f.attente <= 45 ? ' moyen' : ' long')}>
                  {f.inconnue ? '?' : f.enPanne ? '⚠' : !f.ouverte ? '✕' : f.attente == null ? '?' : f.attente + ' min'}
                </span>
                <span className="files-nom">
                  {f.nom}
                  {/* Une panne n'est pas une fermeture : ça rouvre souvent dans
                      l'heure. Les confondre ferait renoncer pour rien. */}
                  {f.enPanne && <span className="files-note panne">{t('EN PANNE — arrêt momentané, ça peut repartir')}</span>}
                  {!f.enPanne && f.ouverte === false && (
                    <span className="files-note danger">
                      {f.statut === 'REFURBISHMENT' ? t('en travaux') : t('fermée')}
                    </span>
                  )}
                  {f.fermetureHm && f.ouverte && (
                    <span className="files-note">{t('ferme à {h}', { h: h(f.fermetureHm) })}</span>
                  )}
                  {f.inconnue && <span className="files-note">{t("pas de correspondance avec l'API")}</span>}
                  {f.depasse && <span className="files-note danger">{t("{n} min de plus que ce que l'étape prévoit", { n: f.depassementMin })}</span>}
                  {f.singleRider != null && <span className="files-note">{t('Single Rider : {n} min', { n: f.singleRider })}</span>}
                  {f.premierAcces?.disponible && (
                    <span className="files-note payant">
                      {t('Premier Access {prix} par personne — vous ne montez pas maintenant, vous revenez entre {debut} et {fin}',
                        { prix: f.premierAcces.prixTexte, debut: h(f.premierAcces.retourDebut), fin: h(f.premierAcces.retourFin) })}
                    </span>
                  )}
                  {f.fileVirtuelle && (
                    <span className={'files-note' + (f.fileVirtuelle.disponible ? ' dispo' : ' danger')}>
                      {f.fileVirtuelle.disponible
                        ? (f.fileVirtuelle.retourDebut
                            ? t('File virtuelle ouverte — passage entre {debut} et {fin}', { debut: h(f.fileVirtuelle.retourDebut), fin: h(f.fileVirtuelle.retourFin) })
                            : t('File virtuelle ouverte'))
                        : t('File virtuelle : complète pour le moment')}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {/* Le prix se donne PAR PERSONNE, et c'est tout. Ce conseil le
                multipliait par trois « pour elle + 2 adultes » : c'est décider
                à la place du parent qui monte, ce qu'il a interdit deux fois. */}
            {principale && principale.attente >= 90 && e.id === 'j1-e2' && (
              <div className="files-conseil">
                {principale.premierAcces?.prixTexte
                  ? t("Au-delà de 90 min, le Premier Access se discute — {prix} par personne à cet instant. Les grands-parents n'ont pas besoin de monter.", { prix: principale.premierAcces.prixTexte })
                  : t("Au-delà de 90 min, le Premier Access se discute. Les grands-parents n'ont pas besoin de monter.")}
              </div>
            )}
          </div>
        )}

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

        {/* On ne dérange le parent que s'il y a réellement du temps à récupérer
            avant la prochaine ancre. */}
        {s.aSignaler && s.analyse && (
          <div className={'alerte-bloc' + (s.graviteReelle === 'alerte' ? '' : ' calme')}>
            {s.contrainte.type === 'ancre' && s.contrainte.avance > 0 ? (
              <>
                <div className="alerte-corps">
                  {tr('{titre} — séance à <b>{h}</b>.', { titre: tp(s.contrainte.titre), h: h(s.contrainte.heureEvenement) })}
                  <div className="sous-ligne">
                    {t("Il faut y être à {h} ({n} min d'avance).", { h: h(minutesVersHm(s.contrainte.heure)), n: s.contrainte.avance })}
                  </div>
                </div>
                <div className="alerte-corps">
                  {s.avanceRestante >= 0
                    ? tr("Vous y seriez avec <b>{n} min d'avance</b> au lieu de {prevu}.", { n: s.avanceRestante, prevu: s.contrainte.avance })
                    : tr('Vous arriveriez <b>{n} min après le début</b>.', { n: -s.avanceRestante })}
                </div>
                {/* Ce chiffre n'est pas une mesure : il suppose que chaque étape
                    d'ici là tient sa durée prévue. On le dit, sinon le parent lui
                    accorde une confiance qu'il n'a pas. */}
                {/* Le détail ne s'affiche QUE s'il change quelque chose. Un
                    tableau de sept lignes pour conclure « 20 min d'avance au
                    lieu de 20 », c'est du bruit — et le parent lit ça debout, une
                    main occupée. Replié par défaut, ouvert d'un mot. */}
                {(s.hypothese || []).length > 0 && s.risqueEnPlus > 0 && (
                  <div className="hypothese">
                    <button className="replier" onClick={() => setDetailHyp((v) => !v)}>
                      {detailHyp ? t('Masquer le détail') : t('Voir le détail ({n} étapes)', { n: s.hypothese.length })}
                    </button>
                    {detailHyp && s.hypothese.map((x) => (
                      <div key={x.id} className={'hyp-ligne' + (x.depassementMin > 0 ? ' derape' : '')}>
                        <div className="hyp-haut">
                          <span className="hyp-quoi">{tp(x.titre)}</span>
                          <span className="hyp-duree">{x.duree} min</span>
                        </div>
                        {x.budget != null && (
                          <div className="hyp-reel">
                            {tr('attente : <b>{n}</b> prévues', { n: x.budget })}
                            {x.attente == null
                              ? ' · ' + t('rien d’affiché sur place')
                              : <> · {tr('<b>{n}</b> affichées', { n: x.attente })}{' '}
                                  <span className="hyp-ecart">
                                    {x.attente > x.budget ? `+${x.attente - x.budget}` : x.attente < x.budget ? `${x.attente - x.budget}` : '='}
                                  </span>
                                </>}
                          </div>
                        )}
                      </div>
                    ))}
                    {s.risqueEnPlus > 0 && (
                      <div className={'hyp-bilan' + (s.avanceRestanteReelle < 0 ? ' rouge' : '')}>
                        {s.avanceRestanteReelle >= 0
                          ? tr("Le réel ajoute <b>{n} min</b> : il resterait <b>{reste} min d'avance</b>, pas {prevu}.", { n: s.risqueEnPlus, reste: s.avanceRestanteReelle, prevu: s.avanceRestante })
                          : tr("Le réel ajoute <b>{n} min</b> : l'avance ne suffit plus, vous arriveriez <b>{retard} min trop tard</b>.", { n: s.risqueEnPlus, retard: -s.avanceRestanteReelle })}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="alerte-corps">
                {tr('<b>{n} min de trop</b> avant {titre} ({h}).', { n: s.aRecuperer, titre: tp(s.contrainte.titre), h: h(minutesVersHm(s.contrainte.heure)) })}
              </div>
            )}

            {/* Conséquence sur le temps libre : information, jamais un bouton. */}
            {s.analyse.tempsLibre.filter((x) => x.perdu > 0).map((x) => (
              <div key={x.etape} className="consequence">
                {tr('{titre} : <b>{n} min</b> au lieu de {duree} · départ {h}', { titre: sansCategorie(tp(x.titre)), n: x.nouvelleDuree, duree: x.duree, h: h(x.partirA) })}
              </div>
            ))}

            {s.souplesse && (
              <div className="souplesse">
                {tp(s.souplesse.message)}
                {s.souplesse.detail && <div className="souplesse-detail">{tp(s.souplesse.detail)}</div>}
              </div>
            )}

            {/* Un spectacle ancré porte DÉJÀ son avance : arriver 4 min plus tard,
                c'est 21 min d'avance au lieu de 25, pas un retard. Proposer d'y
                sacrifier Ratatouille (55 min) est absurde — et pire, ça décrédibilise
                le bouton le jour où il faudra vraiment appuyer dessus. Les boutons
                n'apparaissent que si l'avance est entièrement mangée. */}
            {s.graviteReelle === 'serre' ? (
              <>
                <div className="alerte-corps">
                  {tr("<b>Il ne resterait que {n} min d'avance</b>, et il en faut {minimum} pour entrer sereinement. Ça se décide maintenant.", { n: s.avanceRestanteReelle, minimum: s.contrainte.avanceMinimale })}
                </div>
                <button className="bouton petit" onClick={copierBrief}>
                  {t('Copier la situation pour Claude')}
                </button>
              </>
            ) : s.graviteReelle === 'info' || s.graviteReelle == null ? (
              <div className="alerte-corps calme-mot">
                {s.risqueEnPlus > 0
                  ? t("Rien à faire pour l'instant : l'avance encaisse encore l'écart.")
                  : t("Rien à faire : l'avance prévue absorbe le décalage.")}
              </div>
            ) : s.analyse.absorbeParLeTempsLibre ? (
              <div className="alerte-corps">{t('Le temps libre absorbe tout.')}</div>
            ) : (
              <>
                {/* Ne répéter le chiffre que s'il a changé après absorption. */}
                {s.analyse.manqueApresTempsLibre !== s.aRecuperer && (
                  <div className="alerte-corps">
                    {tr('Il manque encore <b>{n} min</b>.', { n: s.analyse.manqueApresTempsLibre })}
                  </div>
                )}
                <button className="bouton petit" onClick={copierBrief}>
                  {t('Copier la situation pour Claude')}
                </button>
                {s.bascadeParLeReel && (
                  <div className="alerte-corps">
                    {tr('Ce sont les <b>attentes affichées</b> qui font basculer, pas le plan.')}
                  </div>
                )}
                {s.analyse.supprimables.map((c) => (
                  <button key={c.etape} className="bouton petit rouge" onClick={() => supprimer(c)}>
                    {c.suffit
                      ? t('Supprimer {titre} — {n} min · suffit', { titre: tp(c.cible), n: c.duree })
                      : t('Supprimer {titre} — {n} min', { titre: tp(c.cible), n: c.duree })}
                  </button>
                ))}
                {s.analyse.supprimables.length === 0 && (
                  <div className="alerte-corps">
                    {s.souplesse && s.souplesse.genre === 'decalable'
                      ? t("Rien à supprimer d'ici là : prendre la séance suivante.")
                      : s.souplesse && s.souplesse.genre === 'creneau'
                        ? t("Rien à supprimer d'ici là : viser un autre créneau.")
                        : t("Rien à supprimer d'ici là : il faudra écourter sur place.")}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Une escapade couvre PLUSIEURS étapes : sans ce garde, la carte entière
            réapparaissait à l'étape suivante alors que le parent était déjà parti.
            Une fois le créneau utilisé, une seule ligne discrète suffit. */}
        {/* Sur TOUTES les étapes que l'escapade couvre : tant qu'elle dure,
            le parent est dehors et doit garder ses deux heures sous les yeux. */}
        {e.escapade && e.escapade.utilisee && (
          <div className="escapade-faite">
            <div>
              {tr('<b>Escapade en cours</b> — retour prévu {h}', { h: h(e.escapade.retour) })}
              {' · '}
              {e.escapade.margeApresRetour > 0
                ? tr("possible jusqu'à <b>{h}</b>", { h: h(e.escapade.limite) })
                : tr('<b>aucune marge</b>')}
              {e.escapade.margeApresRetour > 0 && suivantes
                .filter((c) => c.live && c.live.ouverte !== false && !c.live.enPanne)
                .map((c) => (
                  <div key={c.attractionId} className="ec-bonus">
                    {c.priorite}. {tp(c.nom)} — {c.live.singleRider != null
                      ? t('{marche} min de marche, {n} min en Single Rider', { marche: c.marcheDepuisCible, n: c.live.singleRider })
                      : t("{marche} min de marche, {n} min d'attente", { marche: c.marcheDepuisCible, n: c.live.attente ?? '?' })}
                  </div>
                ))}
            </div>
            <button className="replier" onClick={() => marquerEscapade(e.escapade)}>{t('Annuler')}</button>
          </div>
        )}

        {/* La carte tient en quatre lignes : la cible, l'attente et le verdict,
            l'heure de retour, qui part. Tout le reste est derrière « Détails ».
            Sept blocs pour une décision qui tient en une ligne, c'était trop. */}
        {e.escapade && !e.escapade.utilisee && !e.escapade.cibleDejaFaite && (() => {
          const esc = e.escapade
          // Une seule heure de retour : la recalculée si la journée a bougé.
          const retour = esc.perimee && esc.retourReel ? esc.retourReel : esc.retour
          let verdict = null
          if (attenteCible == null) verdict = { classe: 'inconnu', texte: t('attente inconnue') }
          else if (esc.attenteMax != null) verdict = attenteCible > esc.attenteMax
            ? { classe: 'non', texte: t('RENONCER — seuil {n} min', { n: esc.attenteMax }) }
            : { classe: 'ok', texte: t('OK — seuil {n} min', { n: esc.attenteMax }) }
          else if (attenteCible > 45) verdict = { classe: 'non', texte: t('beaucoup pour le temps disponible') }
          else verdict = { classe: 'ok', texte: 'OK' }
          return (
            <div className={'escapade' + (esc.risque ? ' risque' : '')}>
              <div className="esc-titre">{t('Escapade solo possible')}</div>
              <div className="esc-cible">
                {tp(cible.nom)}
                <span className="esc-lieu-inline"> · {tp(cible.lieu)}</span>
              </div>
              <div className={'esc-verdict ' + verdict.classe}>
                {attenteCible != null && <>
                  {srCible != null
                    ? tr('Attente <b>{n} min</b> · {sr} en Single Rider', { n: attenteCible, sr: srCible })
                    : tr('Attente <b>{n} min</b>', { n: attenteCible })}
                  {' → '}
                </>}
                <b>{verdict.texte}</b>
              </div>
              <div className="esc-ligne-cle">
                {tr('Retour <b>{h}</b>', { h: h(retour) })}
                {esc.margeApresRetour > 0
                  ? <> · {tr("possible jusqu'à <b>{h}</b>", { h: h(esc.limite) })}</>
                  : butoir && <> — {butoir}</>}
              </div>
              <div className="rangee" style={{ marginTop: 10 }}>
                <button className="bouton petit creux" onClick={() => marquerEscapade(esc)}>
                  {t('Créneau utilisé')}
                </button>
                <button className="bouton petit creux" onClick={() => setDetailsEsc(!detailsEsc)}>
                  {detailsEsc ? t('Masquer') : t('Détails')}
                </button>
              </div>

              {detailsEsc && (
                <div className="esc-details">
                  <div className="esc-cout">{t('Vous ratez : {quoi}', { quoi: tp(esc.coute) })}</div>
                  {esc.margeApresRetour > 0 && esc.enPlus?.length > 0 && (
                    <div className="esc-cout">
                      {t("Jusqu'à {h} en ratant aussi : {liste}. Au-delà, {butoir} est perdu.", { h: h(esc.limite), liste: esc.enPlus.map(tp).join(', '), butoir })}
                    </div>
                  )}
                  {esc.decision && <div className="esc-decision">{tp(esc.decision)}</div>}
                  {(esc.table || []).map((l, i) => (
                    <div key={i} className={'esc-ligne' + (attenteCible != null && ligneRetenue(esc.table, attenteCible) === i ? ' retenue' : '')}>
                      <span className="esc-si">{tp(l.si)}</span>
                      <span className="esc-alors">
                        {l.depart
                          ? t('départ {h} · déjeuner {n} min', { h: h(l.depart), n: l.dejeuner })
                          : t('déjeuner {n} min', { n: l.dejeuner })}
                        {' — '}{tp(l.verdict)}
                      </span>
                    </div>
                  ))}
                  {suivantes.length > 0 && esc.margeApresRetour > 0 && (
                    <div className="bonus-escapade">
                      <div className="bonus-titre">{t("S'il reste du temps, dans cet ordre")}</div>
                      {suivantes.map((c) => (
                        <div key={c.attractionId} className="bonus-ligne">
                          <div className="bonus-nom"><span className="bonus-rang">{c.priorite}</span>{tp(c.nom)}</div>
                          <div className="bonus-detail">
                            {tp(c.lieu)} · {t('{n} min de marche', { n: c.marcheDepuisCible })}
                            {c.live && c.live.ouverte !== false && !c.live.enPanne && c.live.attente != null && (
                              ' · ' + (c.live.singleRider != null
                                ? t('attente {n} min, {sr} en Single Rider', { n: c.live.attente, sr: c.live.singleRider })
                                : t('attente {n} min', { n: c.live.attente }))
                            )}
                            {c.live && c.live.enPanne && ' · ' + t('en panne')}
                            {c.live && c.live.ouverte === false && !c.live.enPanne && ' · ' + t('fermée')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {esc.vigilance && <div className="esc-vigilance">{tp(esc.vigilance)}</div>}
                  {esc.mesure && <div className="esc-cout">{tp(esc.mesure)}</div>}
                  {(escapades.rappels || []).map((r, i) => (
                    <div key={i} className="esc-rappel"><b>{tp(r.titre)}</b> — {tp(r.texte)}</div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        <button className="bouton" onClick={terminer}>{t('Terminé')}</button>

        {peutRevenir && (
          <button className="bouton creux petit" onClick={revenir}>
            {t('← Revenir en arrière')}
          </button>
        )}

        {!annulOuverte ? (
          <button className="replier" onClick={() => setAnnulOuverte(true)}>
            {t('Sauter ou annuler ?')}
          </button>
        ) : (
          <div className="bloc" style={{ borderColor: 'var(--orange)' }}>
            <div className="bloc-titre">{t('On la saute volontairement')}</div>
            <button className="bouton petit" onClick={() => annuler(MOTIF_CHOISI, true)}>
              {t(MOTIF_CHOISI)}
            </button>
            <div className="motif-note">
              {t("L'attraction reste ouverte : elle est mise de côté, pas perdue. La situation s'affichera aussitôt pour que Claude la replace ailleurs.")}
            </div>

            <div className="bloc-titre" style={{ marginTop: 14 }}>{t("Ou c'est impossible")}</div>
            {MOTIFS_IMPOSES.map((m) => (
              <button key={m} className="bouton petit creux" onClick={() => annuler(m)}>{t(m)}</button>
            ))}
            <div className="motif-note">
              {t("Là, c'est perdu pour la journée : inutile de chercher à la replacer.")}
            </div>

            <button className="replier" onClick={() => setAnnulOuverte(false)}>{t('Finalement non')}</button>
          </div>
        )}

        {s.suivante && (
          <div className="ensuite">
            {tr('Ensuite : <b>{titre}</b> — {h}', { titre: tp(s.suivante.titre), h: h(s.suivante.debutHm) })}
          </div>
        )}
      </div>
    </>
  )
}
