// Génère l'artefact « temps d'attente » à partir de ce que le collecteur a
// enregistré. Relancer à volonté : chaque exécution reflète l'historique du
// moment.  node outils/artefact-attentes.mjs [chemin-de-sortie]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.join(__dirname, '..')
const DOSSIER = path.join(RACINE, 'data', 'attentes')
const SORTIE = process.argv[2] || path.join(RACINE, 'data', 'artefact-attentes.html')

const PARCS = { 1: 'Disney Adventure World', 2: 'Parc Disneyland' }
const JOURS = { 1: 'jeudi 3 septembre', 2: 'vendredi 4 septembre' }

function lireJour(jour) {
  const fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith(`-jour${jour}.jsonl`)).sort()
  const noms = {}
  const parHeure = {}      // { id: { heure: [valeurs] } }
  const dates = new Set()
  const transitions = []
  let dernier = null

  for (const f of fichiers) {
    const lignes = fs.readFileSync(path.join(DOSSIER, f), 'utf8').trim().split('\n')
    for (const brut of lignes) {
      let l
      try { l = JSON.parse(brut) } catch { continue }
      if (l.type === 'entete') { Object.assign(noms, l.attractions); continue }
      dates.add(f.slice(0, 10))
      const heure = Number(l.t.slice(0, 2))
      for (const [id, min] of Object.entries(l.w || {})) {
        ((parHeure[id] ||= {})[heure] ||= []).push(min)
      }
      // `fv` n'est écrit QUE quand l'état change : chaque ligne qui en porte un
      // est donc une transition, pas un échantillon. C'est ce qui permet de
      // reconstituer les moments où une file virtuelle s'ouvre.
      if (l.fv) transitions.push({ date: f.slice(0, 10), t: l.t, fv: l.fv })
      dernier = { t: l.t, iso: l.iso, w: l.w, sr: l.sr || {}, f: l.f || [], date: f.slice(0, 10) }
    }
  }

  const heures = [...new Set(Object.values(parHeure).flatMap((h) => Object.keys(h).map(Number)))].sort((a, b) => a - b)
  const attractions = Object.keys(parHeure)
    .map((id) => {
      const moyennes = {}
      let total = 0, n = 0
      for (const [h, vals] of Object.entries(parHeure[id])) {
        moyennes[h] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
        total += vals.reduce((s, v) => s + v, 0); n += vals.length
      }
      return {
        id, nom: noms[id] || id, moyennes,
        moyenne: n ? Math.round(total / n) : null,
        pointe: Math.max(...Object.values(moyennes)),
        live: dernier && dernier.w[id] != null ? dernier.w[id] : null,
        sr: dernier && dernier.sr[id] != null ? dernier.sr[id] : null,
        fermee: dernier ? dernier.f.includes(id) : false,
        releves: n,
      }
    })
    .sort((a, b) => (a.moyenne ?? 1e9) - (b.moyenne ?? 1e9))

  return { jour: Number(jour), parc: PARCS[jour], attractions, heures, dernier,
           jours: [...dates].sort(), noms, filesVirtuelles: ouverturesFiles(transitions) }
}

// Reconstitue, pour chaque file virtuelle, ses plages d'ouverture. Une file
// absente d'un relevé a disparu de l'API : c'est une fermeture, pas un trou.
function ouverturesFiles(transitions) {
  const par = {}            // id -> { plages: [...], ouvertureEnCours }
  const ids = new Set(transitions.flatMap((x) => Object.keys(x.fv)))

  for (const id of ids) {
    const plages = []
    let debut = null, fenetre = null
    for (const { date, t, fv } of transitions) {
      const e = fv[id]
      const ouverte = !!e && e[0] === 'ouverte'
      if (ouverte && !debut) { debut = { date, t }; fenetre = [e[1], e[2]] }
      else if (!ouverte && debut) { plages.push({ date: debut.date, de: debut.t, a: t, fenetre }); debut = null }
      else if (ouverte && debut) { fenetre = [e[1], e[2]] }
    }
    if (debut) plages.push({ date: debut.date, de: debut.t, a: null, fenetre })
    if (plages.length) par[id] = plages
  }
  return par
}

// Le bloc « en ce moment » doit être un vrai relevé, pas la dernière ligne du
// fichier : l'historique n'archive ni l'état des files virtuelles ni la fenêtre
// de retour du Premier Access, qui changent trop vite pour être échantillonnés.
async function lireLive(id) {
  try {
    const r = await fetch(`https://api.themeparks.wiki/v1/entity/${id}/live`,
      { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const d = await r.json()
    const ix = {}
    for (const e of d.liveData || []) {
      const q = e.queue || {}
      // Les rencontres à file virtuelle (Rencontre Royale, Pavillon des
      // Princesses) sont typées SHOW par l'API : les exclure les ferait
      // disparaître alors que ce sont les plus décisives.
      const aUneFile = q.STANDBY || q.PAID_RETURN_TIME || q.RETURN_TIME
      if (e.entityType !== 'ATTRACTION' && !aUneFile) continue
      const pa = q.PAID_RETURN_TIME, rt = q.RETURN_TIME
      ix[e.id] = {
        nom: e.name,
        rencontre: e.entityType !== 'ATTRACTION',
        statut: e.status,
        ouverte: e.status === 'OPERATING',
        enPanne: e.status === 'DOWN',
        attente: q.STANDBY && typeof q.STANDBY.waitTime === 'number' ? q.STANDBY.waitTime : null,
        sr: q.SINGLE_RIDER && typeof q.SINGLE_RIDER.waitTime === 'number' ? q.SINGLE_RIDER.waitTime : null,
        pa: pa && pa.state === 'AVAILABLE' ? {
          prix: pa.price && pa.price.formatted,
          debut: pa.returnStart ? String(pa.returnStart).slice(11, 16) : null,
          fin: pa.returnEnd ? String(pa.returnEnd).slice(11, 16) : null,
        } : null,
        fv: rt ? { ouverte: rt.state === 'AVAILABLE', etat: rt.state,
                   debut: rt.returnStart ? String(rt.returnStart).slice(11, 16) : null,
                   fin: rt.returnEnd ? String(rt.returnEnd).slice(11, 16) : null } : null,
      }
    }
    return { ix, a: new Date() }
  } catch { return null }
}

const IDS = { 1: 'ca888437-ebb4-4d50-aed2-d227f7096968', 2: 'dae968d5-630d-4719-8b06-3d107e944401' }
const donnees = {}
for (const j of Object.keys(PARCS)) {
  try { donnees[j] = lireJour(j) } catch (e) { donnees[j] = null }
  const live = await lireLive(IDS[j])
  if (donnees[j]) donnees[j].live = live
}
const total = Object.values(donnees).reduce((s, d) => s + (d ? d.attractions.reduce((x, a) => x + a.releves, 0) : 0), 0)

const html = `<title>Files d'Attente Disneyland</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    --fond: #f4f6f8;  --surface: #ffffff;  --encre: #101720;  --doux: #586373;
    --trait: #dde2e9;  --accent: #22456e;
    --t0: #0f6b45;  --t1: #9a6a08;  --t2: #b53c0f;  --t3: #85102c;  --off: #8f99a8;
    --ombre: 0 1px 2px rgba(16,23,32,.06), 0 8px 24px -16px rgba(16,23,32,.28);
  }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --fond: #0c1016;  --surface: #151b24;  --encre: #e7ebf1;  --doux: #93a0b2;
      --trait: #263040;  --accent: #7aa6dd;
      --t0: #46c08a;  --t1: #e0b04a;  --t2: #f08252;  --t3: #f2718f;  --off: #6b7789;
      --ombre: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.7);
    }
  }
  :root[data-theme="dark"] {
    --fond: #0c1016;  --surface: #151b24;  --encre: #e7ebf1;  --doux: #93a0b2;
    --trait: #263040;  --accent: #7aa6dd;
    --t0: #46c08a;  --t1: #e0b04a;  --t2: #f08252;  --t3: #f2718f;  --off: #6b7789;
    --ombre: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.7);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--fond); color: var(--encre);
    font-family: "IBM Plex Sans", system-ui, sans-serif; font-size: 16px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .page { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }

  header { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
  .eyebrow {
    font-family: "IBM Plex Mono", monospace; font-size: .72rem; font-weight: 600;
    letter-spacing: .14em; text-transform: uppercase; color: var(--accent);
  }
  h1 {
    font-family: "Bricolage Grotesque", system-ui, sans-serif; font-weight: 800;
    font-size: clamp(1.9rem, 5vw, 2.9rem); line-height: 1.04; letter-spacing: -.02em;
    margin: 0; text-wrap: balance;
  }
  .sous { color: var(--doux); max-width: 62ch; margin: 0; }

  .onglets { display: flex; gap: 8px; margin: 26px 0 18px; flex-wrap: wrap; }
  .onglets button {
    font: inherit; font-weight: 600; font-size: .9rem; cursor: pointer;
    padding: 9px 16px; border-radius: 999px; border: 1px solid var(--trait);
    background: var(--surface); color: var(--encre); transition: .15s;
  }
  .onglets button[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: var(--surface); }
  .onglets button[aria-selected="true"] .meta { color: inherit; opacity: .72; }
  .onglets button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  h2 {
    font-family: "Bricolage Grotesque", system-ui, sans-serif; font-weight: 600;
    font-size: 1.15rem; letter-spacing: -.01em; margin: 34px 0 4px;
  }
  .note { color: var(--doux); font-size: .9rem; margin: 0 0 14px; max-width: 62ch; }

  .live { display: grid; gap: 8px; }
  .rang {
    display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; align-items: start;
    background: var(--surface); border: 1px solid var(--trait); border-radius: 10px;
    padding: 10px 14px; box-shadow: var(--ombre);
  }
  .puce {
    font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums;
    font-weight: 600; font-size: .95rem; text-align: center; color: var(--surface);
    padding: 7px 4px; border-radius: 7px;
  }
  .n0 { background: var(--t0); } .n1 { background: var(--t1); }
  .n2 { background: var(--t2); } .n3 { background: var(--t3); }
  .noff { background: transparent; color: var(--off); border: 1px dashed var(--trait); }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .puce { color: #0c1016; } }
  :root[data-theme="dark"] .puce { color: #0c1016; }
  .noff, :root[data-theme="dark"] .noff { color: var(--off); background: transparent; }

  .nom { font-weight: 500; }
  .jetons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .jeton {
    font-family: "IBM Plex Mono", monospace; font-size: .7rem; font-weight: 500;
    padding: 3px 8px; border-radius: 999px; border: 1px solid var(--trait); color: var(--doux);
  }
  .jeton.payant   { border-color: var(--accent); color: var(--accent); }
  .jeton.payant.tard { border-color: var(--t2); color: var(--t2); }
  .jeton.ouverte  { border-color: var(--t0); color: var(--t0); }
  .jeton.complete { border-color: var(--t3); color: var(--t3); }
  .meta { font-family: "IBM Plex Mono", monospace; font-size: .78rem; color: var(--doux); font-variant-numeric: tabular-nums; }

  .grille-boite { overflow-x: auto; border: 1px solid var(--trait); border-radius: 12px; background: var(--surface); box-shadow: var(--ombre); }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { padding: 9px 10px; text-align: center; white-space: nowrap; font-size: .86rem; }
  thead th {
    font-family: "IBM Plex Mono", monospace; font-size: .74rem; font-weight: 600;
    letter-spacing: .06em; color: var(--doux); border-bottom: 1px solid var(--trait);
  }
  tbody tr + tr td { border-top: 1px solid var(--trait); }
  th.att, td.att {
    position: sticky; left: 0; background: var(--surface); text-align: left;
    font-weight: 500; min-width: 190px; max-width: 240px; white-space: normal;
    border-right: 1px solid var(--trait);
  }
  td.v { font-family: "IBM Plex Mono", monospace; font-weight: 600; }
  td.v span { display: inline-block; min-width: 38px; padding: 4px 0; border-radius: 6px; color: var(--surface); }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) td.v span { color: #0c1016; } }
  :root[data-theme="dark"] td.v span { color: #0c1016; }
  td.vide { color: var(--off); }

  .fv-bloc {
    background: var(--surface); border: 1px solid var(--trait); border-radius: 10px;
    padding: 12px 14px; box-shadow: var(--ombre);
  }
  .fv-tete { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .fv-frise { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .creneau-fv {
    font-family: "IBM Plex Mono", monospace; font-size: .74rem; font-weight: 600;
    font-variant-numeric: tabular-nums; padding: 5px 10px; border-radius: 7px;
    background: color-mix(in srgb, var(--t0) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--t0) 45%, transparent); color: var(--t0);
    display: inline-flex; align-items: baseline; gap: 7px;
  }
  .creneau-fv em { font-style: normal; font-weight: 500; color: var(--doux); font-size: .92em; }

  .legende { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px; font-size: .82rem; color: var(--doux); }
  .legende i { display: inline-block; width: 13px; height: 13px; border-radius: 4px; vertical-align: -2px; margin-right: 6px; }

  .garde {
    margin-top: 34px; padding: 16px 18px; border-radius: 12px;
    background: var(--surface); border: 1px solid var(--trait);
    border-left: 3px solid var(--accent); box-shadow: var(--ombre);
  }
  .garde h3 { font-family: "Bricolage Grotesque", system-ui, sans-serif; font-size: 1rem; margin: 0 0 6px; }
  .garde p { margin: 0; color: var(--doux); font-size: .92rem; max-width: 66ch; }
  footer { margin-top: 30px; color: var(--doux); font-size: .8rem; font-family: "IBM Plex Mono", monospace; }
  [hidden] { display: none !important; }
</style>

<div class="page">
  <header>
    <span class="eyebrow">Relevés ThemeParks.wiki &middot; toutes les 5 minutes</span>
    <h1>Files d'attente, heure par heure</h1>
    <p class="sous">Moyennes par tranche horaire sur les journées déjà collectées, et dernier relevé en direct. Les moyennes se précisent à chaque jour enregistré.</p>
  </header>

  <div class="onglets" role="tablist">
    ${Object.keys(PARCS).map((j, i) => `<button role="tab" aria-selected="${i === 0}" aria-controls="parc${j}" data-cible="parc${j}">${PARCS[j]}<span class="meta"> &middot; ${JOURS[j]}</span></button>`).join('\n    ')}
  </div>

  ${Object.keys(PARCS).map((j, i) => rendreParc(donnees[j], Number(j), i !== 0)).join('\n')}

  <div class="garde">
    <h3>Ce que ces chiffres sont</h3>
    <p><strong>« Passage entre 15h20 et 16h20 »</strong> n'est pas un temps d'attente : c'est la fenêtre pendant laquelle le Premier Access vous laisse entrer. Vous ne montez pas tout de suite, vous revenez à cette heure-là. Plus l'attraction est demandée, plus cette fenêtre s'éloigne — un Premier Access acheté le matin peut vous renvoyer à l'après-midi. Le jeton passe en orange quand la fenêtre est à plus d'une heure et demie.</p>
    <p style="margin-top:10px">Les temps <strong>affichés par Disney</strong>, pas les temps réellement attendus. Disney surestime volontiers : un panneau à 60&nbsp;min correspond souvent à 40&nbsp;min réelles. Le biais joue en votre faveur — vous ne raterez pas un créneau à cause de lui — mais ne prenez pas le chiffre au pied de la lettre.</p>
  </div>

  <footer>Généré le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} &middot; ${total} relevés collectés</footer>
</div>

<script>
  const boutons = [...document.querySelectorAll('.onglets button')]
  boutons.forEach((b) => b.addEventListener('click', () => {
    boutons.forEach((x) => {
      const actif = x === b
      x.setAttribute('aria-selected', actif)
      document.getElementById(x.dataset.cible).hidden = !actif
    })
  }))
</script>
`

// Un Premier Access dont la fenêtre est loin ne sauve plus la situation : il
// déplace l'attraction dans la journée au lieu de raccourcir l'attente.
function ecartMinutes(hm) {
  const [h, m] = hm.split(':').map(Number)
  const now = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false })
  const [nh, nm] = now.replace('h', ':').split(':').map(Number)
  return (h * 60 + m) - (nh * 60 + nm)
}

function niveau(v) {
  if (v == null) return 'noff'
  if (v <= 20) return 'n0'
  if (v <= 45) return 'n1'
  if (v <= 70) return 'n2'
  return 'n3'
}

// Les files virtuelles ne se lisent pas comme un temps d'attente : ce qui compte
// n'est pas « combien de minutes » mais « à quel moment elle s'ouvre ». D'où une
// frise des ouvertures plutôt qu'une moyenne, qui ne voudrait rien dire ici.
function rendreFilesVirtuelles(d) {
  const ix = (d.live && d.live.ix) || {}
  const plages = d.filesVirtuelles || {}
  const ids = [...new Set([
    ...Object.keys(plages),
    ...Object.keys(ix).filter((id) => ix[id].fv),
  ])]
  if (!ids.length) return ''

  const nomDe = (id) => (ix[id] && ix[id].nom) || d.noms[id] || id.slice(0, 8)

  const lignes = ids
    .sort((a, b) => nomDe(a).localeCompare(nomDe(b), 'fr'))
    .map((id) => {
      const live = ix[id] && ix[id].fv
      const p = plages[id] || []
      const etat = !live
        ? '<span class="jeton">absente de l’API</span>'
        : live.ouverte
          ? `<span class="jeton ouverte">ouverte${live.debut ? ` &middot; passage ${live.debut}–${live.fin || '?'}` : ''}</span>`
          : '<span class="jeton complete">complète</span>'

      const frise = p.length
        ? p.map((x) => `<span class="creneau-fv">${x.de}${x.a ? '–' + x.a : '→'}${
            x.fenetre && x.fenetre[0] ? `<em>retour ${x.fenetre[0]}–${x.fenetre[1] || '?'}</em>` : ''
          }</span>`).join('')
        : '<span class="meta">aucune ouverture encore observée</span>'

      return `
      <div class="fv-bloc">
        <div class="fv-tete"><span class="nom">${echapper(nomDe(id))}</span>${etat}</div>
        <div class="fv-frise">${frise}</div>
      </div>`
    }).join('')

  const nb = Object.values(plages).reduce((n, p) => n + p.length, 0)

  return `
    <h2>Files virtuelles</h2>
    <p class="note">Gratuites, à prendre dans l'appli Disneyland Paris. Elles n'ont pas de
    temps d'attente : elles sont ouvertes ou elles ne le sont pas. ${nb
      ? `${nb} ouverture${nb > 1 ? 's' : ''} observée${nb > 1 ? 's' : ''} depuis que l'archivage a commencé, le 1<sup>er</sup> septembre à 13h45.`
      : "L'archivage vient de commencer : les ouvertures apparaîtront ici au fil des relevés."}</p>
    <div class="live">${lignes}</div>`
}

function rendreParc(d, jour, cache) {
  if (!d || !d.attractions.length) {
    return `<section id="parc${jour}" ${cache ? 'hidden' : ''}><p class="note">Aucun relevé enregistré pour ${PARCS[jour]}.</p></section>`
  }
  const ix = (d.live && d.live.ix) || {}
  const enDirect = Object.entries(ix)
    .map(([id, v]) => ({ id, ...v, moyenne: (d.attractions.find((a) => a.id === id) || {}).moyenne ?? null }))
    .sort((a, b) => {
      const va = a.ouverte && a.attente != null ? a.attente : 1e6
      const vb = b.ouverte && b.attente != null ? b.attente : 1e6
      return va - vb || a.nom.localeCompare(b.nom, 'fr')
    })

  const lignes = enDirect.map((a) => {
    const puces = []
    if (a.sr != null) puces.push(`<span class="jeton">single rider ${a.sr} min</span>`)
    if (a.pa) {
      const fen = a.pa.debut ? `passage entre ${a.pa.debut} et ${a.pa.fin || '?'}` : 'fenêtre inconnue'
      const tard = a.pa.debut && ecartMinutes(a.pa.debut) > 90
      puces.push(`<span class="jeton payant${tard ? ' tard' : ''}">Premier Access ${echapper(a.pa.prix || '')} &middot; ${fen}</span>`)
    }
    if (a.rencontre) puces.push('<span class="jeton">rencontre</span>')
    if (a.fv) puces.push(a.fv.ouverte
      ? `<span class="jeton ouverte">file virtuelle ouverte${a.fv.debut ? ` &middot; passage entre ${a.fv.debut} et ${a.fv.fin || '?'}` : ''}</span>`
      : `<span class="jeton complete">file virtuelle complète</span>`)
    const chiffre = a.enPanne ? 'panne' : !a.ouverte ? 'fermé' : a.attente == null ? '—' : a.attente
    return `
      <div class="rang">
        <span class="puce ${a.ouverte && !a.enPanne ? niveau(a.attente) : 'noff'}">${chiffre}</span>
        <span class="nom">${echapper(a.nom)}${puces.length ? `<span class="jetons">${puces.join('')}</span>` : ''}</span>
        <span class="meta">${a.moyenne != null ? 'moy. ' + a.moyenne + ' min' : ''}</span>
      </div>`
  }).join('')

  const entetes = d.heures.map((h) => `<th scope="col">${String(h).padStart(2, '0')}h</th>`).join('')
  const corps = d.attractions.map((a) => `
        <tr>
          <th scope="row" class="att">${echapper(a.nom)}</th>
          ${d.heures.map((h) => {
            const v = a.moyennes[h]
            return v == null ? '<td class="v vide">&middot;</td>'
                             : `<td class="v"><span class="${niveau(v)}">${v}</span></td>`
          }).join('')}
        </tr>`).join('')

  return `<section id="parc${jour}" ${cache ? 'hidden' : ''}>
    <h2>En ce moment</h2>
    <p class="note">${d.live
      ? 'Relevé en direct à ' + d.live.a.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) + ', au moment où cette page a été produite.'
      : 'API injoignable — dernier relevé archivé à ' + (d.dernier ? d.dernier.t : '—') + '.'}</p>
    <div class="live">${lignes || '<p class="note">Parc fermé, aucune file ouverte.</p>'}</div>

    ${rendreFilesVirtuelles(d)}

    <h2>Moyenne par tranche horaire</h2>
    <p class="note">${d.jours.length === 1 ? "Une seule journée collectée pour l'instant : ce sont des relevés, pas encore des moyennes." : d.jours.length + ' journées collectées, moyennées.'} Trié du plus calme au plus chargé.</p>
    <div class="grille-boite">
      <table>
        <thead><tr><th scope="col" class="att">Attraction</th>${entetes}</tr></thead>
        <tbody>${corps}</tbody>
      </table>
    </div>
    <div class="legende">
      <span><i style="background:var(--t0)"></i>20 min ou moins</span>
      <span><i style="background:var(--t1)"></i>21 à 45</span>
      <span><i style="background:var(--t2)"></i>46 à 70</span>
      <span><i style="background:var(--t3)"></i>plus de 70</span>
      <span><i style="border:1px dashed var(--trait)"></i>pas de relevé</span>
    </div>
  </section>`
}

function echapper(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

fs.writeFileSync(SORTIE, html, 'utf8')
console.log(`Artefact écrit : ${SORTIE}`)
console.log(`  ${total} relevés, ${Object.values(donnees).filter(Boolean).map((d) => `${d.parc} ${d.attractions.length} attractions`).join(' | ')}`)
