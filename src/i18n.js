// Bilingüe es/en (CONVENCIONES §9). Español neutro / tuteo, SIN voseo.
// Lenguaje llano (§9.1): nombramos lo que el jugador ve, no la implementación
// (nada de "proxy", "peer", "pubkey" ni "store" en la pantalla).
//
// El idioma lo MANDA el <dotrino-topbar>: él persiste 'dotrino.lang' y avisa con
// el evento 'dotrino-lang'. Aquí solo reflejamos su valor; la app no tiene
// toggle propio ni clave propia.

export const LANG_KEY = 'dotrino.lang'

export function detectLang () {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'es' || saved === 'en') return saved
  } catch (_) {}
  return (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es'
}

export const messages = {
  es: {
    // Línea de estado bajo las teclas: en qué anda la partida. Antes terminaba
    // en un trozo de la llave del jugador ("pk=…"), que ni se entiende (§9.1) ni
    // se veía bien (salía el JSON en crudo). Basta con decir si hay conexión.
    status: {
      booting: 'iniciando…',
      identity: 'preparando tu perfil…',
      connecting: 'conectando…',
      online: 'en línea',
      offline: 'sin conexión',
      soloNoVault: 'partida de un jugador: sin tu perfil no se juega en red',
    },
    // Cuando a alguien no se le puede mandar nada porque no hay con qué protegerlo.
    // Se dice en vez de callarlo: si no, ese jugador parece estar y no recibe nada.
    unreachable: {
      head: (n) => (n === 1 ? 'Un jugador no recibe lo tuyo:' : `${n} jugadores no reciben lo tuyo:`),
      'no-encpub': 'su app todavía no publica con qué protegerlo.',
      'encpub-unverified': 'lo que llegó de él no cuadra con su perfil.',
      'no-encpub-support': 'el servidor por el que pasáis es antiguo.',
      'no-peer-identity': 'aún no ha dicho quién es.',
      unknown: 'no se pudo proteger el envío.',
    },
    // Recordatorio de teclas. Las letras (WASD, Q, E, F, T) son las teclas
    // físicas: no se traducen, solo lo que hace cada una.
    hint: {
      move: 'moverte',
      rock: 'poner roca',
      summon: 'invocar',
      attack: 'atacar',
      tiles: 'ver dibujos',
    },
    roster: {
      title: 'Jugadores',
      open: 'Ver su perfil',
    },
    // Tablero de dibujos: sirve para copiar la posición de un dibujo del mapa.
    picker: {
      tile: 'dibujo',
      copy: 'pulsa para copiar',
      close: 'ESC para cerrar',
    },
    // Datos de la partida dibujados sobre el mundo.
    hud: {
      pos: 'posición',
      seed: 'mundo',
      objects: 'objetos',
      own: 'tuyos',
      others: 'de otros',
      saved: 'guardados',
      total: 'total',
    },
  },
  en: {
    status: {
      booting: 'starting…',
      identity: 'setting up your profile…',
      connecting: 'connecting…',
      online: 'online',
      offline: 'offline',
      soloNoVault: 'single player: without your profile there is no online play',
    },
    unreachable: {
      head: (n) => (n === 1 ? 'One player is not getting what you do:' : `${n} players are not getting what you do:`),
      'no-encpub': 'their app does not publish what it takes to protect it yet.',
      'encpub-unverified': 'what came from them does not match their profile.',
      'no-encpub-support': 'the server you go through is an old one.',
      'no-peer-identity': 'they have not said who they are yet.',
      unknown: 'the message could not be protected.',
    },
    hint: {
      move: 'to move',
      rock: 'place rock',
      summon: 'summon',
      attack: 'attack',
      tiles: 'browse tiles',
    },
    roster: {
      title: 'Players',
      open: 'View their profile',
    },
    picker: {
      tile: 'tile',
      copy: 'click to copy',
      close: 'ESC to close',
    },
    hud: {
      pos: 'position',
      seed: 'world',
      objects: 'objects',
      own: 'yours',
      others: 'others',
      saved: 'saved',
      total: 'total',
    },
  },
}
