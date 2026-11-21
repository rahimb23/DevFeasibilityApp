// Street network for the Development Radar: decoding, spatial index and a small
// offline geocoder (addresses, intersections, ward names) built on the City of
// Toronto centreline. Works in the browser (window.TDRStreets) and in Node.
(function (root) {
  'use strict';
  const CELL = 0.01; // grid cell size in degrees for the spatial index

  function decode(json) {
    const q = json.q, segs = [];
    for (const s of json.segs) {
      const n = (s.length - 6) / 2, xs = new Float64Array(n), ys = new Float64Array(n);
      let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        x += s[6 + 2 * i]; y += s[7 + 2 * i];
        xs[i] = x / q; ys[i] = y / q;
        if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i];
        if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i];
      }
      segs.push({ c: s[0], n: s[1], rng: [s[2], s[3], s[4], s[5]], xs, ys, bb: [x0, y0, x1, y1] });
    }
    const grid = new Map();
    segs.forEach((s, i) => {
      for (let gx = Math.floor(s.bb[0] / CELL); gx <= Math.floor(s.bb[2] / CELL); gx++)
        for (let gy = Math.floor(s.bb[1] / CELL); gy <= Math.floor(s.bb[3] / CELL); gy++) {
          const k = gx * 100000 + gy;
          let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
        }
    });
    const net = { names: json.names, segs, grid, stamp: new Uint32Array(segs.length), tick: 0 };
    net.byName = new Map();
    segs.forEach((s, i) => { if (s.n && s.c <= 10) { let a = net.byName.get(s.n); if (!a) net.byName.set(s.n, a = []); a.push(i); } });
    buildNameIndex(net);
    return net;
  }

  // Segments whose bounding box meets [w, s, e, n]
  function query(net, w, s, e, n) {
    const out = [], t = ++net.tick;
    for (let gx = Math.floor(w / CELL); gx <= Math.floor(e / CELL); gx++)
      for (let gy = Math.floor(s / CELL); gy <= Math.floor(n / CELL); gy++) {
        const a = net.grid.get(gx * 100000 + gy); if (!a) continue;
        for (const i of a) {
          if (net.stamp[i] === t) continue; net.stamp[i] = t;
          const b = net.segs[i].bb;
          if (b[2] >= w && b[0] <= e && b[3] >= s && b[1] <= n) out.push(i);
        }
      }
    return out;
  }

  // ---------- Name normalization ----------
  const ABBR = {
    street: 'st', avenue: 'ave', av: 'ave', road: 'rd', boulevard: 'blvd', blvd: 'blvd', drive: 'dr', crescent: 'cres', cr: 'cres',
    court: 'crt', ct: 'crt', place: 'pl', parkway: 'pkwy', circle: 'circ', terrace: 'ter', terr: 'ter', square: 'sq', gardens: 'gdns',
    gate: 'gt', heights: 'hts', lane: 'lane', ln: 'lane', trail: 'trl', way: 'way', grove: 'grv', park: 'park', path: 'path',
    west: 'w', east: 'e', north: 'n', south: 's', saint: 'st', mount: 'mount', highway: 'hwy', expressway: 'expy',
  };
  const TYPES = new Set(['st', 'ave', 'rd', 'blvd', 'dr', 'cres', 'crt', 'pl', 'pkwy', 'circ', 'ter', 'sq', 'gdns', 'gt', 'hts', 'lane', 'trl', 'way', 'grv', 'cir', 'hwy', 'expy', 'mews', 'path', 'row', 'walk', 'line', 'link', 'pk', 'park']);
  const DIRS = new Set(['w', 'e', 'n', 's']);
  function norm(s) {
    return String(s).toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
      .split(' ').filter(Boolean).map((t) => ABBR[t] || t).join(' ');
  }
  function base(n) {
    const t = n.split(' ');
    while (t.length > 1 && (DIRS.has(t[t.length - 1]) || TYPES.has(t[t.length - 1]))) t.pop();
    return t.join(' ');
  }
  function buildNameIndex(net) {
    net.full = new Map(); net.base = new Map();
    net.names.forEach((nm, i) => {
      if (!nm || !net.byName.has(i)) return;
      const f = norm(nm), b = base(f);
      (net.full.get(f) || net.full.set(f, []).get(f)).push(i);
      (net.base.get(b) || net.base.set(b, []).get(b)).push(i);
    });
  }
  // Name ids matching a typed street: exact, then same base name, then prefix.
  function resolveStreet(net, text) {
    const f = norm(text); if (!f) return [];
    if (net.full.has(f)) return net.full.get(f);
    const b = base(f);
    const dir = f.split(' ').find((t, i, a) => i === a.length - 1 && DIRS.has(t));
    let hits = net.base.get(b) || [];
    if (hits.length && dir) { const d = hits.filter((i) => norm(net.names[i]).endsWith(' ' + dir)); if (d.length) hits = d; }
    if (hits.length) return hits;
    const out = [];
    for (const [k, ids] of net.full) if (k.startsWith(f)) { out.push(...ids); if (out.length > 30) break; }
    return out;
  }

  const DEG = Math.PI / 180;
  const metres = (lat1, lon1, lat2, lon2) => {
    const x = (lon2 - lon1) * DEG * Math.cos((lat1 + lat2) / 2 * DEG), y = (lat2 - lat1) * DEG;
    return Math.hypot(x, y) * 6371008.8;
  };

  // Point a fraction t of the way along a segment's polyline.
  function along(s, t) {
    let total = 0; const L = [];
    for (let i = 1; i < s.xs.length; i++) { const d = metres(s.ys[i - 1], s.xs[i - 1], s.ys[i], s.xs[i]); L.push(d); total += d; }
    let target = total * Math.min(1, Math.max(0, t));
    for (let i = 1; i < s.xs.length; i++) {
      if (target <= L[i - 1] || i === s.xs.length - 1) {
        const r = L[i - 1] ? Math.min(1, target / L[i - 1]) : 0;
        return [s.ys[i - 1] + (s.ys[i] - s.ys[i - 1]) * r, s.xs[i - 1] + (s.xs[i] - s.xs[i - 1]) * r];
      }
      target -= L[i - 1];
    }
    return [s.ys[0], s.xs[0]];
  }

  function geocodeAddress(net, num, street) {
    const ids = resolveStreet(net, street), out = [];
    for (const nid of ids) {
      let best = null;
      for (const si of net.byName.get(nid) || []) {
        const s = net.segs[si], r = s.rng;
        for (const [lo, hi] of [[r[0], r[1]], [r[2], r[3]]]) {
          if (!lo || !hi) continue;
          const a = Math.min(lo, hi), b = Math.max(lo, hi);
          if (num < a || num > b || (num - a) % 2) continue;
          const t = b === a ? 0.5 : (lo <= hi ? (num - a) / (b - a) : (b - num) / (b - a));
          best = along(s, t); break;
        }
        if (best) break;
      }
      if (best) out.push({ name: `${num} ${net.names[nid]}`, lat: best[0], lon: best[1], kind: 'Address' });
    }
    return out;
  }

  function geocodeIntersection(net, aText, bText) {
    const A = resolveStreet(net, aText), B = resolveStreet(net, bText);
    if (!A.length || !B.length) return [];
    const cells = new Map();
    const key = (lon, lat) => Math.floor(lon / 0.002) * 1e6 + Math.floor(lat / 0.002);
    for (const nid of A) for (const si of net.byName.get(nid) || []) {
      const s = net.segs[si];
      for (let i = 0; i < s.xs.length; i++) {
        const k = key(s.xs[i], s.ys[i]); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push([s.ys[i], s.xs[i], nid]);
      }
    }
    const found = [];
    for (const nid of B) for (const si of net.byName.get(nid) || []) {
      const s = net.segs[si];
      for (let i = 0; i < s.xs.length; i++) {
        const gx = Math.floor(s.xs[i] / 0.002), gy = Math.floor(s.ys[i] / 0.002);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          for (const p of cells.get((gx + dx) * 1e6 + gy + dy) || []) {
            const d = metres(p[0], p[1], s.ys[i], s.xs[i]);
            if (d < 25) found.push({ lat: (p[0] + s.ys[i]) / 2, lon: (p[1] + s.xs[i]) / 2, d, a: p[2], b: nid });
          }
        }
      }
    }
    found.sort((x, y) => x.d - y.d);
    const out = [];
    for (const f of found) {
      if (out.some((o) => metres(o.lat, o.lon, f.lat, f.lon) < 400)) continue;
      out.push({ name: `${net.names[f.a]} & ${net.names[f.b]}`, lat: f.lat, lon: f.lon, kind: 'Intersection' });
      if (out.length >= 5) break;
    }
    return out;
  }

  function streetCentre(net, text) {
    return resolveStreet(net, text).slice(0, 4).map((nid) => {
      const segs = net.byName.get(nid), s = net.segs[segs[Math.floor(segs.length / 2)]];
      const p = along(s, 0.5);
      return { name: net.names[nid], lat: p[0], lon: p[1], kind: 'Street' };
    });
  }

  // Returns up to ~6 candidate places for free text.
  function geocode(net, text, extras) {
    const q = String(text).trim(); if (q.length < 2) return [];
    const out = [];
    const inter = q.split(/\s+(?:&|and|at|@)\s+|\s*[&/@]\s*/i);
    if (inter.length === 2 && inter[0] && inter[1]) out.push(...geocodeIntersection(net, inter[0], inter[1]));
    const m = q.match(/^(\d+)[a-z]?(?:\s*-\s*\d+[a-z]?)?\s+(.+)$/i);
    if (m) out.push(...geocodeAddress(net, parseInt(m[1], 10), m[2]));
    if (extras) out.push(...extras(q));
    if (!out.length && !m && inter.length < 2) out.push(...streetCentre(net, q));
    return out.slice(0, 6);
  }

  const api = { decode, query, geocode, norm, resolveStreet, metres };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TDRStreets = api;
})(typeof window !== 'undefined' ? window : globalThis);
