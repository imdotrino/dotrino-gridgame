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

export class PeerLink {
  constructor ({ store, identity, repOfSync, url } = {}) {
    this.store = store
    this.identity = identity
    this.repOfSync = repOfSync
    this.gating = new PeerGating({ ratePerSec: 30, burst: 60, repMin: 0 })

    this.client = getWebSocketProxyClient()
    if (url) this.client.updateConfig({ url })

    this.myToken = null           // proxy token (ephemeral)
    this.myPubkey = null          // identity publickey (stable peer id)
    this.peers = new Map()        // pubkey → { token, lastSeen }
    this.tokenToPubkey = new Map()
    // A quién no se le puede sellar ahora mismo: pubkey → { code, retryAt }. Se dice en
    // la pantalla; no se le manda nada hasta que se pueda.
    this.unreachable = new Map()
    this.viewport = { x0: -8, y0: -6, x1: 8, y1: 6 }
    this._listeners = new Set()
    this._discoveryTimer = null

    this.client.on('connect', () => this._emit({ kind: 'connected' }))
    this.client.on('disconnect', () => this._emit({ kind: 'disconnected' }))
    this.client.on('message', (from, payload, meta) => this._onMessage(from, payload, meta))
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
    await this.client.identifyAs({ publickey: myPubkey, sign: (d) => identity.signData(d) })
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

  subscribe (fn) { this._listeners.add(fn); return () => this._listeners.delete(fn) }
  _emit (e) { for (const fn of this._listeners) { try { fn(e) } catch (err) { console.error(err) } } }

  // ---------- viewport / lazy expand ----------

  setViewport ({ x0, y0, x1, y1 }) {
    this.viewport = { x0, y0, x1, y1 }
    // Por ahora no broadcasteamos subscribe explícitamente — cada peer envía
    // sus objetos a quien sabe que está en el canal. El filtrado por viewport
    // se hace al recibir (LocalStore.pruneToViewport).
  }

  // ---------- outgoing ----------

  /** Broadcast un object_state a todos los jugadores conocidos. */
  broadcastObjectState (obj) {
    this._sendToAll({ type: 'object_state', obj, ts: Date.now() })
  }

  broadcastObjectGone (id) {
    this._sendToAll({ type: 'object_gone', id, ts: Date.now() })
  }

  broadcastHit (enemyId, ownerPubkey, amount) {
    const peer = this.peers.get(ownerPubkey)
    if (!peer) return
    this._sendSealed(ownerPubkey, peer.token, { type: 'hit', enemyId, amount, ts: Date.now() })
  }

  broadcastEnemyDied (id, lootTemplates, pos) {
    this._sendToAll({ type: 'enemy_died', id, loot_template: lootTemplates, pos, ts: Date.now() })
  }

  _sendToAll (msg) {
    for (const [pubkey, peer] of this.peers) {
      if (!peer.token || peer.token === this.myToken) continue
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
   */
  _sendSealed (pubkey, token, msg) {
    const mudo = this.unreachable.get(pubkey)
    if (mudo && Date.now() < mudo.retryAt) return
    this.client.sendSealedTo(token, msg, { peerPubkey: pubkey })
      .then(() => {
        if (this.unreachable.delete(pubkey)) this._emit({ kind: 'peer-reachable', pk: pubkey })
      })
      .catch((e) => {
        const code = e?.code || 'unknown'
        const antes = this.unreachable.get(pubkey)
        this.unreachable.set(pubkey, { code, retryAt: Date.now() + RETRY_UNREACHABLE_MS })
        if (antes?.code !== code) {
          console.warn(`[gridgame] cannot seal to ${pubkey.slice(0, 24)}…: ${code}`, e)
          this._emit({ kind: 'peer-unreachable', pk: pubkey, code })
        }
      })
  }

  // ---------- incoming ----------

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
      case 'object_state':
        if (msg.obj && msg.obj.creator) {
          this.store.upsert(msg.obj, { creatorOnline: true })
        }
        break
      case 'object_gone':
        if (msg.id) this.store.remove(msg.id)
        break
      case 'hit':
        // Solo el dueño autoritativo lo procesa. Re-emit como evento local.
        this._emit({ kind: 'hit', enemyId: msg.enemyId, by: pk, amount: msg.amount })
        break
      case 'enemy_died':
        this._emit({ kind: 'enemy_died', id: msg.id, loot_template: msg.loot_template, pos: msg.pos })
        break
      case 'summon_request':
        this._emit({ kind: 'summon_request', from: pk, ts: msg.ts })
        break
    }
  }

  /**
   * Ya se sabe de quién es ese token, así que ya se le puede sellar. Lo dice el saludo
   * del transporte (`helloTo`), no un mensaje de la app: el token es cosa del proxio.
   */
  _onPeerIdentity (token, pubkey) {
    if (!pubkey || pubkey === this.myPubkey) return
    this.tokenToPubkey.set(token, pubkey)
    const p = this.peers.get(pubkey) || {}
    p.token = token
    p.lastSeen = Date.now()
    this.peers.set(pubkey, p)
    this.store.markCreatorOnline(pubkey)
    this._emit({ kind: 'peer-online', pk: pubkey })
  }

  _onPeerJoin (token) {
    // Saludamos al que entra para saber de quién es su token.
    if (token && token !== this.myToken) this.client.helloTo(token)
  }

  _onPeerGone (token) {
    const pk = this.tokenToPubkey.get(token)
    if (pk) {
      this.tokenToPubkey.delete(token)
      this.peers.delete(pk)
      this.unreachable.delete(pk)
      this.store.markCreatorOffline(pk)
      this._emit({ kind: 'peer-offline', pk })
    }
  }

  // ---------- discovery ----------

  async _discover () {
    let tokens = []
    try { tokens = await this.client.listChannel(CHANNEL) } catch (e) { return }
    for (const t of tokens) {
      if (t === this.myToken) continue
      if (this.tokenToPubkey.has(t)) continue
      this.client.helloTo(t)
    }
  }
}
