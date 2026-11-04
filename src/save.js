// Dónde estás en el mundo, guardado en el almacén del ecosistema (@dotrino/store, §4).
//
// Va al almacén atado al perfil, pero en un hilo `local.*`: se queda en este aparato y
// NO va a la bóveda (dueño, 2026-11-04: no es información que merezca respaldo, y cada
// escritura de un hilo normal es una sincronización). El almacén es de hilos de mensajes: el «documento» de
// la posición es un hilo con UNA entrada, que se reescribe entera (borrar + añadir),
// igual que hacen diamonds y critters con su progreso.
//
// Sin repliegue: si el almacén no abre, la posición NO se guarda y la app lo dice.

import { Store, LOCAL_PREFIX } from '@dotrino/store'

export const POS_THREAD = `${LOCAL_PREFIX}gridgame.position`
// Ya no sale a la bóveda, pero sigue siendo IndexedDB: un guardado por segundo al andar
// y siempre al ocultarse la pestaña basta para no perder más de un segundo de camino.
const SAVE_EVERY_MS = 1000

/**
 * Abre el almacén con la identidad del perfil. Lanza si no se puede: quien llama
 * decide qué enseñar.
 */
export async function openStore (identity) {
  if (!identity) throw Object.assign(new Error('no identity: position is not saved'), { code: 'no-identity' })
  return Store.connect({ identity, adoptCommon: ['gridgame.'] })
}

// MIGRACIÓN (2026-11-04, se quita el 2026-12-04): del 4 al 4 de noviembre la posición vivió
// en `gridgame.position`, que sí iba a la bóveda. Si está, se lee una vez y se borra (el
// borrado también la quita de la bóveda). Lo cubre `tests/smoke.mjs` §13.
const OLD_POS_THREAD = 'gridgame.position'

/** Lee la última posición guardada, o null si nunca se guardó. Una entrada rota lanza. */
export async function loadPosition (store) {
  let entries = await store.listThread(POS_THREAD, {})
  const old = await store.listThread(OLD_POS_THREAD, {})
  if (old?.length) {
    if (!entries?.length) entries = old
    await store.removeThread(OLD_POS_THREAD)
  }
  if (!entries?.length) return null
  const pos = entries[entries.length - 1].pos
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    throw Object.assign(new Error(`invalid saved position: ${JSON.stringify(pos)}`), { code: 'bad-position' })
  }
  return { x: pos.x, y: pos.y }
}

/**
 * Guarda la posición como mucho una vez por segundo y solo si cambió de casilla. Las escrituras
 * van en fila: dos «borrar + añadir» a la vez podrían dejar el hilo con dos entradas
 * o vacío.
 */
export class PositionSaver {
  constructor (store, { onError } = {}) {
    this.store = store
    this.onError = onError || ((e) => console.error('[gridgame] could not save position', e))
    this.last = null
    this.pending = null
    this.timer = null
    this.chain = Promise.resolve()
  }

  /** Posición actual; se escribe al cumplirse el intervalo. */
  update (x, y) {
    const pos = { x: Math.round(x), y: Math.round(y) }
    if (this.last && this.last.x === pos.x && this.last.y === pos.y) return
    this.pending = pos
    if (!this.timer) this.timer = setTimeout(() => this.flush(), SAVE_EVERY_MS)
  }

  /** Escribe ya lo que haya pendiente (al ocultarse la pestaña, por ejemplo). */
  flush () {
    clearTimeout(this.timer)
    this.timer = null
    const pos = this.pending
    if (!pos) return this.chain
    this.pending = null
    this.last = pos
    this.chain = this.chain
      .then(async () => {
        await this.store.removeThread(POS_THREAD)
        await this.store.appendMessage(POS_THREAD, { id: 'pos', ts: Date.now(), pos })
      })
      .catch(this.onError)
    return this.chain
  }
}
