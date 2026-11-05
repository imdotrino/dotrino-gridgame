// Sprites de los actores del mundo: `actors.png`, 48×32, frames de 16 px.
// Fila = quién (ACTOR_ROWS), columna = frame de reposo: 0 quieto, 1 y 2 las dos
// variaciones. Se reproduce 0 → 1 → 0 → 2.

const FRAME = 16
const STEP_MS = 180
const CYCLE = [0, 1, 0, 2]

/** Fila del sheet por `payload.name` del objeto (ver objects/standard.js). */
/** @type {Record<string, number>} */
export const ACTOR_ROWS = { slime: 0, merchant: 1 }

/**
 * Fila del sprite de un actor, o null si no tiene sprite.
 * @param {import('../types').WorldObject | null | undefined} obj
 * @returns {number | null}
 */
export function actorRow (obj) {
  const name = obj?.payload?.name
  const row = name === undefined ? undefined : ACTOR_ROWS[name]
  return row === undefined ? null : row
}

/**
 * Frame de reposo. `phase` desfasa a cada actor para que no laten todos a la vez.
 * @param {number} nowMs
 * @param {number} [phase]
 * @returns {number}
 */
export function idleFrame (nowMs, phase = 0) {
  return CYCLE[Math.floor((nowMs + phase) / STEP_MS) % CYCLE.length]
}

/**
 * Desfase estable por id: el mismo actor late igual en cada frame.
 * @param {string} [id]
 * @returns {number}
 */
export function phaseOf (id = '') {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return (h >>> 0) % (STEP_MS * CYCLE.length)
}

export class ActorSheet {
  /** @param {string} [src] */
  constructor (src = 'actors.png') {
    this.img = new Image()
    this.ready = false
    this.img.onload = () => { this.ready = true }
    this.img.onerror = () => console.error(`[gridgame] actor sheet failed to load: ${src}`)
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
