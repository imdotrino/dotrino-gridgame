#!/usr/bin/env python3
"""Ground autotile atlas (288x80, 16px tiles, 5 terrains x 18 columns).

Columns 0..15 = corner mask (1=TL, 2=TR, 4=BL, 8=BR); 16, 17 = full-tile variants.
Silhouette = 0.5 level of the bilinear interpolation of the 4 corner bits
(identical to template.png). All edge treatment lives INSIDE the silhouette.
"""
import os
import random
from collections import deque
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# Escribe public/terrain.png (lo que carga el juego). Las vistas a 6x quedan aquí,
# fuera de git. Comprueba las siluetas contra template.png (scripts/terrain/template.py).
T = 16
COLS, ROWS = 18, 5
TERRAINS = ['water', 'sand', 'grass', 'dirt', 'stone']


def hx(c):
    c = c.lstrip('#')
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), 255)


PAL = {
    'water': dict(base=hx('3d7fd9'), light=hx('5a96e3'), dark=hx('2f6bc0'), edge=hx('2a5fae'), lip=hx('4a8ade')),
    'sand':  dict(base=hx('e3cf86'), light=hx('ecdb9c'), dark=hx('d6bf74'), edge=hx('b89d55'), lip=hx('eddc9a')),
    'grass': dict(base=hx('5aa64a'), light=hx('6cb65a'), dark=hx('4f9641'), edge=hx('3c7a32'), lip=hx('66b155')),
    'dirt':  dict(base=hx('8a6440'), light=hx('9a7350'), dark=hx('7a5636'), edge=hx('5e4128'), lip=hx('96704a')),
    'stone': dict(base=hx('8f8f8f'), light=hx('a3a3a3'), dark=hx('7c7c7c'), edge=hx('5f5f5f'), lip=hx('a8a8a8'),
                  top=hx('b4b4b4'), side=hx('6e6e6e')),
}
CLEAR = (0, 0, 0, 0)


def silhouette(mask):
    """Pixel-centre bilinear >= 0.5."""
    tl, tr, bl, br = (mask >> 0) & 1, (mask >> 1) & 1, (mask >> 2) & 1, (mask >> 3) & 1
    S = [[False] * T for _ in range(T)]
    for y in range(T):
        v = (y + 0.5) / T
        for x in range(T):
            u = (x + 0.5) / T
            f = (1 - u) * (1 - v) * tl + u * (1 - v) * tr + (1 - u) * v * bl + u * v * br
            S[y][x] = f >= 0.5
    return S


def depth(S):
    """4-neighbour distance to the outside, with neighbours outside the tile
    treated as the clamped border pixel (so edges continue across tiles).
    0 = outside, 1 = contour, 2 = lip, ..."""
    INF = 99
    D = [[INF if S[y][x] else 0 for x in range(T)] for y in range(T)]
    q = deque((x, y) for y in range(T) for x in range(T) if not S[y][x])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < T and 0 <= ny < T and D[ny][nx] > D[y][x] + 1:
                D[ny][nx] = D[y][x] + 1
                q.append((nx, ny))
    return D


def h(x, y, seed=0):
    """Deterministic pseudo-random 0..1 per pixel (same for every mask of a row)."""
    n = (x * 374761393 + y * 668265263 + seed * 982451653) & 0xffffffff
    n = (n ^ (n >> 13)) * 1274126177 & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffff) / 65535.0


# --- per-terrain texture (full tile, seamless because every tile shares it) ----
def texture(name, x, y):
    p = PAL[name]
    r = h(x, y, TERRAINS.index(name) + 1)
    if name == 'water':
        # short horizontal ripples: a lighter pixel pair here and there
        if (x, y) in {(2, 3), (3, 3), (9, 6), (10, 6), (5, 11), (6, 11), (12, 13), (13, 13), (1, 9)}:
            return p['light']
        if (x, y) in {(7, 1), (14, 9), (3, 14)}:
            return p['dark']
        return p['base']
    if name == 'sand':
        if r > 0.93:
            return p['light']
        if r < 0.05:
            return p['dark']
        return p['base']
    if name == 'grass':
        if r > 0.91:
            return p['light']
        if r < 0.07:
            return p['dark']
        return p['base']
    if name == 'dirt':
        if r > 0.92:
            return p['light']
        if r < 0.08:
            return p['dark']
        return p['base']
    if name == 'stone':
        if r > 0.94:
            return p['light']
        if r < 0.06:
            return p['dark']
        return p['base']
    return p['base']


# small details for variants 16 / 17 (kept away from the tile border)
DETAILS = {
    'water': [
        {(6, 7): 'light', (7, 7): 'light', (8, 7): 'light', (7, 8): 'dark'},
        {(3, 5): 'light', (4, 5): 'light', (10, 10): 'light', (11, 10): 'light', (12, 10): 'light'},
    ],
    'sand': [
        {(6, 8): 'edge', (7, 8): 'edge', (6, 7): 'dark', (7, 7): 'light'},          # pebble
        {(10, 4): 'dark', (11, 4): 'dark', (12, 4): 'dark', (4, 11): 'light', (5, 11): 'light'},
    ],
    'grass': [
        {(7, 7): hx('f2e36a'), (6, 7): 'dark', (8, 7): 'dark', (7, 6): 'dark', (7, 8): 'dark'},  # yellow flower
        {(4, 10): hx('eeeeee'), (11, 4): hx('eeeeee'), (5, 10): 'dark', (11, 5): 'dark'},     # white specks
    ],
    'dirt': [
        {(6, 8): 'edge', (7, 8): 'edge', (6, 7): 'dark', (7, 7): 'light'},          # pebble
        {(3, 4): 'edge', (4, 4): 'edge', (5, 4): 'edge', (10, 11): 'edge', (11, 11): 'edge'},  # cracks
    ],
    'stone': [
        {(6, 7): 'light', (7, 7): 'light', (8, 7): 'light', (6, 8): 'edge', (7, 8): 'edge', (8, 8): 'edge'},
        {(4, 4): 'edge', (5, 5): 'edge', (6, 6): 'edge', (11, 10): 'light', (12, 10): 'light'},
    ],
}


def draw_tile(name, mask, variant=0):
    p = PAL[name]
    S = silhouette(mask)
    D = depth(S)
    px = [[CLEAR] * T for _ in range(T)]
    for y in range(T):
        for x in range(T):
            if not S[y][x]:
                continue
            d = D[y][x]
            if d == 1:
                c = p['edge']
                if name == 'stone':
                    above_out = y > 0 and not S[y - 1][x]
                    below_out = y < T - 1 and not S[y + 1][x]
                    if above_out and not below_out:
                        c = p['top']       # lit top rim
                    elif below_out:
                        c = p['edge']      # dark bottom contour
                    else:
                        c = p['side']
                elif name == 'grass':
                    c = p['edge']
            elif d == 2:
                c = p['lip']
                if name == 'grass':
                    # tufted border: some lip pixels darken (2px thick contour spots)
                    c = p['edge'] if h(x, y, 77) > 0.72 else p['lip']
                elif name == 'stone':
                    above_out = y > 1 and not S[y - 2][x]
                    c = p['light'] if above_out else p['dark']
                elif name == 'dirt':
                    c = p['dark'] if h(x, y, 78) > 0.75 else p['lip']
                elif name == 'water':
                    c = p['base']
            elif d == 3 and name == 'grass' and h(x, y, 79) > 0.86:
                c = p['dark']              # odd tuft a bit further in
            else:
                c = texture(name, x, y)
            px[y][x] = c
    if variant:
        for (x, y), c in DETAILS[name][variant - 1].items():
            px[y][x] = p[c] if isinstance(c, str) else c
    return px


def build_atlas():
    im = Image.new('RGBA', (COLS * T, ROWS * T), CLEAR)
    for r, name in enumerate(TERRAINS):
        for c in range(COLS):
            mask = min(c, 15)
            variant = c - 15 if c > 15 else 0
            px = draw_tile(name, mask, variant)
            for y in range(T):
                for x in range(T):
                    im.putpixel((c * T + x, r * T + y), px[y][x])
    return im


def check_against_template(atlas):
    tp = os.path.join(HERE, 'template.png')
    if not os.path.exists(tp):
        return 'template.png not found'
    tpl = Image.open(tp).convert('RGBA')
    bad = 0
    for y in range(atlas.height):
        for x in range(atlas.width):
            a = atlas.getpixel((x, y))[3]
            b = tpl.getpixel((x, y))[3]
            if (a > 0) != (b > 0) or a not in (0, 255):
                bad += 1
    return f'silhouette mismatches vs template: {bad}'


# --- test map, rendered the way the engine does ------------------------------
TESTMAP = [
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [2, 1, 1, 1, 1, 2, 2, 3, 3, 2, 2, 2],
    [2, 1, 0, 0, 1, 2, 3, 3, 2, 2, 4, 4],
    [2, 1, 0, 1, 0, 1, 2, 2, 2, 4, 4, 0],
    [2, 1, 0, 0, 0, 1, 2, 2, 4, 4, 0, 0],
    [2, 1, 1, 1, 1, 2, 2, 2, 4, 0, 0, 0],
    [2, 2, 3, 3, 3, 3, 3, 2, 2, 4, 0, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [3, 2, 1, 2, 4, 2, 3, 2, 1, 2, 0, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
]


def render_testmap(atlas, seed=1):
    rnd = random.Random(seed)
    H, W = len(TESTMAP), len(TESTMAP[0])
    out = Image.new('RGBA', ((W - 1) * T, (H - 1) * T), CLEAR)
    for j in range(H - 1):
        for i in range(W - 1):
            tl, tr = TESTMAP[j][i], TESTMAP[j][i + 1]
            bl, br = TESTMAP[j + 1][i], TESTMAP[j + 1][i + 1]
            lo = min(tl, tr, bl, br)
            col = rnd.choice([15, 16, 17])
            tile = atlas.crop((col * T, lo * T, col * T + T, lo * T + T))
            out.paste(tile, (i * T, j * T), tile)
            for t in range(lo + 1, 5):
                m = (tl >= t) | ((tr >= t) << 1) | ((bl >= t) << 2) | ((br >= t) << 3)
                if m:
                    tile = atlas.crop((m * T, t * T, m * T + T, t * T + T))
                    out.paste(tile, (i * T, j * T), tile)
    return out


def main():
    atlas = build_atlas()
    atlas.save(os.path.join(HERE, '..', '..', 'public', 'terrain.png'))
    atlas.resize((atlas.width * 6, atlas.height * 6), Image.NEAREST).save(os.path.join(HERE, 'terrain-x6.png'))
    tm = render_testmap(atlas)
    tm.resize((tm.width * 6, tm.height * 6), Image.NEAREST).save(os.path.join(HERE, 'testmap-x6.png'))
    print(check_against_template(atlas))


if __name__ == '__main__':
    main()
