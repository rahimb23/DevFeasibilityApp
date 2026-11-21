"""Add precedent metrics (GFA, site area, FSI) to the snapshot's applications.json.

FSI is the figure stated in the description when there is one; otherwise proposed GFA
(from the description) divided by the area of the property parcels the application sits on.
Usage: python3 build_precedents.py <applications.json> <parcels-4326.geojson>
"""
import json, re, sys
import numpy as np
import shapely
from shapely.geometry import shape

apps_path, parcels_path = sys.argv[1:3]
NUM = r'(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{2,7}(?:\.\d+)?)'
AREA = r'\s*(?:square metres|square meters|sq\.? ?m\b|m2\b|m²|sm\b)'
GFA_RES = [re.compile(r'(?:gross floor area|GFA)[^0-9.;]{0,40}?' + NUM + AREA, re.I),
           re.compile(NUM + AREA + r'\s*(?:of\s*)?(?:total\s*|residential\s*|non-residential\s*)?(?:gross floor area|GFA)', re.I)]
FSI_RES = [re.compile(r'\bFSI\)?\s*(?:of|is|=|:)?\s*(?:approximately|approx\.?|about)?\s*(\d{1,2}(?:\.\d+)?)', re.I),
           re.compile(r'density of\s*(?:approximately\s*)?(\d{1,2}(?:\.\d+)?)\s*(?:times|x\b|FSI)', re.I),
           re.compile(r'(\d{1,2}(?:\.\d+)?)\s*times the (?:area of the )?lot', re.I),
           re.compile(r'floor space index (?:\(FSI\) )?(?:of )?(?:approximately )?(\d{1,2}(?:\.\d+)?)', re.I)]

def gfa(desc):
    vals = [float(m.group(1).replace(',', '')) for r in GFA_RES for m in r.finditer(desc)]
    vals = [v for v in vals if 100 <= v <= 2_000_000]
    return max(vals) if vals else None

def fsi(desc):
    for r in FSI_RES:
        m = r.search(desc)
        if m:
            v = float(m.group(1))
            if 0.1 <= v <= 60: return v
    return None

d = json.load(open(apps_path))
cols = d['cols']; I = {k: i for i, k in enumerate(cols)}
feats = json.load(open(parcels_path))['features']
geoms = [shape(f['geometry']) for f in feats if f['properties']['FEATURE_TYPE'] != 'RESERVE']
tree = shapely.STRtree(geoms)
lat0 = np.radians(43.7)
m2 = lambda g: shapely.area(g) * (111412.84 * np.cos(lat0)) * 111132.95
for c in ('gfaM2', 'siteM2', 'fsi', 'fsiSource'):
    cols.append(c)
n_fsi = 0
for r in d['rows']:
    desc = r[I['desc']] or ''
    g = gfa(desc)
    pts = r[I['pts']]
    site = None
    if pts:
        idx = set()
        for lat, lon in pts:
            idx.update(tree.query(shapely.Point(lon, lat), predicate='within').tolist())
        if idx: site = round(sum(m2(geoms[i]) for i in idx))
    f, src = fsi(desc), 'stated'
    if f is None and g and site and site > 50:
        f, src = round(g / site, 2), 'gfa/site'
        if not 0.1 <= f <= 60: f = None
    if f is None: src = None
    else: n_fsi += 1
    r.extend([round(g) if g else None, site, f, src])
with open(apps_path, 'w') as fh:
    fh.write('{"meta":%s,"cols":%s,"rows":[\n' % (json.dumps(d['meta']), json.dumps(cols)))
    fh.write(',\n'.join(json.dumps(r, separators=(',', ':'), ensure_ascii=False) for r in d['rows']))
    fh.write('\n]}')
print(n_fsi, 'applications with an FSI')
