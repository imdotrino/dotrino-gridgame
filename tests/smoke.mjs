// Smoke test sin DOM/red. Verifica los invariantes del plan.
import { ProceduralGround } from '../src/world/ProceduralGround.js'
import { LocalStore } from '../src/world/LocalStore.js'
import { resolveTile } from '../src/world/resolve.js'
import { parseDSL } from '../src/dsl/parser.js'
import { runRules } from '../src/dsl/interpreter.js'
import { powerFor, capOnCraft } from '../src/world/power.js'
import { makeObject, rulesFor } from '../src/objects/standard.js'

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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
