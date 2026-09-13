// Prévient par mail à chaque changement d'état d'une file virtuelle.
//
// Règle, telle que le parent l'a posée : la file s'ouvre, on le dit ; elle se
// ferme, on le dit. Pas de délai, pas de filtre, pas d'interprétation.
//
// Un échec d'envoi ne doit JAMAIS interrompre la collecte : le mail est un
// service rendu, l'historique ne se rattrape pas.

import fs from 'node:fs'
import path from 'node:path'
import { envoyerMail } from './mail.js'

const sansBom = (t) => t.replace(/^﻿/, '')

function lireJson(chemin) {
  try { return JSON.parse(sansBom(fs.readFileSync(chemin, 'utf8'))) } catch { return null }
}

// Le mot de passe vit dans un fichier à part que le parent remplit lui-même.
function lireIdentifiants(chemin) {
  const ix = {}
  try {
    for (const ligne of sansBom(fs.readFileSync(chemin, 'utf8')).split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(ligne)
      if (m) ix[m[1]] = m[2].trim()
    }
  } catch { /* fichier absent : les alertes restent muettes */ }
  return ix
}

const enMinutes = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function creerAlertes({ dossierData, dossierCollecteur, journaliser = console.log }) {
  const F_CONFIG = path.join(dossierData, 'alertes-mail.json')
  const F_ENV = path.join(dossierCollecteur, '.env-mail')
  const F_ETAT = path.join(dossierData, 'etat-courant.json')

  // Dernier état ANNONCÉ, conservé sur disque : un redémarrage du conteneur ne
  // doit pas ré-annoncer ce qui n'a pas changé. Ce n'est pas un délai, c'est la
  // mémoire de ce qu'on a déjà dit.
  const F_MEMOIRE = path.join(dossierData, 'attentes', 'alertes-memoire.json')
  const annonce = (lireJson(F_MEMOIRE) || {}).annonce || {}

  function retenir() {
    try {
      const tmp = F_MEMOIRE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify({ annonce }, null, 2), 'utf8')
      fs.renameSync(tmp, F_MEMOIRE)
    } catch (err) {
      journaliser(`[mail] mémoire non enregistrée : ${err.message}`)
    }
  }

  async function surTransitions({ apres, noms, entites }) {
    // MAIL_ACTIF désigne l'unique expéditeur — le conteneur du serveur — et
    // sert d'interrupteur atteignable : il vit dans docker-compose.yml, qui est
    // synchronisé, alors que data/ ne l'est pas.
    if (process.env.MAIL_ACTIF !== '1') return
    const cfg = lireJson(F_CONFIG)
    if (!cfg) return

    const ids = lireIdentifiants(F_ENV)
    if (!ids.MAIL_UTILISATEUR || !ids.MAIL_MOTDEPASSE) {
      journaliser('[mail] identifiants absents dans .env-mail — rien envoyé')
      return
    }

    const [debut, fin] = cfg.plageHoraire || []
    const maintenant = new Date()
    const minutes = maintenant.getHours() * 60 + maintenant.getMinutes()
    const d = enMinutes(debut), f = enMinutes(fin)
    if (d != null && f != null && (minutes < d || minutes > f)) return

    // Tout est suivi, sauf ce que le parent a fait taire dans l'onglet Attentes.
    const exclues = (lireJson(F_ETAT) || {}).filesNonSuivies || {}

    // Une file OUVERTE, à chaque relevé tant qu'elle l'est. Rien d'autre.
    // Une fermeture n'appelle aucune action : le parent n'en veut pas.
    const changements = []
    for (const [id, etat] of Object.entries(apres)) {
      if (exclues[id] || etat[0] !== 'ouverte') continue
      changements.push({
        id,
        nom: noms[id] || (entites.find((e) => e.id === id) || {}).nom || id,
        retourDebut: etat[1],
        retourFin: etat[2],
      })
    }
    if (!changements.length) return

    const heure = maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    const lignes = changements.map((c) => (c.retourDebut
      ? `${c.nom} — passage entre ${c.retourDebut} et ${c.retourFin || '?'}`
      : c.nom))

    const sujet = changements.length === 1
      ? `File OUVERTE : ${changements[0].nom}`
      : `${changements.length} files ouvertes`

    try {
      await envoyerMail({
        hote: cfg.hote, port: cfg.port,
        utilisateur: ids.MAIL_UTILISATEUR, motDePasse: ids.MAIL_MOTDEPASSE,
        de: cfg.expediteur, pour: cfg.destinataires,
        sujet,
        texte: [...lignes, '', `Relevé de ${heure}.`].join('\n'),
      })
      for (const c of changements) annonce[c.id] = true
      retenir()
      journaliser(`[mail] ${lignes.join(' | ')}`)
    } catch (err) {
      // On n'enregistre PAS : le prochain relevé réessaiera.
      journaliser(`[mail] envoi impossible : ${err.message}`)
    }
  }

  return { surTransitions }
}
