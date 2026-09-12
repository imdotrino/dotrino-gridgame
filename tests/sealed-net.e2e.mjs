/**
 * Prueba de punta a punta del SELLADO de la partida (CONVENCIONES §4.1).
 *
 * Dos navegadores de verdad, cada uno con su propio perfil, jugando por el proxio de
 * PRODUCCIÓN. Lo que se comprueba no es que conecten, sino:
 *
 *   · que por el socket NO viaja nada legible, en las DOS direcciones: ni dónde estás,
 *     ni qué pones en el mundo, ni a quién le pegas. Sellar solo de salida se lo salta
 *     quien acepte texto en claro.
 *   · que la partida SIGUE FUNCIONANDO: lo que uno construye aparece en el mundo del
 *     otro, y moverse cambia lo que se manda.
 *   · que el fallo es DISTINGUIBLE por `code` y nunca cae a mandar en claro:
 *     `no-peer-identity` (nadie ha dicho de quién es ese token) ≠ `no-encpub` (dijo
 *     quién es, pero nunca anunció con qué sellarle).
 *
 * Cómo correrla:
 *
 *   npm install && npx playwright install chromium
 *   npm run build && npm run preview -- --port 4181 &
 *   npm run test:e2e                  # o GRIDGAME_BASE=https://gridgame.dotrino.com/
 *
 * Habla con `wss://proxy.dotrino.com` y con la bóveda `id.dotrino.com`: hace falta red.
 */
import { chromium } from 'playwright'

const BASE = process.env.GRIDGAME_BASE || 'http://127.0.0.1:4181/'

const resultados = []
const check = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok, detalle })
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ' — ' + detalle : ''}`)
}

/** Graba TODO lo que entra y sale por el WebSocket, antes de que cargue la app. */
const GRABADORA = () => {
  window.__frames = { out: [], in: [] }
  const NativeWS = window.WebSocket
  const Patched = function (url, protocols) {
    const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols)
    const send = ws.send.bind(ws)
    ws.send = (data) => { try { window.__frames.out.push(String(data)) } catch (_) {} ; return send(data) }
    ws.addEventListener('message', (e) => { try { window.__frames.in.push(String(e.data)) } catch (_) {} })
    return ws
  }
  Patched.prototype = NativeWS.prototype
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Patched[k] = NativeWS[k]
  window.WebSocket = Patched
}

const navegador = await chromium.launch()

async function nuevaPagina (etiqueta) {
  const ctx = await navegador.newContext()
  await ctx.addInitScript(GRABADORA)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  (${etiqueta}) PAGEERROR ${e.message}`))
  await page.goto(BASE)
  await page.waitForFunction(() => !!window.gridgame?.link?.myToken, null, { timeout: 40000 })
  return { ctx, page }
}

const A = await nuevaPagina('uno')
const B = await nuevaPagina('dos')
check('las dos partidas conectan, se identifican y se publican', true)

// ---------- 1. se reconocen (el saludo del transporte) ----------
const seVen = (page) => page.waitForFunction(
  () => window.gridgame.link.peers.size >= 1, null, { timeout: 40000 }
).then(() => true).catch(() => false)
const reconocidos = (await seVen(A.page)) && (await seVen(B.page))
check('se reconocen: cada token dice de quién es (saludo del transporte)', reconocidos)

// ---------- 2. la partida sigue funcionando ----------
// MOVERSE DE VERDAD (la tecla se mantiene pulsada: el movimiento va por fotograma, no
// por pulsación) y poner una roca donde se ha llegado. Así lo que viaja es una posición
// que no es el origen, que es lo que hay que ver cifrado.
await A.page.keyboard.down('d')
await new Promise((r) => setTimeout(r, 900))
await A.page.keyboard.up('d')
await A.page.keyboard.down('s')
await new Promise((r) => setTimeout(r, 900))
await A.page.keyboard.up('s')
await A.page.keyboard.press('q')
await new Promise((r) => setTimeout(r, 1200))

const puesto = await A.page.evaluate(() => {
  const mios = window.gridgame.store.inRect(-99, -99, 99, 99).filter((o) => o.creator === window.gridgame.myPk)
  return mios.length ? { id: mios.at(-1).id, pos: mios.at(-1).pos } : null
})
check('el primero se mueve y pone algo donde llegó', !!puesto && (puesto.pos.x !== 0 || puesto.pos.y !== 0),
  puesto ? JSON.stringify(puesto.pos) : 'no puso nada')

const llego = await B.page.waitForFunction(
  (id) => !!window.gridgame.store.get(id), puesto.id, { timeout: 30000 }
).then(() => true).catch(() => false)
check('lo que uno construye aparece en el mundo del otro', llego, puesto.id.slice(-8))

// ---------- 3. lo que de verdad se mide: qué se vio por el cable ----------
await new Promise((r) => setTimeout(r, 1500))

const frames = {
  uno: await A.page.evaluate(() => window.__frames),
  dos: await B.page.evaluate(() => window.__frames),
}

// Lo que NO puede aparecer legible: el identificador del objeto (lleva dentro la llave
// de quien lo puso), el tipo de mensaje del juego y sus campos.
const SECRETOS = [
  ['el identificador del objeto', puesto.id],
  ['el tipo de mensaje de la partida', '"object_state"'],
  ['la plantilla del objeto', '"template"'],
  ['el campo de posición', '"pos"'],
]

let limpio = true
for (const [quien, f] of Object.entries(frames)) {
  for (const direccion of ['out', 'in']) {
    const todo = f[direccion].join('\n')
    for (const [nombre, secreto] of SECRETOS) {
      if (todo.includes(secreto)) {
        limpio = false
        check(`NADA legible por el cable — ${quien}/${direccion}`, false, `se vio ${nombre}`)
      }
    }
  }
}
if (limpio) {
  const total = Object.values(frames).reduce((n, f) => n + f.out.length + f.in.length, 0)
  check('NADA legible por el cable, en los dos extremos y en los dos sentidos', true, `${total} tramas grabadas`)
}

// El canal público va sin datos: lo que hacía falta saber lo dice el saludo.
const publishConDatos = Object.values(frames).some((f) =>
  f.out.filter((t) => t.includes('"type":"publish"')).some((t) => t.includes('"pk"')))
check('el canal público ya no lleva la llave escrita dentro', !publishConDatos)

// Y sí se ve el saludo: una trama de control que solo lleva una llave pública.
const saludos = frames.uno.out.map((t) => { try { return JSON.parse(t) } catch (_) { return null } })
  .filter((f) => f?.message && String(f.message).includes('__cc_hello__'))
  .map((f) => JSON.parse(f.message))
const saludoLimpio = saludos.length > 0 && saludos.every((s) => Object.keys(s).sort().join(',') === 'publickey,t')
check('el saludo va en claro y SOLO lleva la llave pública', saludoLimpio, `${saludos.length} saludos`)

// ---------- 4. el fallo se distingue, y nunca cae a claro ----------
const sinIdentidad = await A.page.evaluate(async () => {
  try {
    await window.gridgame.link.client.sendSealedTo('TOKEN-QUE-NADIE-SALUDO', { type: 'hit' })
    return 'no lanzó'
  } catch (e) { return e.code }
})
check('a un token del que nadie ha dicho nada: `no-peer-identity`', sinIdentidad === 'no-peer-identity', sinIdentidad)

const sinLlave = await A.page.evaluate(async () => {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', par.publicKey)
  try {
    await window.gridgame.link.client.sendSealedTo('TOKEN', { type: 'hit' }, { peerPubkey: JSON.stringify(jwk) })
    return 'no lanzó'
  } catch (e) { return e.code }
})
check('a quien nunca anunció con qué sellarle: `no-encpub`', sinLlave === 'no-encpub', sinLlave)

const enClaro = await A.page.evaluate(() => {
  try {
    window.gridgame.link.client.send('TOKEN', { type: 'hit' })
    return 'no lanzó'
  } catch (e) { return e.code }
})
check('mandar en claro por token está cortado: `unsealed`', enClaro === 'unsealed', enClaro)

// Y que se VE quién no recibe, en vez de quedarse callado (§14).
const avisa = await A.page.evaluate(async () => {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', par.publicKey))
  window.gridgame.link.peers.set(jwk, { token: 'TOKEN-FANTASMA', lastSeen: Date.now() })
  window.gridgame.link.broadcastObjectState({ id: 'x', creator: jwk, pos: { x: 0, y: 0 } })
  await new Promise((r) => setTimeout(r, 1500))
  return document.querySelector('.status.warn')?.textContent || ''
})
check('a quien no se le puede sellar, la pantalla lo DICE', avisa.length > 0, avisa)

// ---------- cierre ----------
await navegador.close()

const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones OK`)
if (fallos.length) {
  console.log('FALLAN:\n' + fallos.map((f) => ' · ' + f.nombre + (f.detalle ? ' — ' + f.detalle : '')).join('\n'))
  process.exit(1)
}
