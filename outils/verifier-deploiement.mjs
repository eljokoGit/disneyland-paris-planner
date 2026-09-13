// Le déploiement est-il RÉELLEMENT en ligne ?
//
// À lancer après chaque modification de code, sans exception.
//
// Le 1er septembre, la chaîne s'est bloquée trois fois sur un conflit Syncthing
// et j'ai annoncé « c'est en ligne » à chaque fois sans vérifier. Le parent l'a
// découvert en regardant son téléphone. Un déploiement silencieusement bloqué
// est pire qu'un déploiement raté : on construit la suite sur du faux.
//
//   node --use-system-ca outils/verifier-deploiement.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.join(__dirname, '..')

const cfg = JSON.parse(fs.readFileSync(path.join(RACINE, '.serveur.json'), 'utf8').replace(/^﻿/, ''))

// Le nom du bundle porte une empreinte du contenu : s'il diffère, le serveur
// sert autre chose que ce qu'on a construit.
const local = fs.readdirSync(path.join(RACINE, 'frontend', 'dist', 'assets'))
  .find((f) => /^index-.*\.js$/.test(f))

const page = await fetch(cfg.url, { headers: { 'x-cle': cfg.cle } }).then((r) => r.text())
const enLigne = (/assets\/(index-[^"]+\.js)/.exec(page) || [])[1]

const memeCode = local === enLigne
console.log('construit ici :', local)
console.log('servi en ligne:', enLigne || 'introuvable')
console.log(memeCode ? '\n=> À JOUR' : '\n=> EN RETARD — le rebuild ne s’est pas fait')

if (!memeCode) {
  console.log('\nÀ vérifier, dans cet ordre :')
  console.log('  1. un conflit Syncthing suspend le rebuild — c’est la cause la plus fréquente :')
  console.log('     ssh utilisateur@mon-serveur "cd ~/Disney-app && find . -name \'*.sync-conflict-*\' -not -path \'*/node_modules/*\' -print -delete"')
  console.log('  2. le service tourne-t-il :  sudo systemctl status disney-rebuild')
  console.log('  3. rattrapage manuel :       cd ~/Disney-app && docker compose up -d --build')
}

process.exit(memeCode ? 0 : 1)
