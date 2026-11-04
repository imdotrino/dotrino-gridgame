// Presión de monstruos (decisión del dueño, 2026-11-04): nadie invoca monstruos.
// Aparecen solos alrededor de cada jugador para atacarlo a él y a lo que hostea cerca.
//
//   - CUÁNTOS: lo que hosteas cerca. Cada objeto tuyo en el radio (rocas, cofres,
//     mercaderes…) atrae más y más seguido. Sin nada construido, un slime de vez en cuando.
//   - QUÉ TAN FUERTES: tu reputación (rep ∈ [0,1]). No hay nivel ni XP: la reputación
//     es el nivel (§11 del plan).
//
// Los hostea el jugador amenazado: él es la autoridad de su vida, su movimiento y su
// ataque. Así, para quien se defiende el monstruo no tiene latencia; solo la tiene el
// amigo que viene a ayudar, y su golpe viaja al dueño.
//
// Todo aquí es puro (sin red, sin DOM, sin reloj): lo usa CombatHost y lo prueban los tests.

export const THREAT_RADIUS = 8          // casillas: lo que cuenta como «cerca» y donde cazan
export const DESPAWN_RADIUS = 20        // más lejos que esto, el monstruo se va
export const STEP_MS = 600              // un paso por casilla
export const ATTACK_MS = 1000           // un golpe por segundo
export const STRUCTURE_HP = 20          // vida de lo que construyes

const STRUCTURE_TYPES = new Set(['prop', 'npc'])

export function chebyshev (a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

/** Lo que hosteo cerca: mis objetos que un monstruo puede atacar. */
export function structuresNear (objs, myPk, pos, radius = THREAT_RADIUS) {
  return objs.filter((o) => o.creator === myPk && STRUCTURE_TYPES.has(o.type) && o.pos && chebyshev(o.pos, pos) <= radius)
}

/** Cuántos, cada cuánto y qué tan fuertes, según lo hosteado cerca y la reputación. */
export function threatFor ({ hosted, rep }) {
  const r = Math.max(0, Math.min(1, rep || 0))
  const h = Math.max(0, hosted | 0)
  return {
    maxAlive: Math.min(8, 1 + Math.floor(h / 2)),
    intervalMs: Math.round(Math.max(5000, 40000 / (1 + h * 0.5))),
    hp: 10 + Math.round(r * 40),
    dmg: 1 + Math.round(r * 4)
  }
}

/**
 * Casilla donde aparece: en el anillo de 6 a 9 casillas alrededor del jugador, transitable.
 * `rand` es una función [0,1). Null si no encuentra sitio (rodeado de agua): ese turno no sale.
 */
export function spawnSpot (pos, rand, isPassable) {
  for (let i = 0; i < 24; i++) {
    const angle = rand() * Math.PI * 2
    const dist = 6 + rand() * 3
    const x = Math.round(pos.x + Math.cos(angle) * dist)
    const y = Math.round(pos.y + Math.sin(angle) * dist)
    if (isPassable(x, y)) return { x, y }
  }
  return null
}

/** El objetivo más cercano entre el jugador y sus estructuras. */
export function pickTarget (from, player, structures) {
  let best = { kind: 'player', pos: player, d: chebyshev(from, player) }
  for (const s of structures) {
    const d = chebyshev(from, s.pos)
    if (d < best.d) best = { kind: 'structure', obj: s, pos: s.pos, d }
  }
  return best
}

/**
 * Siguiente paso por el camino más corto hasta quedar al lado del objetivo (distancia ≤ 1;
 * el objetivo puede ser sólido, como una roca). Búsqueda en anchura sobre un cuadrado de
 * `radius` alrededor del monstruo, en cuatro direcciones. Null si no hay camino: se queda
 * quieto en vez de empujar contra la pared.
 */
export function stepToward (from, to, isPassable, radius = 12) {
  if (chebyshev(from, to) <= 1) return null
  const key = (x, y) => `${x},${y}`
  const prev = new Map([[key(from.x, from.y), null]])
  const queue = [from]
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]
    if (chebyshev(c, to) <= 1) {
      // Volver hacia atrás hasta el primer paso.
      let step = c
      let back = prev.get(key(c.x, c.y))
      while (back && (back.x !== from.x || back.y !== from.y)) {
        step = back
        back = prev.get(key(back.x, back.y))
      }
      return step
    }
    // Primero las direcciones que acercan, para que entre caminos iguales elija el recto.
    const dirs = [...DIRS].sort((a, b) =>
      chebyshev({ x: c.x + a[0], y: c.y + a[1] }, to) - chebyshev({ x: c.x + b[0], y: c.y + b[1] }, to))
    for (const [dx, dy] of dirs) {
      const n = { x: c.x + dx, y: c.y + dy }
      const k = key(n.x, n.y)
      if (prev.has(k) || chebyshev(n, from) > radius || !isPassable(n.x, n.y)) continue
      prev.set(k, c)
      queue.push(n)
    }
  }
  return null
}
