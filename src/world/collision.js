// Colisión: combina ground (water bloquea, sand ralentiza) + props sólidos
// (overrides del LocalStore Y props procedurales por seed) para decidir si un
// tile es transitable y a qué velocidad.

import { ProceduralGround } from './ProceduralGround.js'

export function passableAt (x, y, ground, store) {
  const tx = Math.round(x), ty = Math.round(y)
  const t = ground.tileAt(tx, ty)
  if (!ProceduralGround.isPassable(t.type)) return { passable: false, speed: 0 }

  // Override: el peer puede haber colocado un ground modifier transitable
  // encima — no implementado todavía, ignoramos.

  // Props del store en la casilla.
  if (store) {
    for (const o of store.atTile(tx, ty)) {
      if (o.type === 'prop' && o.payload?.solid) return { passable: false, speed: 0 }
    }
  }

  // Props procedurales (no replicados, deterministas).
  const proc = ground.proceduralObjectAt(tx, ty)
  if (proc?.solid) return { passable: false, speed: 0 }

  return { passable: true, speed: ProceduralGround.speedFor(t.type) }
}
