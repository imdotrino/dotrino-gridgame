// Intérprete del DSL. Determinista: solo lee de ctx (self, actor, payload).
// Produce una lista de efectos que el host aplica (no muta directamente).

/**
 * @typedef {import('../types').Rule} Rule
 * @typedef {import('../types').Action} Action
 * @typedef {import('../types').Effect} Effect
 * @typedef {import('../types').Expr} Expr
 * @typedef {import('../types').Operand} Operand
 * @typedef {import('../types').PlacedObject} PlacedObject
 * @typedef {import('../types').WorldObject} WorldObject
 * @typedef {{ self: PlacedObject }} Ctx
 * @typedef {Record<string, unknown>} Bindings
 */

/**
 * @param {Rule[]} rules
 * @param {import('../types').DslTrigger} event
 * @param {Ctx} ctx
 * @returns {Effect[]}
 */
export function runRules (rules, event, ctx) {
  const effects = []
  for (const r of rules) {
    if (r.event !== event.kind) continue
    /** @type {Bindings} */
    const bindings = { self: ctx.self }
    if (r.bind && event.actor) bindings[r.bind] = event.actor
    if (event.signal) bindings.signal = event.signal
    if (r.when && !evalExpr(r.when, bindings)) continue
    for (const a of r.actions) effects.push(materialize(a, bindings, ctx))
  }
  return effects
}

/**
 * Lo que las acciones nombran (`to actor`) es un objeto del mundo, o nada.
 * @param {Bindings} b
 * @param {string} name
 * @returns {WorldObject | undefined}
 */
const bound = (b, name) => /** @type {WorldObject | undefined} */ (b[name])

/**
 * @param {Action} a
 * @param {Bindings} b
 * @param {Ctx} ctx
 * @returns {Effect}
 */
function materialize (a, b, ctx) {
  switch (a.op) {
    case 'destroy': return { kind: 'destroy', id: ctx.self.id }
    case 'spawn': return {
      kind: 'spawn',
      objType: a.objType,
      pos: { x: ctx.self.pos.x + a.dx, y: ctx.self.pos.y + a.dy }
    }
    case 'give': {
      const target = bound(b, a.to)
      return { kind: 'give', toId: target?.id, itemKind: a.kind, fromId: ctx.self.id }
    }
    case 'set': return { kind: 'set', id: ctx.self.id, path: a.path, value: a.value }
    case 'emit': {
      const target = a.to ? bound(b, a.to) : null
      return { kind: 'signal', signal: a.signal, toId: target?.id || null, fromId: ctx.self.id }
    }
    case 'move': return {
      kind: 'move', id: ctx.self.id,
      pos: { x: ctx.self.pos.x + a.dx, y: ctx.self.pos.y + a.dy }
    }
    case 'damage': return { kind: 'damage', toId: bound(b, a.target)?.id, amount: a.amount, fromId: ctx.self.id }
    case 'heal': return { kind: 'heal', toId: bound(b, a.target)?.id, amount: a.amount, fromId: ctx.self.id }
  }
}

/**
 * @param {Operand} node
 * @param {Bindings} b
 * @returns {unknown}
 */
function resolve (node, b) {
  if (node.kind === 'lit') return node.value
  // path: name.key.key
  /** @type {unknown} */
  let cur = b[node.path[0]]
  for (let i = 1; i < node.path.length; i++) {
    if (cur == null) return undefined
    cur = /** @type {Record<string, unknown>} */ (cur)[node.path[i]]
  }
  return cur
}

/**
 * Compara como JavaScript (`<` entre lo que haya): el DSL no tiene tipos.
 * @param {Expr} e
 * @param {Bindings} b
 * @returns {boolean}
 */
function evalExpr (e, b) {
  const a = /** @type {any} */ (resolve(e.lhs, b))
  const c = /** @type {any} */ (resolve(e.rhs, b))
  switch (e.op) {
    case '==': return a === c
    case '!=': return a !== c
    case '<': return a < c
    case '<=': return a <= c
    case '>': return a > c
    case '>=': return a >= c
  }
  return false
}
