// Anti-griefing (§13 del plan).
//
//  - Rate-limit token-bucket por peer, independiente de reputación.
//  - Mute manual local.
//  - Filtro por rep_min: por debajo del threshold, no aceptar objetos del peer.

export class PeerGating {
  constructor ({ ratePerSec = 30, burst = 60, repMin = 0 } = {}) {
    this.ratePerSec = ratePerSec
    this.burst = burst
    this.repMin = repMin
    this._buckets = new Map() // pk → { tokens, lastTs }
    this._muted = new Set()
  }

  mute (pk) { this._muted.add(pk) }
  unmute (pk) { this._muted.delete(pk) }
  isMuted (pk) { return this._muted.has(pk) }

  setRepMin (v) { this.repMin = v }

  /**
   * Decide si aceptar un mensaje entrante. `repOfSync(pk)` debe ser barato.
   * Devuelve { ok:bool, reason }.
   */
  accept (pk, repOfSync) {
    if (!pk) return { ok: false, reason: 'no-peer' }
    if (this._muted.has(pk)) return { ok: false, reason: 'muted' }
    const rep = repOfSync ? repOfSync(pk) : 0
    if (rep < this.repMin) return { ok: false, reason: 'rep-below-min' }
    if (!this._consumeToken(pk)) return { ok: false, reason: 'rate-limited' }
    return { ok: true }
  }

  _consumeToken (pk) {
    const now = Date.now()
    let b = this._buckets.get(pk)
    if (!b) { b = { tokens: this.burst, lastTs: now }; this._buckets.set(pk, b) }
    const dt = (now - b.lastTs) / 1000
    b.tokens = Math.min(this.burst, b.tokens + dt * this.ratePerSec)
    b.lastTs = now
    if (b.tokens < 1) return false
    b.tokens -= 1
    return true
  }
}
