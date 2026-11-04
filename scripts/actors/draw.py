#!/usr/bin/env python3
"""Sprite sheet de los actores (48x32, frames 16x16, RGBA).

Fila 0 = slime (enemigo): col 0 reposo, col 1 aplastado, col 2 estirado.
Fila 1 = mercader (PNJ): col 0 reposo, col 1 respira, col 2 parpadea.
Mismo estilo que scripts/player/draw.py: contorno (30,42,58), luz arriba-izquierda.
Sin sombra en el suelo (la pinta el motor). Determinista.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

PAL = {
    '.': (0, 0, 0, 0),
    'o': (30, 42, 58, 255),      # contorno
    'e': (30, 42, 58, 255),      # ojo
    'w': (236, 250, 232, 255),   # brillo / blanco del ojo
    # slime
    'g': (104, 198, 96, 255),    # verde base
    'h': (170, 234, 130, 255),   # verde luz
    's': (52, 128, 70, 255),     # verde sombra
    # mercader
    'k': (240, 200, 160, 255),   # piel
    'd': (214, 164, 120, 255),   # piel sombra
    'L': (244, 218, 132, 255),   # turbante luz
    'T': (226, 184, 72, 255),    # turbante
    't': (178, 136, 44, 255),    # turbante sombra
    'R': (204, 64, 64, 255),     # gema del turbante
    'f': (222, 214, 198, 255),   # barba
    'q': (176, 166, 150, 255),   # barba sombra
    'H': (124, 178, 88, 255),    # túnica luz
    'G': (88, 140, 62, 255),     # túnica
    'S': (54, 96, 42, 255),      # túnica sombra
    'C': (190, 140, 84, 255),    # saco luz
    'B': (152, 104, 58, 255),    # saco
    'D': (100, 66, 36, 255),     # saco sombra / correa / cinturón
    'u': (58, 36, 20, 255),      # bota sombra
    'b': (92, 58, 34, 255),      # bota
}


def blank():
    return [['.'] * 16 for _ in range(16)]


def paste(grid, rows, y0, x0=0):
    for dy, line in enumerate(rows):
        assert len(line) == 16, line
        for x, ch in enumerate(line):
            if ch != '.':
                grid[y0 + dy][x0 + x] = ch


# ---------------------------------------------------------------- slime
# Silueta por filas: fila -> (x0, x1) inclusive. El contorno se deduce.
SLIME_REST = {5: (6, 9), 6: (5, 10), 7: (4, 11), 8: (3, 12), 9: (3, 12),
              10: (2, 13), 11: (2, 13), 12: (2, 13), 13: (2, 13), 14: (2, 13), 15: (3, 12)}
SLIME_SQUASH = {8: (5, 10), 9: (3, 12), 10: (2, 13), 11: (1, 14), 12: (1, 14),
                13: (1, 14), 14: (1, 14), 15: (2, 13)}
SLIME_STRETCH = {2: (6, 9), 3: (5, 10), 4: (4, 11), 5: (4, 11), 6: (3, 12), 7: (3, 12),
                 8: (3, 12), 9: (3, 12), 10: (3, 12), 11: (3, 12), 12: (3, 12),
                 13: (4, 11), 14: (5, 10)}


def slime(spans, eyes, gloss):
    """spans: silueta; eyes: esquinas (x, y) de dos ojos 2x2; gloss: píxeles de brillo."""
    g = blank()
    inside = {(x, y) for y, (x0, x1) in spans.items() for x in range(x0, x1 + 1)}
    top = min(spans)
    bottom = max(spans)
    for (x, y) in inside:
        edge = any((x + dx, y + dy) not in inside for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            g[y][x] = 'o'
            continue
        x0, x1 = spans[y]
        to_light = (x - x0) + (y - top)          # distancia a la esquina superior izquierda
        to_dark = (x1 - x) + (bottom - y)        # distancia a la esquina inferior derecha
        if to_dark <= 2 or y == bottom - 1 or x == x1 - 1:
            g[y][x] = 's'
        elif to_light <= 3:
            g[y][x] = 'h'
        else:
            g[y][x] = 'g'
    for (x, y) in gloss:
        g[y][x] = 'w'
    for (ex, ey) in eyes:
        g[ey][ex] = 'w'
        g[ey][ex + 1] = 'e'
        g[ey + 1][ex] = 'e'
        g[ey + 1][ex + 1] = 'e'
    return g


SLIME = [
    slime(SLIME_REST, [(5, 10), (9, 10)], [(5, 7), (6, 7), (5, 8)]),
    slime(SLIME_SQUASH, [(4, 11), (10, 11)], [(4, 10), (5, 10), (4, 11)]),
    slime(SLIME_STRETCH, [(5, 8), (9, 8)], [(5, 5), (6, 5), (5, 6)]),
]

# ------------------------------------------------------------- mercader
# Cabeza: turbante + cara + barba (filas 2..10). Cuerpo cols 1..10, saco cols 10..14.
HEAD = [
    "....oooo........",  # 2  turbante
    "...oLLTTo.......",  # 3
    "..oLTTTTTo......",  # 4
    ".oLTTRTTTto.....",  # 5  vuelta del turbante con gema
    ".otTTTTTTto.....",  # 6
    "..okkkkkko......",  # 7  cara
    "..okekkeko......",  # 8  ojos
    "..okfqqfko......",  # 9  bigote y boca
    "...offffo.......",  # 10
]
HEAD_BLINK = list(HEAD)
HEAD_BLINK[6] = "..okdkkdko......"  # ojos cerrados

ROBE = [
    ".oHGGqqGGSo.....",  # 11 hombros (punta de la barba)
    ".oHGGGGGSDo.....",  # 12 correa del saco cruzando
    ".okGDDDDSko.....",  # 13 cinturón y manos
]

SACK = [
    "...........oo...",  # 5  cuello atado
    "..........oDDo..",  # 6
    "..........oCBBo.",  # 7
    "..........oCBBo.",  # 8
    "..........oCBBo.",  # 9
    "..........oCBBo.",  # 10
    "..........oBBDo.",  # 11
    "..........oDDDo.",  # 12
    "...........ooo..",  # 13
]

BOOT = ["obbo", "ouuo"]


def boot(grid, x, y):
    for dy, line in enumerate(BOOT):
        for dx, ch in enumerate(line):
            grid[y + dy][x + dx] = ch


def merchant(head, bob):
    g = blank()
    paste(g, SACK, 5)
    paste(g, ROBE, 11)
    boot(g, 3, 14)
    boot(g, 6, 14)
    paste(g, head, 2 + bob)    # la cabeza va encima de los hombros
    return g


MERCHANT = [merchant(HEAD, 0), merchant(HEAD, 1), merchant(HEAD_BLINK, 0)]

ROWS = [SLIME, MERCHANT]

sheet = Image.new('RGBA', (48, 32), (0, 0, 0, 0))
px = sheet.load()
for ry, frames in enumerate(ROWS):
    for cx, g in enumerate(frames):
        for y in range(16):
            assert g[y][0] == '.' and g[y][15] == '.', (ry, cx, y)  # margen
            for x in range(16):
                px[cx * 16 + x, ry * 16 + y] = PAL[g[y][x]]

out = os.path.join(HERE, '..', '..', 'public', 'actors.png')  # lo que carga el juego
sheet.save(out)
sheet.resize((48 * 8, 32 * 8), Image.NEAREST).save(os.path.join(HERE, 'actors-x8.png'))

# Escena: los dos actores junto al jugador sobre hierba, arena y tierra.
terrain = Image.open(os.path.join(HERE, '..', '..', 'public', 'terrain.png')).convert('RGBA')
player = Image.open(os.path.join(HERE, '..', '..', 'public', 'player.png')).convert('RGBA')
tiles = [terrain.crop((15 * 16, r * 16, 15 * 16 + 16, r * 16 + 16)) for r in (2, 1, 3)]
scene = Image.new('RGBA', (16 * 7, 16 * 3))
for ty, tile in enumerate(tiles):
    for tx in range(7):
        scene.paste(tile, (tx * 16, ty * 16))
    scene.alpha_composite(player.crop((0, 0, 16, 16)), (0, ty * 16))
    for i in range(6):
        scene.alpha_composite(sheet.crop(((i % 3) * 16, (i // 3) * 16, (i % 3) * 16 + 16, (i // 3) * 16 + 16)),
                              ((i + 1) * 16, ty * 16))
scene.resize((scene.width * 4, scene.height * 4), Image.NEAREST).save(
    os.path.join(HERE, 'actors-scene-x4.png'))
print(out)
