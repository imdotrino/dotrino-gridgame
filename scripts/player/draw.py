#!/usr/bin/env python3
"""Sprite sheet del jugador (48x64, frames 16x16, RGBA).

Filas = dirección (0 abajo, 1 izquierda, 2 derecha, 3 arriba).
Columnas = 0 de pie, 1 paso A, 2 paso B.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

PAL = {
    '.': (0, 0, 0, 0),
    'o': (30, 42, 58, 255),      # contorno azul muy oscuro
    'b': (0, 101, 140, 255),     # azul de marca
    'h': (47, 143, 184, 255),    # luz
    's': (0, 70, 95, 255),       # sombra
    'k': (240, 200, 160, 255),   # piel
    'd': (214, 164, 120, 255),   # piel sombra
    'r': (138, 84, 40, 255),     # pelo
    'l': (190, 124, 62, 255),    # pelo luz
    't': (92, 58, 34, 255),      # bota
    'u': (58, 36, 20, 255),      # bota sombra
    'e': (30, 42, 58, 255),      # ojo
}

# Cuerpo (sin botas): filas 3..13 de un frame 16x16 (11 filas), 16 columnas.
BODY_DOWN = [
    "......ooooo.....",  # 3
    ".....ohhhbbo....",  # 4
    "....ohhbbbbbo...",  # 5
    "....obrlrrrbo...",  # 6 flequillo
    "....obkkkkkbo...",  # 7
    "....obkekekbo...",  # 8 ojos
    "....obdkkkdbo...",  # 9
    "....ohhbbbbso...",  # 10 hombros
    "....ohbbhbbso...",  # 11 broche
    "....okbbbbbko...",  # 12 manos
    "....obbbbbsso...",  # 13 bajo
]

BODY_LEFT = [
    "......ooooo.....",  # 3
    ".....ohhbbbo....",  # 4
    "....ohhbbbbbo...",  # 5
    "...olrrbbbbbo...",  # 6 pelo asomando
    "...okkkbbbbbo...",  # 7 la cara sale 1 px delante de la capucha
    "...okekbbbbbo...",  # 8 ojo
    "....odkbbbbbo...",  # 9 barbilla
    "....ohbbbbbso...",  # 10
    "....ohhbbbbso...",  # 11
    "....okbbbbbso...",  # 12 mano delante
    "....obbbbbsso...",  # 13
]

BODY_UP = [
    "......ooooo.....",  # 3
    ".....ohhbbbo....",  # 4
    "....ohhbbbbso...",  # 5
    "....ohbbbbbso...",  # 6
    "....obbbbbbso...",  # 7
    "....obbbsbbso...",  # 8 costura capucha
    "....obbbsbbso...",  # 9
    ".....obbsbbo....",  # 10 punta capucha
    "....ohbbbbbso...",  # 11
    "....okbbbbbko...",  # 12 manos
    "....obbbbbsso...",  # 13
]

BOOT = ["ott", "ouu"]  # 3 ancho (con contorno izquierdo), 2 alto


def blank():
    return [['.'] * 16 for _ in range(16)]


def paste(grid, rows, y0):
    for dy, line in enumerate(rows):
        for x, ch in enumerate(line):
            if ch != '.':
                grid[y0 + dy][x] = ch


def boot(grid, x, y, tall=False):
    # bota de 4 de ancho con contorno a ambos lados: o t t o / o u u o
    # tall: pierna extendida, una fila más de bota arriba
    rows = (["otto"] if tall else []) + ["otto", "ouuo"]
    for dy, line in enumerate(rows):
        for dx, ch in enumerate(line):
            grid[y + dy][x + dx] = ch


def frame(body, bob, boots):
    """body: filas 3..13; bob: px hacia arriba; boots: lista de (x, y)."""
    g = blank()
    for b in boots:
        boot(g, *b)
    paste(g, body, 3 - bob)
    # el contorno inferior del cuerpo debe tapar la parte alta de la bota levantada
    return g


def mirror(g):
    return [row[::-1] for row in g]


# Posiciones de botas (x = columna del contorno izquierdo, y = fila superior).
# De pie: dos botas juntas, filas 14-15.
STAND_BOOTS = [(5, 14), (8, 14)]
# Al andar el cuerpo sube 1 px (bob); una pierna va extendida (bota alta, hasta la
# fila 15) y la otra recogida (bota normal bajo el borde de la capa, filas 13-14).
# Frontal (abajo/arriba): extendida la izquierda en A, la derecha en B.
FRONT_A = [(5, 13, True), (8, 13)]
FRONT_B = [(5, 13), (8, 13, True)]
# Perfil (izquierda): en A el pie delantero adelantado y extendido, el trasero atrás
# y recogido; en B el trasero extendido y el delantero recogido.
SIDE_A = [(9, 13), (4, 13, True)]
SIDE_B = [(5, 13), (8, 13, True)]

ROWS = [
    [frame(BODY_DOWN, 0, STAND_BOOTS), frame(BODY_DOWN, 1, FRONT_A), frame(BODY_DOWN, 1, FRONT_B)],
    [frame(BODY_LEFT, 0, STAND_BOOTS), frame(BODY_LEFT, 1, SIDE_A), frame(BODY_LEFT, 1, SIDE_B)],
    None,  # derecha = espejo de izquierda
    [frame(BODY_UP, 0, STAND_BOOTS), frame(BODY_UP, 1, FRONT_A), frame(BODY_UP, 1, FRONT_B)],
]
ROWS[2] = [mirror(g) for g in ROWS[1]]

sheet = Image.new('RGBA', (48, 64), (0, 0, 0, 0))
px = sheet.load()
for ry, frames in enumerate(ROWS):
    for cx, g in enumerate(frames):
        for y in range(16):
            for x in range(16):
                px[cx * 16 + x, ry * 16 + y] = PAL[g[y][x]]

out = os.path.join(HERE, '..', '..', 'public', 'player.png')  # lo que carga el juego
sheet.save(out)
sheet.resize((48 * 8, 64 * 8), Image.NEAREST).save(os.path.join(HERE, 'player-x8.png'))

# Escena: frames sobre hierba, arena y tierra (terrain.png col 15, filas 2/1/3).
terrain = Image.open(os.path.join(HERE, '..', '..', 'public', 'terrain.png')).convert('RGBA')
tiles = [terrain.crop((15 * 16, r * 16, 15 * 16 + 16, r * 16 + 16)) for r in (2, 1, 3)]
# también el agua (fila 0, col 15 del terreno) para ver el contraste
water = terrain.crop((15 * 16, 0, 15 * 16 + 16, 16))
tiles.append(water)
scene = Image.new('RGBA', (16 * 12, 16 * 4))
for ty, tile in enumerate(tiles):
    for tx in range(12):
        scene.paste(tile, (tx * 16, ty * 16))
for ty in range(4):
    for i, (ry, cx) in enumerate([(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2),
                                  (2, 0), (2, 1), (2, 2), (3, 0), (3, 1), (3, 2)]):
        fr = sheet.crop((cx * 16, ry * 16, cx * 16 + 16, ry * 16 + 16))
        scene.alpha_composite(fr, (i * 16, ty * 16))
scene.resize((scene.width * 4, scene.height * 4), Image.NEAREST).save(
    os.path.join(HERE, 'player-scene-x4.png'))
print(out)
