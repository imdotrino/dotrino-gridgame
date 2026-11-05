// Vida del jugador: golpes, muerte, espera de 10 s, reaparición con protección.
// Puro (el reloj entra por parámetro): lo prueban los tests y lo usa App.vue.
//
//   vivo ──(vida 0)──▶ muerto (RESPAWN_MS, quieto, nadie le pega)
//        ◀─(reaparece con la vida llena)── protegido (PROTECT_MS, los monstruos lo ignoran)

export const MAX_HP = 20
export const RESPAWN_MS = 10_000
export const PROTECT_MS = 5_000
const REGEN_AFTER_MS = 5000
const REGEN_EVERY_MS = 2000

export class PlayerLife {
  constructor () {
    this.hp = MAX_HP
    this.deadUntil = 0      // > now: muerto, esperando
    this.protectedUntil = 0 // > now: recién reaparecido, nadie le pega
    this.lastHurtAt = -Infinity
    this.lastRegenAt = -Infinity
  }

  /** @param {number} now @returns {boolean} */
  isDead (now) { return now < this.deadUntil }
  /** @param {number} now @returns {boolean} */
  isProtected (now) { return !this.isDead(now) && now < this.protectedUntil }
  /**
   * Muerto o protegido: los monstruos no lo eligen y sus golpes no cuentan.
   * @param {number} now
   * @returns {boolean}
   */
  isSafe (now) { return now < this.deadUntil || now < this.protectedUntil }

  /**
   * Recibe un golpe. Devuelve 'died' si este golpe lo mata.
   * @param {number} dmg
   * @param {number} now
   * @returns {'ignored' | 'hurt' | 'died'}
   */
  hit (dmg, now) {
    if (this.isSafe(now)) return 'ignored'
    this.hp = Math.max(0, this.hp - dmg)
    this.lastHurtAt = now
    if (this.hp > 0) return 'hurt'
    this.deadUntil = now + RESPAWN_MS
    this.protectedUntil = this.deadUntil + PROTECT_MS
    return 'died'
  }

  /**
   * Avanza el reloj. Devuelve 'respawned' el frame en que termina la espera.
   * @param {number} now
   * @returns {'respawned' | null}
   */
  update (now) {
    if (this.hp === 0 && !this.isDead(now)) {
      this.hp = MAX_HP
      return 'respawned'
    }
    if (this.hp > 0 && this.hp < MAX_HP && now - this.lastHurtAt >= REGEN_AFTER_MS && now - this.lastRegenAt >= REGEN_EVERY_MS) {
      this.lastRegenAt = now
      this.hp += 1
    }
    return null
  }

  /**
   * Segundos que faltan (para el contador), redondeados hacia arriba; 0 si no aplica.
   * @param {number} now
   * @returns {number}
   */
  secondsToRespawn (now) { return this.isDead(now) ? Math.ceil((this.deadUntil - now) / 1000) : 0 }
  /** @param {number} now @returns {number} */
  secondsProtected (now) { return this.isProtected(now) ? Math.ceil((this.protectedUntil - now) / 1000) : 0 }
}
