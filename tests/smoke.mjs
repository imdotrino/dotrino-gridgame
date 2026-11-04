// Smoke test sin DOM/red. Verifica los invariantes del plan.
import { ProceduralGround } from '../src/world/ProceduralGround.js'
import { LocalStore } from '../src/world/LocalStore.js'
import { resolveTile } from '../src/world/resolve.js'
import { parseDSL } from '../src/dsl/parser.js'
import { runRules } from '../src/dsl/interpreter.js'
import { powerFor, capOnCraft } from '../src/world/power.js'
import { makeObject, rulesFor } from '../src/objects/standard.js'
import { LAYERS, layerOf, quadLayers, fullVariant } from '../src/render/terrain.js'
import { facingFor, walkFrame } from '../src/render/player.js'
import { actorRow, idleFrame, phaseOf } from '../src/render/actors.js'
import { threatFor, structuresNear, pickTarget, stepToward, spawnSpot, makePack, chooseTarget, sightOf, wanderStep, ROLES, MIN_SPAWN_DIST, farFromAll, LEASH_RADIUS, mustReturn, STEP_MS, ATTACK_MS } from '../src/world/threat.js'
import { CombatHost } from '../src/combat.js'
import { PositionSaver, loadPosition, POS_THREAD } from '../src/save.js'
import { PlayerLife, MAX_HP, RESPAWN_MS, PROTECT_MS } from '../src/world/life.js'

let passed = 0, failed = 0
function eq (label, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (ok) { passed++; console.log('  ✓', label) }
  else { failed++; console.log('  ✗', label, '\n    expected', b, '\n    got     ', a) }
}
function truthy (label, v) { eq(label, !!v, true) }

console.log('1) ProceduralGround determinista')
const g1 = new ProceduralGround(0xC10C3E)
const g2 = new ProceduralGround(0xC10C3E)
eq('seed misma → mismo tile (0,0)', g1.tileAt(0, 0).type, g2.tileAt(0, 0).type)
eq('seed misma → mismo tile (100,-100)', g1.tileAt(100, -100).type, g2.tileAt(100, -100).type)
const g3 = new ProceduralGround(123)
let diffs = 0
for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) {
  if (g1.tileAt(x, y).type !== g3.tileAt(x, y).type) diffs++
}
truthy('seed distinta → diferente layout (≥10 tiles)', diffs >= 10)

console.log('2) LocalStore buckets y transitions')
const s = new LocalStore({ myPeerId: 'me' })
s.upsert({ id: 'me:1', type: 'prop', creator: 'me', ts: 1, pos: { x: 0, y: 0 } })
s.upsert({ id: 'alice:1', type: 'prop', creator: 'alice', ts: 1, pos: { x: 1, y: 0 } }, { creatorOnline: true })
s.upsert({ id: 'bob:1', type: 'prop', creator: 'bob', ts: 1, pos: { x: 2, y: 0 } }, { creatorOnline: false })
eq('bucket own', s.bucketOf('me:1'), 'owned')
eq('bucket replicated', s.bucketOf('alice:1'), 'replicated')
eq('bucket cached', s.bucketOf('bob:1'), 'cached')
s.markCreatorOffline('alice')
eq('alice offline → cached', s.bucketOf('alice:1'), 'cached')
s.markCreatorOnline('alice')
eq('alice online → replicated', s.bucketOf('alice:1'), 'replicated')

console.log('3) Last-write-wins por ts')
s.upsert({ id: 'me:1', type: 'prop', creator: 'me', ts: 5, pos: { x: 0, y: 1 } })
eq('ts mayor reemplaza pos', s.get('me:1').pos.y, 1)
s.upsert({ id: 'me:1', type: 'prop', creator: 'me', ts: 2, pos: { x: 0, y: 99 } })
eq('ts menor se ignora', s.get('me:1').pos.y, 1)

console.log('4) Resolución reputación → recencia')
const t = Date.now()
const objs = [
  { id: 'a', type: 'prop', creator: 'alice', ts: t, pos: { x: 0, y: 0 } },
  { id: 'b', type: 'prop', creator: 'bob', ts: t + 100, pos: { x: 0, y: 0 } }
]
const rep = (pk) => ({ alice: 0.9, bob: 0.4 }[pk] || 0)
const r = resolveTile(objs, rep)
eq('mayor rep gana aunque más viejo', r.prop.winner.id, 'a')
const r2 = resolveTile(objs, () => 0.5) // empate de rep
eq('empate rep → más nuevo gana', r2.prop.winner.id, 'b')

console.log('5) Prune viewport conserva owned')
s.upsert({ id: 'far:replicated', type: 'prop', creator: 'alice', ts: 1, pos: { x: 100, y: 100 } })
s.pruneToViewport(-10, -10, 10, 10)
eq('replicated lejano descartado', s.get('far:replicated'), null)
truthy('owned lejano conservado', !!s.get('me:1'))

console.log('6) DSL parser+interpreter')
const rules = parseDSL(`
  on enter(actor) when actor.type=="character" do give key to actor; destroy
  on tick do move 1 0
`)
eq('parse 2 rules', rules.length, 2)
const self = { id: 'chest', pos: { x: 0, y: 0 }, payload: {} }
const actor = { id: 'hero', type: 'character' }
const effects = runRules(rules, { kind: 'enter', actor }, { self })
eq('enter genera 2 efectos', effects.length, 2)
eq('primer efecto = give', effects[0].kind, 'give')
eq('give a actor correcto', effects[0].toId, 'hero')
eq('segundo efecto = destroy', effects[1].kind, 'destroy')
const tickEffects = runRules(rules, { kind: 'tick' }, { self })
eq('tick → move dx=1', tickEffects[0].pos, { x: 1, y: 0 })

console.log('7) Power formula')
eq('power 0 si rep=0', powerFor(1, 0), 0)
eq('power = cap si rep=1', powerFor(0.5, 1), 0.5)
truthy('curva log: 0 < p(0.5) < cap', powerFor(1, 0.5) > 0 && powerFor(1, 0.5) < 1)
eq('cap clamp', capOnCraft(2), 1)

console.log('8) Standard objects')
const slime = makeObject('slime', { creator: 'alice', ts: t, pos: { x: 0, y: 0 } })
eq('slime type=enemy', slime.type, 'enemy')
eq('slime hp=10', slime.payload.hp, 10)
const sr = rulesFor(slime)
truthy('slime tiene rules pre-compiladas', sr.length > 0)

console.log('9) Autotile de rejilla doble')
eq('todo igual → un tile lleno', quadLayers([2, 2, 2, 2]), [{ layer: 2, mask: 15 }])
eq('isla de una esquina (SE) sobre agua', quadLayers([0, 0, 0, 2]), [{ layer: 0, mask: 15 }, { layer: 1, mask: 8 }, { layer: 2, mask: 8 }])
eq('contacto en diagonal', quadLayers([1, 0, 0, 1]), [{ layer: 0, mask: 15 }, { layer: 1, mask: 9 }])
eq('tres terrenos', quadLayers([4, 2, 2, 3]), [{ layer: 2, mask: 15 }, { layer: 3, mask: 9 }, { layer: 4, mask: 1 }])
let allMasks = true
for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let c = 0; c < 5; c++) for (let d = 0; d < 5; d++) {
  for (const { mask } of quadLayers([a, b, c, d])) if (mask < 1 || mask > 15) allMasks = false
}
truthy('toda combinación de 4 esquinas da máscaras 1..15 (sin cortes)', allMasks)
truthy('todo tipo del generador tiene capa', ProceduralGround.TYPES.every((t) => LAYERS.includes(t) && layerOf(t) >= 0))
const gg = new ProceduralGround(0xC10C3E)
let unknown = 0
for (let x = -200; x < 200; x += 7) for (let y = -200; y < 200; y += 7) if (!LAYERS.includes(gg.tileAt(x, y).type)) unknown++
eq('el generador solo produce capas conocidas', unknown, 0)
eq('variante determinista', fullVariant(12, -7), fullVariant(12, -7))

console.log('10) Sprite del jugador')
eq('abajo', facingFor(0, 1), 0)
eq('izquierda', facingFor(-1, 0), 1)
eq('derecha', facingFor(1, 0.2), 2)
eq('arriba', facingFor(0.1, -1), 3)
eq('quieto conserva la cara', facingFor(0, 0, 2), 2)
eq('ciclo de pasos', [0, 140, 280, 420].map(walkFrame), [0, 1, 0, 2])

console.log('11) Sprites de actores')
eq('slime → fila 0', actorRow(makeObject('slime', { creator: 'a', ts: 1, pos: { x: 0, y: 0 } })), 0)
eq('mercader → fila 1', actorRow(makeObject('merchant', { creator: 'a', ts: 1, pos: { x: 0, y: 0 } })), 1)
eq('sin sprite → null', actorRow({ type: 'enemy', payload: { name: 'dragon' } }), null)
eq('ciclo de reposo', [0, 180, 360, 540].map((t) => idleFrame(t)), [0, 1, 0, 2])
eq('desfase estable por id', phaseOf('alice:1'), phaseOf('alice:1'))

console.log('12) Monstruos: grupos, papeles e ira')
const t0 = threatFor({ hosted: 0, rep: 0 })
const t6 = threatFor({ hosted: 6, rep: 0 })
truthy('sin construir ya salen varios', t0.maxAlive >= 6 && t0.packSize >= 3)
truthy('construir atrae más, más seguido y en grupos más grandes', t6.maxAlive > t0.maxAlive && t6.intervalMs < t0.intervalMs && t6.packSize > t0.packSize)
truthy('la reputación los hace más fuertes y trae más jefes', threatFor({ hosted: 0, rep: 1 }).hp > t0.hp && threatFor({ hosted: 0, rep: 1 }).bossChance > t0.bossChance)
const mine = [
  { id: 'r1', type: 'prop', creator: 'me', pos: { x: 3, y: 0 } },
  { id: 'r2', type: 'prop', creator: 'me', pos: { x: 30, y: 0 } },
  { id: 'o1', type: 'prop', creator: 'bob', pos: { x: 1, y: 0 } },
  { id: 'e1', type: 'enemy', creator: 'me', pos: { x: 2, y: 0 } }
]
eq('cuenta solo lo mío, cerca y atacable', structuresNear(mine, 'me', { x: 0, y: 0 }).map((o) => o.id), ['r1'])
eq('va a por lo más cercano', pickTarget({ x: 5, y: 0 }, { x: 0, y: 0 }, [mine[0]]).kind, 'structure')
eq('paso recto hacia el objetivo', stepToward({ x: 0, y: 0 }, { x: 5, y: 0 }, () => true), { x: 1, y: 0 })
const wall = (x, y) => !(x === 1 && y >= -3 && y <= 3)
const around = stepToward({ x: 0, y: 0 }, { x: 5, y: 0 }, wall)
truthy('rodea una pared', around && around.x === 0 && Math.abs(around.y) === 1)
eq('al lado del objetivo no se mueve', stepToward({ x: 0, y: 0 }, { x: 1, y: 1 }, () => true), null)
eq('sin camino se queda quieto', stepToward({ x: 0, y: 0 }, { x: 5, y: 0 }, (x, y) => x === 0 && y === 0), null)
const sp = spawnSpot({ x: 0, y: 0 }, () => 0.5, () => true)
const spd = Math.max(Math.abs(sp.x), Math.abs(sp.y))
truthy('el grupo aparece alejado (anillo 9..14)', spd >= 7 && spd <= 14)
eq('rodeado de agua no aparece', spawnSpot({ x: 0, y: 0 }, Math.random, () => false), null)

// Grupo con papeles: uno al mando, el resto normales o esbirros, y nadie encima del jugador.
let seed = 1
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const pk = makePack({ x: 9, y: 0 }, { ...t6, bossChance: 0 }, rnd, () => true, [{ x: 0, y: 0 }])
eq('un líder por grupo', pk.filter((m) => m.role === 'leader').length, 1)
truthy('el líder es el más fuerte', pk.every((m) => m.role === 'leader' || m.hp <= pk[0].hp))
truthy('ninguno a menos de 8 del jugador', pk.every((m) => Math.max(Math.abs(m.pos.x), Math.abs(m.pos.y)) >= MIN_SPAWN_DIST))
truthy('casillas distintas', new Set(pk.map((m) => `${m.pos.x},${m.pos.y}`)).size === pk.length)
const boss = makePack({ x: 9, y: 0 }, { ...t6, bossChance: 1 }, rnd, () => true)
eq('a veces el que manda es un jefe', boss[0].role, 'boss')
truthy('el jefe es mucho más fuerte que un líder', boss[0].hp >= ROLES.boss.hp * t6.hp - 1 && ROLES.boss.hp > ROLES.leader.hp)

// Lejos de CUALQUIER jugador: con gente alrededor, no aparece nadie.
const crowd = []
for (let a = 0; a < 16; a++) crowd.push({ x: Math.round(Math.cos(a / 16 * Math.PI * 2) * 11), y: Math.round(Math.sin(a / 16 * Math.PI * 2) * 11) })
const crowdHost = new CombatHost({ store: new LocalStore({ myPeerId: 'me' }), myPubkey: 'me', onPlayerHit: () => {}, rand: rnd })
crowdHost.tick(1, { player: { x: 0, y: 0 }, rep: 0, isPassable: () => true, others: crowd })
eq('en una zona con muchos jugadores no aparecen', crowdHost.myMonsters().length, 0)
const nearOther = makePack({ x: 12, y: 0 }, t6, rnd, () => true, [{ x: 0, y: 0 }, { x: 14, y: 0 }])
truthy('tampoco cerca de otro jugador', nearOther.every((m) => farFromAll(m.pos, [{ x: 14, y: 0 }])))

// Ira: la distancia a la que te ve. Ira 0: no ve a nadie, salvo que le peguen.
const calm = { pos: { x: 3, y: 0 }, payload: { aggro: 0 } }
eq('ira 0 no va a por ti aunque estés al lado', chooseTarget(calm, { x: 0, y: 0 }, []), null)
eq('provocado va a por ti aunque su ira sea 0', chooseTarget({ ...calm, payload: { aggro: 0, provoked: true } }, { x: 0, y: 0 }, []).kind, 'player')
eq('ira 0.5 te ve a 5', sightOf(0.5), 5)
eq('fuera de su vista no te persigue', chooseTarget({ pos: { x: 8, y: 0 }, payload: { aggro: 0.5 } }, { x: 0, y: 0 }, []), null)
eq('dentro de su vista, sí', chooseTarget({ pos: { x: 4, y: 0 }, payload: { aggro: 0.5 } }, { x: 0, y: 0 }, []).kind, 'player')
eq('tranquilo no se aleja de su casa', wanderStep({ x: 3, y: 0 }, { x: 0, y: 0 }, () => 0, () => true), null)

// Un combate entero sin red.
const cs = new LocalStore({ myPeerId: 'me' })
let hits = 0
seed = 7
const ch = new CombatHost({ store: cs, myPubkey: 'me', onPlayerHit: (d) => { hits += d }, rand: rnd })
const world = { player: { x: 0, y: 0 }, rep: 0, isPassable: () => true }
let now = 1
ch.tick(now, world)
const first = ch.myMonsters()
truthy('aparece un grupo, no uno suelto', first.length >= 2 && new Set(first.map((m) => m.payload.pack)).size === 1)
truthy('todos alejados del jugador al aparecer', first.every((m) => Math.max(Math.abs(m.pos.x), Math.abs(m.pos.y)) >= MIN_SPAWN_DIST))
// Los tranquilos (ira 0) no vienen solos: les pego a uno y viene todo el grupo cercano.
for (const m of first) cs.upsert({ ...m, ts: Date.now(), payload: { ...m.payload, aggro: 0 } })
for (let i = 0; i < 30; i++) { now += STEP_MS; ch.tick(now, world) }
eq('con ira 0 nadie me ataca', hits, 0)
ch.applyHit(first[0].id, 1)
truthy('pegarle a uno provoca a su grupo', ch.myMonsters().filter((m) => m.payload.pack === first[0].payload.pack).every((m) => m.payload.provoked))
for (let i = 0; i < 60; i++) { now += STEP_MS; ch.tick(now, world) }
truthy('provocados, llegan y pegan', hits > 0)
const m = ch.myMonsters()[0]
truthy('el índice por casilla sigue al monstruo', cs.atTile(m.pos.x, m.pos.y).some((o) => o.id === m.id))
let stale = 0
for (let x = -30; x <= 30; x++) for (let y = -30; y <= 30; y++) for (const o of cs.atTile(x, y)) if (o.type === 'enemy' && (o.pos.x !== x || o.pos.y !== y)) stale++
eq('sin copias fantasma en casillas viejas', stale, 0)
// Una roca mía a la vista de un monstruo con ira: va a por ella y la rompe.
const angry = { ...m, ts: Date.now(), payload: { ...m.payload, aggro: 1, provoked: false } }
cs.upsert(angry)
cs.upsert({ id: 'rock1', type: 'prop', creator: 'me', ts: 1, pos: { x: m.pos.x + 1, y: m.pos.y }, payload: { kind: 'rock', solid: true } })
const far = { ...world, player: { x: m.pos.x - 7, y: m.pos.y } }
for (let i = 0; i < 25; i++) { now += ATTACK_MS; ch.tick(now, far) }
eq('la roca cae', cs.get('rock1'), null)
let threw = false
try { new CombatHost({ store: cs, myPubkey: 'me' }) } catch { threw = true }
truthy('sin onPlayerHit no arranca', threw)

console.log('12b) Muerte, 10 s de espera y protección')
const life = new PlayerLife()
eq('un golpe resta', life.hit(5, 0), 'hurt')
eq('el que deja a cero mata', life.hit(100, 1000), 'died')
truthy('muerto 10 s', life.isDead(1000 + RESPAWN_MS - 1) && !life.isDead(1000 + RESPAWN_MS))
eq('contador', [life.secondsToRespawn(1000), life.secondsToRespawn(1000 + 9500)], [10, 1])
eq('muerto no recibe golpes', life.hit(5, 2000), 'ignored')
eq('sigue muerto antes de tiempo', life.update(5000), null)
eq('reaparece a los 10 s', life.update(1000 + RESPAWN_MS), 'respawned')
eq('con la vida llena', life.hp, MAX_HP)
truthy('protegido 5 s después', life.isProtected(1000 + RESPAWN_MS + 1) && life.secondsProtected(1000 + RESPAWN_MS) === 5)
eq('protegido no recibe golpes', life.hit(5, 1000 + RESPAWN_MS + 100), 'ignored')
eq('acabada la protección, sí', life.hit(5, 1000 + RESPAWN_MS + PROTECT_MS), 'hurt')
eq('un monstruo provocado no elige a un jugador protegido', chooseTarget({ pos: { x: 1, y: 0 }, payload: { aggro: 1, provoked: true } }, { x: 0, y: 0 }, [], true), null)

console.log('12c) La correa: no se alejan más de la cuenta de su grupo')
const leashed = { pos: { x: 10, y: 0 }, payload: { aggro: 1, provoked: true, home: { x: 10, y: 0 } } }
eq('dentro de la correa te persigue', chooseTarget(leashed, { x: 10 - LEASH_RADIUS, y: 0 }, []).kind, 'player')
eq('fuera de la correa se rinde, aunque esté provocado', chooseTarget(leashed, { x: 10 - LEASH_RADIUS - 1, y: 0 }, []), null)
truthy('lejos de casa y sin nada que hacer, vuelve', mustReturn({ pos: { x: 0, y: 0 }, payload: { home: { x: 10, y: 0 } } }))
// Con el host: lo saco de la correa y vuelve a casa, ya calmado.
const ls = new LocalStore({ myPeerId: 'me' })
const lh = new CombatHost({ store: ls, myPubkey: 'me', onPlayerHit: () => {}, rand: rnd })
ls.upsert({ id: 'w1', type: 'enemy', creator: 'me', ts: 1, pos: { x: 4, y: 0 }, payload: { name: 'slime', hp: 10, max_hp: 10, dmg: 1, aggro: 1, provoked: true, home: { x: 10, y: 0 } } })
let lt = 1
for (let i = 0; i < 20; i++) { lt += STEP_MS; lh.tick(lt, { player: { x: -14, y: 0 }, rep: null, isPassable: () => true }) }
const back = ls.get('w1')
truthy('vuelve a su casa', Math.max(Math.abs(back.pos.x - 10), Math.abs(back.pos.y)) <= 3)
eq('y se calma', back.payload.provoked, false)

console.log('13) Guardar la posición no inunda la bóveda')
const ops = []
const fakeStore = { removeThread: async () => ops.push('rm'), appendMessage: async () => ops.push('add') }
const sv = new PositionSaver(fakeStore)
for (let i = 0; i < 200; i++) sv.update(i * 0.05, 0)
eq('caminar no escribe nada antes del intervalo', ops.length, 0)
await sv.flush()
eq('un guardado = borrar + añadir', ops, ['rm', 'add'])
await sv.flush()
eq('sin cambios no vuelve a escribir', ops.length, 2)
sv.update(10.4, 0); sv.update(12.2, 0); sv.update(11.8, 0)
await sv.flush()
eq('varias casillas seguidas, un solo guardado', ops.length, 4)
clearTimeout(sv.timer)
eq('el hilo de la posición es local (no va a la bóveda)', POS_THREAD, 'local.gridgame.position')
const threads = { 'gridgame.position': [{ id: 'pos', ts: 1, pos: { x: 7, y: -3 } }] }
const mig = {
  listThread: async (k) => threads[k] || [],
  removeThread: async (k) => { delete threads[k] }
}
eq('migra la posición vieja', await loadPosition(mig), { x: 7, y: -3 })
eq('y borra el hilo viejo (sale también de la bóveda)', Object.keys(threads), [])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
