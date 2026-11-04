import { ProceduralGround } from '../world/ProceduralGround.js'
import { resolveTile } from '../world/resolve.js'
import { getSheet } from './tiles.js'
import { TerrainAtlas, layerOf, quadLayers, fullVariant, FULL } from './terrain.js'
import { PlayerSprite, facingFor, walkFrame } from './player.js'
import { ActorSheet, actorRow, idleFrame, phaseOf } from './actors.js'

// Render 2D. Dibuja:
//   1) ground procedural como fondo.
//   2) overrides del LocalStore (ground/prop/item/actor) resueltos por
//      reputación → recencia.
// La reputación viene inyectada (repOf), normalmente desde identity.
// Las etiquetas del HUD también (hudLabels): el canvas queda fuera de Vue, así
// que la app pasa un getter y cada frame dibuja en el idioma activo (§9).

// Color por papel: el líder tira a dorado y el jefe a morado, para leerlos de un vistazo.
const ROLE_TINT = { leader: 'hue-rotate(-55deg) saturate(1.4)', boss: 'hue-rotate(160deg) saturate(1.6) brightness(0.85)' }

const HUD_FALLBACK = { pos: 'pos', seed: 'world', objects: 'objects', own: 'own', others: 'others', saved: 'saved', total: 'total' }

export class WorldView {
  constructor (canvas, { tileSize = 24, ground, store = null, repOf = null, hudLabels = null } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.tileSize = tileSize
    this.ground = ground || new ProceduralGround()
    this.store = store
    this.repOf = repOf
    this.hudLabels = hudLabels || (() => HUD_FALLBACK)
    this.camera = { x: 0, y: 0 } // centro en coords de tile
    this.sheet = getSheet()
    this.terrain = new TerrainAtlas()
    this.player = new PlayerSprite()
    this.actors = new ActorSheet()
    // Hacia dónde mira y si camina: lo fija la app en cada paso (setMotion).
    this.facing = 0 // fila del sprite: 0 abajo, 1 izquierda, 2 derecha, 3 arriba
    this.walking = false
    // Vida del jugador y el último golpe recibido: los fija la app.
    this.playerHp = null
    this.hurtAt = -Infinity
    // Los demás jugadores: [{ x, y, facing, walking }]. Los fija la app con lo que llega por red.
    this.others = []
    this.lifeState = 'alive' // 'alive' | 'dead' | 'protected'
    this._shown = new Map() // pk → { x, y } dibujado: se acerca suave a lo último recibido
    // Lo mismo para los actores (monstruos, mercaderes): su posición cambia de casilla en
    // casilla cada 0,6 s; dibujarlos ahí tal cual se ve a saltos.
    this._actorShown = new Map() // id → { x, y, seen }
    this._lastDrawAt = 0
    this._dt = 16.7
    this._raf = null
  }

  /** El movimiento de este frame: decide la cara del sprite y si anda. */
  setMotion (dx, dy) {
    this.walking = !!(dx || dy)
    if (this.walking) this.facing = facingFor(dx, dy, this.facing)
  }

  start () {
    if (this._raf) return
    const loop = () => {
      this.draw()
      this._raf = requestAnimationFrame(loop)
    }
    loop()
  }

  stop () {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
  }

  resize () {
    const dpr = window.devicePixelRatio || 1
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw () {
    const { ctx, canvas, tileSize, camera, ground } = this
    const tDraw = performance.now()
    this._dt = Math.min(100, this._lastDrawAt ? tDraw - this._lastDrawAt : 16.7)
    this._lastDrawAt = tDraw
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const cols = Math.ceil(w / tileSize) + 2
    const rows = Math.ceil(h / tileSize) + 2
    const cx = Math.floor(camera.x - cols / 2)
    const cy = Math.floor(camera.y - rows / 2)
    const offX = w / 2 - (camera.x - cx) * tileSize - tileSize / 2
    const offY = h / 2 - (camera.y - cy) * tileSize - tileSize / 2

    // Capa de cada celda visible (+1 de margen: los tiles de la rejilla doble
    // asoman medio tile por cada lado).
    const gw = cols + 2
    const gh = rows + 2
    const grid = new Uint8Array(gw * gh)
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) grid[j * gw + i] = layerOf(ground.tileAt(cx - 1 + i, cy - 1 + j).type)
    }

    if (this.terrain.ready) {
      // Rejilla doble: el tile (i, j) tiene sus esquinas en el centro de las celdas
      // (i, j), (i+1, j), (i, j+1), (i+1, j+1), así que se pinta medio tile corrido.
      ctx.imageSmoothingEnabled = false
      const corners = [0, 0, 0, 0]
      for (let j = 0; j < gh - 1; j++) {
        for (let i = 0; i < gw - 1; i++) {
          corners[0] = grid[j * gw + i]
          corners[1] = grid[j * gw + i + 1]
          corners[2] = grid[(j + 1) * gw + i]
          corners[3] = grid[(j + 1) * gw + i + 1]
          const tx = cx - 1 + i
          const ty = cy - 1 + j
          const px = Math.floor(offX + (tx - cx) * tileSize + tileSize / 2)
          const py = Math.floor(offY + (ty - cy) * tileSize + tileSize / 2)
          for (const { layer, mask } of quadLayers(corners)) {
            const col = mask === FULL ? fullVariant(tx, ty) : mask
            this.terrain.draw(ctx, layer, col, px, py, tileSize)
          }
        }
      }
    } else {
      // Mientras carga el atlas (o si no cargó: TerrainAtlas lo dice en consola),
      // color plano por celda.
      for (let j = 1; j < gh - 1; j++) {
        for (let i = 1; i < gw - 1; i++) {
          const t = ground.tileAt(cx - 1 + i, cy - 1 + j)
          ctx.fillStyle = ProceduralGround.colorFor(t.type)
          ctx.fillRect(Math.floor(offX + (i - 1) * tileSize), Math.floor(offY + (j - 1) * tileSize), tileSize, tileSize)
        }
      }
    }

    // Props procedurales, después de TODO el suelo: los tiles del suelo se solapan
    // entre celdas y taparían medio objeto.
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const proc = ground.proceduralObjectAt(cx + i, cy + j)
        if (proc) this._drawProcedural(proc, Math.floor(offX + i * tileSize), Math.floor(offY + j * tileSize), tileSize)
      }
    }

    // Overrides del LocalStore.
    if (this.store) {
      const x0 = cx
      const y0 = cy
      const x1 = cx + cols - 1
      const y1 = cy + rows - 1
      const objs = this.store.inRect(x0, y0, x1, y1)
      const tiles = new Map() // key → objects
      for (const o of objs) {
        const k = `${o.pos.x},${o.pos.y}`
        let arr = tiles.get(k)
        if (!arr) { arr = []; tiles.set(k, arr) }
        arr.push(o)
      }
      for (const [k, arr] of tiles) {
        const [sx, sy] = k.split(',').map(Number)
        const px = Math.floor(offX + (sx - cx) * tileSize)
        const py = Math.floor(offY + (sy - cy) * tileSize)
        const r = resolveTile(arr, this.repOf)
        this._drawCell(r, px, py, tileSize)
      }
      // Olvidar a los que ya no se dibujan (muertos, fuera de la pantalla).
      for (const [id, sh] of this._actorShown) if (sh.seen !== this._lastDrawAt) this._actorShown.delete(id)
    }

    // Personaje propio, en el centro: sombra bajo los pies y el sprite encima.
    const pcx = w / 2
    const pcy = h / 2
    // Los demás jugadores, con el mismo sprite, donde dicen estar.
    if (this.player.ready) {
      const now = performance.now()
      const seen = new Set()
      for (const o of this.others) {
        // Llegan ~5 posiciones por segundo: entre una y otra se interpola para que no salte.
        seen.add(o.pk)
        let d = this._shown.get(o.pk)
        if (!d || Math.abs(d.x - o.x) + Math.abs(d.y - o.y) > 6) d = { x: o.x, y: o.y }
        const k = 1 - Math.exp(-this._dt / 60) // ~ el 25 % por fotograma a 60 Hz, igual a cualquier fps
        d.x += (o.x - d.x) * k
        d.y += (o.y - d.y) * k
        this._shown.set(o.pk, d)
        const ox = pcx + (d.x - camera.x) * tileSize
        const oy = pcy + (d.y - camera.y) * tileSize
        if (ox < -tileSize || oy < -tileSize || ox > w + tileSize || oy > h + tileSize) continue
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
        ctx.beginPath()
        ctx.ellipse(ox, oy + tileSize * 0.42, tileSize * 0.3, tileSize * 0.11, 0, 0, Math.PI * 2)
        ctx.fill()
        this.player.draw(ctx, o.facing || 0, o.walking ? walkFrame(now) : 0, Math.floor(ox - tileSize / 2), Math.floor(oy - tileSize / 2), tileSize)
      }
      for (const pk of this._shown.keys()) if (!seen.has(pk)) this._shown.delete(pk)
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
    ctx.beginPath()
    ctx.ellipse(pcx, pcy + tileSize * 0.42, tileSize * 0.3, tileSize * 0.11, 0, 0, Math.PI * 2)
    ctx.fill()
    if (this.player.ready) {
      const now = performance.now()
      const col = this.walking ? walkFrame(now) : 0
      // Al recibir un golpe, parpadea un momento.
      const hurt = now - this.hurtAt < 300
      if (hurt && Math.floor(now / 60) % 2) ctx.globalAlpha = 0.35
      // Caído: gris y medio transparente mientras corre el contador.
      if (this.lifeState === 'dead') { ctx.globalAlpha = 0.45; ctx.filter = 'grayscale(1)' }
      this.player.draw(ctx, this.facing, col, Math.floor(pcx - tileSize / 2), Math.floor(pcy - tileSize / 2), tileSize)
      ctx.globalAlpha = 1
      ctx.filter = 'none'
      // Protegido: una burbuja azul que late.
      if (this.lifeState === 'protected') {
        const pulse = 0.5 + 0.5 * Math.sin(now / 150)
        ctx.strokeStyle = `rgba(80, 180, 255, ${0.5 + 0.4 * pulse})`
        ctx.fillStyle = `rgba(80, 180, 255, ${0.12 + 0.08 * pulse})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(pcx, pcy, tileSize * 0.7, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    } else {
      // Mientras carga (o si no cargó: PlayerSprite lo dice en consola).
      ctx.fillStyle = '#00658c'
      ctx.fillRect(pcx - tileSize / 3, pcy - tileSize / 3, tileSize * 2 / 3, tileSize * 2 / 3)
    }
    if (this.playerHp && this.playerHp.hp < this.playerHp.max) {
      this._hpBar(pcx - tileSize / 2, pcy - tileSize / 2, tileSize, this.playerHp.hp, this.playerHp.max, '#4caf50')
    }

    // HUD (etiquetas en el idioma activo, §9).
    const L = this.hudLabels() || HUD_FALLBACK
    const lines = [
      `${L.pos}: ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}`,
      `${L.seed}: ${ground.seed}`
    ]
    if (this.store) {
      const s = this.store.stats()
      lines.push(`${L.objects}: ${L.own}=${s.owned} ${L.others}=${s.replicated} ${L.saved}=${s.cached}`)
      lines.push(`${L.total}: ${s.total}`)
    }
    ctx.font = '12px system-ui, sans-serif'
    // El panel se ensancha hasta el texto más largo (mismo sitio y alto de
    // siempre): las etiquetas traducidas no miden igual en es que en en, y con
    // el ancho fijo de antes el texto se salía de la caja.
    let panelW = 220
    for (const ln of lines) panelW = Math.max(panelW, Math.ceil(ctx.measureText(ln).width) + 16)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(8, 8, panelW, this.store ? 76 : 44)
    ctx.fillStyle = '#fff'
    lines.forEach((ln, i) => ctx.fillText(ln, 16, 26 + i * 16))
  }

  _drawProcedural (proc, px, py, ts) {
    if (this.sheet.draw(this.ctx, proc.kind, px, py, ts)) return
    const ctx = this.ctx
    if (proc.kind === 'rock') {
      ctx.fillStyle = '#555'
      ctx.beginPath(); ctx.arc(px + ts / 2, py + ts / 2, ts * 0.32, 0, Math.PI * 2); ctx.fill()
    } else if (proc.kind === 'herb') {
      ctx.fillStyle = '#1d8a3a'
      ctx.beginPath(); ctx.arc(px + ts * 0.5, py + ts * 0.5, ts * 0.12, 0, Math.PI * 2); ctx.fill()
    } else if (proc.kind === 'apple') {
      ctx.fillStyle = '#c0392b'
      ctx.beginPath(); ctx.arc(px + ts * 0.5, py + ts * 0.5, ts * 0.14, 0, Math.PI * 2); ctx.fill()
    }
  }

  _drawCell (r, px, py, ts) {
    const ctx = this.ctx
    if (r.ground.winner) {
      const t = r.ground.winner.payload?.type || 'grass'
      if (!this.sheet.draw(ctx, t, px, py, ts)) {
        ctx.fillStyle = ProceduralGround.colorFor(t)
        ctx.fillRect(px, py, ts, ts)
      }
    }
    if (r.prop.winner) {
      const pw = r.prop.winner
      const kind = pw.payload?.kind || 'prop_chest'
      if (!this.sheet.draw(ctx, kind, px, py, ts)) {
        ctx.fillStyle = '#5a3a1a'
        ctx.fillRect(px + ts * 0.15, py + ts * 0.15, ts * 0.7, ts * 0.7)
      }
      if (pw.payload?.max_hp && pw.payload.hp < pw.payload.max_hp) this._hpBar(px, py, ts, pw.payload.hp, pw.payload.max_hp, '#e0a030')
    }
    for (const it of r.items) {
      const kind = it.payload?.kind
      if (!this.sheet.draw(ctx, kind, px, py, ts)) {
        ctx.fillStyle = it.payload?.procedural ? '#ffd24a' : '#9b59ff'
        ctx.beginPath()
        ctx.arc(px + ts / 2, py + ts / 2, ts * 0.18, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (r.actors.winner) {
      this._drawActor(r.actors.winner, px, py, ts)
      for (const ghost of r.actors.others) {
        ctx.save()
        ctx.globalAlpha = 0.35
        this._drawActor(ghost, px, py, ts)
        ctx.restore()
      }
    }
  }

  /** Un actor: su sprite con sombra; sin sprite (o mientras carga), un rectángulo de su color. */
  _drawActor (a, px, py, ts) {
    const ctx = this.ctx
    // Deslizarse hacia su casilla en vez de saltar: un paso dura 0,6 s, así que en ~0,2 s
    // ya está casi en su sitio.
    let sh = this._actorShown.get(a.id)
    if (!sh || Math.abs(sh.x - a.pos.x) + Math.abs(sh.y - a.pos.y) > 3) sh = { x: a.pos.x, y: a.pos.y }
    const k = 1 - Math.exp(-this._dt / 70)
    sh.x += (a.pos.x - sh.x) * k
    sh.y += (a.pos.y - sh.y) * k
    sh.seen = this._lastDrawAt
    this._actorShown.set(a.id, sh)
    px += (sh.x - a.pos.x) * ts
    py += (sh.y - a.pos.y) * ts
    const row = actorRow(a)
    if (row !== null && this.actors.ready) {
      // Tamaño según su papel en el grupo (esbirro más pequeño, líder y jefe más grandes),
      // con los pies en el mismo sitio: crece hacia arriba y hacia los lados.
      const scale = a.payload?.scale || 1
      const size = Math.round(ts * scale)
      const dx = Math.floor(px + ts / 2 - size / 2)
      const dy = Math.floor(py + ts - size)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.ellipse(px + ts / 2, py + ts * 0.92, ts * 0.3 * scale, ts * 0.11 * scale, 0, 0, Math.PI * 2)
      ctx.fill()
      const tint = ROLE_TINT[a.payload?.role]
      if (tint) ctx.filter = tint
      this.actors.draw(ctx, row, idleFrame(performance.now(), phaseOf(a.id)), dx, dy, size)
      if (tint) ctx.filter = 'none'
      this._actorHp(a, dx, dy, size)
      return
    }
    if (this.sheet.draw(ctx, a.type, px, py, ts)) return
    ctx.fillStyle = a.type === 'enemy' ? '#c0392b' : (a.type === 'npc' ? '#2ecc71' : '#3498db')
    ctx.fillRect(px + ts * 0.25, py + ts * 0.1, ts * 0.5, ts * 0.8)
    this._actorHp(a, px, py, ts)
  }

  /** Barra de vida de un actor, solo si está herido. */
  _actorHp (a, px, py, ts) {
    const p = a.payload
    // El jefe enseña su vida siempre; los demás, solo heridos.
    if (!p?.max_hp || (p.hp >= p.max_hp && p.role !== 'boss')) return
    this._hpBar(px, py, ts, p.hp, p.max_hp, a.type === 'enemy' ? '#e04040' : '#e0a030')
  }

  /** Barra fina sobre la casilla (px, py). */
  _hpBar (px, py, ts, hp, max, color) {
    const ctx = this.ctx
    const w = ts * 0.8
    const x = px + (ts - w) / 2
    const y = py - 4
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(x - 1, y - 1, w + 2, 5)
    ctx.fillStyle = color
    ctx.fillRect(x, y, w * Math.max(0, hp) / max, 3)
  }
}
