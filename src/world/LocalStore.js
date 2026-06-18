// LocalStore: estado del mundo según este peer.
//
// Tres buckets (§Arquitectura del plan):
//   - owned       → objetos creados por mí, mutables, autoritativos.
//   - replicated  → objetos cuyo creador está online y me los está enviando.
//   - cached      → remanentes RO: creador offline pero alguien los tiene
//                   cacheados en su viewport. Lo que nadie observa, desaparece.
//
// Diseño subjetivo: no hay verdad global. Cada peer tiene su LocalStore.
// El render decide qué mostrar usando reputación + recencia sobre los datos
// crudos que aquí guardamos.
//
// La cache está acotada al viewport + ring de precarga (§14). Al alejarse, los
// remanentes salen de memoria automáticamente vía prune().

const BUCKETS = ['owned', 'replicated', 'cached']

function tileKey (x, y) { return `${x | 0},${y | 0}` }

export class LocalStore {
  constructor ({ myPeerId } = {}) {
    this.myPeerId = myPeerId || null
    // id → { object, bucket }
    this._byId = new Map()
    // tileKey → Set<id>     (solo objetos posicionados; items en inventario tienen pos=null)
    this._byTile = new Map()
    // peerId → Set<id>      (índice por creador, para promover/quitar al cambiar estado)
    this._byCreator = new Map()
    this._listeners = new Set()
  }

  // ---------- subscriptions ----------

  subscribe (fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  _emit (event) {
    for (const fn of this._listeners) {
      try { fn(event) } catch (e) { console.error(e) }
    }
  }

  // ---------- core CRUD ----------

  /**
   * Inserta o actualiza un objeto. El bucket se infiere de `creator` y
   * `creatorOnline`. Si el objeto ya existe y el nuevo `ts` es menor, se ignora
   * (last-write-wins por timestamp del creador).
   *
   * obj: { id, type, creator, ts, pos:{x,y}|null, parent?, dsl?, payload? }
   */
  upsert (obj, { creatorOnline = true } = {}) {
    if (!obj || !obj.id || !obj.creator) return false
    const prev = this._byId.get(obj.id)
    if (prev && (obj.ts || 0) < (prev.object.ts || 0)) return false

    const bucket = this._bucketFor(obj.creator, creatorOnline)
    if (prev) this._unindex(prev.object)
    this._byId.set(obj.id, { object: obj, bucket })
    this._index(obj)
    this._emit({ kind: prev ? 'update' : 'add', id: obj.id, bucket })
    return true
  }

  remove (id) {
    const entry = this._byId.get(id)
    if (!entry) return false
    this._unindex(entry.object)
    this._byId.delete(id)
    this._emit({ kind: 'remove', id })
    return true
  }

  get (id) { return this._byId.get(id)?.object || null }

  bucketOf (id) { return this._byId.get(id)?.bucket || null }

  // ---------- queries ----------

  /** Todos los objetos en una casilla (sin orden definido). */
  atTile (x, y) {
    const ids = this._byTile.get(tileKey(x, y))
    if (!ids) return []
    const out = []
    for (const id of ids) {
      const e = this._byId.get(id)
      if (e) out.push(e.object)
    }
    return out
  }

  /** Objetos dentro de un rect [x0,y0,x1,y1] inclusive. */
  inRect (x0, y0, x1, y1) {
    const out = []
    for (const { object } of this._byId.values()) {
      if (!object.pos) continue
      const { x, y } = object.pos
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push(object)
    }
    return out
  }

  /** Items sostenidos por un personaje (parent === characterId, pos === null). */
  childrenOf (characterId) {
    const out = []
    for (const { object } of this._byId.values()) {
      if (object.parent === characterId) out.push(object)
    }
    return out
  }

  // ---------- bucket transitions ----------

  /**
   * Llamar cuando un peer se desconecta: sus objetos replicated bajan a cached
   * (read-only). Si vuelve online, llamar markCreatorOnline para promoverlos
   * de nuevo a replicated.
   */
  markCreatorOffline (peerId) {
    const ids = this._byCreator.get(peerId)
    if (!ids) return 0
    let n = 0
    for (const id of ids) {
      const entry = this._byId.get(id)
      if (entry && entry.bucket === 'replicated') {
        entry.bucket = 'cached'
        n++
      }
    }
    if (n) this._emit({ kind: 'bucket-change', peerId, to: 'cached', count: n })
    return n
  }

  markCreatorOnline (peerId) {
    const ids = this._byCreator.get(peerId)
    if (!ids) return 0
    let n = 0
    for (const id of ids) {
      const entry = this._byId.get(id)
      if (entry && entry.bucket === 'cached') {
        entry.bucket = 'replicated'
        n++
      }
    }
    if (n) this._emit({ kind: 'bucket-change', peerId, to: 'replicated', count: n })
    return n
  }

  // ---------- viewport pruning ----------

  /**
   * Descarta objetos `cached` y `replicated` fuera del rect activo
   * (viewport + ring). NUNCA descarta `owned`: el creador soy yo, sigo siendo
   * fuente. El ring define el margen de tolerancia antes de descartar.
   */
  pruneToViewport (x0, y0, x1, y1) {
    const toRemove = []
    for (const [id, { object, bucket }] of this._byId) {
      if (bucket === 'owned') continue
      if (!object.pos) continue // items en inventario: no se prunean por viewport
      const { x, y } = object.pos
      if (x < x0 || x > x1 || y < y0 || y > y1) toRemove.push(id)
    }
    for (const id of toRemove) this.remove(id)
    return toRemove.length
  }

  // ---------- stats / debug ----------

  size (bucket) {
    if (!bucket) return this._byId.size
    let n = 0
    for (const e of this._byId.values()) if (e.bucket === bucket) n++
    return n
  }

  stats () {
    const out = { total: this._byId.size }
    for (const b of BUCKETS) out[b] = 0
    for (const e of this._byId.values()) out[e.bucket]++
    return out
  }

  // ---------- internals ----------

  _bucketFor (creator, creatorOnline) {
    if (this.myPeerId && creator === this.myPeerId) return 'owned'
    return creatorOnline ? 'replicated' : 'cached'
  }

  _index (obj) {
    if (obj.pos) {
      const k = tileKey(obj.pos.x, obj.pos.y)
      let set = this._byTile.get(k)
      if (!set) { set = new Set(); this._byTile.set(k, set) }
      set.add(obj.id)
    }
    let cset = this._byCreator.get(obj.creator)
    if (!cset) { cset = new Set(); this._byCreator.set(obj.creator, cset) }
    cset.add(obj.id)
  }

  _unindex (obj) {
    if (obj.pos) {
      const k = tileKey(obj.pos.x, obj.pos.y)
      const set = this._byTile.get(k)
      if (set) {
        set.delete(obj.id)
        if (set.size === 0) this._byTile.delete(k)
      }
    }
    const cset = this._byCreator.get(obj.creator)
    if (cset) {
      cset.delete(obj.id)
      if (cset.size === 0) this._byCreator.delete(obj.creator)
    }
  }
}
