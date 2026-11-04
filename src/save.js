// Dónde estás en el mundo, guardado en el almacén del ecosistema (@dotrino/store, §4).
//
// Es dato del jugador, así que va al almacén atado al perfil (con respaldo en la
// bóveda), no a localStorage. El almacén es de hilos de mensajes: el «documento» de
// la posición es un hilo con UNA entrada, que se reescribe entera (borrar + añadir),
// igual que hacen diamonds y critters con su progreso.
//
// Sin repliegue: si el almacén no abre, la posición NO se guarda y la app lo dice.

import { Store } from '@dotrino/store'

export const POS_THREAD = 'gridgame.position'
// Cada escritura en el almacén se respalda en la bóveda (la sincronización sale 1,5 s
// después de la última), y cada guardado son dos escrituras (borrar el hilo + añadir).
// Guardar cada segundo al caminar era una sincronización tras cada parada. La posición
// no necesita más que esto: cada 30 s como mucho, y siempre al ocultarse la pestaña.
const SAVE_EVERY_MS = 30_000

/**
 * Abre el almacén con la identidad del perfil. Lanza si no se puede: quien llama
 * decide qué enseñar.
 */
export async function openStore (identity) {
  if (!identity) throw Object.assign(new Error('no identity: position is not saved'), { code: 'no-identity' })
  return Store.connect({ identity, adoptCommon: ['gridgame.'] })
}

/** Lee la última posición guardada, o null si nunca se guardó. Una entrada rota lanza. */
export async function loadPosition (store) {
  const entries = await store.listThread(POS_THREAD, {})
  if (!entries?.length) return null
  const pos = entries[entries.length - 1].pos
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    throw Object.assign(new Error(`invalid saved position: ${JSON.stringify(pos)}`), { code: 'bad-position' })
  }
  return { x: pos.x, y: pos.y }
}

/**
 * Guarda la posición como mucho cada 30 s y solo si cambió de casilla. Las escrituras
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
