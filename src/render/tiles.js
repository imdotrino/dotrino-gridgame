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
export const TILE_MAP = {
  // Ground base — fila 0 cols 5-8 es la "fila plana" que tilea sin bordes.
  grass:     [5, 0],   // verde puro (tilea ✓)
  grass_alt: [5, 1],
  dirt:      [6, 0],   // marrón plano (tilea ✓)
  stone:     [7, 0],   // gris/concreto plano (tilea ✓)
  sand:      [8, 0],   // beige (tilea ✓)
  water:     [3, 1],   // cyan puro centro de estanque (tilea ✓)

  // Props/items procedurales y crafteados
  rock:      [54, 0],  // pila de piedras grises
  herb:      [37, 23], // hojas/flores moradas
  apple:     [52, 15], // pollo cocinado (food placeholder)
  tree:      [13, 9],  // árbol verde
  sword:     [43, 16], // espada

  // Actores
  character: [52, 16], // figura con capucha negra
  npc:       [53, 16], // figura con cabello marrón
  enemy:     [54, 18], // pila marrón puntiaguda (monstruo)

  // Props específicos
  prop_chest: [37, 10], // cofre

  // Decor procedural por bioma
  tree_green:      [13, 9],
  tree_orange:     [14, 9],
  pine_green:      [16, 9],
  bush_green:      [19, 9],
  flowers_white:   [0, 9],
  flowers_blue:    [0, 12],
  flowers_orange:  [2, 8],
  mushroom_brown:  [48, 2],
  rock_pile_brown: [54, 18],
  bush_small:      [22, 10],
  tree_dead:       [27, 9],
  cactus:          [22, 9],
  rock_pile_gray:  [54, 20],
  rock_green:      [55, 19]
}

class TileSheet {
  constructor (src = 'tiles.png') {
    this.img = new Image()
    this.ready = false
    this.img.onload = () => { this.ready = true }
    this.img.src = src
  }

  /** Dibuja un tile por kind. dx,dy,size en píxeles de destino. */
  draw (ctx, kind, dx, dy, size) {
    if (!this.ready) return false
    const m = TILE_MAP[kind]
    if (!m) return false
    const sx = m[0] * STRIDE
    const sy = m[1] * STRIDE
    ctx.drawImage(this.img, sx, sy, TILE, TILE, dx, dy, size, size)
    return true
  }

  /** Dibuja por col/row explícitos. Útil para el picker. */
  drawCell (ctx, col, row, dx, dy, size) {
    if (!this.ready) return false
    ctx.drawImage(this.img, col * STRIDE, row * STRIDE, TILE, TILE, dx, dy, size, size)
    return true
  }
}

// Singleton.
let _sheet = null
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
