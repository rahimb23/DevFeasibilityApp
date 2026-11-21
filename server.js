// Toronto Development Radar: a dependency-free Node server (Node 18+).
// It pulls the City of Toronto "Development Applications" open-data feed, groups rows
// into applications, converts NAD27 MTM-10 coordinates to WGS84, and serves the map UI.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 3000;
const CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
const PACKAGE_ID = 'development-applications';
const REFRESH_MS = (Number(process.env.REFRESH_HOURS) || 6) * 3600e3;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Coordinates: NAD27 / MTM zone 10 (EPSG:2019) -> WGS84 ----------
const CLARKE = { a: 6378206.4, f: 1 / 294.9786982 };
const GRS80 = { a: 6378137.0, f: 1 / 298.257222101 };

function mtmInverse(x, y, { a, f }) {
  const lon0 = -79.5, k0 = 0.9999, FE = 304800;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  x -= FE;
  const mu = y / k0 / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
  const C = ep2 * c * c, T = t * t;
  const N = a / Math.sqrt(1 - e2 * s * s);
  const R = a * (1 - e2) / (1 - e2 * s * s) ** 1.5;
  const D = x / (N * k0);
  const lat = p - (N * t / R) * (D ** 2 / 2 - (5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T + 298 * C + 45 * T ** 2 - 252 * ep2 - 3 * C ** 2) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T + C) * D ** 3 / 6
    + (5 - 2 * C + 28 * T - 3 * C ** 2 + 8 * ep2 + 24 * T ** 2) * D ** 5 / 120) / c;
  return [lat, lon0 * Math.PI / 180 + lon];
}

// NAD27 -> NAD83 with the Canadian mean 3-parameter shift (good to a few metres in Toronto).
function nad27ToNad83(lat, lon) {
  const { a, f } = CLARKE, e2 = f * (2 - f);
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const X = N * Math.cos(lat) * Math.cos(lon) - 10;
  const Y = N * Math.cos(lat) * Math.sin(lon) + 158;
  const Z = N * (1 - e2) * Math.sin(lat) + 187;
  const e2b = GRS80.f * (2 - GRS80.f), p = Math.hypot(X, Y);
  let la = Math.atan2(Z, p * (1 - e2b));
  for (let i = 0; i < 5; i++) {
    const Nb = GRS80.a / Math.sqrt(1 - e2b * Math.sin(la) ** 2);
    la = Math.atan2(Z + e2b * Nb * Math.sin(la), p);
  }
  return [la * 180 / Math.PI, Math.atan2(Y, X) * 180 / Math.PI];
}

function toLatLon(x, y) {
  const X = parseFloat(x), Y = parseFloat(y);
  if (!isFinite(X) || !isFinite(Y) || X < 250000 || Y < 4800000) return null;
  const [lat, lon] = nad27ToNad83(...mtmInverse(X, Y, CLARKE));
  return [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6];
}

// ---------- Text helpers ----------
const clean = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const date = (s) => (s ? String(s).slice(0, 10) : null);
const UNIT_RE = /(\d{1,3}(?:,\d{3})+|\d+)\s+(?:new\s+)?(?:residential\s+|dwelling\s+|rental\s+|condominium\s+|townhouse\s+|affordable\s+|purpose[- ]built\s+)*(?:dwelling\s+)?units\b/gi;
const STOREY_RE = /(\d{1,3})[- ]stor(?:e)?y/gi;
function maxMatch(re, text, cap) {
  let best = null;
  for (const m of text.matchAll(re)) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (n > 0 && n <= cap && (best == null || n > best)) best = n;
  }
  return best;
}
const address = (r) => clean([r.STREET_NUM, r.STREET_NAME, r.STREET_TYPE, r.STREET_DIRECTION].join(' '))
  .replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());

// ---------- Feed ----------
let cache = null; // { apps, meta, gz }
let loading = null;

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'toronto-dev-radar/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  const body = await res.json();
  if (!body.success) throw new Error(`CKAN error from ${url}`);
  return body.result;
}

async function loadFeed() {
  const pkg = await getJSON(`${CKAN}/package_show?id=${PACKAGE_ID}`);
  const res = pkg.resources.find((r) => r.datastore_active);
  if (!res) throw new Error('No datastore resource on the package');
  const sourceUpdated = pkg.resources.map((r) => r.last_modified).filter(Boolean).sort().pop() || pkg.metadata_modified;

  const rows = [];
  for (let offset = 0; ; offset += 10000) {
    const page = await getJSON(`${CKAN}/datastore_search?id=${res.id}&limit=10000&offset=${offset}`);
    rows.push(...page.records);
    if (page.records.length < 10000 || rows.length >= page.total) break;
  }

  // One application can span several addresses (one row each): group by application number.
  const byId = new Map();
  for (const r of rows) {
    const id = clean(r['APPLICATION#']);
    if (!id) continue;
    let app = byId.get(id);
    if (!app) {
      const desc = clean(r.DESCRIPTION);
      app = {
        id,
        type: clean(r.APPLICATION_TYPE),
        status: clean(r.STATUS),
        submitted: date(r.DATE_SUBMITTED),
        desc,
        ward: clean(r.WARD_NUMBER),
        wardName: clean(r.WARD_NAME),
        url: clean(r.APPLICATION_URL) || null,
        parent: clean(r.PARENT_FOLDER_NUMBER) || null,
        meeting: r.COMMUNITY_MEETING_DATE ? {
          date: date(r.COMMUNITY_MEETING_DATE), time: clean(r.COMMUNITY_MEETING_TIME), place: clean(r.COMMUNITY_MEETING_LOCATION),
        } : null,
        contact: clean(r.CONTACT_NAME) ? { name: clean(r.CONTACT_NAME), phone: clean(r.CONTACT_PHONE), email: clean(r.CONTACT_EMAIL) } : null,
        units: maxMatch(UNIT_RE, desc, 20000),
        storeys: maxMatch(STOREY_RE, desc, 120),
        addrs: [],
        pts: [],
      };
      byId.set(id, app);
    }
    const addr = address(r);
    if (addr && !app.addrs.includes(addr)) app.addrs.push(addr);
    const ll = toLatLon(r.X, r.Y);
    if (ll && !app.pts.some((p) => p[0] === ll[0] && p[1] === ll[1])) app.pts.push(ll);
  }
  const apps = [...byId.values()].sort((a, b) => (b.submitted || '').localeCompare(a.submitted || ''));
  const meta = {
    rows: rows.length,
    applications: apps.length,
    withoutLocation: apps.filter((a) => !a.pts.length).length,
    sourceUpdated,
    fetchedAt: new Date().toISOString(),
    source: `https://open.toronto.ca/dataset/${PACKAGE_ID}/`,
  };
  const gz = zlib.gzipSync(JSON.stringify({ meta, apps }));
  cache = { meta, gz };
  console.log(`[feed] ${meta.applications} applications from ${meta.rows} rows (source updated ${sourceUpdated})`);
  return { meta, apps };
}

function refresh() {
  if (!loading) loading = loadFeed().catch((e) => { console.error('[feed] refresh failed:', e.message); throw e; })
    .finally(() => { loading = null; });
  return loading;
}

// ---------- Geocoding (Nominatim, limited to the Toronto area) ----------
const geoCache = new Map();
async function geocode(q) {
  const key = q.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: /toronto/i.test(q) ? q : `${q}, Toronto`, format: 'json', limit: '5', countrycodes: 'ca',
    viewbox: '-79.64,43.86,-79.11,43.58', bounded: '1',
  });
  const res = await fetch(url, { headers: { 'User-Agent': 'toronto-dev-radar/1.0 (open-data map)' } });
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);
  const out = (await res.json()).map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
  geoCache.set(key, out);
  return out;
}

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/applications') {
      if (!cache) await refresh();
      const gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      return send(res, 200, gzipOk ? cache.gz : zlib.gunzipSync(cache.gz), {
        'Content-Type': 'application/json', ...(gzipOk && { 'Content-Encoding': 'gzip' }), 'Cache-Control': 'public, max-age=600',
      });
    }
    if (url.pathname === '/api/meta') {
      if (!cache) await refresh();
      return send(res, 200, JSON.stringify(cache.meta), { 'Content-Type': 'application/json' });
    }
    if (url.pathname === '/api/geocode') {
      const q = clean(url.searchParams.get('q')).slice(0, 200);
      if (!q) return send(res, 400, '[]', { 'Content-Type': 'application/json' });
      return send(res, 200, JSON.stringify(await geocode(q)), { 'Content-Type': 'application/json' });
    }
    // Static files
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, data, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    });
  } catch (e) {
    console.error(e);
    send(res, 502, JSON.stringify({ error: e.message }), { 'Content-Type': 'application/json' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Toronto Development Radar on http://localhost:${PORT}`));
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), REFRESH_MS).unref();
}

module.exports = { loadFeed, toLatLon, maxMatch, UNIT_RE, STOREY_RE };
