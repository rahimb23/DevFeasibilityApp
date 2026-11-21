"""Precompute parcel-level feasibility facts for the Development Radar.

For every property parcel (City of Toronto Property Boundaries) this joins:
  zoning (By-law 569-2013 zone string, FSI, coverage, holding, exception), the former
  municipality (which sets the old by-law where 569-2013 does not apply), height and
  lot-coverage overlays, Secondary Plan, Site and Area Specific Policies, Major Transit
  Station Areas, ravine protection, the heritage register, 3D massing (existing
  buildings) and address points, then writes the parcels into map tiles.

Needs: pip install shapely pyshp
Usage: python3 build_parcels.py <input-dir> <output-dir>
Input dir holds the downloads named as in the README (parcels.geojson, zoning.geojson, ...).
"""
import csv, json, math, os, sys, collections
import numpy as np
import shapely
from shapely.geometry import shape, Point
import shapefile

src, out = sys.argv[1], sys.argv[2]
os.makedirs(f'{out}/parcels', exist_ok=True)
TILE = 0.02          # tile size in degrees
QP = 1_000_000       # coordinate quantization (1e-6 deg, about 0.1 m)
LAT0 = 43.7
MX = 111412.84 * math.cos(math.radians(LAT0)) - 93.5 * math.cos(3 * math.radians(LAT0))  # metres per degree lon
MY = 111132.95 - 559.85 * math.cos(2 * math.radians(LAT0))                                # metres per degree lat

def to_m(g):
    return shapely.transform(g, lambda c: np.column_stack(((c[:, 0] + 79.4) * MX, (c[:, 1] - LAT0) * MY)))

def load_geojson(name, keep=None):
    feats = json.load(open(f'{src}/{name}'))['features']
    geoms, props = [], []
    for f in feats:
        if not f.get('geometry'): continue
        g = shape(f['geometry'])
        if g.is_empty: continue
        if not g.is_valid: g = shapely.make_valid(g)
        geoms.append(g); props.append(f['properties'] if keep is None else {k: f['properties'].get(k) for k in keep})
    return np.array(geoms, dtype=object), props

def mtm27_to_wgs84(c):
    """NAD27 / MTM zone 10 metres -> WGS84 lon/lat (Canadian mean NAD27->NAD83 shift)."""
    a, f = 6378206.4, 1 / 294.9786982
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    x = c[:, 0] - 304800.0; y = c[:, 1]
    mu = y / 0.9999 / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * np.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * np.sin(4 * mu) + (151 * e1 ** 3 / 96) * np.sin(6 * mu)
    sp, cp, tp = np.sin(p), np.cos(p), np.tan(p)
    C = ep2 * cp ** 2; T = tp ** 2; N = a / np.sqrt(1 - e2 * sp ** 2); R = a * (1 - e2) / (1 - e2 * sp ** 2) ** 1.5; D = x / (N * 0.9999)
    lat = p - (N * tp / R) * (D ** 2 / 2 - (5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T + 298 * C + 45 * T ** 2 - 252 * ep2 - 3 * C ** 2) * D ** 6 / 720)
    lon = math.radians(-79.5) + (D - (1 + 2 * T + C) * D ** 3 / 6 + (5 - 2 * C + 28 * T - 3 * C ** 2 + 8 * ep2 + 24 * T ** 2) * D ** 5 / 120) / cp
    Nn = a / np.sqrt(1 - e2 * np.sin(lat) ** 2)
    X = Nn * np.cos(lat) * np.cos(lon) - 10; Y = Nn * np.cos(lat) * np.sin(lon) + 158; Z = Nn * (1 - e2) * np.sin(lat) + 187
    b, fb = 6378137.0, 1 / 298.257222101; eb = fb * (2 - fb); pr = np.hypot(X, Y); la = np.arctan2(Z, pr * (1 - eb))
    for _ in range(5):
        Nb = b / np.sqrt(1 - eb * np.sin(la) ** 2); la = np.arctan2(Z + eb * Nb * np.sin(la), pr)
    return np.column_stack((np.degrees(np.arctan2(Y, X)), np.degrees(la)))

def webmerc_to_wgs84(c):
    R = 6378137.0
    return np.column_stack((np.degrees(c[:, 0] / R), np.degrees(2 * np.arctan(np.exp(c[:, 1] / R)) - math.pi / 2)))

def load_shp(path):
    r = shapefile.Reader(path)
    prj = open(path[:-4] + '.prj').read() if os.path.exists(path[:-4] + '.prj') else ''
    fix = mtm27_to_wgs84 if 'North_American_1927' in prj else webmerc_to_wgs84 if 'Mercator' in prj else None
    geoms, props = [], []
    for sr in r.iterShapeRecords():
        try:
            g = shape(sr.shape.__geo_interface__)
        except Exception:
            continue
        if g.is_empty: continue
        if fix: g = shapely.transform(g, fix)
        if not g.is_valid: g = shapely.make_valid(g)
        geoms.append(g); props.append(sr.record.as_dict())
    return np.array(geoms, dtype=object), props

def find_shp(folder):
    for root, _, files in os.walk(f'{src}/{folder}'):
        for f in files:
            if f.lower().endswith('.shp'): return os.path.join(root, f)

print('parcels…', flush=True)
pg, pp = load_geojson('parcels.geojson', ['PARCELID', 'FEATURE_TYPE'])
sel = np.array([p['FEATURE_TYPE'] in ('COMMON', 'CONDO') for p in pp])
pg = pg[sel]; pp = [p for p, s in zip(pp, sel) if s]
N = len(pg)
rep = shapely.point_on_surface(pg)
pg_m = to_m(pg)
area = shapely.area(pg_m)
print(N, 'parcels', flush=True)

def point_join(layer_geoms):
    """For each parcel, the index of the layer polygon containing its interior point (or -1)."""
    tree = shapely.STRtree(layer_geoms)
    idx = np.full(N, -1)
    pairs = tree.query(rep, predicate='within')
    idx[pairs[0]] = pairs[1]
    return idx

def intersect_join(layer_geoms):
    """For each parcel, the list of layer polygons it overlaps by more than a sliver."""
    tree = shapely.STRtree(layer_geoms)
    pairs = tree.query(pg, predicate='intersects')
    res = collections.defaultdict(list)
    for a, b in zip(*pairs):
        res[a].append(b)
    return res

# ---- Zoning ----
print('zoning…', flush=True)
zg, zp = load_geojson('zoning.geojson')
zi = point_join(zg)
zones, zone_idx = [], {}
def zone_key(p):
    fsi = p['FSI_TOTAL'] if (p['FSI_TOTAL'] or -1) > 0 else (p['DENSITY'] if (p['DENSITY'] or -1) > 0 else None)
    return (p['ZN_STRING'], p['ZN_ZONE'], fsi, p['COVERAGE'] if p['COVERAGE'] not in (None, -1) else None,
            p['ZN_HOLDING'] == 'Y', p['EXCPTN_NO'] if p['ZN_EXCPTN'] == 'Y' else None, p['ZBL_CHAPT'],
            p['FRONTAGE'] if (p['FRONTAGE'] or -1) > 0 else None, p['ZN_AREA'] if (p['ZN_AREA'] or -1) > 0 else None,
            p['UNITS'] if (p['UNITS'] or -1) > 0 else None)
zcol = np.full(N, -1)
for i in range(N):
    if zi[i] < 0: continue
    k = zone_key(zp[zi[i]])
    if k not in zone_idx: zone_idx[k] = len(zones); zones.append(list(k))
    zcol[i] = zone_idx[k]

print('height & coverage overlays…', flush=True)
hg, hp = load_geojson('height.geojson')
hi = point_join(hg)
cg, cp = load_geojson('coverage.geojson')
ci = point_join(cg)

print('secondary plans, SASPs, MTSAs, ravines…', flush=True)
sg, sp = load_geojson('sp.geojson')
si = point_join(sg)
sp_names = [p['SECONDARY_PLAN_NAME'] for p in sp]
ag, ap = load_geojson('sasp.geojson')
asj = intersect_join(ag)
mg, mp = load_shp(find_shp('mtsa'))
mi = point_join(mg)
rg, _ = load_shp(find_shp('ravine'))
rv = intersect_join(rg)

print('former municipalities…', flush=True)
fm_names = []
fmi = np.full(N, -1)
if os.path.exists(f'{src}/formermun.geojson'):
    fg, fp = load_geojson('formermun.geojson')
    fmi = point_join(fg)
    fm_names = [p['AREA_NAME'] for p in fp]

print('heritage…', flush=True)
hrg, hrp = load_shp(find_shp('heritage'))
tree = shapely.STRtree(pg)
pairs = tree.query(hrg, predicate='within')
heritage = {}
RANK = {'Part IV': 3, 'Part V': 2, 'Listed': 1}
for a, b in zip(*pairs):
    st = (hrp[a].get('STATUS') or '').strip() or 'Listed'
    if RANK.get(st, 0) >= RANK.get(heritage.get(b), -1): heritage[b] = st

print('massing…', flush=True)
bg, bp = load_shp(find_shp('massing'))
brep = shapely.point_on_surface(bg)
barea = shapely.area(to_m(bg))
pairs = tree.query(brep, predicate='within')
bfp = np.zeros(N); bmax = np.zeros(N); bgfa = np.zeros(N); bcount = np.zeros(N, dtype=int)
for a, b in zip(*pairs):
    h = max(bp[a].get('AVG_HEIGHT') or 0, 0)
    if barea[a] < 8: continue
    bfp[b] += barea[a]; bcount[b] += 1
    bmax[b] = max(bmax[b], bp[a].get('MAX_HEIGHT') or 0)
    bgfa[b] += barea[a] * max(1, round(h / 3.3))

print('addresses…', flush=True)
ax, ay, alab = [], [], []
with open(f'{src}/addr.csv', newline='') as fh:
    for r in csv.DictReader(fh):
        try:
            c = json.loads(r['geometry'])['coordinates'][0]
        except Exception:
            continue
        ax.append(c[0]); ay.append(c[1]); alab.append(r['ADDRESS_FULL'])
apts = shapely.points(np.array(ax), np.array(ay))
pairs = tree.query(apts, predicate='within')
addrs = collections.defaultdict(list)
for a, b in zip(*pairs):
    addrs[b].append(alab[a])
def addr_sort(s):
    n = s.split(' ')[0]
    return (s.split(' ', 1)[-1], int(n) if n.isdigit() else 0)

print('dimensions & tiles…', flush=True)
mrr = shapely.oriented_envelope(pg_m)
tiles = collections.defaultdict(list)
simp = shapely.simplify(pg, 0.000002, preserve_topology=True)
lookups = {'zones': zones, 'zoneCols': ['string', 'zone', 'fsi', 'coverage', 'holding', 'exception', 'chapter', 'minFrontage', 'minLotArea', 'maxUnits'],
           'secondaryPlans': sp_names, 'sasp': [p['SASP_NO'] for p in ap], 'mtsa': [[p.get('StationNam'), p.get('MTSA_Type'), p.get('SASP_No')] for p in mp]}
for i in range(N):
    g = simp[i]
    poly = max(g.geoms, key=lambda x: x.area) if g.geom_type == 'MultiPolygon' else g
    if poly.geom_type != 'Polygon': continue
    ring = np.asarray(poly.exterior.coords)[:-1]
    x, y = rep[i].x, rep[i].y
    tk = (math.floor(x / TILE), math.floor(y / TILE))
    q = np.round(ring * QP).astype(np.int64)
    d = np.vstack([q[:1], np.diff(q, axis=0)]).ravel().tolist()
    e = np.asarray(mrr[i].exterior.coords)
    s1, s2 = math.dist(e[0], e[1]), math.dist(e[1], e[2])
    h = hp[hi[i]] if hi[i] >= 0 else None
    row = [
        pp[i]['PARCELID'], 'C' if pp[i]['FEATURE_TYPE'] == 'CONDO' else 'P', round(float(area[i])),
        round(min(s1, s2), 1), round(max(s1, s2), 1), int(zcol[i]),
        h['HT_LABEL'] if h and (h['HT_LABEL'] or -1) > 0 else None, h['HT_STORIES'] if h and (h['HT_STORIES'] or -1) > 0 else None,
        cp[ci[i]]['PRCNT_CVER'] if ci[i] >= 0 else None, int(si[i]), sorted(set(int(k) for k in asj.get(i, []))), int(mi[i]),
        1 if i in rv else 0, heritage.get(i), round(float(bfp[i])), round(float(bmax[i]), 1), round(float(bgfa[i])), int(bcount[i]),
        sorted(addrs.get(i, []), key=addr_sort)[:3], int(fmi[i]), round(x, 6), round(y, 6), d,
    ]
    tiles[tk].append(row)

cols = ['id', 'kind', 'areaM2', 'widthM', 'depthM', 'zone', 'heightM', 'heightStoreys', 'coveragePct', 'secondaryPlan', 'sasp', 'mtsa',
        'ravine', 'heritage', 'bldgFootprintM2', 'bldgMaxHeightM', 'bldgGfaEstM2', 'bldgCount', 'addresses', 'formerMun', 'lon', 'lat', 'ring']
index = {}
for (tx, ty), rows in tiles.items():
    name = f'{tx}_{ty}'
    with open(f'{out}/parcels/{name}.json', 'w') as fh:
        fh.write('{"q":%d,"rows":[\n' % QP + ',\n'.join(json.dumps(r, separators=(',', ':')) for r in rows) + '\n]}')
    index[name] = len(rows)
lookups.update({'cols': cols, 'tile': TILE, 'tiles': index, 'formerMunicipalities': fm_names})
json.dump(lookups, open(f'{out}/parcel-index.json', 'w'), separators=(',', ':'))
print('done:', N, 'parcels in', len(index), 'tiles;', len(zones), 'zone strings', flush=True)
