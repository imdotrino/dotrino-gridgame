# Tile Biome Editor

Editor visual standalone para clasificar los tiles del sheet Kenney por **bioma + posición** dentro de un set autotile **29-tile** (`h v T codos`). El motor del juego usa esa clasificación para autotiling determinista en runtime — el grafo de adyacencias se deriva implícitamente, no requiere edición manual.

Servido por Vite junto al juego en `public/tile_links.html` →
`http://localhost:3100/tile_links.html`

## Datos

| Archivo | Rol |
|---|---|
| `public/tiles.png` | Sheet Kenney (57×31 tiles, 16px, 1px margen) |
| `public/tile_catalog.json` | Categorías por tile (`ground`, `prop`, `item`, …) y biomas base (`ground:water` etc.) |
| `public/tile_biomes.json` | Biomas definidos por el usuario + clasificación `(bioma, posición)` por tile. **Source of truth** del autotile |

Si existe `tile_biomes.json` se carga al abrir el editor; **Export biomes** lo regenera.

## Workflow

1. **Biomas** (sidebar superior):
   - 5 biomas precargados (`water`, `sand`, `grass`, `dirt`, `stone`) si no existe `tile_biomes.json` propio.
   - **+ Add** para nuevos: id + color hex/preset.
   - Cada fila tiene:
     - `☐` checkbox de **filtro** — al marcar, solo los tiles clasificados con ese bioma quedan brillantes (combinable con el dropdown de categoría).
     - swatch + id (click en el id la marca como bioma activo para pintar).
     - select **kind** (`normal` / `water` / `sand`) — tipo físico que usa el motor para resolver paso/velocidad. `water` = impasable, `sand` = lento, `normal` = caminable. PEPITO `kind=water` se comporta como agua aunque tenga el color que quieras.
     - `×` borra el bioma.
2. **Marcar compatibilidad** en checkboxes (`*` = transparente).
3. **Pintar posición** sobre tiles:
   - Click un botón de posición (29 disponibles)
   - Click el tile en el sheet → se clasifica (bioma activo, posición activa)
   - Drag pinta varios. Click derecho borra. Click sobre tile ya marcado lo toggle off.
4. **Atajos**:
   - Doble-click en cualquier botón del 3×3 → modo **ALL9**: el click siguiente sobre el sheet se trata como `C` y los 8 vecinos se asignan a sus posiciones relativas.
   - Doble-click en cualquier botón interno → modo **ALL4**: el click es la esquina superior-izquierda de un bloque 2×2 (`iSE iSW / iNE iNW` por la disposición Kenney).
   - Botón medio + drag → pan
5. **Export biomes** (barra superior, junto a *Export catalog*) descarga el JSON; reemplaza `public/tile_biomes.json` para persistir. **Import biomes** carga uno desde disco.

## Posiciones (29)

| Grupo | Piezas | Convención |
|---|---|---|
| Masa 3×3 | `NW N NE / W C E / SW S SE` | El tile contiene biomes en los cuadrantes opuestos al nombre (e.g. `NW` = solo cuadrante SE es bioma, vecinos NW/NE/SW son exterior) |
| Cóncavas internas | `iSE iSW / iNE iNW` | Bioma rellena 3 cuadrantes, el nombrado es exterior |
| Aislado | `I` | Sin vecinos del mismo bioma |
| Horizontal | `hW hC hE` | Cap-W (cerrado izq), medio, cap-E |
| Vertical | `vN vC vS` | Cap-N (cerrado arriba), medio, cap-S |
| T-junctions | `TN TS TW TE` | Nombre = **dirección sin conexión** (TN = T sin norte = `┬`) |
| Cruz | `+` | 4 conexiones |
| Codos | `eNE eNW eSE eSW` | Nombre = **direcciones conectadas** (eNE = norte+este = `└`) |

Total = 9 + 4 + 1 + 3 + 3 + 4 + 1 + 4 = **29**.

## Filtros (barra superior + sidebar)

Dos ejes ortogonales, combinables (AND):

- **Filter dropdown** (barra superior): categorías top-level del catálogo (`ground`, `prop`, `item`, `terrain_edge`, ...). Si elegís una, click toggle la categoría del tile en `tile_catalog.json` (modo clasificación de catálogo). `all categories` = sin filtro.
- **Checkboxes de bioma** (sidebar): marcá uno o varios biomas para mostrar solo sus tiles clasificados.

Botones de la barra:
- **Export catalog** — descarga `tile_catalog.json` con las categorías editadas.
- **Export biomes** — descarga `tile_biomes.json` (biomas + clasificaciones + kind).
- **Import biomes** — carga un `tile_biomes.json` desde disco.

## Estructura del JSON de biomas

```json
{
  "biomes": [
    { "id": "PEPITO", "color": "#2a6fdb", "compat": ["*"], "kind": "water" }
  ],
  "tileBiome": {
    "3,1": { "biome": "PEPITO", "pos": "C" },
    "2,0": { "biome": "PEPITO", "pos": "NW" }
  }
}
```

El motor lee `kind` para resolver paso, `compat` para autotile, y `pos` para elegir el tile correcto en cada celda del mundo según los vecinos.
