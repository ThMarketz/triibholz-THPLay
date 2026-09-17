"""Fill an SVG path without a graphics library.

The app ships with no runtime dependencies and this machine has no cairo, ghostscript, inkscape
or imagemagick, so the icon build draws the mark itself: cubics flattened by recursive
subdivision, then a scanline pass that is analytic across x and supersampled down y.

Verified against SmashingLogo's own rasteriser (the vendor's 1200x867 high-res export of the same
vector): 98.76% coverage IoU, 48 of 543,906 pixels differing by more than half a pixel of
coverage, total ink area within 0.06%, at zero offset. See brand/README.md.

Everything here is even-odd, because that is the rule the mark was authored with: the ball's
seams and the arm's outline are counter-shapes punched out of the body, and a nonzero fill would
quietly flood them.
"""
import math, re

# ---------------------------------------------------------------- SVG path parsing
_NUM = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')

def parse_d(d):
    """M/L/C/Z absolute, which is all build-icons.py ever writes. Returns subpaths."""
    toks = re.findall(r'[MLCZmlczHhVv]|' + _NUM.pattern, d)
    subpaths, cur, pt, start, i = [], [], (0.0, 0.0), (0.0, 0.0), 0
    cmd = None
    def num():
        nonlocal i
        v = float(toks[i]); i += 1; return v
    while i < len(toks):
        t = toks[i]
        if re.fullmatch(r'[MLCZmlczHhVv]', t):
            cmd = t; i += 1
            if cmd in 'Zz':
                if cur:
                    cur.append(start); subpaths.append(cur); cur = []
                pt = start
                continue
        if cmd is None:
            i += 1; continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == 'M':
            x, y = num(), num()
            if rel: x, y = pt[0] + x, pt[1] + y
            if len(cur) > 1: subpaths.append(cur)
            pt = start = (x, y); cur = [pt]
            cmd = 'l' if rel else 'L'          # implicit lineto after moveto
        elif c == 'L':
            x, y = num(), num()
            if rel: x, y = pt[0] + x, pt[1] + y
            pt = (x, y); cur.append(pt)
        elif c == 'H':
            x = num()
            if rel: x = pt[0] + x
            pt = (x, pt[1]); cur.append(pt)
        elif c == 'V':
            y = num()
            if rel: y = pt[1] + y
            pt = (pt[0], y); cur.append(pt)
        elif c == 'C':
            x1, y1, x2, y2, x3, y3 = (num() for _ in range(6))
            if rel:
                x1, y1 = pt[0]+x1, pt[1]+y1; x2, y2 = pt[0]+x2, pt[1]+y2; x3, y3 = pt[0]+x3, pt[1]+y3
            cur.append(('C', (x1, y1), (x2, y2), (x3, y3))); pt = (x3, y3)
        else:
            i += 1
    if len(cur) > 1: subpaths.append(cur)
    return subpaths

def parse_svg(text):
    """viewBox plus every <path fill=... d=.../>, in document order."""
    m = re.search(r'viewBox\s*=\s*"([^"]+)"', text)
    vb = [float(v) for v in m.group(1).split()] if m else [0, 0, 1, 1]
    shapes = []
    for p in re.finditer(r'<path\b([^>]*)/>', text, re.S):
        attrs = p.group(1)
        fill = re.search(r'\bfill\s*=\s*"([^"]+)"', attrs)
        rule = re.search(r'\bfill-rule\s*=\s*"([^"]+)"', attrs)
        d    = re.search(r'\bd\s*=\s*"([^"]+)"', attrs, re.S)
        if not d: continue
        shapes.append({'colour': (fill.group(1) if fill else '#000000').lower(),
                       'rule': rule.group(1) if rule else 'nonzero',
                       'subpaths': parse_d(d.group(1))})
    return vb, shapes

# ---------------------------------------------------------------- flattening
def _flat(p0, p1, p2, p3, tol):
    ux = 3*p1[0] - 2*p0[0] - p3[0]; uy = 3*p1[1] - 2*p0[1] - p3[1]
    vx = 3*p2[0] - 2*p3[0] - p0[0]; vy = 3*p2[1] - 2*p3[1] - p0[1]
    return max(ux*ux, vx*vx) + max(uy*uy, vy*vy) <= 16 * tol * tol

def _cubic(p0, p1, p2, p3, tol, out, depth=0):
    if depth > 24 or _flat(p0, p1, p2, p3, tol):
        out.append(p3); return
    mid = lambda a, b: ((a[0]+b[0])/2, (a[1]+b[1])/2)
    p01, p12, p23 = mid(p0,p1), mid(p1,p2), mid(p2,p3)
    p012, p123 = mid(p01,p12), mid(p12,p23)
    m = mid(p012, p123)
    _cubic(p0, p01, p012, m, tol, out, depth+1)
    _cubic(m, p123, p23, p3, tol, out, depth+1)

def polyline(subpath, tol):
    pts, cur = [], None
    for seg in subpath:
        if isinstance(seg, tuple) and len(seg) == 4 and seg[0] == 'C':
            _cubic(cur, seg[1], seg[2], seg[3], tol, pts); cur = seg[3]
        else:
            pts.append(seg); cur = seg
    return pts

# ---------------------------------------------------------------- scanline fill
def coverage(shapes, W, H, sx, sy, ox, oy, sub=16):
    """Per-shape coverage in 0..1. Analytic across x, `sub` samples down y, even-odd."""
    out = []
    for s in shapes:
        edges = []
        for sp in s['subpaths']:
            pts = [(p[0]*sx + ox, p[1]*sy + oy) for p in polyline(sp, 0.35 / max(sx, sy))]
            if pts and pts[0] != pts[-1]: pts.append(pts[0])
            for i in range(len(pts) - 1):
                (x0, y0), (x1, y1) = pts[i], pts[i+1]
                if y0 != y1: edges.append((x0, y0, x1, y1))
        cov = [0.0] * (W * H)
        if not edges:
            out.append(cov); continue
        y_lo = max(0, int(math.floor(min(min(e[1], e[3]) for e in edges))))
        y_hi = min(H, int(math.ceil (max(max(e[1], e[3]) for e in edges))) + 1)
        inv = 1.0 / sub
        for py in range(y_lo, y_hi):
            row, touched = cov[py*W:(py+1)*W], False
            for k in range(sub):
                yy = py + (k + 0.5) * inv
                xs = [x0 + (yy - y0) * (x1 - x0) / (y1 - y0)
                      for (x0, y0, x1, y1) in edges if (y0 <= yy < y1) or (y1 <= yy < y0)]
                if len(xs) < 2: continue
                xs.sort()
                for i in range(0, len(xs) - 1, 2):      # even-odd: alternate spans are inside
                    a, b = xs[i], xs[i+1]
                    if b <= 0 or a >= W or b <= a: continue
                    a, b = max(a, 0.0), min(b, float(W))
                    ia, ib = int(a), min(int(b), W - 1)
                    touched = True
                    if ia == ib:
                        row[ia] += (b - a) * inv
                    else:
                        row[ia] += (ia + 1 - a) * inv
                        for px in range(ia + 1, ib): row[px] += inv
                        row[ib] += (b - ib) * inv
            if touched: cov[py*W:(py+1)*W] = row
        out.append(cov)
    return out

def draw(shapes, vb, size, inset, bg=None, recolour=None, sub=16):
    """The mark, centred, filling `inset` of a size x size image. bg=None leaves it transparent."""
    from PIL import Image
    w, h = vb[2] - vb[0], vb[3] - vb[1]
    scale = size * inset / max(w, h)
    ox, oy = (size - w*scale) / 2.0, (size - h*scale) / 2.0
    img = Image.new('RGBA', (size, size), (bg + (255,)) if bg else (0, 0, 0, 0))
    px = img.load()
    for s, cov in zip(shapes, coverage(shapes, size, size, scale, scale, ox, oy, sub)):
        col = (recolour or {}).get(s['colour'], s['colour'])
        r, g, b = int(col[1:3], 16), int(col[3:5], 16), int(col[5:7], 16)
        for i, c in enumerate(cov):
            if c <= 0.0005: continue
            c = min(1.0, c)
            x, y = i % size, i // size
            dr, dg, db, da = px[x, y]; da /= 255.0
            na = c + da * (1 - c)
            if na <= 0: continue
            px[x, y] = (round((r*c + dr*da*(1-c)) / na),
                        round((g*c + dg*da*(1-c)) / na),
                        round((b*c + db*da*(1-c)) / na),
                        round(na * 255))
    return img
