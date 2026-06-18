import { ProceduralGround } from '../world/ProceduralGround.js'
import { resolveTile } from '../world/resolve.js'
import { getSheet } from './tiles.js'

// Render 2D. Dibuja:
//   1) ground procedural como fondo.
//   2) overrides del LocalStore (ground/prop/item/actor) resueltos por
//      reputación → recencia.
// La reputación viene inyectada (repOf), normalmente desde identity.

export class WorldView {
  constructor (canvas, { tileSize = 24, ground, store = null, repOf = null } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.tileSize = tileSize
    this.ground = ground || new ProceduralGround()
    this.store = store
    this.repOf = repOf
    this.camera = { x: 0, y: 0 } // centro en coords de tile
    this.sheet = getSheet()
    this._raf = null
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
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const cols = Math.ceil(w / tileSize) + 2
    const rows = Math.ceil(h / tileSize) + 2
    const cx = Math.floor(camera.x - cols / 2)
    const cy = Math.floor(camera.y - rows / 2)
    const offX = w / 2 - (camera.x - cx) * tileSize - tileSize / 2
    const offY = h / 2 - (camera.y - cy) * tileSize - tileSize / 2

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tx = cx + i
        const ty = cy + j
        const t = ground.tileAt(tx, ty)
        const px = Math.floor(offX + i * tileSize)
        const py = Math.floor(offY + j * tileSize)
        if (!this.sheet.draw(ctx, t.type, px, py, tileSize)) {
          ctx.fillStyle = ProceduralGround.colorFor(t.type)
          ctx.fillRect(px, py, tileSize, tileSize)
        }
        const proc = ground.proceduralObjectAt(tx, ty)
        if (proc) this._drawProcedural(proc, px, py, tileSize)
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
    }

    // Personaje propio (placeholder) en el centro.
    ctx.fillStyle = '#ff3355'
    ctx.fillRect(w / 2 - tileSize / 3, h / 2 - tileSize / 3, tileSize * 2 / 3, tileSize * 2 / 3)

    // HUD
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(8, 8, 220, this.store ? 76 : 44)
    ctx.fillStyle = '#fff'
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillText(`pos: ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}`, 16, 26)
    ctx.fillText(`seed: ${ground.seed}`, 16, 42)
    if (this.store) {
      const s = this.store.stats()
      ctx.fillText(`store: own=${s.owned} repl=${s.replicated} cache=${s.cached}`, 16, 58)
      ctx.fillText(`total: ${s.total}`, 16, 74)
    }
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
      const kind = r.prop.winner.payload?.kind || 'prop_chest'
      if (!this.sheet.draw(ctx, kind, px, py, ts)) {
        ctx.fillStyle = '#5a3a1a'
        ctx.fillRect(px + ts * 0.15, py + ts * 0.15, ts * 0.7, ts * 0.7)
      }
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
      const a = r.actors.winner
      if (!this.sheet.draw(ctx, a.type, px, py, ts)) {
        ctx.fillStyle = a.type === 'enemy' ? '#c0392b' : (a.type === 'npc' ? '#2ecc71' : '#3498db')
        ctx.fillRect(px + ts * 0.25, py + ts * 0.1, ts * 0.5, ts * 0.8)
      }
      for (const ghost of r.actors.others) {
        ctx.save()
        ctx.globalAlpha = 0.35
        if (!this.sheet.draw(ctx, ghost.type, px, py, ts)) {
          ctx.fillStyle = ghost.type === 'enemy' ? '#c0392b' : (ghost.type === 'npc' ? '#2ecc71' : '#3498db')
          ctx.fillRect(px + ts * 0.25, py + ts * 0.1, ts * 0.5, ts * 0.8)
        }
        ctx.restore()
      }
    }
  }
}
