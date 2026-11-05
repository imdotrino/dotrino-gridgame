// Sprite del jugador: `player.png`, 48×64, frames de 16 px.
// Fila = hacia dónde mira (0 abajo, 1 izquierda, 2 derecha, 3 arriba).
// Columna = 0 de pie, 1 paso A, 2 paso B. Al andar: de pie → A → de pie → B.

const FRAME = 16
const STEP_MS = 140
const CYCLE = [0, 1, 0, 2]

/**
 * Cara según el movimiento; manda el eje con más desplazamiento. Quieto, se queda la que había.
 * @param {number} dx
 * @param {number} dy
 * @param {number} [current]
 * @returns {number} fila del sprite
 */
export function facingFor (dx, dy, current = 0) {
  if (!dx && !dy) return current
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 2
  return dy < 0 ? 3 : 0
}

/**
 * @param {number} nowMs
 * @returns {number} columna del sprite
 */
export function walkFrame (nowMs) {
  return CYCLE[Math.floor(nowMs / STEP_MS) % CYCLE.length]
}

export class PlayerSprite {
  /** @param {string} [src] */
  constructor (src = 'player.png') {
    this.img = new Image()
    this.ready = false
    this.img.onload = () => { this.ready = true }
    this.img.onerror = () => console.error(`[gridgame] player sprite failed to load: ${src}`)
    this.img.src = src
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} row
   * @param {number} col
   * @param {number} dx
   * @param {number} dy
   * @param {number} size
   */
  draw (ctx, row, col, dx, dy, size) {
    ctx.drawImage(this.img, col * FRAME, row * FRAME, FRAME, FRAME, dx, dy, size, size)
  }
}
