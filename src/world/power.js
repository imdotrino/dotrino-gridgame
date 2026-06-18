// Fórmula de poder para items crafteados (§12 del plan).
//
//   poder = cap * log2(1 + rep_portador)
//
// rep_portador ∈ [0,1]; cap es snapshot de rep_creador al craftear.
// En rep=0 → 0. En rep=1 → cap. Curva log con ganancias decrecientes que
// favorece el avance temprano.

export function powerFor (cap, repBearer) {
  if (!cap || cap <= 0) return 0
  const r = Math.max(0, Math.min(1, repBearer || 0))
  return cap * Math.log2(1 + r)
}

// Snapshot del cap al craftear: rep_creador en ese momento (normalizada).
export function capOnCraft (repCreator) {
  return Math.max(0, Math.min(1, repCreator || 0))
}
