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
export const DESPAWN_RADIUS = 40        // red de seguridad: más lejos que esto, un monstruo suelto se va
export const PACK_GONE_DIST = 16        // un grupo fuera de la zona de memoria Y más lejos que esto se elimina
export const MEMORY_FACTOR = 2          // la zona de memoria es el doble de la pantalla
export const STEP_MS = 600              // un paso por casilla
export const ATTACK_MS = 1000           // un golpe por segundo
export const STRUCTURE_HP = 20          // vida de lo que construyes
export const AGGRO_RANGE = 10           // casillas a las que ve un monstruo con ira 1
export const PROVOKE_RADIUS = 6         // al pegarle a uno, se enfadan los de su grupo hasta aquí
export const WANDER_MS = 2500           // un monstruo tranquilo se mueve cada tanto
export const HOME_RADIUS = 3            // …sin alejarse de donde apareció
export const MIN_SPAWN_DIST = 8         // ningún monstruo aparece más cerca que esto del jugador
export const LEASH_RADIUS = 16          // lo más que se aleja de la casa de su grupo; más allá, se rinde y vuelve
                                        // (más que la distancia a la que aparecen: si no, nunca te alcanzarían)

/**
 * @typedef {import('../types').Pos} Pos
 * @typedef {import('../types').PlacedObject} PlacedObject
 * @typedef {import('../types').Screen} Screen
 * @typedef {import('../types').PeerTarget} PeerTarget
 * @typedef {import('../types').IsPassable} IsPassable
 * @typedef {import('../types').Rand} Rand
 * @typedef {import('../types').MonsterRole} MonsterRole
 * @typedef {{ maxAlive: number, intervalMs: number, packSize: number, hp: number, dmg: number, bossChance: number }} Threat
 * @typedef {{ role: MonsterRole, pos: Pos, hp: number, dmg: number, aggro: number, scale: number }} PackMember
 * @typedef {{ kind: 'player', pos: Pos, d: number }
 *   | { kind: 'peer', pk: string, pos: Pos, d: number }
 *   | { kind: 'structure', obj: PlacedObject, pos: Pos, d: number }} Target
 */

/** @type {Set<string>} */
const STRUCTURE_TYPES = new Set(['prop', 'npc'])

/**
 * @param {Pos} a
 * @param {Pos} b
 * @returns {number}
 */
export function chebyshev (a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

/**
 * Lo que hosteo cerca: mis objetos que un monstruo puede atacar.
 * @param {PlacedObject[]} objs
 * @param {string} myPk
 * @param {Pos} pos
 * @param {number} [radius]
 * @returns {PlacedObject[]}
 */
export function structuresNear (objs, myPk, pos, radius = THREAT_RADIUS) {
  return objs.filter((o) => o.creator === myPk && STRUCTURE_TYPES.has(o.type) && o.pos && chebyshev(o.pos, pos) <= radius)
}

/**
 * Cuántos, cada cuánto, de qué tamaño y qué tan fuertes, según lo hosteado cerca y la
 * reputación. Aparecen en GRUPOS: `packSize` es el tamaño medio de cada grupo.
 *
 * @param {{ hosted: number, rep: number }} input
 * @returns {Threat}
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
 *
 * @type {Record<MonsterRole, { hp: number, dmg: number, aggro: [number, number], scale: number }>}
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
 * @param {Pos} center
 * @param {Threat} threat
 * @param {Rand} rand
 * @param {IsPassable} isPassable
 * @param {Pos[]} [players]
 * @returns {PackMember[]}
 */
export function makePack (center, threat, rand, isPassable, players = []) {
  const size = Math.max(2, threat.packSize - 1 + Math.floor(rand() * 3))   // ±1 alrededor de la media
  /** @type {MonsterRole[]} */
  const roles = [rand() < threat.bossChance ? 'boss' : 'leader']
  for (let i = 1; i < size; i++) roles.push(rand() < 0.4 ? 'normal' : 'minion')
  const taken = new Set()
  const spots = []
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) spots.push({ x: center.x + dx, y: center.y + dy, d: Math.abs(dx) + Math.abs(dy) })
  spots.sort((a, b) => a.d - b.d)
  /** @type {PackMember[]} */
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

/**
 * ¿Está `p` dentro de la zona de memoria (2× pantalla) alrededor de `center`?
 * @param {Pos} p
 * @param {Pos} center
 * @param {Screen | null | undefined} screen
 * @returns {boolean}
 */
export function inMemoryZone (p, center, screen) {
  if (!screen) return false
  return Math.abs(p.x - center.x) <= screen.halfW * MEMORY_FACTOR && Math.abs(p.y - center.y) <= screen.halfH * MEMORY_FACTOR
}

/**
 * ¿Se ha ido el grupo? Para TODOS los jugadores (`player` puede ser uno o una lista):
 * todos sus miembros fuera de su ZONA DE MEMORIA (el doble de la pantalla,
 * MEMORY_FACTOR) Y a más de PACK_GONE_DIST. Mientras esté en la zona de alguien, se queda.
 *   - El doble, y no la pantalla justa: un grupo que acabas de dejar atrás sigue ahí si das
 *     la vuelta. Si se borrara al salir del borde, volver dos pasos daría otro distinto.
 *   - La distancia: en un teléfono la pantalla es estrecha y los grupos APARECEN ya fuera
 *     de ella (a 9–14 casillas); sin ella, se borrarían al nacer.
 * @param {{pos:{x:number,y:number}}[]} members
 * @param {Pos | Pos[]} player
 * @param {Screen | null | undefined} screen media pantalla en casillas
 * @returns {boolean}
 */
export function packGone (members, player, screen) {
  if (!members.length) return true
  const players = Array.isArray(player) ? player : [player]
  return members.every((m) => players.every((p) =>
    !inMemoryZone(m.pos, p, screen) && chebyshev(m.pos, p) > PACK_GONE_DIST))
}

/**
 * Ningún jugador a menos de MIN_SPAWN_DIST: en una zona con mucha gente no aparecen.
 * @param {Pos} p
 * @param {Pos[]} players
 * @returns {boolean}
 */
export function farFromAll (p, players) {
  for (const q of players) if (chebyshev(p, q) < MIN_SPAWN_DIST) return false
  return true
}

/**
 * A cuántas casillas ve un monstruo con esa ira.
 * @param {number | undefined} aggro
 * @returns {number}
 */
export const sightOf = (aggro) => Math.round(Math.max(0, aggro || 0) * AGGRO_RANGE)

/**
 * A quién va. Provocado: a por el jugador, esté donde esté su vista. Si no, lo más cercano
 * que VEA (jugador o estructura dentro de su vista). Null: nada que hacer, está tranquilo.
 *
 * Provocado por OTRO jugador (`provokedBy`): va a por ESE jugador, con la posición que
 * llega por la red (`others`: [{ pk, x, y, safe }]). Si no se sabe dónde está, o está caído
 * o protegido, o fuera de la correa, se rinde.
 *
 * Dos límites, y valen también provocado:
 *   - `playerSafe`: el jugador está caído o recién reaparecido: no se le elige.
 *   - la CORREA: nada a más de LEASH_RADIUS de la casa de su grupo. Si lo sacas de ahí,
 *     se rinde y vuelve (`mustReturn`).
 *
 * @param {PlacedObject} m el monstruo
 * @param {Pos} player
 * @param {PlacedObject[]} structures
 * @param {boolean} [playerSafe]
 * @param {PeerTarget[]} [others]
 * @returns {Target | null}
 */
export function chooseTarget (m, player, structures, playerSafe = false, others = []) {
  const home = m.payload?.home
  /** @param {Pos} p */
  const inLeash = (p) => !home || chebyshev(p, home) <= LEASH_RADIUS
  const by = m.payload?.provoked && m.payload?.provokedBy
  if (by) {
    const o = others.find((q) => q.pk === by)
    if (!o || o.safe || !inLeash(o)) return null
    const pos = { x: o.x, y: o.y }
    return { kind: 'peer', pk: by, pos, d: chebyshev(m.pos, pos) }
  }
  const playerOk = !playerSafe && inLeash(player)
  if (m.payload?.provoked && playerOk) return { kind: 'player', pos: player, d: chebyshev(m.pos, player) }
  const sight = sightOf(m.payload?.aggro)
  if (sight === 0) return null
  /** @type {Target | null} */
  let best = null
  if (playerOk) best = { kind: 'player', pos: player, d: chebyshev(m.pos, player) }
  for (const st of structures) {
    if (!inLeash(st.pos)) continue
    const d = chebyshev(m.pos, st.pos)
    if (!best || d < best.d) best = { kind: 'structure', obj: st, pos: st.pos, d }
  }
  return best && best.d <= sight ? best : null
}

/**
 * Fuera de su casa más de HOME_RADIUS y sin nada que hacer: tiene que volver.
 * @param {PlacedObject} m
 * @returns {boolean}
 */
export function mustReturn (m) {
  const home = m.payload?.home
  return !!home && chebyshev(m.pos, home) > HOME_RADIUS
}

/**
 * Un paso al azar que no lo aleje más de HOME_RADIUS de su casa. Null si no toca moverse.
 * @param {Pos} pos
 * @param {Pos | undefined} home
 * @param {Rand} rand
 * @param {IsPassable} isPassable
 * @returns {Pos | null}
 */
export function wanderStep (pos, home, rand, isPassable) {
  /** @type {[number, number][]} */
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
 *
 * @param {Pos} pos
 * @param {Rand} rand
 * @param {IsPassable} isPassable
 * @returns {Pos | null}
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

/**
 * El objetivo más cercano entre el jugador y sus estructuras.
 * @param {Pos} from
 * @param {Pos} player
 * @param {PlacedObject[]} structures
 * @returns {Target}
 */
export function pickTarget (from, player, structures) {
  /** @type {Target} */
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
 *
 * @param {Pos} from
 * @param {Pos} to
 * @param {IsPassable} isPassable
 * @param {number} [radius]
 * @returns {Pos | null}
 */
export function stepToward (from, to, isPassable, radius = 12) {
  if (chebyshev(from, to) <= 1) return null
  /** @param {number} x @param {number} y */
  const key = (x, y) => `${x},${y}`
  /** @type {Map<string, Pos | null>} */
  const prev = new Map([[key(from.x, from.y), null]])
  const queue = [from]
  /** @type {[number, number][]} */
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
