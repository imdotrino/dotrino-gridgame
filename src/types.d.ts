// Formas de datos que se repiten en el juego (mundo, red, dibujo).

/** Una casilla del mundo (coordenadas de tile). */
export interface Pos {
  x: number
  y: number
}

export type GroundType = 'water' | 'sand' | 'grass' | 'dirt' | 'stone'

/** Lo que dice el generador de una casilla: tipo y los dos campos de ruido. */
export interface GroundTile {
  type: GroundType
  n: number
  m: number
}

/** Decoración procedural (no se replica: cada peer la genera igual). */
export interface ProceduralObject {
  kind: string
  solid: boolean
}

export type ObjectType = 'ground' | 'prop' | 'item' | 'character' | 'npc' | 'enemy'

export type MonsterRole = 'minion' | 'normal' | 'leader' | 'boss'

/**
 * Datos de un objeto. Cada tipo usa los suyos, y el DSL (`set self.payload.x=…`) puede
 * escribir cualquier clave: por eso la firma abierta.
 */
export interface Payload {
  kind?: string
  name?: string
  type?: string
  modifier?: string
  solid?: boolean
  opened?: boolean
  procedural?: boolean
  heal?: number
  power_cap?: number
  friendly?: boolean
  hp?: number
  max_hp?: number
  dmg?: number
  // Monstruos (world/threat.js, combat.js)
  role?: MonsterRole
  aggro?: number
  scale?: number
  pack?: string
  home?: Pos
  provoked?: boolean
  provokedBy?: string | null
  lastStepAt?: number
  lastAttackAt?: number
  [key: string]: unknown
}

/** Un objeto del mundo tal como viaja y se guarda en el LocalStore. */
export interface WorldObject {
  id: string
  type: ObjectType
  /** Pubkey de quien lo creó: es el único que lo publica y lo borra. */
  creator: string
  ts: number
  /** null: en el inventario de `parent`. */
  pos: Pos | null
  parent?: string | null
  dsl?: string | null
  /** Clave de objects/standard.js: sus reglas vienen del catálogo. */
  template?: string
  payload: Payload
}

/** Un objeto con posición (lo que devuelven las consultas por zona). */
export type PlacedObject = WorldObject & { pos: Pos }

export type Bucket = 'owned' | 'replicated' | 'cached'

export type StoreEvent =
  | { kind: 'add' | 'update', id: string, bucket: Bucket }
  | { kind: 'remove', id: string }
  | { kind: 'bucket-change', peerId: string, to: Bucket, count: number }

/** Media pantalla en casillas. */
export interface Screen {
  halfW: number
  halfH: number
}

/** Otro jugador, con lo último que llegó por la red. */
export interface PlayerPosition extends Pos {
  facing: number
  walking: boolean
  safe: boolean
  at: number
}

export interface OtherPlayer extends PlayerPosition {
  pk: string
}

/** Lo mínimo que los monstruos saben de otro jugador. */
export interface PeerTarget extends Pos {
  pk: string
  safe?: boolean
}

export type IsPassable = (x: number, y: number) => boolean
export type Rand = () => number
export type RepOf = (pk: string) => number

// ---- Red (net/PeerLink.js): lo que se manda, siempre sellado ----

export type WireMessage =
  | { type: 'object_state', obj: WorldObject, ts: number }
  | { type: 'object_gone', id: string, ts: number }
  | { type: 'player_pos', x: number, y: number, facing: number, walking: boolean, safe: boolean, ts: number }
  | { type: 'player_hit', enemyId: string, ts: number }
  | { type: 'hit', enemyId: string, amount: number, ts: number }
  | { type: 'enemy_died', id: string, loot_template: string[], pos: Pos, ts: number }

/** Lo que PeerLink cuenta a quien se suscribe. */
export type NetEvent =
  | { kind: 'connected' | 'disconnected' }
  | { kind: 'peer-online' | 'peer-offline' | 'peer-reachable' | 'peer-joined-host' | 'peer-left-host', pk: string }
  | { kind: 'peer-unreachable', pk: string, code: string }
  | { kind: 'dropped-unsealed', from: string }
  | { kind: 'gated', from: string, reason: string }
  | { kind: 'rejected', from: string, reason: string, id?: string }
  | { kind: 'player_hit', by: string, enemyId: string, dmg: number }
  | { kind: 'hit', enemyId: string, by: string | undefined, amount: number }
  | { kind: 'enemy_died', id: string, loot_template: string[], pos: Pos }

// ---- DSL (dsl/parser.js → dsl/interpreter.js) ----

export type DslEvent = 'tick' | 'enter' | 'leave' | 'adjacent' | 'signal' | 'use'
export type Literal = number | string | boolean | null
export type Operand = { kind: 'lit', value: Literal } | { kind: 'path', path: string[] }
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>='
export interface Expr { lhs: Operand, op: CompareOp, rhs: Operand }

export type Action =
  | { op: 'destroy' }
  | { op: 'spawn', objType: string, dx: number, dy: number }
  | { op: 'give', kind: string, to: string }
  | { op: 'set', path: string, value: Literal }
  | { op: 'emit', signal: string, to: string | null }
  | { op: 'move', dx: number, dy: number }
  | { op: 'damage' | 'heal', target: string, amount: number }

export interface Rule {
  event: DslEvent
  bind: string | null
  when: Expr | null
  actions: Action[]
  lineNo: number
}

export type Effect =
  | { kind: 'destroy', id: string }
  | { kind: 'spawn', objType: string, pos: Pos }
  | { kind: 'give', toId: string | undefined, itemKind: string, fromId: string }
  | { kind: 'set', id: string, path: string, value: Literal }
  | { kind: 'signal', signal: string, toId: string | null, fromId: string }
  | { kind: 'move', id: string, pos: Pos }
  | { kind: 'damage' | 'heal', toId: string | undefined, amount: number, fromId: string }

/** Lo que dispara las reglas de un objeto. */
export interface DslTrigger {
  kind: DslEvent
  actor?: WorldObject
  signal?: string
}

declare global {
  interface Window {
    /** Asidero de la prueba de punta a punta (tests/sealed-net.e2e.mjs), puesto en App.vue. */
    gridgame?: {
      link: import('./net/PeerLink.js').PeerLink
      store: import('./world/LocalStore.js').LocalStore
      myPk: string
      hitMe: (dmg: number) => void
    }
  }
}
