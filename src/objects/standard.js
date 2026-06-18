// Catálogo de objetos estándar (§paso 7 del plan).
//
// Cada entrada define un "template" que se instancia en mundo con
// `makeObject(kind, { creator, ts, pos, id })`. El template puede traer DSL
// precompilado (rules ya parseadas) o dejar `dsl=null` para builtins.

import { parseDSL } from '../dsl/parser.js'

const TEMPLATES = {
  // ----- ground modifier -----
  slow_grass: {
    type: 'ground',
    payload: { type: 'grass', modifier: 'slow' },
    dsl: null
  },

  // ----- props -----
  rock: {
    type: 'prop',
    payload: { kind: 'rock', solid: true },
    dsl: null
  },
  chest: {
    type: 'prop',
    payload: { kind: 'chest', solid: true, opened: false },
    dsl: `on use(actor) when self.payload.opened==false do set self.payload.opened=true; give key to actor`
  },

  // ----- items procedurales (consumibles del mundo) -----
  herb: {
    type: 'item',
    payload: { procedural: true, kind: 'herb', heal: 5 },
    dsl: `
      on use(actor) do heal actor 5; destroy
    `
  },
  apple: {
    type: 'item',
    payload: { procedural: true, kind: 'apple', heal: 2 },
    dsl: `
      on use(actor) do heal actor 2; destroy
    `
  },

  // ----- items crafteados (armas) -----
  sword: {
    type: 'item',
    payload: { procedural: false, kind: 'sword', power_cap: 0.5 },
    dsl: null // el daño se computa via power.js cuando el portador la usa
  },

  // ----- npc -----
  merchant: {
    type: 'npc',
    payload: { name: 'merchant', friendly: true },
    dsl: `
      on adjacent(actor) when actor.type=="character" do emit greeting to actor
    `
  },

  // ----- enemy -----
  slime: {
    type: 'enemy',
    payload: { name: 'slime', hp: 10, max_hp: 10, dmg: 1 },
    dsl: `
      on adjacent(actor) when actor.type=="character" do damage actor 1
      on tick do move 1 0
    `
  }
}

// Pre-parse DSL al cargar el módulo.
const COMPILED = {}
for (const [k, t] of Object.entries(TEMPLATES)) {
  COMPILED[k] = { ...t, rules: t.dsl ? parseDSL(t.dsl) : [] }
}

export function listKinds () { return Object.keys(COMPILED) }

export function templateOf (kind) { return COMPILED[kind] || null }

export function makeObject (kind, { creator, ts, pos, id, parent = null } = {}) {
  const t = COMPILED[kind]
  if (!t) throw new Error(`unknown standard kind "${kind}"`)
  return {
    id: id || `${creator}:${kind}:${Math.random().toString(36).slice(2, 8)}`,
    type: t.type,
    creator,
    ts: ts || Date.now(),
    pos,
    parent,
    dsl: null, // los estándar referencian su template, no llevan su DSL en el wire
    template: kind,
    payload: JSON.parse(JSON.stringify(t.payload))
  }
}

// Resolver rules: si el objeto trae `dsl` custom, parse on demand; si es estándar,
// usa las rules precompiladas del template.
const _customCache = new WeakMap()
export function rulesFor (obj) {
  if (obj.template && COMPILED[obj.template]) return COMPILED[obj.template].rules
  if (obj.dsl) {
    let r = _customCache.get(obj)
    if (!r) { r = parseDSL(obj.dsl); _customCache.set(obj, r) }
    return r
  }
  return []
}
