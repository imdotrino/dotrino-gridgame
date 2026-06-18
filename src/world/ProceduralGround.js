// Determinista: tile_base(x, y) idéntico en todos los peers dada la misma seed.
// Hash entero 32-bit estilo xorshift para evitar deps.

const TILE_TYPES = ['grass', 'dirt', 'stone', 'water', 'sand']

function hash32 (x, y, seed) {
  let h = (seed | 0) ^ 0x9E3779B9
  h = Math.imul(h ^ (x | 0), 0x85EBCA6B)
  h = Math.imul(h ^ (y | 0), 0xC2B2AE35)
  h ^= h >>> 13
  h = Math.imul(h, 0x5BD1E995)
  h ^= h >>> 15
  return h >>> 0
}

// Smooth noise: media de hash en celda + vecinos para evitar caos puro.
function smooth (x, y, seed) {
  let s = 0
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      s += hash32(x + dx, y + dy, seed)
    }
  }
  return (s / 9) / 0xFFFFFFFF
}

export class ProceduralGround {
  constructor (seed = 0xC10C3E) {
    this.seed = seed | 0
  }

  tileAt (x, y) {
    const n = smooth(x, y, this.seed)
    let type
    if (n < 0.30) type = 'water'
    else if (n < 0.40) type = 'sand'
    else if (n < 0.70) type = 'grass'
    else if (n < 0.85) type = 'dirt'
    else type = 'stone'
    return { type, n }
  }

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

  static get TYPES () { return TILE_TYPES.slice() }

  // Velocidad relativa por tipo de ground. 0 = intransitable, 1 = normal.
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

  static isPassable (type) { return ProceduralGround.speedFor(type) > 0 }

  // Props/items procedurales determinísticos por (x,y,seed). No se replican:
  // cada peer los genera igual. Una segunda capa de hash decide qué hay.
  // Densidad baja para no saturar.
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
