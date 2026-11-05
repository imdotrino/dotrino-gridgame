// PeerLink: capa de red sobre el transporte del ecosistema (@dotrino/proxy-client).
//
// Responsabilidades:
//   - Conectarse al proxio, identificarse con la bóveda y publicarse en el canal.
//   - Descubrir otros jugadores vía listChannel y SALUDARLOS (helloTo) para saber
//     de quién es cada token.
//   - Enviar mutaciones propias SELLADAS (object_state, object_gone, hit, enemy_died).
//   - Recibir mensajes, filtrar por PeerGating, aplicar al LocalStore.
//   - Lazy expand de la región suscrita según movimiento (§7).
//
// TODO LO QUE MANDA EL JUGADOR VA SELLADO (CONVENCIONES §4.1). El proxio enruta pero
// no cifra: hasta ahora la posición de cada jugador, lo que construía y a quién pegaba
// viajaban legibles para quien opera el servidor. Ahora la app arranca el cliente con
// `requireSealed: true` —que corta en las DOS direcciones: ni manda ni acepta texto en
// claro— y sella con la llave de cifrado de la bóveda del destinatario.
//
// Lo único que sigue en claro es lo PÚBLICO por diseño: el canal `gridgame` (publish /
// list, §4.1 los exime) y el saludo del transporte, que lleva una llave pública que el
// proxio ya tiene atada a esa conexión desde `identify`.
//
// El "peerId" público es el publickey de la bóveda; el token del proxio es efímero y
// lo mapea el saludo (1:1 mientras dura la sesión).

import { getWebSocketProxyClient, identitySealing } from '@dotrino/proxy-client'
import { PeerGating } from './gating.js'

const CHANNEL = 'gridgame'
const DISCOVERY_MS = 5000

// Cada cuánto se vuelve a intentar con un jugador al que no se le pudo sellar. No es un
// repliegue: mientras tanto NO se le manda nada: es que «ahora no tengo su llave» no es
// un hecho permanente (se arregla en cuanto actualice su app), y preguntar en cada
// fotograma sería una tormenta de peticiones.
const RETRY_UNREACHABLE_MS = 30000
// INTERÉS (dueño, 2026-11-04): a un jugador se le sigue fuera de mi vista hasta que no tenga
// ningún elemento relacionado conmigo. Vínculo, cualquiera de estos:
//   - está en mi zona de visión (2× mi pantalla),
//   - un monstruo mío está en su zona (la mido con mi pantalla: la suya no la sé),
//   - un monstruo suyo está en mi zona,
//   - un monstruo mío va a por él porque le pegó (`provokedBy`).
// Sin vínculo sale de mi host: no se le manda lo mío, solo mi posición de vez en cuando,
// para que los dos notemos cuándo volvemos a estar cerca. Al volver a entrar se le manda
// todo lo mío de una vez.
const MEMORY_FACTOR = 2
const FAR_POS_EVERY_MS = 5000
const POS_STALE_MS = 15000
/**
 * @typedef {import('../types').Pos} Pos
 * @typedef {import('../types').WorldObject} WorldObject
 * @typedef {import('../types').PlacedObject} PlacedObject
 * @typedef {import('../types').Screen} Screen
 * @typedef {import('../types').PlayerPosition} PlayerPosition
 * @typedef {import('../types').OtherPlayer} OtherPlayer
 * @typedef {import('../types').WireMessage} WireMessage
 * @typedef {import('../types').NetEvent} NetEvent
 * @typedef {import('../types').RepOf} RepOf
 * @typedef {import('@dotrino/identity').Identity} Identity
 */

/**
 * @param {Pos} a
 * @param {Pos} b
 */
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

export class PeerLink {
  /**
   * @param {{ store: import('../world/LocalStore.js').LocalStore, identity?: Identity | null, repOfSync?: RepOf, url?: string }} opts
   */
  constructor ({ store, identity, repOfSync, url }) {
    this.store = store
    this.identity = identity
    this.repOfSync = repOfSync
    // 5 posiciones por segundo + el movimiento de sus monstruos (cada uno un paso cada 0,6 s,
    // hasta 24): con 30/s se cortaba a un jugador con un grupo grande.
    this.gating = new PeerGating({ ratePerSec: 80, burst: 160, repMin: 0 })
    // Dónde está cada jugador (pubkey → { x, y, facing, walking, at }). Lo usan el dibujo y
    // los monstruos: no aparecen cerca de NINGÚN jugador.
    /** @type {Map<string, PlayerPosition>} */
    this.playerPositions = new Map()
    /** @type {Pos | null} */
    this.myPos = null
    /** @type {Screen | null} */
    this.screen = null            // media pantalla en casillas { halfW, halfH }: la pone la app
    /** @type {Set<string>} */
    this.linked = new Set()       // pubkeys en mi host (con vínculo)
    /** @type {Map<string, number>} */
    this._farPosAt = new Map()    // pubkey → última vez que le mandé mi posición estando lejos

    this.client = getWebSocketProxyClient()
    if (url) this.client.updateConfig({ url })

    /** @type {string | null} */
    this.myToken = null           // proxy token (ephemeral)
    /** @type {string | null} */
    this.myPubkey = null          // identity publickey (stable peer id)
    /** @type {Map<string, { token?: string, lastSeen?: number }>} */
    this.peers = new Map()        // pubkey → { token, lastSeen }
    /** @type {Map<string, string>} */
    this.tokenToPubkey = new Map()
    // A quién no se le puede sellar ahora mismo: pubkey → { code, retryAt }. Se dice en
    // la pantalla; no se le manda nada hasta que se pueda.
    /** @type {Map<string, { code: string, retryAt: number }>} */
    this.unreachable = new Map()
    this.viewport = { x0: -8, y0: -6, x1: 8, y1: 6 }
    /** @type {Set<(e: NetEvent) => void>} */
    this._listeners = new Set()
    /** @type {ReturnType<typeof setInterval> | null} */
    this._discoveryTimer = null

    this.client.on('connect', () => this._emit({ kind: 'connected' }))
    this.client.on('disconnect', () => this._emit({ kind: 'disconnected' }))
    this.client.on('message', (from, payload, meta) => this._onMessage(from, /** @type {WireMessage | null} */ (payload), meta))
    this.client.on('peer_identity', (token, pubkey) => this._onPeerIdentity(token, pubkey))
    this.client.on('peer_disconnected', (token) => this._onPeerGone(token))
    this.client.on('channel_left', (_ch, token) => this._onPeerGone(token))
    this.client.on('channel_joined', (_ch, token) => this._onPeerJoin(token))
  }

  // ---------- lifecycle ----------

  /**
   * Arranca la red. PIDE LA BÓVEDA Y NO SE APAÑA SIN ELLA: sin identidad no hay llave de
   * cifrado con la que sellar ni con la que abrir, y jugar en claro no es una opción
   * degradada, es el fallo que esto viene a cerrar. Sin bóveda, la partida es de un
   * jugador y la pantalla lo dice.
   *
   * @param {string | null} myPubkey
   * @param {Identity | null | undefined} [identity]
   */
  async start (myPubkey, identity = this.identity) {
    if (!identity) throw Object.assign(new Error('PeerLink: no identity vault'), { code: 'no-identity' })
    if (!myPubkey) throw Object.assign(new Error('PeerLink: no publickey'), { code: 'no-identity' })
    this.identity = identity
    this.myPubkey = myPubkey

    this.client.updateConfig({
      // Ni manda ni acepta nada dirigido en claro. Sellar solo de salida no sirve: quien
      // acepta texto plano se salta el sellado entero, y quien nunca leyó nada podría
      // colar una jugada falsa.
      requireSealed: true,
      // Mi llave de cifrado. `identify` la anuncia solo, firmada, para que cualquiera que
      // sepa mi pubkey pueda sellarme sin habernos emparejado nunca.
      myEncPub: await identity.getEncryptionPubkey(),
      // La privada NO está aquí: vive dentro del iframe de la bóveda. El puente es del
      // pilar (§ «el puente de la bóveda»), no de esta app.
      sealing: identitySealing(identity, { app: 'gridgame' }),
    })

    this.myToken = await this.client.connect()
    await this.client.identifyAs({ publickey: myPubkey, sign: (/** @type {string} */ d) => identity.signData(d) })
    // El canal es PÚBLICO por diseño (es la lista de quién está jugando) y va sin datos:
    // lo que hace falta saber de cada uno lo dice el saludo, que es del transporte.
    await this.client.publish(CHANNEL)
    await this._discover()
    this._discoveryTimer = setInterval(() => this._discover(), DISCOVERY_MS)
  }

  async stop () {
    if (this._discoveryTimer) clearInterval(this._discoveryTimer)
    try { await this.client.unpublish(CHANNEL) } catch (_) {}
    try { await this.client.close() } catch (_) {}
  }

  /**
   * @param {(e: NetEvent) => void} fn
   * @returns {() => boolean} desuscribe
   */
  subscribe (fn) { this._listeners.add(fn); return () => this._listeners.delete(fn) }
  /** @param {NetEvent} e */
  _emit (e) { for (const fn of this._listeners) { try { fn(e) } catch (err) { console.error(err) } } }

  // ---------- viewport / lazy expand ----------

  /** @param {{ x0: number, y0: number, x1: number, y1: number }} rect */
  setViewport ({ x0, y0, x1, y1 }) {
    this.viewport = { x0, y0, x1, y1 }
    // Por ahora no broadcasteamos subscribe explícitamente — cada peer envía
    // sus objetos a quien sabe que está en el canal. El filtrado por viewport
    // se hace al recibir (LocalStore.pruneToViewport).
  }

  // ---------- outgoing ----------

  /**
   * Broadcast un object_state a todos los jugadores conocidos.
   * @param {WorldObject} obj
   */
  broadcastObjectState (obj) {
    this._sendToAll({ type: 'object_state', obj, ts: Date.now() })
  }

  /**
   * Dónde estoy. Va sellado como todo lo demás: la posición es del jugador. A quien está
   * en mi host, siempre; a quien no, cada FAR_POS_EVERY_MS (para notar que se acerca).
   *
   * @param {number} x
   * @param {number} y
   * @param {number} facing
   * @param {boolean} walking
   * @param {Screen | null} [screen]
   * @param {boolean} [safe]
   */
  broadcastPosition (x, y, facing, walking, screen = this.screen, safe = false) {
    this.myPos = { x, y }
    this.screen = screen
    this._refreshLinks()
    // `safe`: caído o recién reaparecido; los monstruos de los demás no van a por mí.
    /** @type {WireMessage} */
    const msg = { type: 'player_pos', x, y, facing, walking: !!walking, safe: !!safe, ts: Date.now() }
    const now = Date.now()
    for (const [pubkey, peer] of this.peers) {
      if (!peer.token || peer.token === this.myToken) continue
      if (!this.linked.has(pubkey)) {
        if (now - (this._farPosAt.get(pubkey) || 0) < FAR_POS_EVERY_MS) continue
        this._farPosAt.set(pubkey, now)
      }
      this._sendSealed(pubkey, peer.token, msg)
    }
  }

  /**
   * ¿Tiene algún elemento relacionado conmigo? (ver INTERÉS arriba). Sin saber dónde está
   * él, dónde estoy yo o cuánto mide mi pantalla, se cuenta como que sí: callarle a alguien
   * por no saberlo sería dejarlo sin ver nada.
   *
   * @param {string} pk
   * @returns {boolean}
   */
  isLinked (pk) {
    const pos = this.playerPositions.get(pk)
    if (!pos || Date.now() - pos.at > POS_STALE_MS || !this.myPos || !this.screen) return true
    const zw = this.screen.halfW * MEMORY_FACTOR
    const zh = this.screen.halfH * MEMORY_FACTOR
    /** @param {Pos} p @param {Pos} c */
    const inZone = (p, c) => Math.abs(p.x - c.x) <= zw && Math.abs(p.y - c.y) <= zh
    if (inZone(pos, this.myPos)) return true
    for (const o of this.store.inRect(-Infinity, -Infinity, Infinity, Infinity)) {
      if (o.type !== 'enemy' || !o.pos) continue
      if (o.creator === this.myPubkey && (inZone(o.pos, pos) || o.payload?.provokedBy === pk)) return true
      if (o.creator === pk && inZone(o.pos, this.myPos)) return true
    }
    return false
  }

  /** @returns {PlacedObject[]} */
  _mine () {
    return this.store.inRect(-Infinity, -Infinity, Infinity, Infinity).filter((o) => o.creator === this.myPubkey && o.pos)
  }

  /** Recalcula quién está en mi host; a quien entra se le manda todo lo mío. */
  _refreshLinks () {
    for (const [pubkey, peer] of this.peers) {
      if (!peer.token || peer.token === this.myToken) continue
      const now = this.isLinked(pubkey)
      if (now && !this.linked.has(pubkey)) {
        this.linked.add(pubkey)
        const token = peer.token
        for (const obj of this._mine()) this._sendSealed(pubkey, token, { type: 'object_state', obj, ts: Date.now() })
        this._emit({ kind: 'peer-joined-host', pk: pubkey })
      } else if (!now && this.linked.has(pubkey)) {
        this.linked.delete(pubkey)
        this._emit({ kind: 'peer-left-host', pk: pubkey })
      }
    }
  }

  /**
   * Posiciones de los demás vistas en los últimos `maxAgeMs`.
   * @param {number} [maxAgeMs]
   * @returns {OtherPlayer[]}
   */
  otherPlayers (maxAgeMs = 10000) {
    const now = Date.now()
    const out = []
    for (const [pk, p] of this.playerPositions) if (now - p.at <= maxAgeMs) out.push({ pk, ...p })
    return out
  }

  /** @param {string} id */
  broadcastObjectGone (id) {
    this._sendToAll({ type: 'object_gone', id, ts: Date.now() })
  }

  /**
   * Un monstruo mío le pega a `pk`. No va el daño: lo lee él del monstruo que ya tiene
   * (así nadie puede mandar un golpe de 1000).
   *
   * @param {string} pk
   * @param {string} enemyId
   */
  sendPlayerHit (pk, enemyId) {
    const peer = this.peers.get(pk)
    if (!peer?.token) return
    this._sendSealed(pk, peer.token, { type: 'player_hit', enemyId, ts: Date.now() })
  }

  /**
   * @param {string} enemyId
   * @param {string} ownerPubkey
   * @param {number} amount
   */
  broadcastHit (enemyId, ownerPubkey, amount) {
    const peer = this.peers.get(ownerPubkey)
    // Sin token todavía (no ha contestado el saludo) no hay a quién sellarle.
    if (!peer?.token) return
    this._sendSealed(ownerPubkey, peer.token, { type: 'hit', enemyId, amount, ts: Date.now() })
  }

  /**
   * @param {string} id
   * @param {string[]} lootTemplates
   * @param {Pos} pos
   */
  broadcastEnemyDied (id, lootTemplates, pos) {
    this._sendToAll({ type: 'enemy_died', id, loot_template: lootTemplates, pos, ts: Date.now() })
  }

  /**
   * A todos los que están en mi host (con vínculo). Los demás lo reciben al volver.
   * @param {WireMessage} msg
   */
  _sendToAll (msg) {
    for (const [pubkey, peer] of this.peers) {
      if (!peer.token || peer.token === this.myToken) continue
      if (!this.linked.has(pubkey) && !this.isLinked(pubkey)) continue
      this._sendSealed(pubkey, peer.token, msg)
    }
  }

  /**
   * UNA ENVOLTURA POR JUGADOR: cada identidad tiene su llave de cifrado, así que un solo
   * sobre solo lo abriría uno.
   *
   * Si no se puede sellar NO se manda en claro: se calla, se apunta a quién y por qué, y
   * se avisa a la pantalla. Los tres motivos son distintos y se comprueban por `code`,
   * nunca por la frase.
   *
   * @param {string} pubkey
   * @param {string} token
   * @param {WireMessage} msg
   */
  _sendSealed (pubkey, token, msg) {
    const mudo = this.unreachable.get(pubkey)
    if (mudo && Date.now() < mudo.retryAt) return
    this.client.sendSealedTo(token, msg, { peerPubkey: pubkey })
      .then(() => {
        if (this.unreachable.delete(pubkey)) this._emit({ kind: 'peer-reachable', pk: pubkey })
      })
      .catch((e) => {
        const code = /** @type {{ code?: string } | undefined} */ (e)?.code || 'unknown'
        const antes = this.unreachable.get(pubkey)
        this.unreachable.set(pubkey, { code, retryAt: Date.now() + RETRY_UNREACHABLE_MS })
        if (antes?.code !== code) {
          console.warn(`[gridgame] cannot seal to ${pubkey.slice(0, 24)}…: ${code}`, e)
          this._emit({ kind: 'peer-unreachable', pk: pubkey, code })
        }
      })
  }

  // ---------- incoming ----------

  /**
   * Lo que llega es de otra punta: cada caso comprueba lo que usa.
   * @param {string} fromToken
   * @param {WireMessage | null} payload
   * @param {{ sealed?: boolean } | undefined} meta
   */
  _onMessage (fromToken, payload, meta) {
    // El pilar es el único que abre el sobre (§4.1: dos capas abriéndolo se pisan). Aquí
    // solo se comprueba que VENÍA sellado: con `requireSealed` el texto en claro ni
    // llega, y esto es el cinturón por si alguien afloja la configuración.
    if (!meta?.sealed) {
      this._emit({ kind: 'dropped-unsealed', from: fromToken })
      return
    }
    const pk = this.tokenToPubkey.get(fromToken)
    const gate = this.gating.accept(pk || fromToken, this.repOfSync)
    if (!gate.ok) {
      this._emit({ kind: 'gated', from: pk || fromToken, reason: gate.reason })
      return
    }
    const msg = payload
    if (!msg || !msg.type) return

    switch (msg.type) {
      // Cada uno publica y borra SOLO lo suyo. Sin esto, cualquiera podía mandar un
      // objeto a nombre de otro (un monstruo «tuyo», que tu partida trataría como propio)
      // o borrarte lo que construiste.
      case 'object_state':
        if (!pk || !msg.obj || msg.obj.creator !== pk) {
          this._emit({ kind: 'rejected', from: pk || fromToken, reason: 'not-creator', id: msg.obj?.id })
          break
        }
        this.store.upsert(msg.obj, { creatorOnline: true })
        break
      case 'object_gone': {
        const prev = msg.id ? this.store.get(msg.id) : null
        if (!prev) break
        if (prev.creator !== pk) {
          this._emit({ kind: 'rejected', from: pk || fromToken, reason: 'not-creator', id: msg.id })
          break
        }
        this.store.remove(msg.id)
        break
      }
      case 'player_pos':
        // Solo de quien sabemos quién es, y con números de verdad.
        if (!pk || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) {
          this._emit({ kind: 'rejected', from: pk || fromToken, reason: 'bad-position' })
          break
        }
        this.playerPositions.set(pk, { x: msg.x, y: msg.y, facing: (msg.facing | 0) & 3, walking: !!msg.walking, safe: !!msg.safe, at: Date.now() })
        this._refreshLinks()
        break
      case 'player_hit': {
        // Solo vale si el monstruo es de quien lo manda, lo tengo, y está pegado a mí. El
        // daño sale del monstruo que tengo, no del mensaje.
        const mob = msg.enemyId ? this.store.get(msg.enemyId) : null
        if (!pk || !mob || mob.type !== 'enemy' || mob.creator !== pk || !mob.pos || !this.myPos || cheb(mob.pos, { x: Math.round(this.myPos.x), y: Math.round(this.myPos.y) }) > 2) {
          this._emit({ kind: 'rejected', from: pk || fromToken, reason: 'bad-player-hit', id: msg.enemyId })
          break
        }
        this._emit({ kind: 'player_hit', by: pk, enemyId: mob.id, dmg: Math.max(0, (mob.payload?.dmg ?? 0) | 0) })
        break
      }
      case 'hit':
        // Solo el dueño autoritativo lo procesa. Re-emit como evento local.
        this._emit({ kind: 'hit', enemyId: msg.enemyId, by: pk, amount: msg.amount })
        break
      case 'enemy_died':
        this._emit({ kind: 'enemy_died', id: msg.id, loot_template: msg.loot_template, pos: msg.pos })
        break
    }
  }

  /**
   * Ya se sabe de quién es ese token, así que ya se le puede sellar. Lo dice el saludo
   * del transporte (`helloTo`), no un mensaje de la app: el token es cosa del proxio.
   *
   * @param {string} token
   * @param {string} pubkey
   */
  _onPeerIdentity (token, pubkey) {
    if (!pubkey || pubkey === this.myPubkey) return
    this.tokenToPubkey.set(token, pubkey)
    /** @type {{ token?: string, lastSeen?: number }} */
    const p = this.peers.get(pubkey) || {}
    p.token = token
    p.lastSeen = Date.now()
    this.peers.set(pubkey, p)
    this.store.markCreatorOnline(pubkey)
    this._emit({ kind: 'peer-online', pk: pubkey })
  }

  /** @param {string} token */
  _onPeerJoin (token) {
    // Saludamos al que entra para saber de quién es su token.
    if (token && token !== this.myToken) this.client.helloTo(token)
  }

  /** @param {string} token */
  _onPeerGone (token) {
    const pk = this.tokenToPubkey.get(token)
    if (pk) {
      this.tokenToPubkey.delete(token)
      this.peers.delete(pk)
      this.playerPositions.delete(pk)
      this.linked.delete(pk)
      this._farPosAt.delete(pk)
      this.unreachable.delete(pk)
      this.store.markCreatorOffline(pk)
      this._emit({ kind: 'peer-offline', pk })
    }
  }

  // ---------- discovery ----------

  async _discover () {
    /** @type {string[]} */
    let tokens = []
    try { tokens = await this.client.listChannel(CHANNEL) } catch (e) { return }
    for (const t of tokens) {
      if (t === this.myToken) continue
      if (this.tokenToPubkey.has(t)) continue
      this.client.helloTo(t)
    }
  }
}
