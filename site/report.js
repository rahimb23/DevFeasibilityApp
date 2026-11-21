// Site feasibility report: a printable, letter-size report for the selected parcel or
// assembly. Opens in a new tab with "Save as PDF" (the browser's print dialog) and
// "Download HTML". Loaded after feasibility.js and uses its globals
// (site, PF, DEFAULTS, FIELDS, siteFacts, precedents, chosenFsi, proforma, siteFlagList, money, num ...).
'use strict';

(function () {
  const SCEN_LABEL = { zoning: 'As of right (zoning)', median: 'Precedent median', p75: 'Precedent 75th percentile', custom: 'Custom FSI' };
  const HERITAGE_LABEL = (h) => h === 'Part IV' ? 'Designated (Part IV)' : h === 'Part V' ? 'Heritage Conservation District (Part V)' : h ? 'Listed' : '';

  function wardAt(lat, lon) {
    if (!WARDS) return null;
    for (const w of WARDS) for (const ring of w.rings) {
      // ring points are [lon, lat]
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return w;
    }
    return null;
  }

  const shortMoney = (v) => { const a = Math.abs(v), sg = v < 0 ? '−' : ''; return a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : `${sg}$${Math.round(a / 1e3)}K`; };
  const perSf = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- Drawings ----------
  function niceScale(m) { for (const s of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (s >= m) return s; return 1000; }

  function sitePlanSvg(parcels, f) {
    const lat0 = f.lat, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    const polys = parcels.map((p) => p.pts.map(([la, lo]) => [(lo - f.lon) * kx, (la - lat0) * ky]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pg of polys) for (const [x, y] of pg) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const W = 320, H = 230, pad = 26, wM = Math.max(1, x1 - x0), hM = Math.max(1, y1 - y0);
    const s = Math.min((W - 2 * pad - 30) / wM, (H - 2 * pad - 16) / hM);
    const ox = (W - 30 - wM * s) / 2, oy = (H - 16 - hM * s) / 2;
    const P = ([x, y]) => [ox + (x - x0) * s, oy + (y1 - y) * s];
    const shapes = polys.map((pg, i) => {
      const d = pg.map((pt, k) => (k ? 'L' : 'M') + P(pt).map((v) => v.toFixed(1)).join(' ')).join(' ') + ' Z';
      let cx = 0, cy = 0; pg.forEach((pt) => { const [a, b] = P(pt); cx += a; cy += b; }); cx /= pg.length; cy /= pg.length;
      const herit = parcels[i].heritage;
      return { d, cx, cy, herit };
    });
    const bar = niceScale(wM / 4), barPx = bar * s;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Outline of the selected parcels">
      <rect width="${W}" height="${H}" fill="#f3f4f7"/>
      ${shapes.map((sh) => `<path d="${sh.d}" fill="${sh.herit ? '#f1e4d2' : '#dde6f5'}" stroke="#1f5fbf" stroke-width="1.5" stroke-linejoin="round"/>`).join('')}
      ${parcels.length > 1 ? shapes.map((sh, i) => `<g><circle cx="${sh.cx.toFixed(1)}" cy="${sh.cy.toFixed(1)}" r="8" fill="#1f5fbf"/><text x="${sh.cx.toFixed(1)}" y="${(sh.cy + 3.3).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" font-weight="600" fill="#fff">${i + 1}</text></g>`).join('') : ''}
      <g transform="translate(${W - 20},28)" font-family="IBM Plex Sans, sans-serif" font-size="9" fill="#1b1d21" text-anchor="middle"><path d="M0 -14 L6 4 L0 0 L-6 4 Z" fill="#1b1d21"/><text y="16">N</text></g>
      <g transform="translate(12,${H - 10})" font-family="IBM Plex Mono, monospace" font-size="8" fill="#5e6470"><rect width="${barPx.toFixed(1)}" height="3" fill="#1b1d21"/><text x="${(barPx + 5).toFixed(1)}" y="4">${bar} m</text></g>
    </svg>`;
  }

  function precedentMapSvg(f, list, radius) {
    const S = 220, c = S / 2, R = 96, kx = Math.cos(f.lat * Math.PI / 180) * 111320, ky = 110540;
    const dots = list.map(({ a, pt }, i) => {
      const dx = (pt[1] - f.lon) * kx, dy = (pt[0] - f.lat) * ky;
      return { x: c + dx / radius * R, y: c - dy / radius * R, n: i + 1 };
    });
    return `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Precedent applications within ${esc(fmtRadius(radius))} of the site">
      <rect width="${S}" height="${S}" fill="#f3f4f7"/>
      <circle cx="${c}" cy="${c}" r="${R}" fill="rgba(31,95,191,.06)" stroke="#1f5fbf" stroke-dasharray="3 3"/>
      <circle cx="${c}" cy="${c}" r="${R / 2}" fill="none" stroke="#c9cdd6" stroke-dasharray="2 3"/>
      <rect x="${c - 6}" y="${c - 6}" width="12" height="12" fill="#1b1d21"/>
      ${dots.map((d) => `<g><circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="7.5" fill="#1f5fbf" stroke="#fff" stroke-width="1"/><text x="${d.x.toFixed(1)}" y="${(d.y + 3).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="8.5" font-weight="600" fill="#fff">${d.n}</text></g>`).join('')}
      <text x="${c}" y="${S - 6}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="8" fill="#5e6470">${esc(fmtRadius(radius))} radius · inner ring ${esc(fmtRadius(radius / 2))}</text>
      <g transform="translate(${S - 16},22)" font-family="IBM Plex Sans, sans-serif" font-size="8" fill="#1b1d21" text-anchor="middle"><path d="M0 -11 L5 3 L0 0 L-5 3 Z" fill="#1b1d21"/><text y="13">N</text></g>
    </svg>`;
  }

  // ---------- Report data ----------
  function collect() {
    const f = siteFacts(), pr = precedents(f), ch = chosenFsi(f, pr), r = proforma(f, ch.fsi);
    const steps = [-0.1, -0.05, 0, 0.05, 0.1];
    const grid = steps.map((dp) => steps.map((dh) => proforma(f, ch.fsi, { price: 1 + dp, hard: 1 + dh }).rlv));
    const scen = ['zoning', 'median', 'p75', 'custom']
      .filter((k) => ch.opts[k] != null && (k !== 'custom' || ch.key === 'custom'))
      .map((k) => ({ k, fsi: ch.opts[k], r: proforma(f, ch.opts[k]) }));
    const prec = pr.list.slice(0, 6).map(({ a, d }) => {
      let best = a.pts[0], bd = Infinity;
      for (const p of a.pts) { const dd = haversine(f.lat, f.lon, p[0], p[1]); if (dd < bd) { bd = dd; best = p; } }
      return { a, d, pt: best };
    });
    return { f, pr, ch, r, steps, grid, scen, prec, ward: wardAt(f.lat, f.lon) };
  }

  function summaryText(D) {
    const m = (v) => `<span class="nw">${money(v)}</span>`;
    const { r, ch, grid, scen } = D, zon = scen.find((s) => s.k === 'zoning');
    const lo = grid[1][2], hi = grid[3][2], out = [];
    const label = { zoning: 'as-of-right zoning', median: 'the density nearby applications are seeking', p75: 'the upper range of nearby applications', custom: 'the custom density' }[ch.key];
    if (r.rlv <= 0) {
      out.push(`At ${label} (FSI ${num(ch.fsi, 1)}), the project cannot pay anything for the land at these assumptions: the residual is <b>${m(r.rlv)}</b>. A 5% rise in sale prices would take it to <b>${m(hi)}</b>. The sensitivity table shows how far prices or costs need to move.`);
    } else {
      out.push(`At ${label} (FSI ${num(ch.fsi, 1)}), this site supports a residual land value of about <b>${m(r.rlv)}</b>, or ${perSf(r.perBsf)} per buildable sf.${lo < 0 ? ' That margin is thin.' : ''} A 5% drop in sale prices takes it to <b>${m(lo)}</b>, and a 5% rise lifts it to <b>${m(hi)}</b>.`);
    }
    const p2 = [];
    if (zon && ch.key !== 'zoning') p2.push(`At as-of-right zoning (FSI ${num(zon.fsi, 1)}) the residual is ${m(zon.r.rlv)}${zon.r.rlv < r.rlv * 0.5 ? ', so most of the value depends on a rezoning' : ''}.`);
    else if (!zon) p2.push('The zoning data gives no as-of-right FSI for this site, so check the zoning by-law before relying on any scenario.');
    p2.push('If the asking price or current-use value of the land is higher than the residual, the scheme does not work at these assumptions.');
    out.push(p2.join(' '));
    return out.map((p) => `<p>${p}</p>`).join('');
  }

  // ---------- HTML ----------
  function build() {
    const D = collect(), { f, pr, ch, r, steps, grid, scen, prec, ward } = D;
    const P = site.parcels, multi = P.length > 1;
    const title = f.addrs[0] ? (multi ? `${f.addrs[0]} and ${P.length - 1} more` : f.addrs[0]) : `Parcel ${P[0].id}`;
    const sub = multi ? `${P.length}-parcel assembly` + (f.addrs.length > 1 ? ` · ${f.addrs.slice(0, 5).join(', ')}${f.addrs.length > 5 ? '…' : ''}` : '')
      : (f.addrs.length > 1 ? `Also ${f.addrs.slice(1, 5).join(', ')}` : `Parcel ${P[0].id}`);
    const today = todayIso();
    const reportId = `DW-${today.replace(/-/g, '')}-${String(P[0].id).slice(-6)}${multi ? '-A' + P.length : ''}`;
    const snapshot = DATA_META && DATA_META.sourceUpdated ? fmtDate(DATA_META.sourceUpdated.slice(0, 10)) : '—';

    const flags = siteFlagList(f).map(([cls, t]) => [cls === 'good' ? 'good' : cls === 'warn' || cls === 'water' ? 'warn' : '', t]);
    if (f.zonedFsi && ch.fsi > f.zonedFsi * 1.05) flags.push(['', 'Rezoning needed for selected FSI']);
    if (f.heightSt && r.storeys > f.heightSt || (!f.heightSt && f.heightM && r.storeys * 3.2 > f.heightM)) flags.push(['', 'Selected massing exceeds the height overlay']);

    const fact = (k, v, note) => `<div class="fact"><dt>${esc(k)}</dt><dd>${v}${note ? `<span class="fn">${note}</span>` : ''}</dd></div>`;

    // Parcel schedule
    const parcelRows = P.map((p, i) => {
      const z = zoneOf(p);
      return `<tr><td>${multi ? `<span class="idx">${i + 1}</span>` : ''}</td><td class="mono">${esc(p.id)}</td><td>${esc(p.addresses[0] || '—')}${p.addresses.length > 1 ? `<span class="fn">+ ${p.addresses.length - 1} more</span>` : ''}</td>
        <td class="num">${num(p.areaM2)}</td><td class="mono">${z ? esc(z.string) : 'Former by-law'}</td>
        <td class="num">${p.bldgCount ? `${p.bldgCount} · ${num(p.bldgGfaEstM2)} m²` : '—'}</td><td>${esc(HERITAGE_LABEL(p.heritage)) || '—'}</td></tr>`;
    }).join('') + (multi ? `<tr class="sub"><td></td><td></td><td>Assembly total</td><td class="num">${num(f.area)}</td><td></td><td class="num">${num(f.bGfa)} m²</td><td></td></tr>` : '');

    const zoneTxt = f.zones.length ? f.zones.map((z) => `<code>${esc(z.string)}</code>${z.exception ? ` <span class="fn-inline">exception ${esc(z.exception)}</span>` : ''}`).join('<br>') : 'Not covered';
    const env = [];
    if (f.env & 1) env.push('Regulatory floodplain (TRCA)');
    if (f.env & 2) env.push('TRCA regulated area');
    if (f.ravine) env.push('Ravine and natural feature protection');
    if (f.env & 4) env.push('Environmentally Significant Area');
    if (f.env & 8) env.push('Natural Heritage System');

    const planning = [
      fact('Zoning (By-law 569-2013)', zoneTxt, f.unzoned && f.zones.length ? 'Part of this site is not covered by By-law 569-2013.' : ''),
      f.unzoned ? fact('Former by-law in effect', f.formerBylaws.map((m) => esc(FORMER_BYLAWS[m]?.name || 'A former municipal zoning by-law')).join('<br>'), 'Applies as amended by site-specific by-laws, which this data does not include.') : '',
      fact('Zoned density', f.zonedFsi ? `FSI ${num(f.zonedFsi, 2)}` : '—', f.zonedFsi ? `${num(f.zonedFsi * f.area)} m² as of right` : 'No FSI in the zone label'),
      fact('Height limit', f.heightM ? `${num(f.heightM, 1)} m` + (f.heightSt ? ` · ${f.heightSt} storeys` : '') : '—', 'Height overlay'),
      fact('Lot coverage', f.cov ? `${num(f.cov)}%` : '—'),
      fact('Secondary Plan', f.sps.length ? esc(f.sps.join(', ')) : 'None'),
      fact('Site and Area Specific Policy', f.sasp.length ? esc(f.sasp.map((s) => 'SASP ' + +s).join(', ')) : 'None'),
      fact('Major Transit Station Area', f.mtsa.length ? esc(f.mtsa.map((m) => m[0]).join(', ')) : 'None', f.mtsa.length ? 'Official Plan minimum densities apply. Inclusionary zoning may apply in protected areas.' : ''),
      fact('Heritage', f.heritage.length ? esc(f.heritage.map(HERITAGE_LABEL).join(', ')) : 'None on the Heritage Register'),
      fact('Flood and natural features', env.length ? env.map(esc).join('<br>') : 'None mapped', (f.env & 3) ? 'Needs a TRCA permit under Ontario Regulation 41/24.' : ''),
      fact('Holding symbol', f.holding ? 'Yes' : 'None'),
      fact('Condominium', f.condo ? 'Registered condominium' : 'No registered condominium'),
    ].join('');

    const precRows = prec.map(({ a, d }, i) => `<tr><td><span class="idx">${i + 1}</span></td><td>${a.url ? `<a href="${esc(a.url)}">${esc(a.addrs[0] || a.id)}</a>` : esc(a.addrs[0] || a.id)}<span class="fn mono">${esc(a.id)}</span></td>
      <td class="num">${esc(fmtDist(d))}</td><td>${esc(a.type)}</td><td>${esc(a.status)}</td><td class="num">${num(a.fsi, 1)}</td><td class="num">${a.storeys || '—'}</td><td class="num">${a.units ? num(a.units) : '—'}</td></tr>`).join('');

    const scenRows = scen.map(({ k, fsi, r: s }) => `<tr class="${k === ch.key ? 'sel' : ''}"><td>${SCEN_LABEL[k]}${k === ch.key ? ' <span class="chip acc">Selected</span>' : ''}</td>
      <td class="num">${num(fsi, 1)}</td><td class="num">${num(s.gfaM2)}</td><td class="num">${num(s.units)}</td><td class="num">≈ ${s.storeys}</td><td class="num strong">${money(s.rlv)}</td><td class="num">${money(s.perUnit)}</td></tr>`).join('');
    const zon = scen.find((s) => s.k === 'zoning');
    const uplift = zon && ch.key !== 'zoning' ? r.rlv - zon.r.rlv : null;

    const pfRows = [
      ['Residential sales', r.revRes, ''], ['Parking sales', r.revPark, ''], ['Gross revenue', r.revenue, 'sub'],
      ['Hard costs incl. parking', -r.hardCost], ['Contingency', -r.cont], ['Soft costs', -r.soft], ['Development charges', -r.dcs],
      ['Demolition', -r.demo], ['Sales and marketing', -r.sales], ['Construction financing', -r.finance], ['Developer profit', -r.profit],
      ['Available for land and land costs', r.rlv + r.landLinked, 'sub'],
      [`Land closing, parkland${r.cbcApplies ? ', CBC' : ''} and land carry`, -r.landLinked],
      ['Residual land value', r.rlv, 'total'],
    ].map(([k, v, cls]) => `<tr class="${cls || ''}"><td>${esc(k)}</td><td class="num">${money(v)}</td><td class="num">${r.revenue ? num(Math.abs(v) / r.revenue * 100, 1) + '%' : ''}</td></tr>`).join('');

    const maxAbs = Math.max(1, ...grid.flat().map(Math.abs));
    const sens = `<thead><tr><th scope="col">Sale price ↓ · Hard cost →</th>${steps.map((s) => `<th scope="col">${s > 0 ? '+' : ''}${Math.round(s * 100)}%</th>`).join('')}</tr></thead><tbody>` +
      grid.map((row, i) => `<tr><th scope="row">$${num(PF.salePsf * (1 + steps[i]))}/sf</th>${row.map((v, j) => {
        const a = Math.min(1, Math.abs(v) / maxAbs) * 0.5 + 0.08;
        return `<td class="num${i === 2 && j === 2 ? ' base' : ''}" style="background:color-mix(in srgb, ${v < 0 ? 'var(--neg)' : 'var(--pos)'} ${Math.round(a * 100)}%, transparent)">${shortMoney(v)}</td>`;
      }).join('')}</tr>`).join('') + '</tbody>';

    let edited = 0;
    const assump = FIELDS.map(([group, fields]) => `<div class="agroup"><h4>${esc(group)}</h4><dl>${fields.map(([k, label, unit]) => {
      const ch2 = PF[k] !== DEFAULTS[k]; if (ch2) edited++;
      const v = Number(PF[k]).toLocaleString('en-CA', { maximumFractionDigits: 2 });
      const val = unit === '$' ? `$${v}` : unit.startsWith('$/') ? `$${v}${unit.slice(1)}` : unit.startsWith('%') ? `${v}${unit}` : `${v}${unit ? ' ' + unit : ''}`;
      return `<div><dt>${esc(label)}</dt><dd>${esc(val)}${ch2 ? ' <span class="chip acc">edited</span>' : ''}</dd></div>`;
    }).join('')}</dl></div>`).join('');

    const heightNote = `At a ${num(Math.min(PF.floorplate, f.area * 0.9))} m² floor plate` + (f.heightSt && r.storeys > f.heightSt ? ` · above the ${f.heightSt}-storey limit` : f.heightM && r.storeys * 3.2 > f.heightM ? ` · above the ${num(f.heightM)} m limit` : '');
    const costs = r.hardCost + r.cont + r.soft + r.dcs + r.demo + r.sales + r.finance;
    const neg = r.rlv < 0;

    const body = `
<div class="toolbar"><div class="toolbar-in">
  <div class="tb-btns"><button type="button" id="pdf" class="primary">Save as PDF</button><button type="button" id="html">Download HTML</button></div>
  <p>In the print dialog, choose <b>Save as PDF</b> as the destination. Figures reflect the site and assumptions selected when this report was made.</p>
</div></div>
<article class="sheet">
  <header class="rep">
    <div>
      <div class="brand">Development Watch · Site Feasibility Report</div>
      <h1>${esc(title)}</h1>
      <div class="addr">${esc(sub)}${ward ? ` · Ward ${esc(ward.code)}, ${esc(ward.name)}` : ''}</div>
    </div>
    <div class="meta">
      Report <b>${esc(reportId)}</b><br>
      Prepared <b>${esc(fmtDate(today))}</b><br>
      Data snapshot <b>${esc(snapshot)}</b><br>
      Scenario <b>${esc(SCEN_LABEL[ch.key].replace(' (zoning)', ''))}</b>
    </div>
  </header>

  <div class="summary">
    <div class="rlv${neg ? ' neg' : ''}">
      <div class="k">Residual land value</div>
      <div class="big">${money(r.rlv)}</div>
      <div class="note">At FSI ${num(ch.fsi, 2)} · about ${num(r.units)} units · ≈ ${r.storeys} storeys</div>
      <div class="tiles">
        <div><div class="v">${perSf(r.perBsf)}</div><div class="l">per buildable sf</div></div>
        <div><div class="v">${money(r.perAcre)}</div><div class="l">per acre</div></div>
        <div><div class="v">${money(r.perUnit)}</div><div class="l">per unit</div></div>
      </div>
    </div>
    <div class="takeaway">
      <h4>Summary</h4>
      ${summaryText(D)}
      <div class="chips">${flags.length ? flags.map(([c, t]) => `<span class="chip ${c}">${esc(t)}</span>`).join('') : '<span class="chip">No heritage, ravine, flood or condominium flags</span>'}</div>
    </div>
  </div>

  <section class="s">
    <h2><span class="no">01</span>Site${multi ? ' and parcels' : ''}</h2>
    <div class="two">
      <figure>${sitePlanSvg(P, f)}<figcaption>Parcel outline${multi ? 's' : ''} from Property Boundaries${multi ? ', numbered as in the schedule' : ''}. Amber: on the Heritage Register.</figcaption></figure>
      <dl class="facts one">
        ${fact('Lot area', `${num(f.area)} m²`, `${num(f.area * SQFT)} sf · ${num(f.area / ACRE_M2, 2)} ac`)}
        ${f.width ? fact('Approx. dimensions', `${num(f.width, 1)} × ${num(f.depth, 1)} m`, 'Shortest and longest side of the bounding rectangle') : ''}
        ${fact('Existing buildings', f.bCount ? `${f.bCount} · ${num(f.bFoot)} m² footprint` : 'None recorded', f.bCount ? `${f.bMax > 0 ? `Up to ${num(f.bMax, 1)} m tall · ` : ''}about ${num(f.bGfa)} m² floor area (FSI ${num(f.bGfa / f.area, 2)}), estimated from 3D massing` : '')}
        ${fact('Location', `${num(f.lat, 5)}, ${num(f.lon, 5)}`, 'Site centroid (WGS84)')}
      </dl>
    </div>
    <h3>Parcel schedule</h3>
    <div class="tw"><table>
      <thead><tr><th></th><th>Parcel</th><th>Address</th><th class="num">Area m²</th><th>Zoning</th><th class="num">Existing buildings</th><th>Heritage</th></tr></thead>
      <tbody>${parcelRows}</tbody>
    </table></div>
  </section>

  <section class="s">
    <h2><span class="no">02</span>Planning controls</h2>
    <dl class="facts">${planning}</dl>
  </section>

  <section class="s brk">
    <h2><span class="no">03</span>Nearby precedents</h2>
    ${pr.n ? `
    <div class="two prec-grid">
      <figure>${precedentMapSvg(f, prec, site.precRadius)}</figure>
      <dl class="facts one">
        ${fact('Median FSI', num(pr.median, 1), `from ${pr.n} site${pr.n === 1 ? '' : 's'} with a stated density`)}
        ${fact('75th percentile FSI', num(pr.p75, 1))}
        ${fact('Median height', pr.medStoreys ? `${pr.medStoreys} storeys` : 'Not stated')}
        ${fact('Search', esc(fmtRadius(site.precRadius)), 'Rezoning and site plan files, last 10 years, latest file per address')}
      </dl>
    </div>
    <div class="tw" style="margin-top:12px"><table>
      <thead><tr><th>#</th><th>Address</th><th class="num">Distance</th><th>Type</th><th>Status</th><th class="num">FSI</th><th class="num">Storeys</th><th class="num">Units</th></tr></thead>
      <tbody>${precRows}</tbody>
    </table></div>
    <p class="small muted" style="margin-top:6px">The ${Math.min(6, pr.list.length)} nearest of ${pr.n}. Type: OZ = Official Plan / Rezoning, SA = Site Plan Approval. FSI is the figure stated in the file, or proposed GFA divided by the parcel area, read from free-text descriptions.</p>`
    : `<p class="muted">No rezoning or site plan applications with a stated density within ${esc(fmtRadius(site.precRadius))} in the last 10 years.</p>`}
  </section>

  <section class="s">
    <h2><span class="no">04</span>Density scenarios</h2>
    <p class="muted small">Same assumptions at each density available for this site.${uplift != null ? ` The difference between the as-of-right and selected rows (${money(uplift)}) is the land value a rezoning would create, a starting point for community benefit discussions.` : ''}</p>
    <div class="tw"><table>
      <thead><tr><th>Scenario</th><th class="num">FSI</th><th class="num">GFA m²</th><th class="num">Units</th><th class="num">Storeys</th><th class="num">RLV</th><th class="num">RLV / unit</th></tr></thead>
      <tbody>${scenRows}</tbody>
    </table></div>
  </section>

  <section class="s brk">
    <h2><span class="no">05</span>Pro forma: ${esc(SCEN_LABEL[ch.key].replace(' (zoning)', ''))}, FSI ${num(ch.fsi, 2)}</h2>
    <div class="two">
      <div class="tw"><table>
        <thead><tr><th>Line</th><th class="num">Amount</th><th class="num">% of revenue</th></tr></thead>
        <tbody>${pfRows}</tbody>
      </table></div>
      <dl class="facts one">
        ${fact('Gross floor area', `${num(r.gfaM2)} m²`, `${num(r.gfaSf)} sf`)}
        ${fact('Units', num(r.units), `${num(r.nsa)} sf saleable at ${num(PF.unitSize)} sf average`)}
        ${fact('Implied height', `≈ ${r.storeys} storeys`, heightNote)}
        ${fact('Parking', `${num(r.stalls)} stalls`)}
        ${fact('Community benefits charge', r.cbcApplies ? 'Applies (5+ storeys, 10+ units)' : 'Does not apply')}
      </dl>
    </div>
  </section>

  <section class="s">
    <h2><span class="no">06</span>Sensitivity: residual land value</h2>
    <p class="muted small">Rows change the sale price, columns change the hard cost. The outlined cell is the base case.</p>
    <div class="tw"><table class="sens">${sens}</table></div>
  </section>

  <section class="s brk">
    <h2><span class="no">07</span>Assumptions</h2>
    <div class="assump">${assump}</div>
    <p class="small muted" style="margin-top:10px">${edited ? `${edited} value${edited === 1 ? '' : 's'} changed from the app's defaults (marked "edited").` : "These are the app's default figures for Toronto high-rise condo in late 2026. Replace them with current market and cost numbers."}</p>
  </section>

  <section class="s">
    <h2><span class="no">08</span>Method: what residual land value means</h2>
    <p>Residual land value is the most a developer could pay for this land and still earn their required profit. It is worked out backwards from what the finished project would be worth.</p>
    <div class="formula">RLV = Gross development value − (development costs + developer profit)<br><span class="muted">then ÷ (1 + land closing % + parkland % + CBC % + land carry)</span></div>
    <h3>This site, step by step</h3>
    <table class="walk"><tbody>
      <tr><td>Gross development value</td><td class="num">${money(r.revenue)}</td></tr>
      <tr><td>− Development costs</td><td class="num">${money(costs)}</td></tr>
      <tr><td>− Developer profit (${num(PF.profitPct, 1)}% of revenue)</td><td class="num">${money(r.profit)}</td></tr>
      <tr class="sub"><td>${neg ? 'Shortfall before land' : 'Available for land and land costs'}</td><td class="num">${money(r.rlv + r.landLinked)}</td></tr>
      <tr><td>− Land-linked costs</td><td class="num">${money(r.landLinked)}</td></tr>
      <tr class="total"><td>Residual land value</td><td class="num">${money(r.rlv)}</td></tr>
    </tbody></table>
    <h3>How to read it</h3>
    <ul class="uses">
      <li><b>Viability.</b> Compare the residual with the asking price or the land's current-use value. If the residual is lower, the scheme does not work as designed.</li>
      <li><b>Highest and best use.</b> The scenario table shows which density produces the most land value.</li>
      <li><b>Policy impact.</b> Raising development charges, parkland or inclusionary zoning requirements lowers the residual. If it falls below current-use value, development stalls.</li>
      <li><b>Land value capture.</b> The uplift between as-of-right and the selected density is the value a rezoning creates.</li>
      <li><b>Leverage.</b> The residual is a small number left after subtracting two large ones, so small changes in prices or costs swing it a lot. Read it alongside the sensitivity table.</li>
    </ul>
    <div class="disclaimer">
      This is a screening estimate, not an appraisal. It ignores HST, phasing, inclusionary zoning and site-specific costs such as shoring, remediation and heritage conservation. Application units, storeys and FSI are read from free-text descriptions. Data: City of Toronto Open Data (Development Applications, Property Boundaries, Zoning By-law 569-2013, Secondary Plans, Site and Area Specific Policies, Major Transit Station Areas, Heritage Register, Ravine Protection, 3D Massing, City Wards), Open Government Licence – Toronto; TRCA Open Data (TRCA Open Data Licence v1.0).
    </div>
    <footer class="pg"><span>Development Watch · ${esc(reportId)}</span><span>${esc(title)}</span></footer>
  </section>
</article>`;

    return { html: `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Site Feasibility Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${REPORT_CSS}</style></head><body>${body}
<script>${REPORT_SCRIPT}<\/script></body></html>`, filename: `site-report-${reportId}.html` };
  }

  const REPORT_SCRIPT = `
(function () {
  var pdf = document.getElementById('pdf'), html = document.getElementById('html');
  pdf.addEventListener('click', function () { window.print(); });
  html.addEventListener('click', function () {
    var doc = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
    var url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    var a = document.createElement('a'); a.href = url; a.download = document.body.dataset.filename || 'site-report.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
})();`;

  const REPORT_CSS = `
/* Letter-size sheets on a grey desk; summary first, detail after. Single light theme: a printed document. */
:root { --desk:#e4e6ea; --paper:#fff; --ink:#1b1d21; --muted:#5e6470; --rule:#d9dce2; --soft:#f3f4f7; --accent:#1f5fbf; --pos:#2a9467; --neg:#c9416b; --warn:#a8650f;
  --display:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif; --body:"IBM Plex Sans","Segoe UI",Helvetica,Arial,sans-serif; --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace; color-scheme:light; }
*{box-sizing:border-box} html,body{margin:0}
body{background:var(--desk);color:var(--ink);font:13.5px/1.5 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
.toolbar{position:sticky;top:0;z-index:5;background:rgba(228,230,234,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--rule)}
.toolbar-in{max-width:8.5in;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}
.tb-btns{display:flex;gap:8px}
.toolbar button{font:600 13px var(--body);border:1px solid var(--rule);background:var(--paper);color:var(--ink);padding:7px 14px;border-radius:8px;cursor:pointer}
.toolbar button.primary{background:var(--accent);color:#fff;border-color:transparent}
.toolbar button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.toolbar p{margin:0;color:var(--muted);font-size:12.5px;max-width:56ch}
.sheet{max-width:8.5in;margin:20px auto;background:var(--paper);box-shadow:0 1px 2px rgba(20,25,35,.08),0 8px 24px rgba(20,25,35,.08);padding:.6in .65in}
@media (max-width:640px){.sheet{padding:24px 18px;margin:12px 8px}}
header.rep{display:grid;grid-template-columns:1fr auto;gap:8px 24px;padding-bottom:18px;border-bottom:3px solid var(--ink)}
.brand{font:600 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font:700 30px/1.1 var(--display);margin:6px 0 4px;letter-spacing:-.01em;text-wrap:balance}
.addr{color:var(--muted);font-size:13px}
.meta{font:12px/1.7 var(--mono);color:var(--muted);text-align:right;white-space:nowrap}
.meta b{color:var(--ink);font-weight:500}
@media (max-width:560px){header.rep{grid-template-columns:1fr}.meta{text-align:left}}
section.s{padding-top:22px}
h2{font:600 17px/1.2 var(--display);margin:0 0 10px;text-wrap:balance}
h2 .no{font:500 12px var(--mono);color:var(--accent);margin-right:10px}
h3{font:600 13px var(--body);margin:14px 0 6px}
h4{font:600 11.5px var(--body);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 6px}
p{margin:0 0 8px;max-width:72ch}
.muted{color:var(--muted)} .small{font-size:12px}
.summary{display:grid;grid-template-columns:1.15fr 1fr;gap:18px;margin-top:18px}
@media (max-width:640px){.summary{grid-template-columns:1fr}}
.rlv{align-self:start;border:1px solid color-mix(in srgb,var(--pos) 40%,transparent);background:color-mix(in srgb,var(--pos) 8%,var(--paper));border-radius:10px;padding:16px}
.rlv.neg{border-color:color-mix(in srgb,var(--neg) 40%,transparent);background:color-mix(in srgb,var(--neg) 8%,var(--paper))}
.rlv .k{font:600 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.rlv .big{font:700 40px/1.05 var(--display);letter-spacing:-.02em;margin:4px 0 2px;font-variant-numeric:tabular-nums}
.rlv .note{color:var(--muted);font-size:12.5px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.tiles>div{background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:8px 10px}
.tiles .v{font:600 16px var(--display);font-variant-numeric:tabular-nums}
.tiles .l{color:var(--muted);font-size:11px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{display:inline-block;font-size:11.5px;font-weight:500;padding:2px 8px;border-radius:999px;background:var(--soft);color:var(--muted)}
.chip.good{color:var(--pos);background:color-mix(in srgb,var(--pos) 12%,transparent)}
.chip.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.chip.acc{color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);font-size:10.5px;padding:1px 7px;margin-left:4px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.two.prec-grid{grid-template-columns:240px 1fr}
@media (max-width:640px){.two,.two.prec-grid{grid-template-columns:1fr}}
figure{margin:0;border:1px solid var(--rule);border-radius:8px;padding:10px;background:var(--soft);align-self:start}
figure svg{display:block;width:100%;height:auto}
figcaption{font-size:11.5px;color:var(--muted);margin-top:6px}
.facts{display:grid;grid-template-columns:repeat(2,1fr);gap:0 24px;margin:0}
.facts.one{grid-template-columns:1fr;align-content:start}
@media (max-width:560px){.facts{grid-template-columns:1fr}}
.fact{display:grid;grid-template-columns:44% 1fr;gap:10px;padding:7px 0;border-bottom:1px solid var(--rule);break-inside:avoid}
.fact dt{color:var(--muted);font-size:12.5px}
.fact dd{margin:0;font-weight:500}
.fn{display:block;font-weight:400;color:var(--muted);font-size:11.5px}
.fn-inline{font-weight:400;color:var(--muted);font-size:11.5px}
  .nw{white-space:nowrap}
code,.mono{font-family:var(--mono);font-size:12px}
.tw{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
thead th{font:600 11px var(--body);text-transform:uppercase;letter-spacing:.04em;color:var(--muted);border-bottom:1.5px solid var(--ink)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.sub td{font-weight:600;background:var(--soft)}
tr.total td{font-weight:700;font-size:14px;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink)}
tr.sel td{background:color-mix(in srgb,var(--accent) 6%,transparent)}
td.strong{font-weight:700}
.idx{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;font:600 10.5px var(--mono)}
table.sens{table-layout:fixed;min-width:480px}
table.sens th,table.sens td{text-align:center}
table.sens tbody th{text-align:left;font-weight:600;white-space:nowrap}
table.sens td.base{outline:2px solid var(--ink);outline-offset:-2px;font-weight:700}
.assump{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px 22px}
.agroup dl{margin:0}
.agroup dl div{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px dotted var(--rule);font-size:12.5px}
.agroup dt{color:var(--muted)}
.agroup dd{margin:0;font-weight:500;text-align:right;font-variant-numeric:tabular-nums}
.formula{font:500 13px/1.6 var(--mono);background:var(--soft);border-left:3px solid var(--accent);padding:10px 14px;margin:8px 0 12px;border-radius:0 6px 6px 0;overflow-x:auto}
.walk{max-width:460px}
.walk td:first-child{color:var(--muted)}
ul.uses{margin:4px 0 10px;padding-left:18px;max-width:72ch}
ul.uses li{margin-bottom:5px}
.disclaimer{margin-top:18px;padding-top:12px;border-top:1px solid var(--rule);font-size:11.5px;color:var(--muted)}
footer.pg{display:flex;justify-content:space-between;gap:12px;margin-top:24px;padding-top:8px;border-top:1px solid var(--rule);font:11px var(--mono);color:var(--muted)}
@page{size:letter;margin:.55in .6in}
@media print{
  body{background:#fff} .toolbar{display:none}
  .sheet{box-shadow:none;margin:0;padding:0;max-width:none}
  section.brk{break-before:page}
  tr,figure,.rlv,.tw,.agroup,.walk{break-inside:avoid}
  h2,h3{break-after:avoid}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

  // ---------- Button ----------
  function saveFile(name, html) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.buildSiteReport = build;
  $('siteReport').addEventListener('click', () => {
    if (!site.parcels.length) return;
    const { html, filename } = build();
    const doc = html.replace('<body>', `<body data-filename="${esc(filename)}">`);
    const w = window.open('', '_blank');
    if (!w) { saveFile(filename, doc); return; } // pop-up blocked: download the file instead
    w.document.open(); w.document.write(doc); w.document.close();
  });
})();
