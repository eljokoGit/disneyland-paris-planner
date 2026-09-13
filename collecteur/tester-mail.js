// Vérifie la chaîne d'envoi des alertes.
//
//   node collecteur/tester-mail.js --verifier
//       Teste le chemin jusqu'à AUTH SANS envoyer d'identifiants. Aucune
//       tentative de connexion ratée, donc aucun risque de bannissement.
//
//   node collecteur/tester-mail.js
//       Envoie un vrai mail de test aux destinataires configurés.

import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { envoyerMail } from './mail.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RACINE = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const sansBom = (t) => t.replace(/^\uFEFF/, '')

const cfg = JSON.parse(sansBom(fs.readFileSync(path.join(RACINE, 'alertes-mail.json'), 'utf8')))

function identifiants() {
  const ix = {}
  try {
    for (const l of sansBom(fs.readFileSync(path.join(__dirname, '.env-mail'), 'utf8')).split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l)
      if (m) ix[m[1]] = m[2].trim()
    }
  } catch { /* absent */ }
  return ix
}

async function verifier() {
  console.log(`Serveur   : ${cfg.hote}:${cfg.port}`)
  const brut = net.connect({ host: cfg.hote, port: cfg.port, timeout: 15000 })
  await new Promise((r, j) => { brut.once('connect', r); brut.once('error', j) })
  const lire = () => new Promise((r) => brut.once('data', (d) => r(d.toString())))
  console.log('Bannière  :', (await lire()).trim().split('\n')[0])
  brut.write('EHLO plan-disneyland\r\n'); await lire()
  brut.write('STARTTLS\r\n'); await lire()

  const s = tls.connect({ socket: brut, servername: cfg.hote })
  await new Promise((r, j) => { s.once('secureConnect', r); s.once('error', j) })
  const c = s.getPeerCertificate()
  console.log('Certificat:', c.subject.CN, '— valide jusqu\u2019au', c.valid_to)
  console.log('Chiffré   :', s.authorized ? 'oui, certificat vérifié' : `oui, mais NON vérifié (${s.authorizationError})`)

  s.write('EHLO plan-disneyland\r\n')
  const cap = await new Promise((r) => s.once('data', (d) => r(d.toString())))
  const auth = /AUTH[ =]([^\r\n]*)/i.exec(cap)
  console.log('AUTH      :', auth ? auth[1].trim() : 'NON PROPOSÉ — l\u2019envoi sera impossible')
  s.write('QUIT\r\n'); s.end(); brut.destroy()

  const ids = identifiants()
  console.log('Identifiants dans .env-mail :',
    ids.MAIL_UTILISATEUR && ids.MAIL_MOTDEPASSE
      ? `présents (compte ${ids.MAIL_UTILISATEUR})`
      : 'ABSENTS — à remplir avant de pouvoir envoyer')
  console.log('Alertes   :', cfg.actif ? 'activées' : 'désactivées (actif: false dans alertes-mail.json)')
  console.log('Destinataires :', (cfg.destinataires || []).join(', ') || 'aucun')
}

async function envoyerTest() {
  const ids = identifiants()
  if (!ids.MAIL_UTILISATEUR || !ids.MAIL_MOTDEPASSE) {
    console.error('Remplissez d\u2019abord collecteur/.env-mail (MAIL_UTILISATEUR et MAIL_MOTDEPASSE).')
    process.exit(1)
  }
  const r = await envoyerMail({
    hote: cfg.hote, port: cfg.port,
    utilisateur: ids.MAIL_UTILISATEUR, motDePasse: ids.MAIL_MOTDEPASSE,
    de: cfg.expediteur, pour: cfg.destinataires,
    sujet: 'File ouverte : Rencontre Royale (test)',
    texte: [
      'Ceci est un test de la chaîne d\u2019alerte. Voici à quoi ressemblera un vrai message :',
      '',
      'La file virtuelle de Rencontre Royale vient de rouvrir.',
      '',
      '  Rencontre Royale — passage entre 14:00 et 19:45',
      '',
      'Ouvrez l\u2019application Disneyland Paris et réservez maintenant :',
      'ces créneaux se referment en quelques minutes.',
    ].join('\n'),
  })
  console.log('Envoyé à :', r.destinataires.join(', '))
}

try {
  if (process.argv.includes('--verifier')) await verifier()
  else await envoyerTest()
  process.exit(0)
} catch (e) {
  console.error('Échec :', e.message)
  process.exit(1)
}
