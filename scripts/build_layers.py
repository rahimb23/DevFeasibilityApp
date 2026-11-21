"""Build the map overlay layers (flood and environmental features) for the site.

Writes compact polygon files to <out>/layers/, each clipped to the City of Toronto:
  floodplain.json      TRCA regulatory floodplain (Regional Storm / 100-year, whichever is greater)
  trca-regulated.json  TRCA regulated area (where a TRCA permit is needed)
  ravine.json          City ravine and natural feature protection by-law area
  nhs.json             Official Plan Natural Heritage System (Map 9)
  esa.json             Environmentally Significant Areas
The former by-law layer is written by build_parcels.py, because it is built from parcels.

Usage: python3 build_layers.py <input-dir> <output-dir>
"""
import json, os, sys
import numpy as np
import shapely
from shapely.geometry import shape
import shapefile

src, out = sys.argv[1], sys.argv[2]
os.makedirs(f'{out}/layers', exist_ok=True)
Q = 100_000  # 1e-5 degree (about 1 m)


def load(path):
    """Features from a GeoJSON file or a (WGS84) shapefile folder as (geometry, properties)."""
    full = os.path.join(src, path)
    if os.path.isdir(full):
        shp = next(os.path.join(r, f) for r, _, fs in os.walk(full) for f in fs if f.lower().endswith('.shp'))
        rd = shapefile.Reader(shp)
        items = [(shape(sr.shape.__geo_interface__), sr.record.as_dict()) for sr in rd.iterShapeRecords()]
    else:
        items = [(shape(f['geometry']), f['properties']) for f in json.load(open(full))['features'] if f.get('geometry')]
    res = []
    for g, p in items:
        if g.is_empty: continue
        if not g.is_valid: g = shapely.make_valid(g)
        res.append((g, p))
    return res


def polys(g):
    if g.geom_type == 'Polygon': return [g]
    if g.geom_type == 'MultiPolygon': return list(g.geoms)
    if g.geom_type == 'GeometryCollection': return [p for x in g.geoms for p in polys(x)]
    return []


def enc_ring(coords):
    q = np.round(np.asarray(coords)[:-1, :2] * Q).astype(np.int64)
    if len(q) < 3: return None
    return np.vstack([q[:1], np.diff(q, axis=0)]).ravel().tolist()


def write_layer(name, items, tol=0.00001, min_m2=25, props=lambda p: {}):
    """items: [(geometry, properties)] -> layers/<name>.json with rings delta-encoded."""
    feats = []
    for g, p in items:
        g = shapely.simplify(g, tol, preserve_topology=True)
        for poly in polys(g):
            if poly.area * 111_000 * 80_000 < min_m2: continue
            rings = [enc_ring(poly.exterior.coords)] + [enc_ring(i.coords) for i in poly.interiors if i.area * 111_000 * 80_000 >= min_m2]
            rings = [r for r in rings if r]
            if rings: feats.append({'p': props(p), 'r': rings})
    with open(f'{out}/layers/{name}.json', 'w') as fh:
        fh.write('{"q":%d,"features":[\n' % Q + ',\n'.join(json.dumps(f, separators=(',', ':')) for f in feats) + '\n]}')
    print(f'{name}: {len(feats)} polygons, {os.path.getsize(f"{out}/layers/{name}.json") // 1024} KB', flush=True)


# City boundary from the former municipalities, used to clip the TRCA layers
city = shapely.union_all([g for g, _ in load('formermun.geojson')])



def clip(items, merge=False):
    out_items = []
    for g, p in items:
        if not g.intersects(city): continue
        out_items.append((g.intersection(city), p))
    if merge:  # dissolve overlapping pieces into one shape
        return [(shapely.union_all([g for g, _ in out_items]), {})]
    return out_items


if os.path.exists(f'{src}/floodplain.geojson'):
    fp = clip(load('floodplain.geojson'))
    # merge per watershed so overlapping engineered/estimated pieces draw cleanly
    by = {}
    for g, p in fp:
        by.setdefault((p.get('Watershed') or '', p.get('FloodPlainSource') or ''), []).append(g)
    write_layer('floodplain', [(shapely.union_all(gs), {'w': k[0], 's': k[1]}) for k, gs in by.items()], props=lambda p: p)
if os.path.exists(f'{src}/trca_regulated.geojson'):
    write_layer('trca-regulated', clip(load('trca_regulated.geojson'), merge=True))
if os.path.isdir(f'{src}/ravine'):
    write_layer('ravine', [(shapely.union_all([g for g, _ in load('ravine')]), {})])
if os.path.isdir(f'{src}/nhs'):
    write_layer('nhs', [(shapely.union_all([g for g, _ in load('nhs')]), {})], tol=0.00002)
if os.path.exists(f'{src}/esa.geojson'):
    write_layer('esa', load('esa.geojson'), props=lambda p: {'n': p.get('ESA_NAME')})
print('done')
