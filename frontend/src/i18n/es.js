// Espagnol d'Espagne. Clé = la phrase française telle qu'elle est écrite dans
// le code ; les {marques} et les <b>…</b> se recopient tels quels.
//
// Choix de vocabulaire, pour rester cohérent d'un écran à l'autre :
//   file virtuelle → fila virtual     créneau → franja      séance → sesión
//   rencontre → encuentro             escapade → escapada   flâner → paseo
//   ancre / rendez-vous → hora fija / cita                  attente → espera
// Premier Access, Single Rider et les noms d'attractions restent ceux de Disney.

// Les zones des deux parcs, avec l'article quand l'espagnol en veut un.
const ZONES = {
  premiere: 'World Premiere Plaza',
  frozen: 'World of Frozen',
  lac: 'el lago',
  pixar: 'Worlds of Pixar',
  toon: 'Toon Studio',
  way: 'Adventure Way',
  avengers: 'Avengers Campus',
  courtyard: 'Production Courtyard',
  fantasyland: 'Fantasyland',
  chateau: 'el castillo',
  frontierland: 'Frontierland',
  adventureland: 'Adventureland',
  discoveryland: 'Discoveryland',
  plaza: 'Central Plaza',
  mainstreet: 'Main Street',
  entree: 'la entrada',
}
const zone = (id) => ZONES[id] || id
const contracter = (s) => s.replace(/\bDe el /g, 'Del ').replace(/\ba el /g, 'al ')

export default {
  ui: {
    // ------------------------------------------------------------ App
    'Une action a été refusée par le serveur : {raison}': 'El servidor ha rechazado una acción: {raison}',
    '{n} actions ont été refusées par le serveur': 'El servidor ha rechazado {n} acciones',
    'Refusé par le serveur : {raison}': 'Rechazado por el servidor: {raison}',
    "Clé d'accès manquante": 'Falta la clave de acceso',
    "Le serveur répond, mais ce navigateur n'a pas la clé. Elle se perd quand le lien passe par une messagerie qui coupe la fin de l'adresse.":
      'El servidor responde, pero este navegador no tiene la clave. Se pierde cuando el enlace pasa por una mensajería que corta el final de la dirección.',
    'Collez la clé ici': 'Pega aquí la clave',
    'Entrer': 'Entrar',
    'Serveur injoignable et aucun plan en cache.': 'Servidor inaccesible y ningún plan guardado.',
    'Chargement…': 'Cargando…',
    'HORS LIGNE — 1 action en attente': 'SIN CONEXIÓN — 1 acción pendiente',
    'HORS LIGNE — {n} actions en attente': 'SIN CONEXIÓN — {n} acciones pendientes',
    'HORS LIGNE — affichage en cache': 'SIN CONEXIÓN — datos guardados',
    'Maintenant': 'Ahora',
    'Journée': 'Día',
    'Attentes': 'Esperas',
    'Résas': 'Reservas',
    'Réglages': 'Ajustes',

    // ------------------------------------------------------------ Plan du parc
    'Plan officiel': 'Plano oficial',
    'Schéma': 'Esquema',
    'Plan du {parc}': 'Plano de {parc}',
    '(position estimée)': '(posición aproximada)',
    'Repère non calibré sur ce plan.': 'Punto sin calibrar en este plano.',
    'ensuite : {zone}': 'después: {zone}',
    'escapade : {zone}': 'escapada: {zone}',
    'Ouvrir le plan officiel (PDF)': 'Abrir el plano oficial (PDF)',
    'Schéma du {parc}': 'Esquema de {parc}',
    'on est ici — {zone}': 'estamos aquí — {zone}',
    'on est ici': 'estamos aquí',
    'ensuite — {zone}': 'después — {zone}',
    'escapade — {zone}': 'escapada — {zone}',

    // ------------------------------------------------------------ Attentes
    "à l'instant": 'hace un momento',
    'il y a {n} min': 'hace {n} min',
    "Rien d'archivé pour cette attraction — le collecteur ne l'a pas encore vue ouverte.":
      'Nada archivado para esta atracción: el recolector todavía no la ha visto abierta.',
    'min au plus calme': 'min en el momento más tranquilo',
    'min à la pointe': 'min en la hora punta',
    '{n} relevés': '{n} lecturas',
    'Une seule journée collectée : ce sont des relevés bruts, pas encore des moyennes.':
      'Un solo día recogido: son lecturas sueltas, todavía no medias.',
    'Moyennes sur {n} journées collectées.': 'Medias de {n} días recogidos.',
    "Les heures sans barre sont celles où rien n'a été relevé.": 'Las horas sin barra son aquellas en las que no se registró nada.',
    'Jour {n}': 'Día {n}',
    "Temps d'attente injoignables.": 'Tiempos de espera no disponibles.',
    'Relevé {quand} — dernière donnée connue': 'Leído {quand} — último dato conocido',
    'Relevé {quand}': 'Leído {quand}',
    "L'historique ne s'enregistre plus.": 'El historial ya no se guarda.',
    "Le collecteur n'a jamais démarré.": 'El recolector nunca ha arrancado.',
    'Aucun relevé enregistré depuis {n} min.': 'Ninguna lectura guardada desde hace {n} min.',
    "Les chiffres ci-dessous restent à jour — c'est l'archivage qui est arrêté.":
      'Las cifras de abajo siguen actualizadas: lo que está parado es el archivo.',
    'au plan': 'en el plan',
    'EN PANNE — ça peut repartir': 'AVERIADA — puede volver a funcionar',
    'en travaux': 'en obras',
    'fermée': 'cerrada',
    'ferme à {h}': 'cierra a las {h}',
    'Single Rider : {n} min': 'Single Rider: {n} min',
    'Moyenne relevée : {n} min': 'Media registrada: {n} min',
    'Aucune attraction remontée.': 'No ha llegado ninguna atracción.',
    'Historique : {n} relevés enregistrés, dernier il y a {min} min.': 'Historial: {n} lecturas guardadas, la última hace {min} min.',
    'À lire avec des pincettes': 'Tomadlo con pinzas',
    'Attente': 'Espera',
    'Nom': 'Nombre',

    // ------------------------------------------------------------ Journée
    'décrochée de son ancre': 'sin hora fija',
    'chevauchement {n} min': 'se solapa {n} min',
    'battement {n} min': 'margen {n} min',
    'pile poil': 'justo a tiempo',
    'départ': 'salida',
    'enchaîne': 'seguido',
    'Ordre modifié': 'Orden cambiado',
    '{titre} annulé — {n} min libérées': '{titre} cancelado — {n} min liberados',
    '{titre} retiré — préviens Claude pour refaire le planning': '{titre} quitado — avisa a Claude para rehacer el plan',
    '{titre} remis au plan': '{titre} vuelve al plan',
    '{faites}/{total} faites': '{faites}/{total} hechas',
    'respiration {duree}': 'respiro {duree}',
    '{n} min (au lieu de {avant})': '{n} min (en vez de {avant})',
    '{n} séances': '{n} sesiones',
    'rendez-vous': 'cita',
    'amortisseur': 'colchón',
    'Sur place': 'Allí mismo',
    'Replier': 'Plegar',
    'La note': 'La nota',
    'Faite — annuler': 'Hecha — deshacer',
    'Marquer faite': 'Marcar hecha',
    'Annulée ?': '¿Cancelada?',
    'Retirer': 'Quitar',
    "Pourquoi c'est annulé ?": '¿Por qué se cancela?',
    'Annulées — à replanifier': 'Canceladas — por recolocar',
    '{lieu} — {n} min libérées.': '{lieu} — {n} min liberados.',
    'Finalement maintenue': 'Al final se mantiene',
    'Retirées volontairement': 'Quitadas a propósito',
    'Retirée au recalcul — {motif}': 'Quitada al recalcular — {motif}',
    'Retirée au recalcul': 'Quitada al recalcular',
    'Remettre au plan': 'Volver a ponerla en el plan',
    "Ce qu'on sacrifie, dans l'ordre": 'Lo que se sacrifica, por orden',
    "Toute activité peut être retirée du plan. Cette liste dit seulement lesquelles l'app proposera <b>en premier</b> en cas de retard : les autres suivent, dans l'ordre de la journée. Les flèches changent la priorité.":
      'Cualquier actividad se puede quitar del plan. Esta lista solo dice cuáles propondrá la app <b>primero</b> si vais con retraso: las demás siguen, en el orden del día. Las flechas cambian la prioridad.',
    'Jamais': 'Nunca',
    'Points de décision': 'Momentos de decisión',
    'Météo': 'Tiempo',
    'Fermeture ou panne': 'Cierre o avería',
    'Complet': 'Completo',
    'Pas le temps': 'No hay tiempo',

    // ------------------------------------------------------------ Maintenant : bandeau
    'Hors journée': 'Fuera del horario del día',
    'En retard de {n} min': '{n} min de retraso',
    'En retard de {n} min — ça passe': '{n} min de retraso — da tiempo',
    'En avance': 'Vais adelantados',
    'Dans les temps': 'A tiempo',
    'Rencontre commencée — sortie vers {h}': 'Encuentro empezado — salida hacia las {h}',
    'Spectacle commencé — sortie vers {h}': 'Espectáculo empezado — salida hacia las {h}',
    'Rencontre maintenant': 'Encuentro ahora',
    'Spectacle maintenant': 'Espectáculo ahora',
    'Rencontre dans {n} min': 'Encuentro dentro de {n} min',
    'Spectacle dans {n} min': 'Espectáculo dentro de {n} min',
    'démarre dans {n} min': 'empieza dentro de {n} min',
    '{n} min avant {rdv}': '{n} min antes de {rdv}',
    'restent {n} min': 'quedan {n} min',

    // ------------------------------------------------------------ Maintenant : actions
    'Retour sur {titre}': 'Vuelta a {titre}',
    '{titre} mis de côté — {n} min libérées': '{titre} aparcado — {n} min liberados',
    'Brief impossible : {erreur}': 'No se puede preparar el texto: {erreur}',
    'Créneau remis à disposition': 'Franja disponible de nuevo',
    'Escapade notée': 'Escapada anotada',
    'Toutes les étapes du jour {n} sont faites. Bravo.': 'Todas las etapas del día {n} están hechas. ¡Bravo!',
    '← Revenir en arrière': '← Volver atrás',

    // ------------------------------------------------------------ Maintenant : texte pour Claude
    'Copié dans le presse-papier — collez-le à Claude.': 'Copiado — pegádselo a Claude.',
    'Le presse-papier a refusé. Touchez le texte, tout se sélectionne, puis copiez.':
      'El portapapeles no ha funcionado. Tocad el texto, se selecciona entero, y copiadlo.',
    'Le texte pour Claude reste en français.': 'El texto para Claude se queda en francés: es como lo lee.',
    'Un mot pour Claude ? Il passera avant tout le reste.': '¿Algo que decirle a Claude? Pasará por delante de todo lo demás.',
    'Ma fille fatigue, on peut sauter le dîner. / Il pleut. / La file annonce 40 mais avance vite.':
      'La niña está cansada, podemos saltarnos la cena. / Llueve. / La fila marca 40 pero avanza rápido.',
    'Copié, avec votre commentaire': 'Copiado, con vuestro comentario',
    'Copié': 'Copiado',
    'Copiez à la main : le texte est sélectionné': 'Copiadlo a mano: el texto está seleccionado',
    'Sélectionner et copier': 'Seleccionar y copiar',
    'Fermer': 'Cerrar',

    // ------------------------------------------------------------ Maintenant : séances et plan cassé
    'Séance introuvable': 'Sesión que no existe',
    "{titre} est ancré sur <b>{h}</b>, qui n'est pas dans les horaires du jour.":
      '{titre} está fijado a las <b>{h}</b>, que no está en los horarios del día.',
    'Séances relevées : {liste}': 'Sesiones registradas: {liste}',
    'Cette étape est à replacer, et ça déplace la suite. Copiez la situation et envoyez-la-moi.':
      'Hay que recolocar esta etapa, y eso mueve lo que viene después. Copiad la situación y mandádmela.',
    'Copier la situation pour Claude': 'Copiar la situación para Claude',
    'Le plan ne tient plus': 'El plan ya no cuadra',
    '{titre} est prévu à {h}, soit <b>{n} min</b> avant la fin de ce qui le précède.':
      '{titre} está previsto a las {h}, es decir <b>{n} min</b> antes de que termine lo anterior.',
    "Il faut refaire l'ordre de la journée. Copiez la situation et envoyez-la-moi.":
      'Hay que rehacer el orden del día. Copiad la situación y mandádmela.',

    // ------------------------------------------------------------ Maintenant : étape en cours
    'Étape {n} sur {total}': 'Etapa {n} de {total}',
    'Créneau {h} — sortie {sortie}': 'Franja {h} — salida {sortie}',
    'Séance {h} — sortie {sortie}': 'Sesión {h} — salida {sortie}',
    'Sur place depuis {h}': 'Allí desde las {h}',
    'Prévu {debut} – {fin}': 'Previsto {debut} – {fin}',
    'Masquer': 'Ocultar',
    'Où est-ce ?': '¿Dónde está?',
    'Photo': 'Foto',
    'Spots photo dans le coin': 'Sitios para fotos por aquí',
    'Repérages : {source}': 'Localizaciones: {source}',

    // ------------------------------------------------------------ Maintenant : files
    "Temps d'attente affichés — fermé": 'Tiempos de espera anunciados — cerrado',
    "Temps d'attente affichés": 'Tiempos de espera anunciados',
    'EN PANNE — arrêt momentané, ça peut repartir': 'AVERIADA — parada momentánea, puede volver a funcionar',
    "pas de correspondance avec l'API": 'sin correspondencia con la API',
    "{n} min de plus que ce que l'étape prévoit": '{n} min más de lo que prevé la etapa',
    'Premier Access {prix} par personne — vous ne montez pas maintenant, vous revenez entre {debut} et {fin}':
      'Premier Access {prix} por persona — no subís ahora, volvéis entre las {debut} y las {fin}',
    'File virtuelle ouverte — passage entre {debut} et {fin}': 'Fila virtual abierta — pase entre las {debut} y las {fin}',
    'File virtuelle ouverte': 'Fila virtual abierta',
    'File virtuelle : complète pour le moment': 'Fila virtual: completa por ahora',
    "Au-delà de 90 min, le Premier Access se discute — {prix} par personne à cet instant. Les grands-parents n'ont pas besoin de monter.":
      'A partir de 90 min, el Premier Access merece la pena pensarlo — {prix} por persona ahora mismo. Los abuelos no necesitan subir.',
    "Au-delà de 90 min, le Premier Access se discute. Les grands-parents n'ont pas besoin de monter.":
      'A partir de 90 min, el Premier Access merece la pena pensarlo. Los abuelos no necesitan subir.',

    // ------------------------------------------------------------ Maintenant : retard
    '{titre} — séance à <b>{h}</b>.': '{titre} — sesión a las <b>{h}</b>.',
    "Il faut y être à {h} ({n} min d'avance).": 'Hay que estar allí a las {h} ({n} min antes).',
    "Vous y seriez avec <b>{n} min d'avance</b> au lieu de {prevu}.": 'Llegaríais con <b>{n} min de antelación</b> en vez de {prevu}.',
    'Vous arriveriez <b>{n} min après le début</b>.': 'Llegaríais <b>{n} min después del comienzo</b>.',
    'Masquer le détail': 'Ocultar el detalle',
    'Voir le détail ({n} étapes)': 'Ver el detalle ({n} etapas)',
    'attente : <b>{n}</b> prévues': 'espera: <b>{n}</b> previstos',
    'rien d’affiché sur place': 'nada anunciado allí',
    '<b>{n}</b> affichées': '<b>{n}</b> anunciados',
    "Le réel ajoute <b>{n} min</b> : il resterait <b>{reste} min d'avance</b>, pas {prevu}.":
      'La realidad añade <b>{n} min</b>: quedarían <b>{reste} min de antelación</b>, no {prevu}.',
    "Le réel ajoute <b>{n} min</b> : l'avance ne suffit plus, vous arriveriez <b>{retard} min trop tard</b>.":
      'La realidad añade <b>{n} min</b>: la antelación ya no basta, llegaríais <b>{retard} min tarde</b>.',
    '<b>{n} min de trop</b> avant {titre} ({h}).': '<b>{n} min de más</b> antes de {titre} ({h}).',
    '{titre} : <b>{n} min</b> au lieu de {duree} · départ {h}': '{titre}: <b>{n} min</b> en vez de {duree} · salida {h}',
    "<b>Il ne resterait que {n} min d'avance</b>, et il en faut {minimum} pour entrer sereinement. Ça se décide maintenant.":
      '<b>Solo quedarían {n} min de antelación</b>, y hacen falta {minimum} para entrar con calma. Hay que decidirlo ahora.',
    "Rien à faire pour l'instant : l'avance encaisse encore l'écart.": 'Nada que hacer por ahora: la antelación todavía absorbe la diferencia.',
    "Rien à faire : l'avance prévue absorbe le décalage.": 'Nada que hacer: la antelación prevista absorbe el desfase.',
    'Le temps libre absorbe tout.': 'El tiempo libre lo absorbe todo.',
    'Il manque encore <b>{n} min</b>.': 'Todavía faltan <b>{n} min</b>.',
    'Ce sont les <b>attentes affichées</b> qui font basculer, pas le plan.': 'Lo que desequilibra son las <b>esperas anunciadas</b>, no el plan.',
    'Supprimer {titre} — {n} min · suffit': 'Quitar {titre} — {n} min · basta',
    'Supprimer {titre} — {n} min': 'Quitar {titre} — {n} min',
    "Rien à supprimer d'ici là : prendre la séance suivante.": 'Nada que quitar hasta entonces: coged la sesión siguiente.',
    "Rien à supprimer d'ici là : viser un autre créneau.": 'Nada que quitar hasta entonces: buscad otra franja.',
    "Rien à supprimer d'ici là : il faudra écourter sur place.": 'Nada que quitar hasta entonces: habrá que acortar allí mismo.',

    // ------------------------------------------------------------ Maintenant : escapade
    '<b>Escapade en cours</b> — retour prévu {h}': '<b>Escapada en curso</b> — vuelta prevista a las {h}',
    "possible jusqu'à <b>{h}</b>": 'posible hasta las <b>{h}</b>',
    '<b>aucune marge</b>': '<b>ningún margen</b>',
    '{marche} min de marche, {n} min en Single Rider': '{marche} min andando, {n} min en Single Rider',
    "{marche} min de marche, {n} min d'attente": '{marche} min andando, {n} min de espera',
    'Annuler': 'Cancelar',
    'attente inconnue': 'espera desconocida',
    'RENONCER — seuil {n} min': 'RENUNCIAR — límite {n} min',
    'OK — seuil {n} min': 'OK — límite {n} min',
    'beaucoup pour le temps disponible': 'mucho para el tiempo disponible',
    'Escapade solo possible': 'Escapada en solitario posible',
    'Attente <b>{n} min</b> · {sr} en Single Rider': 'Espera <b>{n} min</b> · {sr} en Single Rider',
    'Attente <b>{n} min</b>': 'Espera <b>{n} min</b>',
    'Retour <b>{h}</b>': 'Vuelta <b>{h}</b>',
    'Créneau utilisé': 'Franja usada',
    'Détails': 'Detalles',
    'Vous ratez : {quoi}': 'Os perdéis: {quoi}',
    "Jusqu'à {h} en ratant aussi : {liste}. Au-delà, {butoir} est perdu.":
      'Hasta las {h}, perdiéndoos también: {liste}. Más tarde, {butoir} se pierde.',
    'départ {h} · déjeuner {n} min': 'salida {h} · comida {n} min',
    'déjeuner {n} min': 'comida {n} min',
    "S'il reste du temps, dans cet ordre": 'Si queda tiempo, por este orden',
    '{n} min de marche': '{n} min andando',
    'attente {n} min, {sr} en Single Rider': 'espera {n} min, {sr} en Single Rider',
    'attente {n} min': 'espera {n} min',
    'en panne': 'averiada',

    // ------------------------------------------------------------ Maintenant : bas de page
    'Terminé': 'Hecho',
    'Sauter ou annuler ?': '¿Saltar o cancelar?',
    'On la saute volontairement': 'La saltamos a propósito',
    "L'attraction reste ouverte : elle est mise de côté, pas perdue. La situation s'affichera aussitôt pour que Claude la replace ailleurs.":
      'La atracción sigue abierta: se aparca, no se pierde. La situación aparecerá enseguida para que Claude la recoloque en otro momento.',
    "Ou c'est impossible": 'O no se puede',
    "Là, c'est perdu pour la journée : inutile de chercher à la replacer.": 'En ese caso se pierde para el día: no hace falta intentar recolocarla.',
    'Finalement non': 'Al final no',
    'Ensuite : <b>{titre}</b> — {h}': 'Después: <b>{titre}</b> — {h}',

    // ------------------------------------------------------------ Réglages
    'Journal injoignable': 'Registro no disponible',
    'État à copier': 'Estado para copiar',
    'Copie refusée par le navigateur': 'El navegador no ha dejado copiar',
    "Copier l'état": 'Copiar el estado',
    'Journal de la journée': 'Registro del día',
    'Rien encore.': 'Todavía nada.',
    'Afficher le journal': 'Mostrar el registro',

    // ------------------------------------------------------------ Résas
    '{nom} : alertes activées': '{nom}: avisos activados',
    '{nom} : alertes coupées': '{nom}: avisos desactivados',
    'J{n}': 'D{n}',
    'Alertes mail : ON': 'Avisos por correo: SÍ',
    'Alertes mail : OFF': 'Avisos por correo: NO',
    '{nom} à {h} — la journée se recale': '{nom} a las {h} — el día se reajusta',
    '{nom} à {h} — noté': '{nom} a las {h} — anotado',
    'Créneau effacé': 'Franja borrada',
    'Créneau obtenu : <b>{h}</b> — la journée est calée dessus': 'Franja conseguida: <b>{h}</b> — el día está ajustado a ella',
    'Créneau obtenu : <b>{h}</b>': 'Franja conseguida: <b>{h}</b>',
    'Effacer': 'Borrar',
    'Heure du créneau obtenu': 'Hora de la franja conseguida',
    'Enregistrer': 'Guardar',
    'Les deux jours': 'Los dos días',
    'Alertes par mail': 'Avisos por correo',
    'Un mail à chaque relevé tant que la file est ouverte. Coupez celles qui ne vous intéressent pas.':
      'Un correo en cada lectura mientras la fila esté abierta. Desactivad las que no os interesen.',
    'Heure obtenue': 'Hora conseguida',
    "Quand vous décrochez un créneau, saisissez l'heure ici. Pour les rencontres du plan, la journée se recale dessus.":
      'Cuando consigáis una franja, poned aquí la hora. Para los encuentros del plan, el día se reajusta a ella.',
    'Règles des files virtuelles': 'Reglas de las filas virtuales',
  },

  // Phrases fixes fabriquées par le moteur (shared/moteur.js).
  moteur: {
    "C'est un créneau de file virtuelle : on peut en retenter un autre.": 'Es una franja de fila virtual: se puede intentar conseguir otra.',
    "C'est la DERNIÈRE séance : impossible de la décaler.": 'Es la ÚLTIMA sesión: imposible retrasarla.',
    'Séance unique : impossible de la décaler.': 'Sesión única: imposible retrasarla.',
    'On peut gagner du temps avant, mais à un moment on sera bloqué.': 'Se puede ganar tiempo antes, pero en algún momento no habrá margen.',
    'la fin de la journée': 'el final del día',
    'Marche et pause toilettes.': 'Caminar y parada para el baño.',
    'Trajet imposé par le nouvel ordre.': 'Trayecto impuesto por el nuevo orden.',
  },

  // Textes calculés : on les reconnaît à leur forme.
  motifs: [
    [/^Séance suivante à (\d{1,2})h(\d{2})\.$/, (m) => `Siguiente sesión a las ${m[1]}:${m[2]}.`],
    [/^TRANSITION : marche vers ([\w-]+)$/, (m) => `TRANSICIÓN: caminar hacia ${zone(m[1])}`],
    [/^De ([\w-]+) vers ([\w-]+)$/, (m) => contracter(`De ${zone(m[1])} a ${zone(m[2])}`)],
  ],
}
