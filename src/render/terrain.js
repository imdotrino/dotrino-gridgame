// Autotile de rejilla doble (dual grid) para el suelo.
//
// El terreno se decide por CELDA (x, y) —es lo que usan la colisión y la velocidad—, pero
// el suelo NO se pinta por celda: se pinta con tiles desplazados medio tile, cuyas cuatro
// esquinas caen en el centro de cuatro celdas. Cada tile mira esas cuatro esquinas y
// elige su forma entre 16 (2⁴). Con eso cualquier mapa se dibuja sin cortes: islas de
// una celda, tiras de una celda y contactos en diagonal incluidos, sin pedirle nada al
// generador.
//
// Varios terrenos sin explosión de pares: van en CAPAS ordenadas. La capa más baja de las
// cuatro esquinas se pinta entera y cada capa superior se pinta encima con su forma. Cada
// terreno necesita UN juego de 16, no uno por cada vecino posible.
//
// Atlas `terrain.png`: tiles de 16 px sin margen. Fila = capa (orden de LAYERS). Columna =
// máscara 0..15; columnas 16 y 17 son variantes del tile lleno (máscara 15) para que el
// suelo no se vea repetido.
//
// Bits de la máscara: 1 = NO (noroeste), 2 = NE, 4 = SO, 8 = SE.

/** @type {import('../types').GroundType[]} */
export const LAYERS = ['water', 'sand', 'grass', 'dirt', 'stone']
export const TILE_PX = 16
export const FULL = 15
export const FULL_VARIANTS = [15, 16, 17]

/** @type {Record<string, number>} */
const LAYER_INDEX = Object.fromEntries(LAYERS.map((t, i) => [t, i]))

/**
 * @param {string} type
 * @returns {number}
 */
export function layerOf (type) {
  const i = LAYER_INDEX[type]
  if (i === undefined) throw new Error(`terrain: unknown ground type "${type}"`)
  return i
}

/**
 * Lo que hay que pintar en un tile de la rejilla doble, de abajo arriba.
 * @param {number[]} c capas de las esquinas [NO, NE, SO, SE]
 * @returns {{layer:number, mask:number}[]}
 */
export function quadLayers (c) {
  const lo = Math.min(c[0], c[1], c[2], c[3])
  const hi = Math.max(c[0], c[1], c[2], c[3])
  const out = [{ layer: lo, mask: FULL }]
  for (let l = lo + 1; l <= hi; l++) {
    const mask = (c[0] >= l ? 1 : 0) | (c[1] >= l ? 2 : 0) | (c[2] >= l ? 4 : 0) | (c[3] >= l ? 8 : 0)
    if (mask) out.push({ layer: l, mask })
  }
  return out
}

/**
 * Variante determinista del tile lleno: la misma celda se ve igual en todos los peers.
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function fullVariant (x, y) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul((y | 0) ^ 0x165667b1, 0xc2b2ae35)
  h ^= h >>> 15
  h = h >>> 0
  // La variante 15 es la principal; las otras salen 1 de cada 4 veces.
  const r = h % 8
  return r < 6 ? 15 : (r === 6 ? 16 : 17)
}

export class TerrainAtlas {
  /** @param {string} [src] */
  constructor (src = 'terrain.png') {
    this.img = new Image()
    this.ready = false
    this.failed = false
    this.img.onload = () => { this.ready = true }
    this.img.onerror = () => {
      this.failed = true
      console.error(`[gridgame] terrain atlas failed to load: ${src}`)
    }
    this.img.src = src
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} layer
   * @param {number} col
   * @param {number} dx
   * @param {number} dy
   * @param {number} size
   */
  draw (ctx, layer, col, dx, dy, size) {
    ctx.drawImage(this.img, col * TILE_PX, layer * TILE_PX, TILE_PX, TILE_PX, dx, dy, size, size)
  }
}
