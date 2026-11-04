#!/usr/bin/env python3
"""Genera la PLANTILLA del atlas del suelo (scripts/terrain/template.png).

Es arte provisional y, sobre todo, la referencia de formas para quien dibuje el
arte definitivo: cada tile es la silueta exacta que espera el motor
(src/render/terrain.js). Fila = capa (water, sand, grass, dirt, stone). Columna =
máscara 0..15 (bits: 1 NO, 2 NE, 4 SO, 8 SE); 16 y 17 = variantes del lleno.

Uso: python3 scripts/terrain/template.py [salida.png] [--zoom N]
"""
import os
import random
import sys
from PIL import Image

T = 16
LAYERS = [
    ('water', (61, 127, 217), (45, 100, 190)),
    ('sand',  (227, 207, 134), (190, 165, 95)),
    ('grass', (90, 166, 74),  (60, 125, 50)),
    ('dirt',  (138, 100, 64), (100, 70, 42)),
    ('stone', (143, 143, 143), (105, 105, 105)),
]
COLS = 18


def inside(mask, px, py):
    # Centro del píxel en [0,1]; interpolación bilineal de las 4 esquinas.
    u = (px + 0.5) / T
    v = (py + 0.5) / T
    nw, ne, sw, se = (mask >> 0) & 1, (mask >> 1) & 1, (mask >> 2) & 1, (mask >> 3) & 1
    val = nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v
    return val > 0.5


def main():
    out = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'template.png')
    zoom = int(sys.argv[sys.argv.index('--zoom') + 1]) if '--zoom' in sys.argv else 1
    img = Image.new('RGBA', (COLS * T, len(LAYERS) * T), (0, 0, 0, 0))
    for row, (_, base, edge) in enumerate(LAYERS):
        for col in range(COLS):
            mask = 15 if col >= 15 else col
            rnd = random.Random(row * 100 + col)
            for py in range(T):
                for px in range(T):
                    if not inside(mask, px, py):
                        continue
                    border = any(not inside(mask, qx, qy)
                                 for qx, qy in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1))
                                 if 0 <= qx < T and 0 <= qy < T)
                    if border:
                        c = edge
                    else:
                        k = rnd.random()
                        c = tuple(max(0, ch - 14) for ch in base) if k < 0.08 else (
                            tuple(min(255, ch + 12) for ch in base) if k < 0.14 else base)
                    img.putpixel((col * T + px, row * T + py), c + (255,))
    if zoom > 1:
        img = img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)
    img.save(out)
    print(out, img.size)


if __name__ == '__main__':
    main()
