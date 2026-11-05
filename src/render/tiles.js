// Spritesheet de Kenney "Roguelike/RPG Pack".
//   - 57 cols × 31 rows, 16×16 con 1px de margen entre tiles, sin margen exterior.
//   - Pixel (col, row) → (col*17, row*17).
//
// Los mappings de abajo son punto de partida; ajústalos abriendo Preview.png
// del pack y contando filas/columnas. El "picker" (modo debug) está descrito
// al final del archivo.

const TILE = 16
const STRIDE = 17 // 16px + 1px margen

// Mapa kind → [col, row]. Identificados a mano viendo el sheet en crops zoomeados.
// Tecla T abre el picker si quieres ajustar al gusto.
// Revisado el 2026-11-04 contra la hoja, tile a tile. Lo que el pack no trae
// (personajes, enemigos, espada) NO va aquí: sin entrada, WorldView dibuja su
// forma de color, que se ve; un tile equivocado o vacío confunde o desaparece.
/** @type {Record<string, [number, number]>} */
export const TILE_MAP = {
  // Suelo plano (el suelo del mapa lo pinta terrain.js; esto es para los
  // modificadores de suelo que coloca un jugador).
  grass:     [5, 0],
  grass_alt: [5, 1],
  dirt:      [6, 0],
  stone:     [7, 0],
  sand:      [8, 0],
  water:     [3, 1],

  // Objetos e ítems
  rock:       [54, 21], // roca gris
  herb:       [28, 10], // hojas
  apple:      [56, 12], // muslo de pollo (el pack no trae manzana)
  tree:       [13, 9],
  prop_chest: [38, 10], // cofre

  // Decoración procedural por bioma
  tree_green:      [13, 9],
  tree_orange:     [14, 9],
  pine_green:      [16, 9],
  bush_green:      [19, 9],
  flowers_white:   [31, 9],
  flowers_blue:    [28, 9],
  flowers_orange:  [29, 9],
  mushroom_brown:  [48, 2],
  rock_pile_brown: [55, 19],
  bush_small:      [22, 10],
  tree_dead:       [27, 9],
  cactus:          [22, 9],
  rock_pile_gray:  [55, 21],
  rock_green:      [54, 22]
}

class TileSheet {
  /** @param {string} [src] */
  constructor (src = 'tiles.png') {
    this.img = new Image()
    this.ready = false
    this.img.onload = () => { this.ready = true }
    this.img.src = src
  }

  /**
   * Dibuja un tile por kind. dx,dy,size en píxeles de destino.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string | undefined} kind
   * @param {number} dx
   * @param {number} dy
   * @param {number} size
   * @returns {boolean} si lo dibujó
   */
  draw (ctx, kind, dx, dy, size) {
    if (!this.ready) return false
    const m = kind === undefined ? undefined : TILE_MAP[kind]
    if (!m) return false
    const sx = m[0] * STRIDE
    const sy = m[1] * STRIDE
    ctx.drawImage(this.img, sx, sy, TILE, TILE, dx, dy, size, size)
    return true
  }

  /**
   * Dibuja por col/row explícitos. Útil para el picker.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} col
   * @param {number} row
   * @param {number} dx
   * @param {number} dy
   * @param {number} size
   * @returns {boolean}
   */
  drawCell (ctx, col, row, dx, dy, size) {
    if (!this.ready) return false
    ctx.drawImage(this.img, col * STRIDE, row * STRIDE, TILE, TILE, dx, dy, size, size)
    return true
  }
}

// Singleton.
/** @type {TileSheet | null} */
let _sheet = null
/** @returns {TileSheet} */
export function getSheet () {
  if (!_sheet) _sheet = new TileSheet()
  return _sheet
}

// -------- Picker (debug) --------
// Para identificar tiles del sheet rápido: en el browser abre
//   http://localhost:3100/tiles.png
// y mira el preview. Cada celda (col, row): la coord pixel es (col*17, row*17),
// con el tile ocupando 16×16. Asume 0-index.
//
// Atajo en App.vue (pendiente): tecla T para abrir un overlay que muestra todo
// el sheet con grid y cursor que reporta (col,row) bajo el mouse.
