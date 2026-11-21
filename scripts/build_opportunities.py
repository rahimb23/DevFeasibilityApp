"""Score every parcel for development opportunity and write the results into the site.

Adds an `opp` column to each parcel tile and writes opportunities.json, a ranked list of
the best-scoring parcels for the map and the Opportunities tab.

Score (0-100) = zoning (25) + transit (20) + density gap (25) + lot size (15)
              + market momentum (10) + Secondary Plan (5) - constraint penalties.
Parcels are excluded (opp = -code) when they are condos, designated heritage, in the
floodplain, in a zone not meant for intensification, too small, or have little room to add
floor area. Development applications located on each parcel are counted; parcels with a
rezoning, site plan, condo or subdivision file from the last 6 years are flagged as already
in the pipeline.

Usage: python3 build_opportunities.py <site-dir>
"""
import datetime, glob, json, math, os, sys
import numpy as np
import shapely

site = sys.argv[1]
idx = json.load(open(f'{site}/parcel-index.json'))
C = {c: i for i, c in enumerate(idx['cols'])}
ZC = {c: i for i, c in enumerate(idx['zoneCols'])}
zones, mtsa = idx['zones'], idx['mtsa']
apps_doc = json.load(open(f'{site}/applications.json'))
A = {c: i for i, c in enumerate(apps_doc['cols'])}
today = datetime.date.today()
since6 = (today.replace(year=today.year - 6)).isoformat()
since5 = (today.replace(year=today.year - 5)).isoformat()
since10 = (today.replace(year=today.year - 10)).isoformat()

ZONE_PTS = {'CR': 25, 'CRE': 25, 'RA': 22, 'RAC': 22, 'CL': 20, 'RM': 10, 'R': 6, 'RT': 6, 'RD': 0, 'RS': 0}
LOW_RISE = {'RM', 'R', 'RT', 'RD', 'RS'}
EXCLUDE_ZONES = {'O', 'ON', 'OR', 'OG', 'OC', 'OM', 'UT', 'E', 'EH', 'EL', 'EO', 'I', 'IH', 'IE', 'IS', 'IPW'}
# exclusion codes (stored as negative numbers)
EX = {'condo': 1, 'designated': 2, 'floodplain': 3, 'zone': 4, 'small': 5, 'nogap': 6, 'inplay': 7}

# ---- Application-derived neighbourhood stats on a ~550 m grid ----
CELL = 0.005
def cell(lat, lon): return (math.floor(lon / CELL), math.floor(lat / CELL))
fsi_cells, count_cells, app_pts, app_idx = {}, {}, [], []
for ai, r in enumerate(apps_doc['rows']):
    pts, typ, sub = r[A['pts']], r[A['type']], r[A['submitted']] or ''
    if not pts: continue
    lat, lon = pts[0]
    if typ in ('OZ', 'SA') and sub >= since5:
        k = cell(lat, lon); count_cells[k] = count_cells.get(k, 0) + 1
    if typ in ('OZ', 'SA') and sub >= since10 and r[A['fsi']] and 'refused' not in (r[A['status']] or '').lower():
        k = cell(lat, lon); fsi_cells.setdefault(k, []).append(r[A['fsi']])
    for la, lo in pts:  # every application, any type or year, for the on-site check
        app_pts.append((lo, la)); app_idx.append(ai)


def around(d, k, empty):
    out = [] if empty == 'list' else 0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            v = d.get((k[0] + dx, k[1] + dy))
            if v is None: continue
            if empty == 'list': out += v
            else: out += v
    return out

# ---- Load tiles ----
tiles = {}
for path in sorted(glob.glob(f'{site}/parcels/*.json')):
    tiles[path] = json.load(open(path))
rows = [(p, i, r) for p, t in tiles.items() for i, r in enumerate(t['rows'])]
print(len(rows), 'parcels', flush=True)

# development applications located on each parcel (any type, any year)
polys = []
for p, i, r in rows:
    ring, q = r[C['ring']], tiles[p]['q']
    xy = np.cumsum(np.asarray(ring, dtype=np.int64).reshape(-1, 2), axis=0) / q
    polys.append(shapely.Polygon(xy) if len(xy) >= 3 else shapely.Point(0, 0))
polys = np.asarray(polys, dtype=object)
tree = shapely.STRtree(polys)
on_site = {}
if app_pts:
    a, b = tree.query(shapely.points(np.asarray(app_pts)), predicate='within')
    for ai, pi in zip(a, b):
        lst = on_site.setdefault(int(pi), [])
        if app_idx[ai] not in lst: lst.append(app_idx[ai])
def latest_first(ids):
    return sorted(ids, key=lambda j: apps_doc['rows'][j][A['submitted']] or '', reverse=True)
# "in the pipeline": a rezoning, site plan, condominium or subdivision file from the last 6 years on the parcel
inplay = np.zeros(len(rows), dtype=bool)
for pi, ids in on_site.items():
    inplay[pi] = any(apps_doc['rows'][j][A['type']] in ('OZ', 'SA', 'CD', 'SB') and (apps_doc['rows'][j][A['submitted']] or '') >= since6 for j in ids)
print(len(on_site), 'parcels have applications on them;', int(inplay.sum()), 'already in the pipeline', flush=True)

# ---- Score ----
opps = []
for n, (p, i, r) in enumerate(rows):
    area = r[C['areaM2']] or 0
    z = zones[r[C['zone']]] if r[C['zone']] >= 0 else None
    zcat = z[ZC['zone']] if z else None
    env, her = r[C['env']] or 0, r[C['heritage']]
    if r[C['kind']] == 'C': r.append(-EX['condo']); continue
    if her == 'Part IV': r.append(-EX['designated']); continue
    if env & 1: r.append(-EX['floodplain']); continue
    if zcat in EXCLUDE_ZONES or (z and zcat not in ZONE_PTS): r.append(-EX['zone']); continue
    if area < 300: r.append(-EX['small']); continue

    lat, lon = r[C['lat']], r[C['lon']]
    k = cell(lat, lon)
    prec = around(fsi_cells, k, 'list')
    zoned = z[ZC['fsi']] if z else None
    prec_med = float(np.median(prec)) if len(prec) >= 3 else None
    if zcat in LOW_RISE:
        target = max(zoned or 0.6, 1.0)          # neighbourhoods: multiplex / missing-middle scale
    else:
        target = max(x for x in (prec_med, zoned, 2.0) if x is not None)
        target = min(target, 25.0)
    existing = (r[C['bldgGfaEstM2']] or 0) / area if area else 0
    add_gfa = (target - existing) * area
    if add_gfa < 1500: r.append(-EX['nogap']); continue

    zone_pts = ZONE_PTS.get(zcat, 10)  # sites under a former by-law: unknown zone, middle score
    m = mtsa[r[C['mtsa']]] if r[C['mtsa']] >= 0 else None
    transit = (20 if 'Protected' in (m[1] or '') else 15) if m else 0
    ratio = existing / target if target else 1
    gap = 25 if ratio < 0.15 else 20 if ratio < 0.3 else 12 if ratio < 0.5 else 5 if ratio < 0.7 else 0
    size = 15 if area >= 4000 else 12 if area >= 2000 else 8 if area >= 1000 else 4 if area >= 600 else 0
    cnt = around(count_cells, k, 'num')
    momentum = 10 if cnt >= 15 else 7 if cnt >= 6 else 4 if cnt >= 2 else 0
    plan = 5 if r[C['secondaryPlan']] >= 0 else 0
    penalty = (15 if env & 2 else 0) + (15 if env & 4 else 0) + (10 if env & 8 else 0) + (10 if r[C['ravine']] else 0) \
        + (12 if her == 'Part V' else 8 if her == 'Listed' else 0)
    score = max(0, min(100, zone_pts + transit + gap + size + momentum + plan - penalty))
    r.append([score, zone_pts, transit, gap, size, momentum, plan, penalty, round(target, 1), round(add_gfa), cnt,
              len(on_site.get(n, [])), int(inplay[n])])
    opps.append((score, add_gfa, p, r, n))

# ---- Write tiles, index and the ranked list ----
for path, t in tiles.items():
    with open(path, 'w') as fh:
        fh.write('{"q":%d,"rows":[\n' % t['q'] + ',\n'.join(json.dumps(r, separators=(',', ':')) for r in t['rows']) + '\n]}')
idx['cols'].append('opp')
idx['oppParts'] = ['score', 'zoning', 'transit', 'densityGap', 'lotSize', 'momentum', 'secondaryPlan', 'penalty', 'targetFsi', 'addGfaM2', 'nearbyFiles', 'appsOnSite', 'inPipeline']
idx['oppExcluded'] = {str(v): k for k, v in EX.items()}
json.dump(idx, open(f'{site}/parcel-index.json', 'w'), separators=(',', ':'))

opps.sort(key=lambda x: (-x[0], -x[1]))
top, n_free, n_pipe = [], 0, 0
for score, add_gfa, p, r, n in opps:
    # up to 3,000 open sites plus up to 1,500 sites already in the pipeline (shown on request)
    if inplay[n]:
        if n_pipe >= 1500 or score < 50: continue
        n_pipe += 1
    else:
        if n_free >= 3000 or (score < 50 and n_free >= 1500): continue
        n_free += 1
    z = zones[r[C['zone']]] if r[C['zone']] >= 0 else None
    m = mtsa[r[C['mtsa']]] if r[C['mtsa']] >= 0 else None
    o = r[-1]
    top.append({'id': r[C['id']], 'lat': r[C['lat']], 'lon': r[C['lon']], 's': score, 'a': (r[C['addresses']] or [None])[0],
                'area': r[C['areaM2']], 'z': z[ZC['string']] if z else None, 't': o[8], 'g': o[9], 'm': m[0] if m else None,
                'parts': o[1:8], 'n': o[11], 'p': o[12],
                'ap': [[apps_doc['rows'][j][A['id']], apps_doc['rows'][j][A['type']], apps_doc['rows'][j][A['status']], apps_doc['rows'][j][A['submitted']]]
                       for j in latest_first(on_site.get(n, []))[:3]]})
json.dump({'generated': today.isoformat(), 'count': len(opps), 'top': top}, open(f'{site}/opportunities.json', 'w'), separators=(',', ':'))
scores = np.array([o[0] for o in opps])
print(f'scored {len(opps)} parcels; median {np.median(scores):.0f}, 90th pct {np.percentile(scores, 90):.0f}, max {scores.max()}; '
      f'{len(top)} in opportunities.json ({n_pipe} already in the pipeline)', flush=True)
