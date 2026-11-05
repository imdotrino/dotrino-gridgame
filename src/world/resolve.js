// Heurística de resolución de conflictos visuales (§3 del plan).
//
// El motor expone datos crudos; el render llama a `resolveTile()` para decidir
// qué se muestra cuando varios objetos del mismo "slot" pelean una casilla.
//
// Slots por capa (§4):
//   - ground  : se apila visualmente. No hay conflicto realmente; tomamos el de
//               mayor reputación/recencia si hay overrides.
//   - prop    : único (bloquea paso).
//   - item    : varios pueden coexistir; el render los apila.
//   - actor   : personajes/npc/enemigo. Subjetivamente pueden superponerse;
//               el render dibuja todos pero "destaca" el ganador.
//
// `repOf(peerId)` es inyectado: lo provee el host con datos de
// `dotrino-identity` (agregación local de endorsements).

/**
 * @typedef {import('../types').WorldObject} WorldObject
 * @typedef {import('../types').RepOf} RepOf
 * @typedef {'ground' | 'prop' | 'item' | 'actor'} Layer
 * @typedef {{ winner: WorldObject | null, others: WorldObject[] }} LayerPick
 */

/** @type {Record<string, Layer>} */
const LAYER_OF = {
  ground: 'ground',
  prop: 'prop',
  item: 'item',
  character: 'actor',
  npc: 'actor',
  enemy: 'actor'
}

/**
 * @param {WorldObject} obj
 * @param {RepOf | null | undefined} repOf
 * @returns {number}
 */
function score (obj, repOf) {
  const r = repOf ? (repOf(obj.creator) ?? 0) : 0
  const ts = obj.ts || 0
  // Primero reputación, desempate por recencia. Empaquetamos en un solo número
  // para sort estable: rep * 1e15 + ts.
  return r * 1e15 + ts
}

/**
 * @param {WorldObject[]} objects
 * @returns {Record<Layer, WorldObject[]>}
 */
export function groupByLayer (objects) {
  /** @type {Record<Layer, WorldObject[]>} */
  const groups = { ground: [], prop: [], item: [], actor: [] }
  for (const o of objects) {
    const layer = LAYER_OF[o.type]
    if (layer) groups[layer].push(o)
  }
  return groups
}

/**
 * Devuelve los objetos a renderizar en un tile, ya ordenados por capa y con
 * el "ganador" de cada capa marcado.
 *
 * Resultado: { ground:{winner,others}, prop:{winner,others}, items:[], actors:{winner,others} }
 *
 * @param {WorldObject[]} objects
 * @param {RepOf | null} [repOf]
 * @returns {{ ground: LayerPick, prop: LayerPick, items: WorldObject[], actors: LayerPick }}
 */
export function resolveTile (objects, repOf) {
  const g = groupByLayer(objects)

  /**
   * @param {WorldObject[]} arr
   * @returns {LayerPick}
   */
  const pickWinner = (arr) => {
    if (arr.length === 0) return { winner: null, others: [] }
    const sorted = arr.slice().sort((a, b) => score(b, repOf) - score(a, repOf))
    return { winner: sorted[0], others: sorted.slice(1) }
  }

  return {
    ground: pickWinner(g.ground),
    prop: pickWinner(g.prop),
    items: g.item, // todos visibles, sin "ganador" exclusivo
    actors: pickWinner(g.actor)
  }
}
