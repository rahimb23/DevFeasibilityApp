"""Build the static snapshot files for the published (serverless) version of the radar.

Usage: python3 build_snapshot.py <apps-json-from-/api/applications> <centreline-4326.geojson> <wards-4326.geojson> <out-dir>
"""
import json, math, sys

apps_path, tcl_path, wards_path, out = sys.argv[1:5]
Q = 1e5  # 1e-5 degree quantization (about 1 m)

def simplify(pts, tol):
    """Douglas-Peucker on (lon, lat) in degrees, tolerance in degrees."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, (y2 - y1); L = math.hypot(dx * 0.72, dy) or 1e-12
        best, idx = 0, None
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs((x - x1) * 0.72 * dy - (y - y1) * dx * 0.72) / L
            if d > best: best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True; stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]

def enc(pts):
    out, px, py = [], 0, 0
    for x, y in pts:
        ix, iy = round(x * Q), round(y * Q)
        out += [ix - px, iy - py]; px, py = ix, iy
    return out

# ---- Streets / linear features ----
CLASS = {
    'Expressway': 1, 'Expressway Ramp': 2, 'Major Arterial': 3, 'Major Arterial Ramp': 3, 'Minor Arterial': 4, 'Minor Arterial Ramp': 4,
    'Collector': 5, 'Collector Ramp': 5, 'Local': 6, 'Access Road': 6, 'Busway': 6, 'Laneway': 7,
    'Major Railway': 8, 'Minor Railway': 8, 'Major Shoreline': 9, 'Minor Shoreline (Land locked)': 9, 'River': 10, 'Creek/Tributary': 10,
    'Trail': 11, 'Walkway': 11,
}
tcl = json.load(open(tcl_path))['features']
names, name_idx, segs = [], {}, []
def num(v):
    try: return int(float(v))
    except (TypeError, ValueError): return 0
for f in tcl:
    p = f['properties']; c = CLASS.get(p.get('FEATURE_CODE_DESC'))
    if not c: continue
    g = f['geometry']
    lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    nm = p.get('LINEAR_NAME_FULL') or ''
    if nm == 'None' or c in (8, 9, 11): nm = ''  # keep names for roads and rivers only
    if nm not in name_idx: name_idx[nm] = len(names); names.append(nm)
    rng = [num(p.get('LO_NUM_L')), num(p.get('HI_NUM_L')), num(p.get('LO_NUM_R')), num(p.get('HI_NUM_R'))]
    tol = 0.000008 if c <= 7 else 0.00002
    for line in lines:
        pts = simplify([(x, y) for x, y, *_ in line], tol)
        if len(pts) < 2: continue
        seg = [c, name_idx[nm]] + (rng if any(rng) and c <= 6 else [0, 0, 0, 0]) + enc(pts)
        segs.append(seg)

with open(f'{out}/streets.json', 'w') as fh:
    fh.write('{"q":%d,"names":%s,"segs":[\n' % (Q, json.dumps(names, separators=(',', ':'))))
    fh.write(',\n'.join(json.dumps(s, separators=(',', ':')) for s in segs))
    fh.write('\n]}')

# ---- Wards ----
wards = []
for f in json.load(open(wards_path))['features']:
    p = f['properties']; g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    rings = []
    for poly in polys:
        ring = [(x, y) for x, y, *_ in poly[0]]
        h = len(ring) // 2  # closed ring: simplify each half so the endpoints differ
        rings.append(enc(simplify(ring[:h + 1], 0.00003)[:-1] + simplify(ring[h:], 0.00003)))
    wards.append({'code': p['AREA_SHORT_CODE'], 'name': p['AREA_NAME'], 'rings': rings})
json.dump({'q': Q, 'wards': wards}, open(f'{out}/wards.json', 'w'), separators=(',', ':'))

# ---- Applications ----
d = json.load(open(apps_path))
cols = ['id', 'type', 'status', 'submitted', 'desc', 'ward', 'wardName', 'url', 'parent', 'meeting', 'contact', 'units', 'storeys', 'addrs', 'pts']
with open(f'{out}/applications.json', 'w') as fh:
    fh.write('{"meta":%s,"cols":%s,"rows":[\n' % (json.dumps(d['meta']), json.dumps(cols)))
    fh.write(',\n'.join(json.dumps([a[c] for c in cols], separators=(',', ':'), ensure_ascii=False) for a in d['apps']))
    fh.write('\n]}')
print(len(segs), 'segments,', len(names), 'names,', len(wards), 'wards,', len(d['apps']), 'applications')
