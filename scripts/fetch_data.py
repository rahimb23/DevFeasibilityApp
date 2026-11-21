"""Download the City of Toronto Open Data inputs for the site build into data/raw.

Each resource is looked up by package and resource name through the CKAN API, so the
script keeps working when the City replaces a file (its download URL changes).
Usage: python3 scripts/fetch_data.py [out-dir]
"""
import json, os, sys, urllib.request, zipfile, shutil

CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/raw'

# (package id, matcher for the resource name, local file name, unzip?)
WANTED = [
    ('toronto-centreline-tcl', lambda n: n == 'Centreline - Version 2 - 4326.geojson', 'centreline.geojson', False),
    ('city-wards', lambda n: n == 'City Wards Data - 4326.geojson', 'wards.geojson', False),
    ('property-boundaries', lambda n: n == 'Property Boundaries - 4326.geojson', 'parcels.geojson', False),
    ('zoning-by-law', lambda n: n == 'Zoning Area - 4326.geojson', 'zoning.geojson', False),
    ('zoning-by-law', lambda n: n == 'Zoning Height Overlay - 4326.geojson', 'height.geojson', False),
    ('zoning-by-law', lambda n: n == 'Zoning Lot Coverage Overlay - 4326.geojson', 'coverage.geojson', False),
    ('secondary-plans', lambda n: n == 'Secondary Plans Data - 4326.geojson', 'sp.geojson', False),
    ('former-municipality-boundaries', lambda n: n == 'Former Municipality Boundaries Data - 4326.geojson', 'formermun.geojson', False),
    ('site-and-area-specific-policies', lambda n: n == 'Site and Area Specific Policies Data - 4326.geojson', 'sasp.geojson', False),
    ('address-points-municipal-toronto-one-address-repository', lambda n: n == 'Address Points - 4326.csv', 'addr.csv', False),
    ('minister-approved-major-transit-station-areas', lambda n: 'delineation' in n.lower(), 'mtsa', True),
    ('heritage-register', lambda n: n == 'Heritage Register Data', 'heritage', True),
    ('ravine-natural-feature-protection-area', lambda n: 'wgs84' in n.lower(), 'ravine', True),
    # newest WGS84 3D massing shapefile (names look like 3DMassingShapefile_2025_WGS84.zip)
    ('3d-massing', 'massing', 'massing', True),
]

def api(action, **params):
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    with urllib.request.urlopen(f'{CKAN}/{action}?{q}', timeout=120) as r:
        return json.load(r)['result']

def pick(pkg, match):
    res = api('package_show', id=pkg)['resources']
    if match == 'massing':
        cands = sorted((r for r in res if r['name'].startswith('3DMassingShapefile_') and 'WGS84' in r['name']), key=lambda r: r['name'])
        return cands[-1]
    for r in res:
        if match(r['name']):
            return r
    raise SystemExit(f'No matching resource in {pkg}: {[r["name"] for r in res]}')

def download(url, dest):
    tmp = dest + '.part'
    req = urllib.request.Request(url, headers={'User-Agent': 'toronto-dev-radar-build'})
    with urllib.request.urlopen(req, timeout=600) as r, open(tmp, 'wb') as fh:
        shutil.copyfileobj(r, fh, 1 << 20)
    os.replace(tmp, dest)

os.makedirs(OUT, exist_ok=True)
for pkg, match, name, unzip in WANTED:
    r = pick(pkg, match)
    dest = os.path.join(OUT, name + ('.zip' if unzip else ''))
    print(f'{pkg}: {r["name"]}', flush=True)
    download(r['url'], dest)
    if unzip:
        folder = os.path.join(OUT, name)
        shutil.rmtree(folder, ignore_errors=True)
        with zipfile.ZipFile(dest) as z:
            z.extractall(folder)
        os.remove(dest)
print('done')
