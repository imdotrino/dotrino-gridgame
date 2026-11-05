// Sistema de combate cooperativo (§10 del plan).
//
//  - Nadie invoca monstruos (dueño, 2026-11-04): aparecen solos alrededor de cada
//    jugador, tantos como lo que hostea cerca y tan fuertes como su reputación
//    (world/threat.js). Cazan a ese jugador y a lo que construyó.
//  - Dueño autoritativo del enemigo: el jugador amenazado hostea su vida, su
//    movimiento y su ataque; los golpes de los demás le llegan como mensajes hit.
//  - Desconexión del dueño → enemigo desaparece (gestionado por LocalStore al
//    promover replicated → cached; combat ignora cached).
//  - Loot subjetivo no-exclusivo: el dueño anuncia templates; cada peer
//    instancia su propia copia local.

import { makeObject } from './objects/standard.js'

const HEARTBEAT_MS = 3000
import {
  THREAT_RADIUS, DESPAWN_RADIUS, STEP_MS, ATTACK_MS, STRUCTURE_HP, PROVOKE_RADIUS, WANDER_MS, packGone, inMemoryZone,
  chebyshev, structuresNear, threatFor, spawnSpot, makePack, farFromAll, chooseTarget, mustReturn, stepToward, wanderStep
} from './world/threat.js'

/**
 * @typedef {import('./types').Pos} Pos
 * @typedef {import('./types').WorldObject} WorldObject
 * @typedef {import('./types').PlacedObject} PlacedObject
 * @typedef {import('./types').Screen} Screen
 * @typedef {import('./types').PeerTarget} PeerTarget
 * @typedef {import('./types').IsPassable} IsPassable
 * @typedef {import('./types').NetEvent} NetEvent
 * @typedef {import('./world/LocalStore.js').LocalStore} LocalStore
 * @typedef {import('./net/PeerLink.js').PeerLink} PeerLink
 */

export class CombatHost {
  /**
   * @param {object} o
   * @param {LocalStore} o.store
   * @param {PeerLink | null} [o.peerLink]
   * @param {string} o.myPubkey
   * @param {(dmg:number, by:PlacedObject) => void} o.onPlayerHit  un monstruo mío me pegó
   * @param {import('./types').Rand} [o.rand]
   */
  constructor ({ store, peerLink = null, myPubkey, onPlayerHit, rand = Math.random }) {
    if (!onPlayerHit) throw new Error('CombatHost: onPlayerHit is required')
    this.store = store
    this.rand = rand
    this.packSeq = 0
    this.myPubkey = myPubkey
    this.onPlayerHit = onPlayerHit
    this.nextSpawnAt = 0
    /** @type {(() => boolean) | null} */
    this._unsub = null
    /** @type {PeerLink | null} */
    this.peerLink = null
    this._lastForgetAt = 0
    this._lastBeatAt = 0
    this._beat = 0
    this.setPeerLink(peerLink)
  }

  /**
   * La red llega después (o nunca, sin bóveda): los monstruos existen igual.
   * @param {PeerLink | null} peerLink
   */
  setPeerLink (peerLink) {
    this._unsub?.()
    this.peerLink = peerLink
    this._unsub = peerLink?.subscribe?.(e => this._onNet(e)) || null
  }

  destroy () { this._unsub?.() }

  // ---------- presión de monstruos ----------

  /**
   * Mis monstruos (los que hosteo yo).
   * @returns {PlacedObject[]}
   */
  myMonsters () {
    const out = []
    for (const o of this.store.inRect(-Infinity, -Infinity, Infinity, Infinity)) {
      if (o.type === 'enemy' && o.creator === this.myPubkey) out.push(o)
    }
    return out
  }

  /**
   * Un paso del mundo para lo que hosteo. Se llama a menudo (cada frame vale): cada
   * monstruo lleva su propio reloj de paso y de golpe.
   * @param {number} now ms
   * @param {{x:number,y:number}} player posición del jugador (casilla)
   * @param {number} rep reputación del jugador ∈ [0,1]
   * @param {(x:number,y:number) => boolean} isPassable
   * @param {{pk:string,x:number,y:number,safe?:boolean}[]} others los demás jugadores conocidos
   * @param {boolean} playerSafe caído o recién reaparecido
   * @param {Screen | null} screen media pantalla en casillas
   */
  /**
   * (Las líneas de arriba describen los campos del segundo argumento.)
   * @param {number} now
   * @param {{ player: Pos, rep: number | null, isPassable: IsPassable, others?: PeerTarget[], playerSafe?: boolean, screen?: Screen | null }} args
   */
  tick (now, { player, rep, isPassable, others = [], playerSafe = false, screen = null }) {
    // Los grupos que salieron de pantalla (y quedaron lejos) se van, y dejan sitio: el
    // siguiente puede salir ya, sin esperar el intervalo.
    if (this._dropGonePacks([player, ...others], screen)) this.nextSpawnAt = Math.min(this.nextSpawnAt, now)
    this._forgetFarForeign(now, player, screen)
    this._heartbeat(now)
    const monsters = this.myMonsters()
    const structures = structuresNear(this.store.inRect(player.x - THREAT_RADIUS, player.y - THREAT_RADIUS, player.x + THREAT_RADIUS, player.y + THREAT_RADIUS), this.myPubkey, player)
    // rep null = todavía no se sabe qué dice la red de este jugador: no se inventa una
    // fuerza, ese turno no aparece nadie.
    if (rep != null && now >= this.nextSpawnAt) {
      const threat = threatFor({ hosted: structures.length, rep })
      this.nextSpawnAt = now + threat.intervalMs
      if (monsters.length + threat.packSize <= threat.maxAlive) {
        // Lejos de todos: el centro y cada miembro del grupo, de mí y de los demás.
        const everyone = [player, ...others]
        const center = spawnSpot(player, this.rand, (x, y) => isPassable(x, y) && farFromAll({ x, y }, everyone))
        if (center) this._spawnPack(center, threat, isPassable, everyone)
      }
    }

    for (const m of monsters) this._act(m, now, player, structures, isPassable, playerSafe, others)
  }

  /**
   * MEMORIA POR JUGADOR: los monstruos de OTROS fuera de mi zona de memoria (2× pantalla)
   * se olvidan aquí (solo en mi memoria, no para nadie más). No se pierde nada: su dueño
   * los reenvía cada HEARTBEAT_MS, así que al volver reaparecen donde estén.
   *
   * @param {number} now
   * @param {Pos} player
   * @param {Screen | null} screen
   */
  _forgetFarForeign (now, player, screen) {
    if (!screen || now - (this._lastForgetAt || 0) < 1000) return
    this._lastForgetAt = now
    for (const o of this.store.inRect(-Infinity, -Infinity, Infinity, Infinity)) {
      if (o.type !== 'enemy' || o.creator === this.myPubkey || !o.pos) continue
      if (!inMemoryZone(o.pos, player, screen)) this.store.remove(o.id)
    }
  }

  /**
   * Cada HEARTBEAT_MS reenvío mis monstruos aunque no se hayan movido. Sin esto, un
   * monstruo quieto no le llegaba a quien se conectó después, ni a quien lo olvidó por
   * alejarse. Repartido: un tercio cada vez, para no mandar todo de golpe.
   *
   * @param {number} now
   */
  _heartbeat (now) {
    if (!this.peerLink || now - (this._lastBeatAt || 0) < HEARTBEAT_MS / 3) return
    this._lastBeatAt = now
    this._beat = ((this._beat || 0) + 1) % 3
    const mine = this.myMonsters()
    for (let i = this._beat; i < mine.length; i += 3) this.peerLink.broadcastObjectState(mine[i])
  }

  /**
   * Borra (para todos) los grupos que se fueron. Devuelve si borró alguno.
   * @param {Pos[]} player todos los jugadores
   * @param {Screen | null} screen
   * @returns {boolean}
   */
  _dropGonePacks (player, screen) {
    /** @type {Map<string, PlacedObject[]>} */
    const packs = new Map()
    for (const m of this.myMonsters()) {
      const k = m.payload.pack || m.id
      let list = packs.get(k)
      if (!list) { list = []; packs.set(k, list) }
      list.push(m)
    }
    let dropped = false
    for (const members of packs.values()) {
      if (!packGone(members, player, screen)) continue
      for (const m of members) {
        this.store.remove(m.id)
        this.peerLink?.broadcastObjectGone(m.id)
      }
      dropped = true
    }
    return dropped
  }

  /**
   * Un grupo entero: comparten `pack` y una casa (`home`) de la que no se alejan tranquilos.
   * @param {Pos} center
   * @param {import('./world/threat.js').Threat} threat
   * @param {IsPassable} isPassable
   * @param {Pos[]} players
   * @returns {PlacedObject[]}
   */
  _spawnPack (center, threat, isPassable, players) {
    const pack = `${this.myPubkey.slice(-6)}:${Date.now().toString(36)}:${this.packSeq++}`
    const out = []
    for (const m of makePack(center, threat, this.rand, isPassable, players)) {
      const obj = makeObject('slime', { creator: this.myPubkey, ts: Date.now(), pos: m.pos })
      obj.payload = {
        ...obj.payload,
        hp: m.hp, max_hp: m.hp, dmg: m.dmg,
        role: m.role, aggro: m.aggro, scale: m.scale,
        pack, home: { ...m.pos }, provoked: false
      }
      this._publish(obj)
      out.push(obj)
    }
    return out
  }

  // Los objetos del almacén NO se mutan: está indexado por casilla, y cambiar `pos` en
  // el sitio dejaría el monstruo apuntado en la casilla vieja. Cada cambio es un objeto
  // nuevo con `ts` nuevo.
  /**
   * @param {PlacedObject} m
   * @param {number} now
   * @param {Pos} player
   * @param {PlacedObject[]} structures
   * @param {IsPassable} isPassable
   * @param {boolean} playerSafe
   * @param {PeerTarget[]} [others]
   */
  _act (m, now, player, structures, isPassable, playerSafe, others = []) {
    if (chebyshev(m.pos, player) > DESPAWN_RADIUS) {
      this.store.remove(m.id)
      this.peerLink?.broadcastObjectGone(m.id)
      return
    }
    const target = chooseTarget(m, player, structures, playerSafe, others)
    if (!target) {
      // Se le acabó la persecución (lejos de casa, o el jugador caído/protegido): se calma.
      const payload = { ...m.payload, provoked: false, provokedBy: null }
      if (mustReturn(m)) {
        // Fuera de su casa: vuelve andando, a paso normal.
        if (now - (m.payload.lastStepAt || 0) < STEP_MS) return
        // mustReturn ya comprobó que tiene casa.
        const next = stepToward(m.pos, /** @type {Pos} */ (m.payload.home), isPassable)
        const updated = { ...m, pos: next || m.pos, ts: Date.now(), payload: { ...payload, lastStepAt: now } }
        if (next) this._publish(updated)
        else this.store.upsert(updated, { creatorOnline: true })
        return
      }
      // En casa: se mueve a ratos sin alejarse.
      if (now - (m.payload.lastStepAt || 0) < WANDER_MS) return
      const next = wanderStep(m.pos, m.payload.home, this.rand, isPassable)
      const updated = { ...m, pos: next || m.pos, ts: Date.now(), payload: { ...payload, lastStepAt: now } }
      if (next) this._publish(updated)
      else this.store.upsert(updated, { creatorOnline: true })
      return
    }
    if (target.d <= 1) {
      if (now - (m.payload.lastAttackAt || 0) < ATTACK_MS) return
      // El reloj del golpe es solo del dueño: no hace falta publicarlo.
      this.store.upsert({ ...m, ts: Date.now(), payload: { ...m.payload, lastAttackAt: now } }, { creatorOnline: true })
      // `dmg` lo pone _spawnPack a todo monstruo.
      if (target.kind === 'player') this.onPlayerHit(/** @type {number} */ (m.payload.dmg), m)
      // A otro jugador el golpe le llega por la red; él decide (caído, protegido…).
      else if (target.kind === 'peer') this.peerLink?.sendPlayerHit(target.pk, m.id)
      else this._damageStructure(target.obj, /** @type {number} */ (m.payload.dmg))
      return
    }
    if (now - (m.payload.lastStepAt || 0) < STEP_MS) return
    const next = stepToward(m.pos, target.pos, isPassable)
    const updated = { ...m, pos: next || m.pos, ts: Date.now(), payload: { ...m.payload, lastStepAt: now } }
    // Sin camino no hay nada nuevo que contar a los demás: solo se anota el reloj.
    if (next) this._publish(updated)
    else this.store.upsert(updated, { creatorOnline: true })
  }

  /**
   * Lo que construí pierde vida; a cero, desaparece para todos.
   * @param {PlacedObject} obj
   * @param {number} dmg
   */
  _damageStructure (obj, dmg) {
    const max = obj.payload.max_hp || STRUCTURE_HP
    const hp = (obj.payload.hp ?? max) - dmg
    if (hp <= 0) {
      this.store.remove(obj.id)
      this.peerLink?.broadcastObjectGone(obj.id)
      return
    }
    this._publish({ ...obj, ts: Date.now(), payload: { ...obj.payload, hp, max_hp: max } })
  }

  /** @param {WorldObject} obj */
  _publish (obj) {
    this.store.upsert(obj, { creatorOnline: true })
    this.peerLink?.broadcastObjectState(obj)
  }

  // ---------- damage (al dueño le llega hit; ataques locales si soy yo dueño) ----------

  /**
   * `by`: pubkey de quien pegó (null = yo). Queda anotado como vínculo con él.
   * @param {string} enemyId
   * @param {number} amount
   * @param {string | null} [by]
   */
  applyHit (enemyId, amount, by = null) {
    const found = this.store.get(enemyId)
    if (!found || found.creator !== this.myPubkey) return // solo el dueño aplica
    if (found.type !== 'enemy' || !found.pos) return
    const obj = /** @type {PlacedObject} */ (found)
    const hp = (obj.payload.hp || 0) - amount
    // Pegarle enfada a él y a los de su grupo que estén cerca, aunque su ira sea 0.
    this._provokePack(obj, by)
    if (hp <= 0) {
      this._announceDeath(obj)
      this.store.remove(obj.id)
      this.peerLink?.broadcastObjectGone(obj.id)
    } else {
      // _provokePack acaba de volver a publicarlo: el vigente es el del almacén.
      const cur = /** @type {WorldObject} */ (this.store.get(obj.id))
      this._publish({ ...cur, ts: Date.now(), payload: { ...cur.payload, hp, provoked: true, ...(by ? { provokedBy: by } : {}) } })
    }
  }

  /**
   * Provoca al golpeado y a su grupo cercano; `provokedBy` dice quién (vínculo con ese jugador).
   * @param {PlacedObject} hit
   * @param {string | null} by
   */
  _provokePack (hit, by) {
    for (const m of this.myMonsters()) {
      if (m.payload.provoked && (!by || m.payload.provokedBy === by)) continue
      const same = m.id === hit.id || (hit.payload.pack && m.payload.pack === hit.payload.pack && chebyshev(m.pos, hit.pos) <= PROVOKE_RADIUS)
      if (same) this._publish({ ...m, ts: Date.now(), payload: { ...m.payload, provoked: true, ...(by ? { provokedBy: by } : {}) } })
    }
  }

  /** @param {PlacedObject} obj */
  _announceDeath (obj) {
    const loot = lootTableFor(obj)
    this.peerLink?.broadcastEnemyDied(obj.id, loot, obj.pos)
    // El propio dueño también recibe loot local (instancia su copia).
    this._instantiateLoot(loot, obj.pos)
  }

  /**
   * @param {string[]} templates
   * @param {Pos} pos
   */
  _instantiateLoot (templates, pos) {
    for (const kind of templates) {
      const item = makeObject(kind, { creator: this.myPubkey, ts: Date.now(), pos: { ...pos } })
      this.store.upsert(item, { creatorOnline: true })
    }
  }

  // ---------- net ----------

  /** @param {NetEvent} e */
  _onNet (e) {
    if (e.kind === 'hit') this.applyHit(e.enemyId, e.amount, e.by || null)
    else if (e.kind === 'enemy_died') {
      // Cualquier peer (no-dueño) instancia su propia copia local del loot.
      this._instantiateLoot(e.loot_template || [], e.pos)
    }
  }
}

/**
 * @param {WorldObject} enemy
 * @returns {string[]}
 */
function lootTableFor (enemy) {
  // Tabla muy simple por ahora. En el futuro la decide su DSL/payload.
  // El jefe y el líder sueltan más.
  const base = enemy.payload?.name === 'slime' ? ['herb', 'apple'] : ['herb']
  if (enemy.payload?.role === 'boss') return [...base, 'herb', 'apple', 'herb']
  if (enemy.payload?.role === 'leader') return [...base, 'herb']
  return base
}
