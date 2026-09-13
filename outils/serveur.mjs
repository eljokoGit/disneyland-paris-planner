// Pilotage du serveur déployé, depuis ce PC, sans SSH ni mot de passe.
//
// C'est ce qui rend le recalcul possible pendant que le parent est dans le parc :
// il me parle depuis son téléphone, j'agis d'ici, l'app se met à jour toute
// seule. Aucune commande à copier de son côté.
//
//   node --use-system-ca outils/serveur.mjs etat
//   node --use-system-ca outils/serveur.mjs brief
//   node --use-system-ca outils/serveur.mjs pousser-plan
//   node --use-system-ca outils/serveur.mjs plans
//   node --use-system-ca outils/serveur.mjs restaurer plan-....json
//   node --use-system-ca outils/serveur.mjs attentes 1
//
// --use-system-ca : Avast intercepte le TLS sur ce poste et signe avec sa
// propre racine, installée dans le magasin de Windows que Node ignore sans
// ce drapeau. Sans lui, tout échoue sur « self-signed certificate ».

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.join(__dirname, '..')
const F_CONFIG = path.join(RACINE, '.serveur.json')

function config() {
  try {
    const c = JSON.parse(fs.readFileSync(F_CONFIG, 'utf8').replace(/^﻿/, ''))
    if (!c.url || !c.cle) throw new Error('url ou cle manquante')
    return c
  } catch (err) {
    console.error(`Configuration illisible (${F_CONFIG}) : ${err.message}`)
    console.error('Attendu : { "url": "https://…", "cle": "…" }')
    process.exit(1)
  }
}

const { url: BASE, cle: CLE } = config()

async function appel(chemin, options = {}) {
  const r = await fetch(BASE + chemin, {
    ...options,
    headers: { 'x-cle': CLE, ...(options.headers || {}) },
  })
  const type = r.headers.get('content-type') || ''
  const corps = type.includes('json') ? await r.json() : await r.text()
  if (!r.ok) {
    console.error(`HTTP ${r.status} — ${typeof corps === 'string' ? corps : corps.erreur || JSON.stringify(corps)}`)
    process.exit(1)
  }
  return corps
}

const [commande, argument] = process.argv.slice(2)

switch (commande) {
  case 'etat':
    console.log(await appel('/api/etat'))
    break

  case 'brief':
    console.log(await appel('/api/brief'))
    break

  case 'attentes': {
    const d = await appel(`/api/attentes/${argument || 1}`)
    console.log(`Relevé ${d.majLe} — ${d.entites.length} entités`)
    for (const e of d.entites.filter((x) => x.dansLePlan || x.fileVirtuelle)) {
      const bits = [e.nom.slice(0, 42).padEnd(44)]
      bits.push(e.ouverte ? String(e.attente ?? '—').padStart(3) + ' min' : '  fermée')
      if (e.singleRider != null) bits.push(`SR ${e.singleRider}`)
      if (e.premierAcces?.disponible) bits.push(`PA ${e.premierAcces.prixTexte} ${e.premierAcces.retourDebut}-${e.premierAcces.retourFin}`)
      if (e.fileVirtuelle) bits.push(e.fileVirtuelle.disponible ? 'FILE OUVERTE' : 'file complète')
      console.log('  ' + bits.join(' · '))
    }
    break
  }

  case 'pousser-plan': {
    // Le plan local devient le plan du serveur. Le serveur le valide, en garde
    // une copie horodatée, et le recharge à chaud : pas de redémarrage, pas de
    // coupure pour les téléphones qui l'ont ouvert.
    const local = path.join(RACINE, 'data', 'plan.json')
    const contenu = fs.readFileSync(local, 'utf8').replace(/^﻿/, '')
    JSON.parse(contenu)   // on échoue ici plutôt que d'envoyer un plan cassé
    const r = await appel('/api/plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: contenu,
    })
    console.log('Plan poussé et rechargé à chaud.')
    console.log('  ancien conservé :', r.sauvegarde)
    for (const j of r.jours) console.log(`  jour ${j.numero} : ${j.etapes} étapes`)
    break
  }

  case 'plans': {
    const r = await appel('/api/plans-precedents')
    if (!r.fichiers.length) { console.log('Aucune sauvegarde.'); break }
    console.log(`${r.fichiers.length} sauvegarde(s), de la plus récente à la plus ancienne :`)
    for (const f of r.fichiers) console.log('  ' + f)
    break
  }

  case 'restaurer': {
    if (!argument) { console.error('Nom de sauvegarde attendu. Voir : serveur.mjs plans'); process.exit(1) }
    const r = await appel('/api/plan/restaurer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fichier: argument }),
    })
    console.log('Plan restauré :', r.restaure)
    break
  }

  default:
    console.log('Commandes : etat | brief | attentes [jour] | pousser-plan | plans | restaurer <fichier>')
    process.exit(1)
}
