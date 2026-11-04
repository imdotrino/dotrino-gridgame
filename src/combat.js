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
import {
  THREAT_RADIUS, DESPAWN_RADIUS, STEP_MS, ATTACK_MS, STRUCTURE_HP,
  chebyshev, structuresNear, threatFor, spawnSpot, pickTarget, stepToward
} from './world/threat.js'

export class CombatHost {
  /**
   * @param {object} o
   * @param {(dmg:number, by:object) => void} o.onPlayerHit  un monstruo mío me pegó
   */
  constructor ({ store, peerLink = null, myPubkey, onPlayerHit } = {}) {
    if (!onPlayerHit) throw new Error('CombatHost: onPlayerHit is required')
    this.store = store
    this.myPubkey = myPubkey
    this.onPlayerHit = onPlayerHit
    this.nextSpawnAt = 0
    this._unsub = null
    this.setPeerLink(peerLink)
  }

  /** La red llega después (o nunca, sin bóveda): los monstruos existen igual. */
  setPeerLink (peerLink) {
    this._unsub?.()
    this.peerLink = peerLink
    this._unsub = peerLink?.subscribe?.(e => this._onNet(e)) || null
  }

  destroy () { this._unsub?.() }

  // ---------- presión de monstruos ----------

  /** Mis monstruos (los que hosteo yo). */
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
   */
  tick (now, { player, rep, isPassable }) {
    const monsters = this.myMonsters()
    const structures = structuresNear(this.store.inRect(player.x - THREAT_RADIUS, player.y - THREAT_RADIUS, player.x + THREAT_RADIUS, player.y + THREAT_RADIUS), this.myPubkey, player)
    // rep null = todavía no se sabe qué dice la red de este jugador: no se inventa una
    // fuerza, ese turno no aparece nadie.
    if (rep != null && now >= this.nextSpawnAt) {
      const threat = threatFor({ hosted: structures.length, rep })
      this.nextSpawnAt = now + threat.intervalMs
      if (monsters.length < threat.maxAlive) {
        const spot = spawnSpot(player, Math.random, isPassable)
        if (spot) this._spawn(spot, threat)
      }
    }

    for (const m of monsters) this._act(m, now, player, structures, isPassable)
  }

  _spawn (pos, threat) {
    const obj = makeObject('slime', { creator: this.myPubkey, ts: Date.now(), pos })
    obj.payload.hp = threat.hp
    obj.payload.max_hp = threat.hp
    obj.payload.dmg = threat.dmg
    this._publish(obj)
    return obj
  }

  // Los objetos del almacén NO se mutan: está indexado por casilla, y cambiar `pos` en
  // el sitio dejaría el monstruo apuntado en la casilla vieja. Cada cambio es un objeto
  // nuevo con `ts` nuevo.
  _act (m, now, player, structures, isPassable) {
    if (chebyshev(m.pos, player) > DESPAWN_RADIUS) {
      this.store.remove(m.id)
      this.peerLink?.broadcastObjectGone(m.id)
      return
    }
    const target = pickTarget(m.pos, player, structures)
    if (target.d <= 1) {
      if (now - (m.payload.lastAttackAt || 0) < ATTACK_MS) return
      // El reloj del golpe es solo del dueño: no hace falta publicarlo.
      this.store.upsert({ ...m, ts: Date.now(), payload: { ...m.payload, lastAttackAt: now } }, { creatorOnline: true })
      if (target.kind === 'player') this.onPlayerHit(m.payload.dmg, m)
      else this._damageStructure(target.obj, m.payload.dmg)
      return
    }
    if (now - (m.payload.lastStepAt || 0) < STEP_MS) return
    const next = stepToward(m.pos, target.pos, isPassable)
    const updated = { ...m, pos: next || m.pos, ts: Date.now(), payload: { ...m.payload, lastStepAt: now } }
    // Sin camino no hay nada nuevo que contar a los demás: solo se anota el reloj.
    if (next) this._publish(updated)
    else this.store.upsert(updated, { creatorOnline: true })
  }

  /** Lo que construí pierde vida; a cero, desaparece para todos. */
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

  _publish (obj) {
    this.store.upsert(obj, { creatorOnline: true })
    this.peerLink?.broadcastObjectState(obj)
  }

  // ---------- damage (al dueño le llega hit; ataques locales si soy yo dueño) ----------

  applyHit (enemyId, amount) {
    const obj = this.store.get(enemyId)
    if (!obj || obj.creator !== this.myPubkey) return // solo el dueño aplica
    if (obj.type !== 'enemy') return
    const hp = (obj.payload.hp || 0) - amount
    if (hp <= 0) {
      this._announceDeath(obj)
      this.store.remove(obj.id)
      this.peerLink?.broadcastObjectGone(obj.id)
    } else {
      this._publish({ ...obj, ts: Date.now(), payload: { ...obj.payload, hp } })
    }
  }

  _announceDeath (obj) {
    const loot = lootTableFor(obj)
    this.peerLink?.broadcastEnemyDied(obj.id, loot, obj.pos)
    // El propio dueño también recibe loot local (instancia su copia).
    this._instantiateLoot(loot, obj.pos)
  }

  _instantiateLoot (templates, pos) {
    for (const kind of templates) {
      const item = makeObject(kind, { creator: this.myPubkey, ts: Date.now(), pos: { ...pos } })
      this.store.upsert(item, { creatorOnline: true })
    }
  }

  // ---------- net ----------

  _onNet (e) {
    if (e.kind === 'hit') this.applyHit(e.enemyId, e.amount)
    else if (e.kind === 'enemy_died') {
      // Cualquier peer (no-dueño) instancia su propia copia local del loot.
      this._instantiateLoot(e.loot_template || [], e.pos)
    }
  }
}

function lootTableFor (enemy) {
  // Tabla muy simple por ahora. En el futuro la decide su DSL/payload.
  switch (enemy.payload?.name) {
    case 'slime': return ['herb', 'apple']
    default: return ['herb']
  }
}
