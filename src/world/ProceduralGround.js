// Determinista: tile_base(x, y) idéntico en todos los peers dada la misma seed.
// Hash entero 32-bit estilo xorshift para evitar deps.

/** @typedef {import('../types').GroundType} GroundType */

/** @type {GroundType[]} */
const TILE_TYPES = ['grass', 'dirt', 'stone', 'water', 'sand']

/**
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number}
 */
function hash32 (x, y, seed) {
  let h = (seed | 0) ^ 0x9E3779B9
  h = Math.imul(h ^ (x | 0), 0x85EBCA6B)
  h = Math.imul(h ^ (y | 0), 0xC2B2AE35)
  h ^= h >>> 13
  h = Math.imul(h, 0x5BD1E995)
  h ^= h >>> 15
  return h >>> 0
}

// Ruido de valor por octavas (fBm): manchas grandes y orgánicas en vez de confeti.
// El dibujo no le pide nada al generador: el autotile de rejilla doble
// (render/terrain.js) pinta sin cortes cualquier combinación de vecinos.
/**
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number}
 */
function valueNoise (x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = hash32(x0, y0, seed), b = hash32(x0 + 1, y0, seed)
  const c = hash32(x0, y0 + 1, seed), d = hash32(x0 + 1, y0 + 1, seed)
  const top = a + (b - a) * u, bot = c + (d - c) * u
  return (top + (bot - top) * v) / 0xFFFFFFFF
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @param {number} [base]
 * @returns {number}
 */
function fbm (x, y, seed, base = 24) {
  let sum = 0, amp = 0.5, norm = 0, scale = 1 / base
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * scale, y * scale, seed + o * 1013)
    norm += amp
    amp *= 0.5
    scale *= 2
  }
  return sum / norm
}

export class ProceduralGround {
  /** @param {number} [seed] */
  constructor (seed = 0xC10C3E) {
    this.seed = seed | 0
  }

  // Bioma por dos campos: ALTURA (agua → playa → tierras → colinas → roca) y
  // HUMEDAD (en las tierras medias decide entre desierto, tierra seca y pradera).
  /**
   * @param {number} x
   * @param {number} y
   * @returns {import('../types').GroundTile}
   */
  tileAt (x, y) {
    const n = fbm(x, y, this.seed)
    const m = fbm(x, y, this.seed ^ 0x5bd1e995, 48)
    /** @type {GroundType} */
    let type
    if (n < 0.33) type = 'water'
    else if (n < 0.37) type = 'sand'
    else if (n > 0.70) type = 'stone'
    else if (n > 0.63) type = 'dirt'
    else if (m < 0.38) type = 'sand'
    else if (m < 0.44) type = 'dirt'
    else type = 'grass'
    return { type, n, m }
  }

  /**
   * @param {string} type
   * @returns {string}
   */
  static colorFor (type) {
    switch (type) {
      case 'water': return '#2a6fdb'
      case 'sand': return '#d9c878'
      case 'grass': return '#3aa252'
      case 'dirt': return '#7a5a3a'
      case 'stone': return '#888888'
      default: return '#ff00ff'
    }
  }

  /** @returns {GroundType[]} */
  static get TYPES () { return TILE_TYPES.slice() }

  // Velocidad relativa por tipo de ground. 0 = intransitable, 1 = normal.
  /**
   * @param {string} type
   * @returns {number}
   */
  static speedFor (type) {
    switch (type) {
      case 'water': return 0
      case 'sand': return 0.5
      case 'grass': return 1
      case 'dirt': return 0.9
      case 'stone': return 0.7
      default: return 1
    }
  }

  /**
   * @param {string} type
   * @returns {boolean}
   */
  static isPassable (type) { return ProceduralGround.speedFor(type) > 0 }

  // Props/items procedurales determinísticos por (x,y,seed). No se replican:
  // cada peer los genera igual. Una segunda capa de hash decide qué hay.
  // Densidad baja para no saturar.
  /**
   * @param {number} x
   * @param {number} y
   * @returns {import('../types').ProceduralObject | null}
   */
  proceduralObjectAt (x, y) {
    const t = this.tileAt(x, y).type
    const h = hash32(x * 17 + 1, y * 31 - 3, this.seed) / 0xFFFFFFFF
    const h2 = hash32(x * 131 - 7, y * 73 + 11, this.seed) / 0xFFFFFFFF
    if (t === 'grass') {
      if (h < 0.04) return { kind: 'tree_green', solid: true }
      if (h < 0.055) return { kind: 'tree_orange', solid: true }
      if (h < 0.075) return { kind: 'pine_green', solid: true }
      if (h < 0.105) return { kind: 'bush_green', solid: true }
      if (h < 0.145) return { kind: 'flowers_white', solid: false }
      if (h < 0.175) return { kind: 'flowers_blue', solid: false }
      if (h < 0.195) return { kind: 'flowers_orange', solid: false }
      if (h < 0.205) return { kind: 'mushroom_brown', solid: false }
      if (h2 < 0.05) return { kind: 'herb', solid: false }
      if (h2 < 0.07) return { kind: 'apple', solid: false }
    }
    if (t === 'dirt') {
      if (h < 0.06) return { kind: 'rock_pile_brown', solid: true }
      if (h < 0.09) return { kind: 'bush_small', solid: true }
      if (h < 0.11) return { kind: 'tree_dead', solid: true }
    }
    if (t === 'sand') {
      if (h < 0.04) return { kind: 'cactus', solid: true }
      if (h < 0.06) return { kind: 'rock_pile_brown', solid: true }
    }
    if (t === 'stone') {
      if (h < 0.10) return { kind: 'rock_pile_gray', solid: true }
      if (h < 0.14) return { kind: 'rock_green', solid: true }
      if (h < 0.25) return { kind: 'rock', solid: true }
    }
    return null
  }
}
