// Site feasibility for the Development Radar: parcel layer, planning controls,
// nearby precedents and a residual land value (RLV) pro forma.
// Loaded after the main page script and uses its globals (map, APPS, css, fmt, esc, $ ...).
'use strict';

const SQFT = 10.7639, ACRE_M2 = 4046.856;
const PARCELS = { index: null, tiles: new Map(), loading: new Map() };
const site = { ids: [], parcels: [], assemble: false, precRadius: 750, scenario: 'auto', customFsi: 4 };
let siteMode = false;
let siteLayer = null;

// ---------- Pro forma assumptions ----------
const DEFAULTS = {
  efficiency: 82, unitSize: 700, salePsf: 1050, parkRatio: 0.3, stallPrice: 70000,
  hardPsf: 375, stallCost: 120000, contingency: 5, softPct: 22, dcPerUnit: 60000, demoPsf: 20,
  salesPct: 5, finRate: 7, finYears: 4, finDraw: 55, profitPct: 15, closingPct: 4, parklandPct: 10, cbcPct: 4,
  floorplate: 750,
};
const FIELDS = [
  ['Building', [
    ['efficiency', 'Saleable share of GFA', '%', 1], ['unitSize', 'Average unit size', 'sf', 25], ['floorplate', 'Typical floor plate', 'm²', 25],
  ]],
  ['Revenue', [
    ['salePsf', 'Sale price', '$/sf', 25], ['parkRatio', 'Parking stalls per unit', '', 0.05], ['stallPrice', 'Parking stall price', '$', 5000],
  ]],
  ['Construction and soft costs', [
    ['hardPsf', 'Hard cost (above grade)', '$/sf GFA', 5], ['stallCost', 'Underground parking cost', '$/stall', 5000],
    ['contingency', 'Contingency', '% of hard', 0.5], ['softPct', 'Soft costs', '% of hard', 1], ['demoPsf', 'Demolition of existing buildings', '$/sf', 1],
  ]],
  ['Charges', [
    ['dcPerUnit', 'Development charges (City + education)', '$/unit', 1000], ['parklandPct', 'Parkland cash-in-lieu', '% of land value', 0.5],
    ['cbcPct', 'Community benefits charge', '% of land value', 0.5],
  ]],
  ['Sales, finance and return', [
    ['salesPct', 'Sales and marketing', '% of revenue', 0.5], ['finRate', 'Construction loan rate', '%', 0.25], ['finYears', 'Development period', 'years', 0.5],
    ['finDraw', 'Average loan balance', '% of costs', 5], ['profitPct', 'Developer profit', '% of revenue', 0.5], ['closingPct', 'Land closing costs and transfer tax', '% of land value', 0.25],
  ]],
];
let PF = { ...DEFAULTS };
try { Object.assign(PF, JSON.parse(localStorage.getItem('tdr-proforma-v1') || '{}')); } catch { /* defaults */ }
const savePF = () => { try { localStorage.setItem('tdr-proforma-v1', JSON.stringify(PF)); } catch { /* ignore */ } };

// ---------- Parcel tiles ----------
function tileKey(lon, lat) { const t = PARCELS.index.tile; return `${Math.floor(lon / t)}_${Math.floor(lat / t)}`; }
function loadTile(key) {
  if (!PARCELS.index || !PARCELS.index.tiles[key]) return Promise.resolve(null);
  if (PARCELS.tiles.has(key)) return Promise.resolve(PARCELS.tiles.get(key));
  if (PARCELS.loading.has(key)) return PARCELS.loading.get(key);
  const p = fetch(`parcels/${key}.json`).then((r) => r.json()).then((j) => {
    const C = PARCELS.index.cols, ix = Object.fromEntries(C.map((c, i) => [c, i]));
    const list = j.rows.map((r) => {
      const ring = r[ix.ring], pts = [];
      let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        x += ring[i]; y += ring[i + 1];
        const lon = x / j.q, lat = y / j.q; pts.push([lat, lon]);
        if (lon < x0) x0 = lon; if (lon > x1) x1 = lon; if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
      }
      const o = {}; C.forEach((c, i) => { if (c !== 'ring') o[c] = r[i]; });
      o.pts = pts; o.bb = [x0, y0, x1, y1];
      return o;
    });
    PARCELS.tiles.set(key, list); PARCELS.loading.delete(key);
    return list;
  }).catch(() => { PARCELS.loading.delete(key); PARCELS.tiles.set(key, []); return []; });
  PARCELS.loading.set(key, p);
  return p;
}
function inRing(lat, lon, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
async function parcelAt(lat, lon) {
  if (!PARCELS.index) return null;
  const t = PARCELS.index.tile, keys = [];
  for (const dx of [0, -1, 1]) for (const dy of [0, -1, 1]) keys.push(`${Math.floor(lon / t) + dx}_${Math.floor(lat / t) + dy}`);
  for (const k of keys) {
    const list = await loadTile(k); if (!list) continue;
    for (const p of list) {
      if (lon < p.bb[0] || lon > p.bb[2] || lat < p.bb[1] || lat > p.bb[3]) continue;
      if (inRing(lat, lon, p.pts)) return p;
    }
  }
  return null;
}

// Nearest non-condo parcel (by vertex distance) when a point falls on a road
async function nearestParcel(lat, lon, maxM = 80) {
  const hit = await parcelAt(lat, lon);
  if (hit) return hit;
  const t = PARCELS.index.tile; let best = null, bd = maxM;
  for (const dx of [0, -1, 1]) for (const dy of [0, -1, 1]) {
    const list = await loadTile(`${Math.floor(lon / t) + dx}_${Math.floor(lat / t) + dy}`); if (!list) continue;
    for (const p of list) {
      if (p.kind === 'C' || p.bb[0] > lon + 0.002 || p.bb[2] < lon - 0.002 || p.bb[1] > lat + 0.002 || p.bb[3] < lat - 0.002) continue;
      for (const [la, lo] of p.pts) { const d = haversine(lat, lon, la, lo); if (d < bd) { bd = d; best = p; } }
    }
  }
  return best;
}

// Parcel outlines, drawn on canvas tiles at street zoom
const ParcelLayer = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
    tile.width = tile.height = 256 * dpr; tile.className = 'basemap-tile';
    if (coords.z >= 16 && PARCELS.index) drawParcels(tile, coords, dpr);
    return tile;
  },
});
function drawParcels(tile, coords, dpr) {
  const z = coords.z, x0 = coords.x * 256, y0 = coords.y * 256;
  const w = unX(x0, z), e = unX(x0 + 256, z), n = unY(y0, z), s = unY(y0 + 256, z);
  const t = PARCELS.index.tile, keys = new Set();
  for (let gx = Math.floor(w / t) - 1; gx <= Math.floor(e / t) + 1; gx++) for (let gy = Math.floor(s / t) - 1; gy <= Math.floor(n / t) + 1; gy++) keys.add(`${gx}_${gy}`);
  const ready = [...keys].filter((k) => PARCELS.index.tiles[k]);
  const missing = ready.filter((k) => !PARCELS.tiles.has(k));
  if (missing.length) { Promise.all(missing.map(loadTile)).then(scheduleParcelRedraw); return; }
  const ctx = tile.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.beginPath();
  for (const k of ready) for (const p of PARCELS.tiles.get(k)) {
    if (p.bb[2] < w || p.bb[0] > e || p.bb[3] < s || p.bb[1] > n) continue;
    p.pts.forEach(([la, lo], i) => { const px = projX(lo, z) - x0, py = projY(la, z) - y0; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath();
  }
  ctx.strokeStyle = css('--parcel'); ctx.lineWidth = z >= 17 ? 1 : 0.7; ctx.stroke();
}
let redrawTimer = null;
function scheduleParcelRedraw() {
  if (redrawTimer) return;
  redrawTimer = setTimeout(() => { redrawTimer = null; parcelLayer.redraw(); }, 60);
}
const parcelLayer = new ParcelLayer({ tileSize: 256, minZoom: 16, updateWhenZooming: false, zIndex: 2 }).addTo(map);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => parcelLayer.redraw());

// ---------- Selection ----------
async function selectAt(lat, lon, add, nearest) {
  const p = nearest && PARCELS.index ? await nearestParcel(lat, lon) : await parcelAt(lat, lon);
  if (!p) { $('siteMsg').textContent = PARCELS.index ? 'No property parcel here (this may be a road, rail corridor or the lake).' : 'Parcel data is still loading…'; $('siteMsg').hidden = false; return; }
  $('siteMsg').hidden = true;
  if (add) {
    const i = site.ids.indexOf(p.id);
    if (i >= 0) { site.ids.splice(i, 1); site.parcels.splice(i, 1); } else { site.ids.push(p.id); site.parcels.push(p); }
  } else { site.ids = [p.id]; site.parcels = [p]; }
  drawSelection(); renderSite();
}
function drawSelection() {
  if (siteLayer) siteLayer.remove();
  siteLayer = L.featureGroup(site.parcels.map((p) => L.polygon(p.pts, { color: css('--accent'), weight: 2.5, fillColor: css('--accent'), fillOpacity: 0.18, interactive: false }))).addTo(map);
}

// Former general zoning by-laws, by pre-1998 municipality. They still apply where
// By-law 569-2013 does not (usually because of site-specific by-laws or appeals).
const FORMER_BYLAWS = {
  'TORONTO': { name: 'Former City of Toronto General Zoning By-law 438-86' },
  'NORTH YORK': { name: 'Former City of North York Zoning By-law 7625' },
  'ETOBICOKE': { name: 'Former City of Etobicoke Zoning Code' },
  'YORK': { name: 'Former City of York Zoning By-law 1-83' },
  'EAST YORK': { name: 'Former Borough of East York Zoning By-law 6752', note: 'In Leaside, the former Town of Leaside By-law 1916 applies instead.' },
  'SCARBOROUGH': { name: 'A former City of Scarborough Community or Employment District zoning by-law', note: 'Scarborough had a separate by-law for each district. The City’s zoning map names the one for this site.' },
};
const ZONING_MAP = 'https://map.toronto.ca/gccmaps/?app=zoning';

// ---------- Analysis ----------
const LOOK = () => PARCELS.index;
function zoneOf(p) {
  if (p.zone < 0) return null;
  const z = LOOK().zones[p.zone], c = LOOK().zoneCols;
  return Object.fromEntries(c.map((k, i) => [k, z[i]]));
}
function siteFacts() {
  const P = site.parcels;
  const area = P.reduce((s, p) => s + p.areaM2, 0);
  let fsiArea = 0, fsiW = 0;
  const zones = new Map(), sps = new Set(), sasp = new Set(), mtsa = new Map(), heritage = new Set(), addrs = [];
  let heightM = null, heightSt = null, cov = null, ravine = false, unzoned = false, condo = false, holding = false;
  const formerBylaws = new Set();
  let env = 0;
  let bFoot = 0, bGfa = 0, bMax = 0, bCount = 0;
  for (const p of P) {
    const z = zoneOf(p);
    if (!z) {
      unzoned = true;
      const fm = p.formerMun != null && p.formerMun >= 0 ? (LOOK().formerMunicipalities || [])[p.formerMun] : null;
      formerBylaws.add(fm || '');
    } else {
      zones.set(z.string, z);
      if (z.fsi) { fsiArea += p.areaM2; fsiW += z.fsi * p.areaM2; }
      if (z.holding) holding = true;
    }
    if (p.heightM != null) heightM = heightM == null ? p.heightM : Math.min(heightM, p.heightM);
    if (p.heightStoreys != null) heightSt = heightSt == null ? p.heightStoreys : Math.min(heightSt, p.heightStoreys);
    if (p.coveragePct != null) cov = cov == null ? p.coveragePct : Math.min(cov, p.coveragePct);
    if (p.secondaryPlan >= 0) sps.add(LOOK().secondaryPlans[p.secondaryPlan]);
    for (const s of p.sasp) sasp.add(LOOK().sasp[s]);
    if (p.mtsa >= 0) mtsa.set(p.mtsa, LOOK().mtsa[p.mtsa]);
    if (p.ravine) ravine = true;
    env |= p.env || 0;
    if (p.heritage) heritage.add(p.heritage);
    if (p.kind === 'C') condo = true;
    addrs.push(...p.addresses);
    bFoot += p.bldgFootprintM2; bGfa += p.bldgGfaEstM2; bMax = Math.max(bMax, p.bldgMaxHeightM); bCount += p.bldgCount;
  }
  let lat = 0, lon = 0; for (const p of P) { lat += p.lat; lon += p.lon; } lat /= P.length; lon /= P.length;
  return { area, zonedFsi: fsiArea ? fsiW / fsiArea : null, zonedFsiShare: area ? fsiArea / area : 0, zones: [...zones.values()], heightM, heightSt, cov,
    sps: [...sps], sasp: [...sasp].sort(), mtsa: [...mtsa.values()], ravine, env, heritage: [...heritage], unzoned, formerBylaws: [...formerBylaws], condo, holding, addrs,
    bFoot, bGfa, bMax, bCount, lat, lon, width: P.length === 1 ? P[0].widthM : null, depth: P.length === 1 ? P[0].depthM : null };
}
function precedents(f) {
  const since = `${new Date().getFullYear() - 10}-01-01`;
  const out = [];
  for (const a of APPS) {
    if (!a.fsi || !a.pts.length || !['OZ', 'SA'].includes(a.type) || (a.submitted || '') < since) continue;
    // leave out applications on the selected site itself
    if (site.parcels.some((sp) => a.pts.some((q) => q[0] >= sp.bb[1] && q[0] <= sp.bb[3] && q[1] >= sp.bb[0] && q[1] <= sp.bb[2] && inRing(q[0], q[1], sp.pts)))) continue;
    let d = Infinity; for (const p of a.pts) d = Math.min(d, haversine(f.lat, f.lon, p[0], p[1]));
    if (d <= site.precRadius && !a.status.toLowerCase().includes('refused')) out.push({ a, d });
  }
  out.sort((x, y) => x.d - y.d);
  // One figure per site: keep the latest file per address
  const seen = new Set(), list = [];
  for (const o of out.slice().sort((x, y) => (y.a.submitted || '').localeCompare(x.a.submitted || ''))) {
    const k = o.a.addrs[0] || o.a.id; if (seen.has(k)) continue; seen.add(k); list.push(o);
  }
  list.sort((x, y) => x.d - y.d);
  const v = list.map((o) => o.a.fsi).sort((a, b) => a - b);
  const q = (p) => v.length ? v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))] : null;
  const st = list.map((o) => o.a.storeys).filter(Boolean).sort((a, b) => a - b);
  return { list, n: v.length, median: q(0.5), p75: q(0.75), max: v.length ? v[v.length - 1] : null, medStoreys: st.length ? st[Math.floor(st.length / 2)] : null };
}
function chosenFsi(f, pr) {
  const opts = {
    zoning: f.zonedFsi && f.zonedFsiShare > 0.5 ? f.zonedFsi : null,
    median: pr.n >= 3 ? pr.median : null,
    p75: pr.n >= 3 ? pr.p75 : null,
    custom: site.customFsi,
  };
  let key = site.scenario;
  if (key === 'auto') key = opts.median ? 'median' : opts.zoning ? 'zoning' : 'custom';
  if (opts[key] == null) key = 'custom';
  return { key, fsi: opts[key], opts };
}

function proforma(f, fsi, adj = {}) {
  const price = PF.salePsf * (adj.price || 1), hard = PF.hardPsf * (adj.hard || 1);
  const gfaM2 = f.area * fsi, gfaSf = gfaM2 * SQFT, nsa = gfaSf * PF.efficiency / 100;
  const units = Math.max(0, Math.round(nsa / PF.unitSize));
  const stalls = Math.round(units * PF.parkRatio);
  const storeys = Math.max(1, Math.ceil(gfaM2 / Math.max(50, Math.min(PF.floorplate, f.area * 0.9))));
  const revRes = nsa * price, revPark = stalls * PF.stallPrice, revenue = revRes + revPark;
  const hardCost = gfaSf * hard + stalls * PF.stallCost;
  const cont = hardCost * PF.contingency / 100;
  const soft = (hardCost + cont) * PF.softPct / 100;
  const dcs = units * PF.dcPerUnit;
  const demo = f.bGfa * SQFT * PF.demoPsf;
  const sales = revenue * PF.salesPct / 100;
  const finance = (hardCost + cont + soft + dcs + demo) * PF.finRate / 100 * PF.finYears * PF.finDraw / 100;
  const profit = revenue * PF.profitPct / 100;
  const cbcApplies = storeys >= 5 && units >= 10;
  const landRate = PF.closingPct / 100 + PF.parklandPct / 100 + (cbcApplies ? PF.cbcPct / 100 : 0) + PF.finRate / 100 * PF.finYears;
  const residual = revenue - hardCost - cont - soft - dcs - demo - sales - finance - profit;
  const rlv = residual > 0 ? residual / (1 + landRate) : residual; // land-linked costs only arise on a positive land price
  return { gfaM2, gfaSf, nsa, units, stalls, storeys, revRes, revPark, revenue, hardCost, cont, soft, dcs, demo, sales, finance, profit,
    cbcApplies, landRate, rlv, landLinked: rlv > 0 ? rlv * landRate : 0, perAcre: rlv / (f.area / ACRE_M2), perBsf: gfaSf ? rlv / gfaSf : 0, perUnit: units ? rlv / units : 0 };
}

// ---------- Rendering ----------
const money = (v) => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${fmt.format(Math.round(a))}`;
};
const num = (v, d = 0) => v == null ? '—' : Number(v).toLocaleString('en-CA', { maximumFractionDigits: d, minimumFractionDigits: d });
const fact = (k, v, note) => `<div class="fact"><span class="fk">${esc(k)}</span><span class="fv">${v}</span>${note ? `<span class="fn">${note}</span>` : ''}</div>`;

function renderSite() {
  const empty = !site.parcels.length;
  $('siteEmpty').hidden = !empty;
  $('siteBody').hidden = empty;
  if (empty) return;
  const f = siteFacts(), pr = precedents(f), ch = chosenFsi(f, pr), r = proforma(f, ch.fsi);

  // Header
  $('siteTitle').textContent = f.addrs[0] || `Parcel ${site.parcels[0].id}`;
  $('siteSub').textContent = site.parcels.length > 1 ? `${site.parcels.length} parcels assembled` + (f.addrs.length > 1 ? ` · ${f.addrs.slice(1, 4).join(', ')}${f.addrs.length > 4 ? '…' : ''}` : '')
    : (f.addrs.length > 1 ? `Also ${f.addrs.slice(1).join(', ')}` : `Parcel ${site.parcels[0].id}`);

  // Site
  const flags = [];
  if (f.condo) flags.push('<span class="flag warn">Registered condominium: needs the condo corporation to sell</span>');
  if (f.heritage.length) flags.push(`<span class="flag warn">Heritage: ${esc(f.heritage.map((h) => h === 'Part IV' ? 'Designated (Part IV)' : h === 'Part V' ? 'Heritage Conservation District (Part V)' : 'Listed').join(', '))}</span>`);
  if (f.env & 1) flags.push('<span class="flag water">In the TRCA regulatory floodplain</span>');
  if (f.env & 2) flags.push('<span class="flag warn">TRCA regulated area: permit needed</span>');
  if (f.ravine) flags.push('<span class="flag warn">Ravine and natural feature protection area</span>');
  if (f.env & 4) flags.push('<span class="flag warn">Environmentally Significant Area</span>');
  if (f.env & 8) flags.push('<span class="flag">Natural Heritage System</span>');
  if (f.unzoned) flags.push('<span class="flag bylaw">Former by-law area</span>');
  if (f.holding) flags.push('<span class="flag warn">Holding (H) symbol on the zoning</span>');
  if (f.mtsa.length) flags.push(`<span class="flag good">${esc(f.mtsa[0][0])} station area (${esc(f.mtsa[0][1].replace(' Major Transit Station Area', ' MTSA'))})</span>`);
  $('siteFlags').innerHTML = flags.join('') || '<span class="flag">No heritage, ravine or condominium flags</span>';

  $('siteFacts').innerHTML = [
    fact('Lot area', `${num(f.area)} m²`, `${num(f.area * SQFT)} sf · ${num(f.area / ACRE_M2, 2)} ac`),
    f.width ? fact('Approx. dimensions', `${num(f.width, 1)} × ${num(f.depth, 1)} m`, 'Shortest and longest side of the parcel’s bounding rectangle') : '',
    fact('Existing buildings', f.bCount ? `${f.bCount} · ${num(f.bFoot)} m² footprint` : 'None recorded', f.bCount ? `${f.bMax > 0 ? `Up to ${num(f.bMax, 1)} m tall · ` : ''}about ${num(f.bGfa)} m² floor area (FSI ${num(f.bGfa / f.area, 2)}), estimated from 3D massing` : ''),
  ].join('');

  // Planning controls
  const zoneTxt = f.zones.length ? f.zones.map((z) => `<code>${esc(z.string)}</code>${z.exception ? ` <span class="fn-inline">exception ${esc(z.exception)}</span>` : ''}`).join('<br>') : '';
  $('sitePlanning').innerHTML = [
    fact('Zoning (By-law 569-2013)', f.unzoned && !f.zones.length ? 'Not covered' : zoneTxt, f.unzoned && f.zones.length ? 'Part of this site is not covered. See the former by-law below.' : ''),
    f.unzoned ? fact('Former by-law in effect', f.formerBylaws.map((m) => esc(FORMER_BYLAWS[m]?.name || 'A former municipal zoning by-law')).join('<br>'),
      [...new Set(f.formerBylaws.map((m) => FORMER_BYLAWS[m]?.note).filter(Boolean))].map(esc).join(' ') +
      `${f.formerBylaws.some((m) => FORMER_BYLAWS[m]?.note) ? ' ' : ''}Applies as amended by any site-specific by-laws, which this data does not include, so zoned density and height are not shown. <a href="${ZONING_MAP}" target="_blank" rel="noopener">Check the City’s zoning map ↗</a>`) : '',
    fact('Zoned density', f.zonedFsi ? `FSI ${num(f.zonedFsi, 2)}` : '—', f.zonedFsi ? `${num(f.zonedFsi * f.area)} m² as of right` : f.unzoned && !f.zones.length ? 'Set by the former by-law' : 'No FSI in the zone label'),
    fact('Height limit', f.heightM ? `${num(f.heightM, 1)} m` + (f.heightSt ? ` · ${f.heightSt} storeys` : '') : '—', 'Height overlay'),
    fact('Lot coverage', f.cov ? `${num(f.cov)}%` : '—'),
    fact('Secondary Plan', f.sps.length ? esc(f.sps.join(', ')) : 'None'),
    fact('Site and Area Specific Policy', f.sasp.length ? esc(f.sasp.map((s) => 'SASP ' + +s).join(', ')) : 'None'),
    fact('Flood and natural features', (() => {
      const items = [];
      if (f.env & 1) items.push('Regulatory floodplain (TRCA)');
      if (f.env & 2) items.push('TRCA regulated area');
      if (f.ravine) items.push('Ravine and natural feature protection');
      if (f.env & 4) items.push('Environmentally Significant Area');
      if (f.env & 8) items.push('Natural Heritage System');
      return items.length ? items.map(esc).join('<br>') : 'None mapped';
    })(), (f.env & 3) ? 'Development here needs a TRCA permit under Ontario Regulation 41/24, and floodplain lands may be limited or unbuildable. Confirm the limits with TRCA.' : (f.env & 12) || f.ravine ? 'Official Plan natural heritage policies apply. Expect setbacks or an environmental study.' : ''),
    fact('Major Transit Station Area', f.mtsa.length ? esc(f.mtsa.map((m) => m[0]).join(', ')) : 'None', f.mtsa.length ? 'Official Plan minimum densities apply. Inclusionary zoning may apply in protected areas.' : ''),
  ].join('');

  // Precedents
  $('precSummary').innerHTML = pr.n ? `
    <div class="tiles">
      <div class="tile"><div class="v">${num(pr.median, 1)}</div><div class="k">median FSI (${pr.n} site${pr.n === 1 ? '' : 's'})</div></div>
      <div class="tile"><div class="v">${num(pr.p75, 1)}</div><div class="k">75th percentile FSI</div></div>
    </div>
    <div class="hint">Rezoning and site plan files from the last 10 years within ${fmtRadius(site.precRadius)}. Median height ${pr.medStoreys ? pr.medStoreys + ' storeys' : 'not stated'}. FSI is the figure stated in the file, or proposed GFA divided by the parcel area.</div>`
    : `<div class="empty" style="text-align:left">No applications with a stated density within ${fmtRadius(site.precRadius)}. Widen the search.</div>`;
  $('precList').innerHTML = pr.list.slice(0, 6).map(({ a, d }) => `
    <div class="prec" data-id="${esc(a.id)}"><div><b>${esc(a.addrs[0] || a.id)}</b><span class="fn-inline">${fmtDist(d)} · ${esc(a.status)}</span></div>
    <div class="pv">FSI ${num(a.fsi, 1)}${a.storeys ? ` · ${a.storeys} st` : ''}${a.units ? ` · ${fmt.format(a.units)} u` : ''}</div></div>`).join('');

  // Scenario
  const lab = { zoning: 'As of right', median: 'Precedent median', p75: 'Precedent 75th pct.', custom: 'Custom' };
  $('scenario').innerHTML = Object.keys(lab).map((k) => {
    const v = ch.opts[k], dis = v == null;
    return `<button data-k="${k}" aria-pressed="${ch.key === k}" ${dis ? 'disabled' : ''}>${lab[k]}${k !== 'custom' ? `<small>${dis ? 'n/a' : 'FSI ' + num(v, 2)}</small>` : ''}</button>`;
  }).join('');
  $('customFsiRow').hidden = ch.key !== 'custom';
  $('customFsi').value = site.customFsi;

  // Results
  const neg = r.rlv < 0;
  $('rlvBox').className = 'rlv' + (neg ? ' neg' : '');
  $('rlvTotal').textContent = money(r.rlv);
  $('rlvNote').textContent = neg ? 'Negative: at these assumptions the project cannot pay anything for the land.' : `Residual land value at FSI ${num(ch.fsi, 2)}`;
  $('rlvStats').innerHTML = [
    ['per buildable sf', money(r.perBsf).replace('$', '$')], ['per acre', money(r.perAcre)], ['per unit', money(r.perUnit)],
  ].map(([k, v]) => `<div><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  $('massing').innerHTML = [
    fact('Gross floor area', `${num(r.gfaM2)} m²`, `${num(r.gfaSf)} sf`),
    fact('Units', num(r.units), `${num(r.nsa)} sf saleable at ${num(PF.unitSize)} sf average`),
    fact('Implied height', `≈ ${r.storeys} storeys`, `at a ${num(Math.min(PF.floorplate, f.area * 0.9))} m² floor plate` + (f.heightSt && r.storeys > f.heightSt ? ` · above the ${f.heightSt}-storey limit` : f.heightM && r.storeys * 3.2 > f.heightM ? ` · above the ${num(f.heightM)} m limit` : '')),
    fact('Parking', `${num(r.stalls)} stalls`),
  ].join('');
  const rows = [
    ['Residential sales', r.revRes, 'rev'], ['Parking sales', r.revPark, 'rev'], ['Gross revenue', r.revenue, 'sub'],
    ['Hard costs incl. parking', -r.hardCost], ['Contingency', -r.cont], ['Soft costs', -r.soft], ['Development charges', -r.dcs],
    ['Demolition', -r.demo], ['Sales and marketing', -r.sales], ['Construction financing', -r.finance], ['Developer profit', -r.profit],
    ['Available for land and land costs', r.rlv + r.landLinked, 'sub'],
    [`Land closing, parkland${r.cbcApplies ? ', CBC' : ''} and land carry`, -r.landLinked],
    ['Residual land value', r.rlv, 'total'],
  ];
  $('pfTable').innerHTML = rows.map(([k, v, cls]) => `<tr class="${cls || ''}"><td>${esc(k)}</td><td>${money(v)}</td><td>${r.revenue ? num(Math.abs(v) / r.revenue * 100, 1) + '%' : ''}</td></tr>`).join('');

  // Sensitivity: sale price vs hard cost
  const steps = [-0.1, -0.05, 0, 0.05, 0.1];
  const grid = steps.map((dp) => steps.map((dh) => proforma(f, ch.fsi, { price: 1 + dp, hard: 1 + dh }).rlv));
  const maxAbs = Math.max(1, ...grid.flat().map(Math.abs));
  const short = (v) => { const a = Math.abs(v), sg = v < 0 ? '−' : ''; return a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : `${sg}$${Math.round(a / 1e3)}K`; };
  $('sens').innerHTML = `<thead><tr><th>$/sf · cost</th>${steps.map((s) => `<th>${s > 0 ? '+' : ''}${s * 100}%</th>`).join('')}</tr></thead><tbody>` +
    grid.map((row, i) => `<tr><th>$${num(PF.salePsf * (1 + steps[i]))}</th>${row.map((v, j) => {
      const a = Math.min(1, Math.abs(v) / maxAbs) * 0.55 + 0.08;
      return `<td class="${i === 2 && j === 2 ? 'base' : ''}" style="background:color-mix(in srgb, ${v < 0 ? 'var(--neg)' : 'var(--pos)'} ${Math.round(a * 100)}%, transparent)">${short(v)}</td>`;
    }).join('')}</tr>`).join('') + '</tbody>';
}

function renderInputs() {
  $('pfInputs').innerHTML = FIELDS.map(([group, fields]) => `<fieldset><legend>${group}</legend>${fields.map(([k, label, unit, step]) => `
    <label class="pf"><span>${label}</span><span class="pfin"><input type="number" id="pf-${k}" data-k="${k}" step="${step}" value="${PF[k]}" inputmode="decimal"><em>${unit}</em></span></label>`).join('')}</fieldset>`).join('');
}

// ---------- Wiring ----------
function setMode(m) {
  siteMode = m === 'site';
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', b.dataset.tab === m);
  $('radarPane').hidden = siteMode; $('sitePane').hidden = !siteMode;
  if (siteMode) { circle.remove(); pin.remove(); } else { circle.addTo(map); pin.addTo(map); }
  if (siteMode && !site.parcels.length && APPS.length) {
    selectAt(state.lat, state.lon, false, true).then(() => { if (map.getZoom() < 16) map.flyTo([state.lat, state.lon], 17, { duration: 0.6 }); });
  }
  if (siteMode && map.getZoom() < 16 && site.parcels.length) map.flyTo(siteLayer.getBounds().getCenter(), 17, { duration: 0.6 });
  try { localStorage.setItem('tdr-tab', m); } catch { /* ignore */ }
}
document.getElementById('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.tab); });
map.on('click', (e) => { if (siteMode) selectAt(e.latlng.lat, e.latlng.lng, site.assemble || e.originalEvent.shiftKey); });
$('assemble').addEventListener('change', (e) => { site.assemble = e.target.checked; });
$('clearSite').addEventListener('click', () => { site.ids = []; site.parcels = []; drawSelection(); renderSite(); });
$('precRadius').addEventListener('change', (e) => { site.precRadius = +e.target.value; renderSite(); });
$('scenario').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; site.scenario = b.dataset.k; renderSite(); });
$('customFsi').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v > 0) { site.customFsi = v; renderSite(); } });
$('pfInputs').addEventListener('input', (e) => {
  const k = e.target.dataset.k, v = parseFloat(e.target.value);
  if (!k || !isFinite(v)) return;
  PF[k] = v; savePF(); renderSite();
});
$('pfReset').addEventListener('click', () => { PF = { ...DEFAULTS }; savePF(); renderInputs(); renderSite(); });
$('precList').addEventListener('click', (e) => {
  const el = e.target.closest('.prec'); if (!el) return;
  const a = APPS.find((x) => x.id === el.dataset.id); if (a && a._pt) map.flyTo(a._pt, Math.max(map.getZoom(), 16), { duration: 0.5 });
  else if (a && a.pts[0]) map.flyTo(a.pts[0], Math.max(map.getZoom(), 16), { duration: 0.5 });
});
$('useCentre').addEventListener('click', () => { selectAt(state.lat, state.lon, false, true); map.flyTo([state.lat, state.lon], 17, { duration: 0.6 }); });

renderInputs();
fetch('parcel-index.json').then((r) => r.json()).then((j) => {
  PARCELS.index = j; parcelLayer.redraw();
  let tab = 'radar'; try { tab = localStorage.getItem('tdr-tab') || 'radar'; } catch { /* ignore */ }
  const go = () => { if (tab === 'site') setMode('site'); };
  if (APPS.length) go(); else { const t = setInterval(() => { if (APPS.length) { clearInterval(t); go(); } }, 300); }
}).catch(() => { $('siteMsg').textContent = 'Parcel data did not load. Reload the page to try again.'; $('siteMsg').hidden = false; });
