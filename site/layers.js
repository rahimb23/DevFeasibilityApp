// Map overlays for the Development Radar: former by-law areas and flood / environmental
// features, drawn on canvas tiles, with a layer switcher and legend.
// Loaded after the main page script and feasibility.js; uses their globals (map, css, projX, ...).
'use strict';

const OVERLAYS = [
  { id: 'nhs', file: 'nhs', label: 'Natural Heritage System', note: 'Official Plan Map 9', color: '--ov-nhs', fill: 0.18, width: 0.8, on: false },
  { id: 'ravine', file: 'ravine', label: 'Ravine and natural feature protection', note: 'City by-law area', color: '--ov-ravine', fill: 0.22, width: 0.8, on: false },
  { id: 'esa', file: 'esa', label: 'Environmentally Significant Areas', note: 'Official Plan', color: '--ov-esa', fill: 0.25, width: 1.2, on: false },
  { id: 'trca', file: 'trca-regulated', label: 'TRCA regulated area', note: 'Permit needed to develop', color: '--ov-trca', fill: 0.07, width: 1.4, dash: [5, 3], on: true },
  { id: 'flood', file: 'floodplain', label: 'Regulatory floodplain', note: 'TRCA, Regional Storm or 100-year', color: '--ov-flood', fill: 0.38, width: 1, on: true },
  { id: 'bylaw', file: 'former-bylaw', label: 'Former by-law areas', note: 'Outside Zoning By-law 569-2013', color: '--ov-bylaw', fill: 0.07, width: 2.4, on: true },
];
const OV = { data: new Map(), loading: new Map() };
try {
  const saved = JSON.parse(localStorage.getItem('tdr-overlays') || 'null');
  if (saved) for (const o of OVERLAYS) if (o.id in saved) o.on = !!saved[o.id];
} catch { /* defaults */ }
const saveOverlays = () => { try { localStorage.setItem('tdr-overlays', JSON.stringify(Object.fromEntries(OVERLAYS.map((o) => [o.id, o.on])))); } catch { /* ignore */ } };

function loadOverlay(o) {
  if (OV.data.has(o.id)) return Promise.resolve(OV.data.get(o.id));
  if (OV.loading.has(o.id)) return OV.loading.get(o.id);
  const p = fetch(`layers/${o.file}.json`).then((r) => r.json()).then((j) => {
    const feats = j.features.map((f) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const rings = f.r.map((r) => {
        const pts = new Float64Array(r.length); let x = 0, y = 0;
        for (let i = 0; i < r.length; i += 2) {
          x += r[i]; y += r[i + 1];
          const lon = x / j.q, lat = y / j.q; pts[i] = lon; pts[i + 1] = lat;
          if (lon < x0) x0 = lon; if (lon > x1) x1 = lon; if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
        }
        return pts;
      });
      return { p: f.p, rings, bb: [x0, y0, x1, y1] };
    });
    OV.data.set(o.id, feats); OV.loading.delete(o.id);
    return feats;
  }).catch(() => { OV.loading.delete(o.id); OV.data.set(o.id, []); return []; });
  OV.loading.set(o.id, p);
  return p;
}

const OverlayLayer = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
    tile.width = tile.height = 256 * dpr; tile.className = 'basemap-tile';
    const active = OVERLAYS.filter((o) => o.on);
    const missing = active.filter((o) => !OV.data.has(o.id));
    if (missing.length) Promise.all(missing.map(loadOverlay)).then(() => overlayLayer.redraw());
    else if (active.length) drawOverlays(tile.getContext('2d'), coords, dpr, active);
    return tile;
  },
});
function drawOverlays(ctx, coords, dpr, active) {
  const z = coords.z, x0 = coords.x * 256, y0 = coords.y * 256, pad = 4;
  const w = unX(x0 - pad, z), e = unX(x0 + 256 + pad, z), n = unY(y0 - pad, z), s = unY(y0 + 256 + pad, z);
  ctx.scale(dpr, dpr); ctx.lineJoin = 'round';
  for (const o of active) {
    const feats = OV.data.get(o.id); if (!feats || !feats.length) continue;
    ctx.beginPath();
    let any = false;
    for (const f of feats) {
      if (f.bb[2] < w || f.bb[0] > e || f.bb[3] < s || f.bb[1] > n) continue;
      any = true;
      for (const r of f.rings) {
        for (let i = 0; i < r.length; i += 2) {
          const px = projX(r[i], z) - x0, py = projY(r[i + 1], z) - y0;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
      }
    }
    if (!any) continue;
    const col = css(o.color);
    ctx.globalAlpha = o.fill; ctx.fillStyle = col; ctx.fill('evenodd');
    ctx.globalAlpha = 1; ctx.strokeStyle = col;
    ctx.lineWidth = o.id === 'bylaw' ? (z >= 15 ? o.width : z >= 13 ? 1.8 : 1.2) : o.width;
    ctx.setLineDash(o.dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
}
const overlayLayer = new OverlayLayer({ tileSize: 256, updateWhenZooming: false, zIndex: 3 }).addTo(map);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => overlayLayer.redraw());

// ---------- Layer switcher ----------
const LayerControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const box = L.DomUtil.create('div', 'layers-ctl');
    const small = window.matchMedia('(max-width: 860px)').matches;
    box.innerHTML = `<button type="button" class="layers-toggle" aria-expanded="${!small}">Map layers</button>
      <div class="layers-body"${small ? ' hidden' : ''}>${OVERLAYS.slice().reverse().map((o) => `
        <label class="layer-row"><input type="checkbox" id="ov-${o.id}" data-id="${o.id}" ${o.on ? 'checked' : ''}>
          <span class="sw sw-${o.id}"></span><span><b>${o.label}</b><small>${o.note}</small></span></label>`).join('')}
        <div class="layers-src">Sources: City of Toronto Open Data; TRCA Open Data (Toronto and Region Conservation Authority). Screening only: confirm limits with TRCA and the City.</div>
      </div>`;
    L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
    const body = box.querySelector('.layers-body'), btn = box.querySelector('.layers-toggle');
    btn.addEventListener('click', () => { body.hidden = !body.hidden; btn.setAttribute('aria-expanded', !body.hidden); });
    box.addEventListener('change', (ev) => {
      const o = OVERLAYS.find((x) => x.id === ev.target.dataset.id); if (!o) return;
      o.on = ev.target.checked; saveOverlays(); overlayLayer.redraw();
    });
    return box;
  },
});
new LayerControl().addTo(map);
