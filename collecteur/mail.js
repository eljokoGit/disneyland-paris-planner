// Client SMTP minimal, sans dépendance : le collecteur doit rester autonome.
//
// Chemin vérifié sur mail.exemple.com le 1er septembre 2026 :
//   587 en clair -> EHLO -> STARTTLS -> EHLO -> AUTH LOGIN -> MAIL/RCPT/DATA
// Le port 465 est fermé et le 25 ne répond pas : 587 est la seule porte.
//
// Le SPF du domaine est en `-all` : l'envoi DOIT passer par ce serveur, sinon
// les mails partent avec une IP non autorisée et sont rejetés.

import net from 'node:net'
import tls from 'node:tls'

const DELAI = 15000

function dialogue(socket, attendus) {
  // Un serveur SMTP peut répondre sur plusieurs lignes (« 250-… » puis « 250 … ») :
  // on n'a la réponse complète que sur la ligne sans tiret.
  return new Promise((resoudre, rejeter) => {
    let buffer = ''
    const minuteur = setTimeout(() => { nettoyer(); rejeter(new Error('délai dépassé')) }, DELAI)
    const surDonnees = (d) => {
      buffer += d.toString('utf8')
      const lignes = buffer.split('\r\n').filter(Boolean)
      const derniere = lignes[lignes.length - 1] || ''
      if (!/^\d{3} /.test(derniere)) return
      nettoyer()
      const code = Number(derniere.slice(0, 3))
      if (attendus.includes(code)) resoudre({ code, texte: buffer.trim() })
      else rejeter(new Error(`SMTP ${code} : ${derniere.trim()}`))
    }
    const surErreur = (e) => { nettoyer(); rejeter(e) }
    function nettoyer() {
      clearTimeout(minuteur)
      socket.removeListener('data', surDonnees)
      socket.removeListener('error', surErreur)
    }
    socket.on('data', surDonnees)
    socket.on('error', surErreur)
  })
}

const envoyerLigne = (s, ligne) => new Promise((r, j) => s.write(ligne + '\r\n', (e) => (e ? j(e) : r())))

// Un sujet non-ASCII doit être encodé (RFC 2047), sinon il arrive en charabia.
const sujetEncode = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)

// Une ligne du corps commençant par un point terminerait le message : on la double.
const corpsProtege = (c) => c.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')

export async function envoyerMail({ hote, port = 587, utilisateur, motDePasse, de, pour, sujet, texte }) {
  if (!hote || !utilisateur || !motDePasse) throw new Error('configuration SMTP incomplète')
  const destinataires = (Array.isArray(pour) ? pour : [pour]).filter(Boolean)
  if (!destinataires.length) throw new Error('aucun destinataire')

  const brut = net.connect({ host: hote, port, timeout: DELAI })
  await new Promise((r, j) => { brut.once('connect', r); brut.once('error', j) })

  try {
    await dialogue(brut, [220])
    await envoyerLigne(brut, 'EHLO plan-disneyland')
    await dialogue(brut, [250])
    await envoyerLigne(brut, 'STARTTLS')
    await dialogue(brut, [220])

    // Certificat vérifié : c'est le serveur du parent, pas un intermédiaire.
    const s = tls.connect({ socket: brut, servername: hote })
    await new Promise((r, j) => { s.once('secureConnect', r); s.once('error', j) })

    await envoyerLigne(s, 'EHLO plan-disneyland')
    const capacites = await dialogue(s, [250])
    if (!/AUTH[ =][^\r\n]*LOGIN/i.test(capacites.texte)) throw new Error('le serveur n\u2019offre pas AUTH LOGIN')

    await envoyerLigne(s, 'AUTH LOGIN')
    await dialogue(s, [334])
    await envoyerLigne(s, Buffer.from(utilisateur, 'utf8').toString('base64'))
    await dialogue(s, [334])
    await envoyerLigne(s, Buffer.from(motDePasse, 'utf8').toString('base64'))
    await dialogue(s, [235])

    await envoyerLigne(s, `MAIL FROM:<${de}>`)
    await dialogue(s, [250])
    for (const d of destinataires) {
      await envoyerLigne(s, `RCPT TO:<${d}>`)
      await dialogue(s, [250, 251])
    }
    await envoyerLigne(s, 'DATA')
    await dialogue(s, [354])

    const entetes = [
      `From: Plan Disneyland <${de}>`,
      `To: ${destinataires.join(', ')}`,
      `Subject: ${sujetEncode(sujet)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n')
    await envoyerLigne(s, entetes + '\r\n\r\n' + corpsProtege(texte) + '\r\n.')
    await dialogue(s, [250])

    await envoyerLigne(s, 'QUIT').catch(() => {})
    s.end()
    return { ok: true, destinataires }
  } finally {
    try { brut.destroy() } catch { /* déjà fermé */ }
  }
}
