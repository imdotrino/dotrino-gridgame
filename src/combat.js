// Sistema de combate cooperativo (§10 del plan).
//
//  - Summon ponderado por reputación: peers más reputados invocan más a menudo.
//    Cada peer mantiene su propio cooldown local; cuando suelta `summon_request`
//    los peers acuerdan implícitamente quién va primero (mayor rep gana).
//  - Dueño autoritativo del enemigo: hostea HP, agrega daño vía mensajes hit.
//  - Desconexión del dueño → enemigo desaparece (gestionado por LocalStore al
//    promover replicated → cached; combat ignora cached).
//  - Loot subjetivo no-exclusivo: el dueño anuncia templates; cada peer
//    instancia su propia copia local.

import { makeObject } from './objects/standard.js'

export class CombatHost {
  constructor ({ store, peerLink, myPubkey } = {}) {
    this.store = store
    this.peerLink = peerLink
    this.myPubkey = myPubkey
    this.lastSummonAt = 0
    this._unsub = peerLink?.subscribe?.(e => this._onNet(e))
  }

  destroy () { this._unsub && this._unsub() }

  // ---------- summon ----------

  /** Cooldown ponderado por reputación. rep ∈ [0,1] → cooldown 30s..5s. */
  summonCooldownMs (rep) {
    const r = Math.max(0, Math.min(1, rep))
    return Math.round(30000 - r * 25000)
  }

  canSummon (myRep) {
    return (Date.now() - this.lastSummonAt) >= this.summonCooldownMs(myRep)
  }

  summon (kind, pos, myRep = 0) {
    if (!this.canSummon(myRep)) return null
    this.lastSummonAt = Date.now()
    const obj = makeObject(kind, { creator: this.myPubkey, ts: Date.now(), pos })
    this.store.upsert(obj, { creatorOnline: true })
    this.peerLink?.broadcastObjectState(obj)
    return obj
  }

  // ---------- damage (al dueño le llega hit; ataques locales si soy yo dueño) ----------

  applyHit (enemyId, amount) {
    const obj = this.store.get(enemyId)
    if (!obj || obj.creator !== this.myPubkey) return // solo el dueño aplica
    if (obj.type !== 'enemy') return
    const hp = (obj.payload.hp || 0) - amount
    obj.payload.hp = hp
    obj.ts = Date.now()
    if (hp <= 0) {
      this._announceDeath(obj)
      this.store.remove(obj.id)
    } else {
      this.store.upsert(obj) // re-broadcast estado
      this.peerLink?.broadcastObjectState(obj)
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
