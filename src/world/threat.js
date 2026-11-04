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
export const DESPAWN_RADIUS = 26        // más lejos que esto, el monstruo se va
export const STEP_MS = 600              // un paso por casilla
export const ATTACK_MS = 1000           // un golpe por segundo
export const STRUCTURE_HP = 20          // vida de lo que construyes
export const AGGRO_RANGE = 10           // casillas a las que ve un monstruo con ira 1
export const PROVOKE_RADIUS = 6         // al pegarle a uno, se enfadan los de su grupo hasta aquí
export const WANDER_MS = 2500           // un monstruo tranquilo se mueve cada tanto
export const HOME_RADIUS = 3            // …sin alejarse de donde apareció
export const MIN_SPAWN_DIST = 8         // ningún monstruo aparece más cerca que esto del jugador

const STRUCTURE_TYPES = new Set(['prop', 'npc'])

export function chebyshev (a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

/** Lo que hosteo cerca: mis objetos que un monstruo puede atacar. */
export function structuresNear (objs, myPk, pos, radius = THREAT_RADIUS) {
  return objs.filter((o) => o.creator === myPk && STRUCTURE_TYPES.has(o.type) && o.pos && chebyshev(o.pos, pos) <= radius)
}

/**
 * Cuántos, cada cuánto, de qué tamaño y qué tan fuertes, según lo hosteado cerca y la
 * reputación. Aparecen en GRUPOS: `packSize` es el tamaño medio de cada grupo.
 */
export function threatFor ({ hosted, rep }) {
  const r = Math.max(0, Math.min(1, rep || 0))
  const h = Math.max(0, hosted | 0)
  return {
    maxAlive: Math.min(24, 6 + h * 2),
    intervalMs: Math.round(Math.max(4000, 15000 / (1 + h * 0.5))),
    packSize: Math.min(7, 3 + Math.floor(h / 3)),
    hp: 10 + Math.round(r * 40),
    dmg: 1 + Math.round(r * 4),
    bossChance: 0.05 + r * 0.15
  }
}

/**
 * Papeles dentro de un grupo. `aggro` es la IRA ∈ [0,1]: la distancia a la que te ve es
 * `aggro × AGGRO_RANGE`, así que con ira 0 no ve a nadie y solo ataca si le pegan.
 * `scale` es el tamaño con que se dibuja.
 */
export const ROLES = {
  minion: { hp: 0.5, dmg: 0.5, aggro: [0, 0.4], scale: 0.8 },
  normal: { hp: 1, dmg: 1, aggro: [0.3, 0.7], scale: 1 },
  leader: { hp: 2, dmg: 1.5, aggro: [0.6, 1], scale: 1.25 },
  boss: { hp: 5, dmg: 2.5, aggro: [1, 1], scale: 1.6 }
}

/**
 * Un grupo alrededor de `center`: un líder (o, a veces, un jefe), algunos normales y el
 * resto esbirros. Cada uno con su sitio libre a ≤ 2 casillas del centro y a MIN_SPAWN_DIST
 * o más de todos los `players`.
 * @returns {{role:string, pos:{x:number,y:number}, hp:number, dmg:number, aggro:number, scale:number}[]}
 */
export function makePack (center, threat, rand, isPassable, players = []) {
  const size = Math.max(2, threat.packSize - 1 + Math.floor(rand() * 3))   // ±1 alrededor de la media
  const roles = [rand() < threat.bossChance ? 'boss' : 'leader']
  for (let i = 1; i < size; i++) roles.push(rand() < 0.4 ? 'normal' : 'minion')
  const taken = new Set()
  const spots = []
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) spots.push({ x: center.x + dx, y: center.y + dy, d: Math.abs(dx) + Math.abs(dy) })
  spots.sort((a, b) => a.d - b.d)
  const out = []
  for (const role of roles) {
    // Siempre un poco alejados de CUALQUIER jugador: nunca a menos de MIN_SPAWN_DIST.
    const spot = spots.find((p) => !taken.has(`${p.x},${p.y}`) && isPassable(p.x, p.y) && farFromAll(p, players))
    if (!spot) break
    taken.add(`${spot.x},${spot.y}`)
    const R = ROLES[role]
    out.push({
      role,
      pos: { x: spot.x, y: spot.y },
      hp: Math.max(1, Math.round(threat.hp * R.hp)),
      dmg: Math.max(1, Math.round(threat.dmg * R.dmg)),
      aggro: Math.round((R.aggro[0] + rand() * (R.aggro[1] - R.aggro[0])) * 100) / 100,
      scale: R.scale
    })
  }
  return out
}

/** Ningún jugador a menos de MIN_SPAWN_DIST: en una zona con mucha gente no aparecen. */
export function farFromAll (p, players) {
  for (const q of players) if (chebyshev(p, q) < MIN_SPAWN_DIST) return false
  return true
}

/** A cuántas casillas ve un monstruo con esa ira. */
export const sightOf = (aggro) => Math.round(Math.max(0, aggro || 0) * AGGRO_RANGE)

/**
 * A quién va. Provocado: a por el jugador, esté donde esté. Si no, lo más cercano que
 * VEA (jugador o estructura dentro de su vista). Null: nada a la vista, se queda tranquilo.
 */
export function chooseTarget (m, player, structures) {
  if (m.payload?.provoked) return { kind: 'player', pos: player, d: chebyshev(m.pos, player) }
  const sight = sightOf(m.payload?.aggro)
  if (sight === 0) return null
  const t = pickTarget(m.pos, player, structures)
  return t.d <= sight ? t : null
}

/** Un paso al azar que no lo aleje más de HOME_RADIUS de su casa. Null si no toca moverse. */
export function wanderStep (pos, home, rand, isPassable) {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const [dx, dy] = DIRS[Math.floor(rand() * 4)]
  const next = { x: pos.x + dx, y: pos.y + dy }
  if (home && chebyshev(next, home) > HOME_RADIUS) return null
  return isPassable(next.x, next.y) ? next : null
}

/**
 * Centro de un grupo: en el anillo de 9 a 14 casillas alrededor del jugador, transitable.
 * Más allá del borde de la vista de casi todos, para que se acerquen y no aparezcan encima.
 * `rand` es una función [0,1). Null si no encuentra sitio (rodeado de agua): ese turno no sale.
 */
export function spawnSpot (pos, rand, isPassable) {
  for (let i = 0; i < 24; i++) {
    const angle = rand() * Math.PI * 2
    const dist = 9 + rand() * 5
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
