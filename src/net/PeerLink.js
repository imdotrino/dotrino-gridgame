// PeerLink: capa de red sobre simple-websocket-proxy.
//
// Responsabilidades:
//   - Conectarse al proxy y publicarse en el canal "gridgame".
//   - Descubrir otros peers vía listChannel.
//   - Enviar mutaciones propias (object_state, object_gone, hit, enemy_died).
//   - Recibir mensajes, filtrar por PeerGating, aplicar al LocalStore.
//   - Lazy expand de la región suscrita según movimiento (§7).
//
// El "peerId" público es el publickey de dotrino-identity; el token del
// proxy es efímero y se mapea internamente (1:1 mientras dura la sesión).

import { getWebSocketProxyClient } from '@dotrino/proxy-client'
import { PeerGating } from './gating.js'

const CHANNEL = 'gridgame'
const DISCOVERY_MS = 5000

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
    this.viewport = { x0: -8, y0: -6, x1: 8, y1: 6 }
    this._listeners = new Set()
    this._discoveryTimer = null

    this.client.on('connect', () => this._emit({ kind: 'connected' }))
    this.client.on('disconnect', () => this._emit({ kind: 'disconnected' }))
    this.client.on('message', (from, payload) => this._onMessage(from, payload))
    this.client.on('peer_disconnected', (token) => this._onPeerGone(token))
    this.client.on('channel_left', (_ch, token) => this._onPeerGone(token))
    this.client.on('channel_joined', (_ch, token) => this._onPeerJoin(token))
  }

  // ---------- lifecycle ----------

  async start (myPubkey) {
    this.myPubkey = myPubkey
    this.myToken = await this.client.connect()
    await this.client.publish(CHANNEL, { pk: myPubkey || null })
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

  /** Broadcast un object_state a todos los peers conocidos. */
  broadcastObjectState (obj) {
    const msg = { type: 'object_state', obj, ts: Date.now() }
    this._sendToAll(msg)
  }

  broadcastObjectGone (id) {
    this._sendToAll({ type: 'object_gone', id, ts: Date.now() })
  }

  broadcastHit (enemyId, ownerPubkey, amount) {
    const peer = this.peers.get(ownerPubkey)
    if (!peer) return
    this.client.send(peer.token, { type: 'hit', enemyId, amount, ts: Date.now() })
  }

  broadcastEnemyDied (id, lootTemplates, pos) {
    this._sendToAll({ type: 'enemy_died', id, loot_template: lootTemplates, pos, ts: Date.now() })
  }

  _sendToAll (msg) {
    const tokens = [...this.peers.values()].map(p => p.token).filter(t => t && t !== this.myToken)
    if (tokens.length === 0) return
    this.client.send(tokens, msg)
  }

  // ---------- incoming ----------

  _onMessage (fromToken, payload) {
    const pk = this.tokenToPubkey.get(fromToken)
    const gate = this.gating.accept(pk || fromToken, this.repOfSync)
    if (!gate.ok) {
      this._emit({ kind: 'gated', from: pk || fromToken, reason: gate.reason })
      return
    }
    let msg
    try { msg = typeof payload === 'string' ? JSON.parse(payload) : payload } catch { return }
    if (!msg || !msg.type) return

    switch (msg.type) {
      case 'hello':
        // Mapea token → pubkey si lo trae.
        if (msg.pk) {
          this.tokenToPubkey.set(fromToken, msg.pk)
          const p = this.peers.get(msg.pk) || {}
          p.token = fromToken; p.lastSeen = Date.now()
          this.peers.set(msg.pk, p)
          this.store.markCreatorOnline(msg.pk)
        }
        break
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

  _onPeerJoin (token) {
    // Saludamos para intercambiar pubkey.
    this.client.send(token, { type: 'hello', pk: this.myPubkey, ts: Date.now() })
  }

  _onPeerGone (token) {
    const pk = this.tokenToPubkey.get(token)
    if (pk) {
      this.tokenToPubkey.delete(token)
      this.peers.delete(pk)
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
      if (![...this.peers.values()].some(p => p.token === t)) {
        // saludo inicial: pediremos pk vía hello
        this.client.send(t, { type: 'hello', pk: this.myPubkey, ts: Date.now() })
      }
    }
  }
}
