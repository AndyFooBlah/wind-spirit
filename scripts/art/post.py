"""Turn picked candidates into game sprites: key out the magenta, trim, downscale, pack an atlas.

    uv run --with pillow python3 scripts/art/post.py            # all groups with picks
    uv run --with pillow python3 scripts/art/post.py --group buildings --contact   # a contact sheet of every candidate for review

Reads art/picks/<group>.json ({key: candidateIndex}), writes art/sprites/<group>/<key>.png (transparent, trimmed, at
the manifest's target height) and apps/web/public/art/atlas.png + atlas.json for the renderer.
"""
import argparse, json, os, glob, math
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def key_out(img: Image.Image) -> Image.Image:
    """Alpha from magenta contamination. The key is `min(r, b) - g`: strongly positive only where the magenta ground
    shows through, including where a painted shadow has darkened or desaturated it, and negative for every ochre,
    green, grey and brown in the palette. Contaminated pixels also get their red and blue pulled back to green."""
    img = img.convert('RGBA'); px = img.load(); w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = min(r, b) - g
            if d <= 6:
                px[x, y] = (r, g, b, 255); continue
            alpha = max(0, min(255, round(255 * (1 - (d - 6) / 34))))
            if alpha == 0:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (min(r, g + 6), g, min(b, g + 6), alpha)   # despill: no magenta fringe on the edge
    return img


def trim(img: Image.Image, pad: int = 4) -> Image.Image:
    bbox = img.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
    if not bbox: return img
    x0, y0, x1, y1 = bbox
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument('--group', default=''); ap.add_argument('--contact', action='store_true'); a = ap.parse_args()
    manifest = json.load(open(os.path.join(ROOT, 'art', 'manifest.json')))
    groups = sorted({x['group'] for x in manifest['assets']}) if not a.group else [a.group]
    if a.contact:
        for g in groups:
            files = sorted(glob.glob(os.path.join(ROOT, 'out', 'art', g, '*.png')))
            if not files: continue
            cell = 256; cols = 4; rows = math.ceil(len(files) / cols)
            sheet = Image.new('RGB', (cols * cell, rows * (cell + 18)), 'white')
            from PIL import ImageDraw; d = ImageDraw.Draw(sheet)
            for i, f in enumerate(files):
                im = Image.open(f).convert('RGB'); im.thumbnail((cell, cell))
                x, y = (i % cols) * cell, (i // cols) * (cell + 18); sheet.paste(im, (x, y)); d.text((x + 4, y + cell + 2), os.path.basename(f)[:-4], fill='black')
            out = os.path.join(ROOT, 'out', 'art', f'contact-{g}.png'); sheet.save(out); print('wrote', out)
        return
    atlas_entries = {}; sprites = []
    for g in groups:
        pfile = os.path.join(ROOT, 'art', 'picks', f'{g}.json')
        if not os.path.exists(pfile): continue
        picks = json.load(open(pfile)); heights = {x['key']: x.get('height', 128) for x in manifest['assets'] if x['group'] == g}
        outdir = os.path.join(ROOT, 'art', 'sprites', g); os.makedirs(outdir, exist_ok=True)
        for key, idx in picks.items():
            src = os.path.join(ROOT, 'out', 'art', g, f'{key}-{idx}.png')
            if not os.path.exists(src): print('missing', src); continue
            im = trim(key_out(Image.open(src)))
            target_h = heights.get(key, 128); scale = target_h / im.height
            im = im.resize((max(1, round(im.width * scale)), target_h), Image.LANCZOS)
            im.save(os.path.join(outdir, f'{key}.png')); sprites.append((f'{g}/{key}', im))
    if not sprites: print('no picks yet'); return
    # simple shelf packing into one atlas
    sprites.sort(key=lambda s: -s[1].height); W = 2048; x = y = shelf = 0
    for name, im in sprites:
        if x + im.width > W: x = 0; y += shelf; shelf = 0
        atlas_entries[name] = {'x': x, 'y': y, 'w': im.width, 'h': im.height}; x += im.width + 4; shelf = max(shelf, im.height + 4)   # a wider gutter, so a scaled draw cannot reach a neighbour
    H = y + shelf; atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for name, im in sprites: e = atlas_entries[name]; atlas.paste(im, (e['x'], e['y']))
    pub = os.path.join(ROOT, 'apps', 'web', 'public', 'art'); os.makedirs(pub, exist_ok=True)
    atlas.save(os.path.join(pub, 'atlas.png'), optimize=True)
    # The page asks for atlas.png?v=<hash>, so a repack is never served from a stale cache.
    import hashlib
    version = hashlib.sha256(open(os.path.join(pub, 'atlas.png'), 'rb').read()).hexdigest()[:12]
    json.dump({'size': [W, H], 'version': version, 'sprites': atlas_entries}, open(os.path.join(pub, 'atlas.json'), 'w'), indent=1)
    print(f'atlas {W}x{H}, {len(sprites)} sprites')


if __name__ == '__main__':
    main()
