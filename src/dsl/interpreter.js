// Intérprete del DSL. Determinista: solo lee de ctx (self, actor, payload).
// Produce una lista de efectos que el host aplica (no muta directamente).

export function runRules (rules, event, ctx) {
  const effects = []
  for (const r of rules) {
    if (r.event !== event.kind) continue
    const bindings = { self: ctx.self }
    if (r.bind && event.actor) bindings[r.bind] = event.actor
    if (event.signal) bindings.signal = event.signal
    if (r.when && !evalExpr(r.when, bindings)) continue
    for (const a of r.actions) effects.push(materialize(a, bindings, ctx))
  }
  return effects
}

function materialize (a, b, ctx) {
  switch (a.op) {
    case 'destroy': return { kind: 'destroy', id: ctx.self.id }
    case 'spawn': return {
      kind: 'spawn',
      objType: a.objType,
      pos: { x: ctx.self.pos.x + a.dx, y: ctx.self.pos.y + a.dy }
    }
    case 'give': {
      const target = b[a.to]
      return { kind: 'give', toId: target?.id, itemKind: a.kind, fromId: ctx.self.id }
    }
    case 'set': return { kind: 'set', id: ctx.self.id, path: a.path, value: a.value }
    case 'emit': {
      const target = a.to ? b[a.to] : null
      return { kind: 'signal', signal: a.signal, toId: target?.id || null, fromId: ctx.self.id }
    }
    case 'move': return {
      kind: 'move', id: ctx.self.id,
      pos: { x: ctx.self.pos.x + a.dx, y: ctx.self.pos.y + a.dy }
    }
    case 'damage': return { kind: 'damage', toId: b[a.target]?.id, amount: a.amount, fromId: ctx.self.id }
    case 'heal': return { kind: 'heal', toId: b[a.target]?.id, amount: a.amount, fromId: ctx.self.id }
  }
}

function resolve (node, b) {
  if (node.kind === 'lit') return node.value
  // path: name.key.key
  let cur = b[node.path[0]]
  for (let i = 1; i < node.path.length; i++) {
    if (cur == null) return undefined
    cur = cur[node.path[i]]
  }
  return cur
}

function evalExpr (e, b) {
  const a = resolve(e.lhs, b)
  const c = resolve(e.rhs, b)
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
