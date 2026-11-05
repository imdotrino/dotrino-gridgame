// DSL declarativo (§5 del plan). Pequeño y determinista.
//
// Sintaxis por línea (`#` = comentario):
//
//   on <event>[(<bind>)] [when <expr>] do <action>[; <action>...]
//
// Eventos: tick | enter(actor) | leave(actor) | adjacent(actor) | signal(name) | use(by)
// Expresiones (en `when`): comparaciones simples sobre self/actor/payload.
//   ej: actor.type=="character", self.payload.hp<10
// Acciones (en `do`):
//   destroy
//   spawn <type> at <dx> <dy>
//   give <itemKind> to actor
//   set self.<key>=<value>
//   emit <signal> [to actor]
//   move <dx> <dy>
//   damage actor <n>
//   heal actor <n>
//
// Determinista: no time-of-day ni Math.random — todo proviene de inputs.

/**
 * @typedef {import('../types').Rule} Rule
 * @typedef {import('../types').Action} Action
 * @typedef {import('../types').Expr} Expr
 * @typedef {import('../types').Operand} Operand
 * @typedef {import('../types').Literal} Literal
 * @typedef {import('../types').DslEvent} DslEvent
 * @typedef {import('../types').CompareOp} CompareOp
 */

/** @type {Set<string>} */
const EVENTS = new Set(['tick', 'enter', 'leave', 'adjacent', 'signal', 'use'])
/** @type {Set<string>} */
const ACTIONS = new Set(['destroy', 'spawn', 'give', 'set', 'emit', 'move', 'damage', 'heal'])

/**
 * @param {string | null | undefined} src
 * @returns {Rule[]}
 */
export function parseDSL (src) {
  const rules = []
  const lines = (src || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    try {
      rules.push(parseRule(line, i + 1))
    } catch (e) {
      throw new Error(`DSL line ${i + 1}: ${/** @type {Error} */ (e).message}\n  > ${raw}`)
    }
  }
  return rules
}

/**
 * @param {string} line
 * @param {number} lineNo
 * @returns {Rule}
 */
function parseRule (line, lineNo) {
  // on <event>[(<bind>)] [when <expr>] do <action>[; <action>...]
  const m = line.match(/^on\s+(\w+)(?:\(([^)]*)\))?\s*(?:when\s+(.+?))?\s+do\s+(.+)$/i)
  if (!m) throw new Error('expected "on <event> [when ...] do <actions>"')
  const [, evt, bind, when, actionsSrc] = m
  if (!EVENTS.has(evt)) throw new Error(`unknown event "${evt}"`)
  const actions = actionsSrc.split(';').map(s => s.trim()).filter(Boolean).map(parseAction)
  return {
    event: /** @type {DslEvent} */ (evt),
    bind: bind ? bind.trim() : null,
    when: when ? parseExpr(when.trim()) : null,
    actions,
    lineNo
  }
}

/**
 * @param {string} src
 * @returns {Action}
 */
function parseAction (src) {
  const head = src.split(/\s+/)[0]
  if (!ACTIONS.has(head)) throw new Error(`unknown action "${head}"`)
  const rest = src.slice(head.length).trim()
  switch (head) {
    case 'destroy': return { op: 'destroy' }
    case 'spawn': {
      const m = rest.match(/^(\w+)\s+at\s+(-?\d+)\s+(-?\d+)$/)
      if (!m) throw new Error('spawn <type> at <dx> <dy>')
      return { op: 'spawn', objType: m[1], dx: +m[2], dy: +m[3] }
    }
    case 'give': {
      const m = rest.match(/^(\w+)\s+to\s+(\w+)$/)
      if (!m) throw new Error('give <kind> to <bind>')
      return { op: 'give', kind: m[1], to: m[2] }
    }
    case 'set': {
      const m = rest.match(/^([\w.]+)\s*=\s*(.+)$/)
      if (!m) throw new Error('set <path>=<value>')
      return { op: 'set', path: m[1], value: parseLiteral(m[2]) }
    }
    case 'emit': {
      const m = rest.match(/^(\w+)(?:\s+to\s+(\w+))?$/)
      if (!m) throw new Error('emit <signal> [to <bind>]')
      return { op: 'emit', signal: m[1], to: m[2] || null }
    }
    case 'move': {
      const m = rest.match(/^(-?\d+)\s+(-?\d+)$/)
      if (!m) throw new Error('move <dx> <dy>')
      return { op: 'move', dx: +m[1], dy: +m[2] }
    }
    case 'damage':
    case 'heal': {
      const m = rest.match(/^(\w+)\s+(\d+)$/)
      if (!m) throw new Error(`${head} <bind> <n>`)
      return { op: head, target: m[1], amount: +m[2] }
    }
  }
  // ACTIONS ya filtró: aquí no se llega con una acción desconocida.
  throw new Error(`unknown action "${head}"`)
}

/**
 * @param {string} src
 * @returns {Expr}
 */
function parseExpr (src) {
  // Soporta: A op B  with op in == != < <= > >=  ; A/B son paths o literales.
  const m = src.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/)
  if (!m) throw new Error(`bad expression "${src}"`)
  return { lhs: parsePathOrLiteral(m[1].trim()), op: /** @type {CompareOp} */ (m[2]), rhs: parsePathOrLiteral(m[3].trim()) }
}

/**
 * @param {string} s
 * @returns {Operand}
 */
function parsePathOrLiteral (s) {
  const lit = tryLiteral(s)
  if (lit !== undefined) return { kind: 'lit', value: lit }
  return { kind: 'path', path: s.split('.') }
}

/**
 * @param {string} s
 * @returns {Literal | undefined}
 */
function tryLiteral (s) {
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^"[^"]*"$/.test(s)) return s.slice(1, -1)
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  return undefined
}

/**
 * @param {string} s
 * @returns {Literal}
 */
function parseLiteral (s) {
  const v = tryLiteral(s)
  if (v === undefined) throw new Error(`expected literal, got "${s}"`)
  return v
}
