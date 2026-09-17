#!/usr/bin/env python3
"""Build the app icon set from brand/thplay-mark-dark.svg.

    python3 scripts/build-icons.py [--check]

The mark is vector (brand/), so every size is drawn from the same curves rather than resampled
from a big PNG. --check re-derives everything and fails if what is on disk differs. It is its own gate
(it needs Pillow, which tests/smoke.mjs does not), listed in README.md beside the others.

Two rules the platforms impose, both of which are silent failures if you get them wrong:

  · ICONS ARE OPAQUE. iOS and Android composite an app icon onto their own square and round the
    corners themselves. A transparent PNG becomes a black box on some launchers, so every icon
    here is painted onto the app's own ground first.
  · A MASKABLE ICON ONLY OWNS ITS INNER 80%. Android crops to a circle, a squircle or a teardrop
    depending on the launcher, so the art is drawn smaller in its canvas and this script asserts
    that not one pixel of ink falls outside that circle. The regular icons are NOT maskable and
    are deliberately drawn larger.
"""
import os, sys, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import vector                                                      # noqa: E402

GROUND = (0x07, 0x0f, 0x17)        # --bg, the app's own dark ground
MASTER = 'brand/thplay-mark-dark.svg'

# inset = the fraction of the square the mark spans. The maskable one is small on purpose.
ICONS = [
    ('icons/favicon-64.png',          64,  0.82, False),
    ('icons/icon-192.png',           192,  0.78, False),
    ('icons/icon-512.png',           512,  0.78, False),
    ('icons/apple-touch-icon.png',   180,  0.76, False),
    ('icons/icon-maskable-512.png',  512,  0.56, True),
]

def safe_zone_violations(img):
    """Ink outside the inner-80% circle, which is all a maskable icon is guaranteed to keep."""
    w, h = img.size
    cx = cy = w / 2.0
    r = w * 0.8 / 2.0
    px = img.load()
    bad = 0
    for y in range(h):
        for x in range(w):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                continue
            if px[x, y][:3] != GROUND:          # anything that is not bare ground is art
                bad += 1
    return bad

def build():
    vb, shapes = vector.parse_svg(open(os.path.join(ROOT, MASTER)).read())
    out = []
    for path, size, inset, maskable in ICONS:
        img = vector.draw(shapes, vb, size, inset, bg=GROUND)
        img = img.convert('RGB')                # opaque: launchers composite onto their own shape
        if maskable:
            bad = safe_zone_violations(img)
            if bad:
                raise SystemExit(f'{path}: {bad} ink pixels outside the inner-80% safe circle')
        out.append((path, img))
    return out

def main():
    check = '--check' in sys.argv
    built = build()
    changed = []
    for path, img in built:
        full = os.path.join(ROOT, path)
        import io
        buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True)
        new = buf.getvalue()
        old = open(full, 'rb').read() if os.path.exists(full) else None
        same = old is not None and hashlib.sha256(old).digest() == hashlib.sha256(new).digest()
        if check:
            if not same: changed.append(path)
        elif not same:
            open(full, 'wb').write(new); changed.append(path)
        print(f'  {path:32s} {img.size[0]:>4}px  {len(new):>7} bytes  {"changed" if not same else "unchanged"}')
    if check and changed:
        raise SystemExit('icons differ from brand/ — run: python3 scripts/build-icons.py\n  ' + '\n  '.join(changed))
    print(('checked ' if check else 'wrote ') + f'{len(built)} icons from {MASTER}')

if __name__ == '__main__':
    main()
