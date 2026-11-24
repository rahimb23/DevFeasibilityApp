// Site Feasibility Report: a printable report for the selected site, laid out after the
// "Site Feasibility Report Sample" and filled from the app's own analysis and pro forma.
// Loaded after feasibility.js; uses its globals (site, siteFacts, precedents, proforma, PF ...).
'use strict';

const RPT_BRAND = 'Toronto Development Radar';

function rptMoney(v) { return money(v); }
function rptPct(v, d = 1) { return `${num(v, d)}%`; }
function fmtAssumption(v, unit) {
  if (unit === '$') return `$${num(v)}`;
  if (unit.startsWith('$')) return `$${num(v)}${unit.slice(1)}`;
  if (unit.startsWith('%')) return `${num(v, v % 1 ? 2 : 0)}%${unit.slice(1)}`;
  if (unit === '') return num(v, 2);
  return `${num(v, v % 1 ? 2 : 0)} ${unit}`;
}
const LABELS = { zoning: 'As of right (zoning)', median: 'Precedent median', p75: 'Precedent 75th percentile', custom: 'Custom density' };

// ---------- Drawings ----------
function siteSvg(f) {
  const P = site.parcels, lat0 = f.lat, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const toM = ([la, lo]) => [(lo - f.lon) * kx, (la - lat0) * ky];
  const rings = P.map((p) => p.pts.map(toM));
  const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 320, H = 230, pad = 26, s = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad - 14) / Math.max(1, y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2, oy = (H - 14 - (y1 - y0) * s) / 2;
  const px = ([x, y]) => [ox + (x - x0) * s, oy + (y1 - y) * s];
  const bar = [5, 10, 20, 50, 100, 200, 500].find((m) => m * s >= 40) || 500;
  const polys = P.map((p, i) => {
    const pts = rings[i].map(px), d = 'M' + pts.map((q) => q.map((v) => v.toFixed(1)).join(' ')).join(' L') + ' Z';
    const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    const label = `P${i + 1}`;
    const fill = p.heritage ? 'var(--r-warn)' : 'var(--r-accent)';
    return `<path d="${d}" fill="color-mix(in srgb, ${fill} 16%, white)" stroke="var(--r-accent)" stroke-width="1.5"/>
      <text x="${cx.toFixed(1)}" y="${(cy - 2).toFixed(1)}" text-anchor="middle" font-family="var(--r-mono)" font-size="10" fill="var(--r-ink)">${esc(label)}</text>
      <text x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}" text-anchor="middle" font-family="var(--r-mono)" font-size="8.5" fill="var(--r-muted)">${num(p.areaM2)} m²</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Outline of the selected parcels">
    <rect width="${W}" height="${H}" fill="var(--r-soft)"/>${polys}
    <g transform="translate(${W - 24},30)" font-family="var(--r-body)" font-size="9" fill="var(--r-ink)" text-anchor="middle"><path d="M0 -14 L6 4 L0 0 L-6 4 Z" fill="var(--r-ink)"/><text y="16">N</text></g>
    <g transform="translate(14,${H - 10})" font-family="var(--r-mono)" font-size="8" fill="var(--r-muted)"><rect width="${(bar * s).toFixed(1)}" height="3" y="-3" fill="var(--r-ink)"/><text x="${(bar * s + 5).toFixed(1)}" y="1">${bar} m</text></g>
  </svg>`;
}

function precedentSvg(f, list) {
  const R = site.precRadius, S = 220, c = S / 2, r = 96, k = r / R;
  const kx = 111320 * Math.cos(f.lat * Math.PI / 180), ky = 110574;
  const pt = (la, lo) => [c + (lo - f.lon) * kx * k, c - (la - f.lat) * ky * k];
  let roads = '';
  if (typeof NET !== 'undefined' && NET) {
    const dLat = R / ky, dLon = R / kx;
    const ids = TDRStreets.query(NET, f.lon - dLon, f.lat - dLat, f.lon + dLon, f.lat + dLat);
    roads = ids.map((i) => NET.segs[i]).filter((sg) => sg.c <= 6).map((sg) => {
      const d = Array.from(sg.xs, (x, j) => pt(sg.ys[j], x).map((v) => v.toFixed(1)).join(' ')).join(' L');
      return `<path d="M${d}" stroke="#fff" stroke-width="${sg.c <= 4 ? 3.2 : 1.6}" fill="none" stroke-linecap="round"/>`;
    }).join('');
  }
  const dots = list.map(({ a }, i) => {
    const p = a._pt || a.pts[0], [x, y] = pt(p[0], p[1]);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7.5" fill="var(--r-accent)"/><text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${i + 1}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Map of precedent applications within ${fmtRadius(R)} of the site">
    <defs><clipPath id="rptClip"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath></defs>
    <rect width="${S}" height="${S}" fill="var(--r-soft)"/>
    <g clip-path="url(#rptClip)">${roads}</g>
    <circle cx="${c}" cy="${c}" r="${r}" fill="color-mix(in srgb, var(--r-accent) 6%, transparent)" stroke="var(--r-accent)" stroke-dasharray="3 3"/>
    <rect x="${c - 6}" y="${c - 6}" width="12" height="12" fill="var(--r-ink)"/>
    <g font-family="var(--r-mono)" font-size="8.5" font-weight="600" fill="#fff" text-anchor="middle">${dots}</g>
    <text x="${c}" y="${S - 6}" text-anchor="middle" font-family="var(--r-mono)" font-size="8" fill="var(--r-muted)">${fmtRadius(R)} radius</text>
  </svg>`;
}

// ---------- Report ----------
function buildReport() {
  const f = siteFacts(), pr = precedents(f), ch = chosenFsi(f, pr), r = proforma(f, ch.fsi);
  const today = new Date(), iso = today.toISOString().slice(0, 10);
  const dataDate = (typeof DATA_META !== 'undefined' && DATA_META && DATA_META.sourceUpdated) ? fmtDate(DATA_META.sourceUpdated.slice(0, 10)) : '—';
  const reportId = `TDR-${iso.replace(/-/g, '').slice(0, 4)}-${iso.slice(5, 7)}${iso.slice(8, 10)}-${String(site.parcels[0].id).slice(-5)}`;
  const title = site.parcels.length > 1 ? `${f.addrs[0] || 'Parcel ' + site.parcels[0].id} and ${site.parcels.length - 1} more` : (f.addrs[0] || `Parcel ${site.parcels[0].id}`);
  const subtitle = site.parcels.length > 1 ? `${site.parcels.length}-parcel assembly · ${f.addrs.slice(0, 4).join(', ')}${f.addrs.length > 4 ? '…' : ''}` : (f.addrs.length > 1 ? f.addrs.join(', ') : `Parcel ${site.parcels[0].id}`);
  const wards = [...new Set(APPS.filter((a) => a.pts.length && haversine(f.lat, f.lon, a.pts[0][0], a.pts[0][1]) < 400).map((a) => `Ward ${a.ward}, ${a.wardName}`))];
  const ward = wards[0] || '';

  // Scenarios with the same assumptions
  const keys = ['zoning', 'median', 'p75'].filter((k) => ch.opts[k] != null);
  if (ch.key === 'custom') keys.push('custom');
  const scen = keys.map((k) => ({ k, fsi: ch.opts[k], res: proforma(f, ch.opts[k]) }));
  const asr = scen.find((x) => x.k === 'zoning');
  const uplift = asr && ch.key !== 'zoning' ? r.rlv - asr.res.rlv : null;

  // Summary sentences: sign test, ±5% price sensitivity, as-of-right comparison
  const lo = proforma(f, ch.fsi, { price: 0.95 }).rlv, hi = proforma(f, ch.fsi, { price: 1.05 }).rlv;
  const slope = (hi - lo) / 0.1, bePct = slope ? (-r.rlv / slope) * 100 : null;
  let s1;
  if (r.rlv <= 0) s1 = `At ${esc(LABELS[ch.key].toLowerCase())} density (FSI ${num(ch.fsi, 1)}), this site cannot pay anything for the land at these assumptions: the residual is <b>${rptMoney(r.rlv)}</b>.${bePct != null && bePct > 0 && bePct < 60 ? ` Sale prices would need to rise about <b>${num(bePct, 1)}%</b>, to roughly $${num(salePrice(f) * (1 + bePct / 100))}/sf, to break even.` : ''}`;
  else if (r.rlv < 0.05 * r.revenue) s1 = `At ${esc(LABELS[ch.key].toLowerCase())} density (FSI ${num(ch.fsi, 1)}), this site supports a land value of about <b>${rptMoney(r.rlv)}</b>. That margin is thin. A 5% drop in sale prices takes it to <b>${rptMoney(lo)}</b>, and a 5% rise lifts it to <b>${rptMoney(hi)}</b>.`;
  else s1 = `At ${esc(LABELS[ch.key].toLowerCase())} density (FSI ${num(ch.fsi, 1)}), this site supports a land value of about <b>${rptMoney(r.rlv)}</b>, or ${rptMoney(r.perBsf)} per buildable sf. A 5% change in sale prices moves it between <b>${rptMoney(lo)}</b> and <b>${rptMoney(hi)}</b>.`;
  let s2;
  if (f.unzoned && !f.zones.length) s2 = `There is no as-of-right density to compare, because a former by-law applies (${esc(f.formerBylaws.map((m) => (FORMER_BYLAWS[m]?.name || 'a former municipal by-law')).join('; '))}). Check site-specific by-laws on the City's zoning map.`;
  else if (asr && ch.key !== 'zoning') {
    const a = asr.res.rlv, at = `At as-of-right zoning (FSI ${num(asr.fsi, 1)})`;
    if (a < r.rlv && r.rlv > 0) s2 = `${at} it falls to ${rptMoney(a)}, so value here depends on a rezoning.`;
    else if (a < r.rlv) s2 = `${at} it is lower still, at ${rptMoney(a)}, so more density helps but does not close the gap on its own.`;
    else s2 = `${at} it comes to ${rptMoney(a)}. At these assumptions the extra density costs more to build than it earns, so a rezoning adds no land value.`;
  }
  else s2 = '';
  const s3 = r.rlv > 0 ? 'If the asking price or current-use value of the land is higher than the residual, the scheme does not work at these assumptions.' : 'Lower costs, higher prices or a different density would be needed before this site makes sense to acquire.';

  const heritageNote = (h) => h === 'Listed' ? 'Listing requires 60 days’ notice before demolition' : h === 'Part IV' ? 'Designated: changes and demolition need a heritage permit' : 'Heritage Conservation District: exterior changes need a heritage permit';
  const envItems = [];
  if (f.env & 1) envItems.push('Regulatory floodplain (TRCA)');
  if (f.env & 2) envItems.push('TRCA regulated area');
  if (f.ravine) envItems.push('Ravine and natural feature protection');
  if (f.env & 4) envItems.push('Environmentally Significant Area');
  if (f.env & 8) envItems.push('Natural Heritage System');

  const fact = (k, v, note) => `<div class="fact"><dt>${esc(k)}</dt><dd>${v}${note ? `<span class="fn">${note}</span>` : ''}</dd></div>`;
  const heritageByAddr = site.parcels.filter((p) => p.heritage).map((p) => `${p.heritage === 'Part IV' ? 'Designated' : p.heritage === 'Part V' ? 'HCD' : 'Listed'}: ${p.addresses[0] || 'parcel ' + p.id}`);

  const pfRows = [
    ['Residential sales', r.revRes, 'rev'], ['Parking sales', r.revPark, 'rev'], ['Gross revenue', r.revenue, 'sub'],
    ['Hard costs incl. parking', -r.hardCost], ['Contingency', -r.cont], ['Soft costs', -r.soft], ['Development charges', -r.dcs],
    ['Demolition', -r.demo], ['Sales and marketing', -r.sales], ['Construction financing', -r.finance], ['Developer profit', -r.profit],
    ['Available for land and land costs', r.rlv + r.landLinked, 'sub'],
    [`Land closing, parkland${r.cbcApplies ? ', CBC' : ''} and land carry`, -r.landLinked], ['Residual land value', r.rlv, 'total'],
  ];
  const steps = [-0.1, -0.05, 0, 0.05, 0.1];
  const grid = steps.map((dp) => steps.map((dh) => proforma(f, ch.fsi, { price: 1 + dp, hard: 1 + dh }).rlv));
  const maxAbs = Math.max(1, ...grid.flat().map(Math.abs));
  const costs = r.hardCost + r.cont + r.soft + r.dcs + r.demo + r.sales + r.finance;
  const flagsHtml = $('siteFlags').innerHTML;
  const precList = pr.list.slice(0, 6);
  const edited = (k) => PF[k] !== DEFAULTS[k];

  return `
  <header class="rep">
    <div>
      <div class="brand">${RPT_BRAND} · Site Feasibility Report</div>
      <h1>${esc(title)}</h1>
      <div class="addr">${esc(subtitle)}${ward ? ` · ${esc(ward)}` : ''}</div>
    </div>
    <div class="meta">Report <b>${reportId}</b><br>Prepared <b>${fmtDate(iso)}</b><br>Data snapshot <b>${dataDate}</b><br>Scenario <b>${esc(LABELS[ch.key])}</b></div>
  </header>

  <div class="summary">
    <div class="rlv${r.rlv < 0 ? ' neg' : ''}">
      <div class="k">Residual land value</div>
      <div class="big">${rptMoney(r.rlv)}</div>
      <div class="note">At FSI ${num(ch.fsi, 2)} · about ${num(r.units)} units · ≈ ${r.storeys} storeys</div>
      <div class="tiles"><div><div class="v">${rptMoney(r.perBsf)}</div><div class="l">per buildable sf</div></div><div><div class="v">${rptMoney(r.perAcre)}</div><div class="l">per acre</div></div><div><div class="v">${rptMoney(r.perUnit)}</div><div class="l">per unit</div></div></div>
    </div>
    <div class="takeaway"><h4>Summary</h4><p>${s1}</p>${s2 ? `<p>${s2}</p>` : ''}<p>${s3}</p><div class="chips">${flagsHtml}</div></div>
  </div>

  <section class="s">
    <h2><span class="no">01</span>Site and parcels</h2>
    <div class="two">
      <figure>${siteSvg(f)}<figcaption>Parcel outlines from Property Boundaries${site.parcels.some((p) => p.heritage) ? '. Amber: heritage property' : ''}.</figcaption></figure>
      <dl class="facts one">
        ${fact('Lot area', `${num(f.area)} m²`, `${num(f.area * SQFT)} sf · ${num(f.area / ACRE_M2, 2)} ac`)}
        ${f.width ? fact('Approx. dimensions', `${num(f.width, 1)} × ${num(f.depth, 1)} m`, 'Shortest and longest side of the bounding rectangle') : ''}
        ${fact('Existing buildings', f.bCount ? `${f.bCount} · ${num(f.bFoot)} m² footprint` : 'None recorded', f.bCount ? `About ${num(f.bGfa)} m² floor area (FSI ${num(f.bGfa / f.area, 2)}), estimated from 3D Massing` : '')}
        ${fact('Condominium', f.condo ? 'Registered condominium on site' : 'No registered condominium')}
      </dl>
    </div>
    <h3>Parcel schedule</h3>
    <div class="tw"><table><thead><tr><th></th><th>Parcel</th><th>Address</th><th class="num">Area m²</th><th class="num">Existing GFA m²</th><th class="num">Max height</th><th>Zoning</th></tr></thead><tbody>
      ${site.parcels.map((p, i) => { const z = zoneOf(p); return `<tr><td class="mono">P${i + 1}</td><td class="mono">${p.id}</td><td>${esc(p.addresses.join(', ') || '—')}</td><td class="num">${num(p.areaM2)}</td><td class="num">${num(p.bldgGfaEstM2)}</td><td class="num">${p.bldgMaxHeightM > 0 ? num(p.bldgMaxHeightM, 1) + ' m' : '—'}</td><td class="mono">${z ? esc(z.string) : 'Former by-law'}</td></tr>`; }).join('')}
      ${site.parcels.length > 1 ? `<tr class="sub"><td></td><td></td><td>Assembly total</td><td class="num">${num(f.area)}</td><td class="num">${num(f.bGfa)}</td><td></td><td>Existing FSI ${num(f.bGfa / f.area, 2)}</td></tr>` : ''}
    </tbody></table></div>
  </section>

  <section class="s">
    <h2><span class="no">02</span>Planning controls</h2>
    <dl class="facts">
      ${fact('Zoning (By-law 569-2013)', f.zones.length ? f.zones.map((z) => `<code>${esc(z.string)}</code>`).join('<br>') : 'Not covered', f.zones.some((z) => z.exception) ? 'Site-specific exception applies' : '')}
      ${f.unzoned ? fact('Former by-law in effect', f.formerBylaws.map((m) => esc(FORMER_BYLAWS[m]?.name || 'A former municipal zoning by-law')).join('<br>'), 'As amended by site-specific by-laws; check the City’s zoning map') : ''}
      ${fact('Zoned density', f.zonedFsi ? `FSI ${num(f.zonedFsi, 2)}` : '—', f.zonedFsi ? `${num(f.zonedFsi * f.area)} m² as of right` : '')}
      ${fact('Height limit', f.heightM ? `${num(f.heightM, 1)} m${f.heightSt ? ` · ${f.heightSt} storeys` : ''}` : '—', f.heightM ? 'Height overlay' : '')}
      ${fact('Lot coverage', f.cov ? `${num(f.cov)}%` : '—')}
      ${fact('Secondary Plan', esc(f.sps.join(', ') || 'None'))}
      ${fact('Site and Area Specific Policy', esc(f.sasp.map((s) => 'SASP ' + +s).join(', ') || 'None'))}
      ${fact('Major Transit Station Area', esc(f.mtsa.map((m) => `${m[0]} (${m[1].includes('Protected') ? 'protected' : 'MTSA'})`).join(', ') || 'None'), f.mtsa.length ? 'Official Plan minimum densities apply. Inclusionary zoning may apply.' : '')}
      ${fact('Heritage', esc(heritageByAddr.join('; ') || 'None'), f.heritage.length ? esc([...new Set(f.heritage.map(heritageNote))].join('. ')) : '')}
      ${fact('Flood and natural features', esc(envItems.join(', ') || 'None mapped'), (f.env & 3) ? 'TRCA permit needed under Ontario Regulation 41/24' : '')}
      ${fact('Holding symbol', f.holding ? 'Yes (H)' : 'None')}
    </dl>
  </section>

  <section class="s">
    <h2><span class="no">03</span>Nearby precedents</h2>
    ${pr.n ? `<div class="two prec-grid">
      <figure>${precedentSvg(f, precList)}</figure>
      <dl class="facts one">
        ${fact('Median FSI', num(pr.median, 1), `from ${pr.n} site${pr.n === 1 ? '' : 's'} with a stated density`)}
        ${fact('75th percentile FSI', num(pr.p75, 1))}
        ${fact('Median height', pr.medStoreys ? `${pr.medStoreys} storeys` : 'Not stated')}
        ${fact('Search', fmtRadius(site.precRadius), 'Rezoning and site plan files, last 10 years')}
      </dl></div>
    <div class="tw" style="margin-top:12px"><table><thead><tr><th>#</th><th>Address</th><th class="num">Distance</th><th>Type</th><th>Status</th><th class="num">FSI</th><th class="num">Storeys</th><th class="num">Units</th></tr></thead><tbody>
      ${precList.map(({ a, d }, i) => `<tr><td><span class="idx">${i + 1}</span></td><td>${esc(a.addrs[0] || a.id)}</td><td class="num">${fmtDist(d)}</td><td>${esc(a.type)}</td><td>${esc(a.status)}</td><td class="num">${num(a.fsi, 1)}</td><td class="num">${a.storeys || '—'}</td><td class="num">${a.units ? num(a.units) : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Type: OZ = Official Plan / Rezoning, SA = Site Plan Approval. FSI is the figure stated in the file, or proposed GFA divided by parcel area.</p>`
    : `<p class="muted">No rezoning or site plan files with a stated density within ${fmtRadius(site.precRadius)}.</p>`}
  </section>

  <section class="s">
    <h2><span class="no">04</span>Density scenarios</h2>
    <p class="muted small">Same assumptions at each density.${uplift == null ? '' : r.rlv > 0 && uplift > 0 ? ` The difference between the as-of-right and selected rows is the land value a rezoning would create (<b>${rptMoney(uplift)}</b> here), which is the starting point for community benefit negotiations.` : uplift > 0 ? ` The selected density improves the result by <b>${rptMoney(uplift)}</b> over as-of-right, but the residual is still negative, so there is no land value uplift to capture yet.` : ` The selected density produces less land value than as-of-right at these assumptions.`}</p>
    <div class="tw"><table><thead><tr><th>Scenario</th><th class="num">FSI</th><th class="num">GFA m²</th><th class="num">Units</th><th class="num">Storeys</th><th class="num">RLV</th><th class="num">RLV / unit</th></tr></thead><tbody>
      ${scen.map((x) => `<tr class="${x.k === ch.key ? 'sel' : ''}"><td>${esc(LABELS[x.k])}${x.k === ch.key ? ' <span class="chip acc">Selected</span>' : ''}</td><td class="num">${num(x.fsi, 2)}</td><td class="num">${num(x.res.gfaM2)}</td><td class="num">${num(x.res.units)}</td><td class="num">≈ ${x.res.storeys}</td><td class="num strong">${rptMoney(x.res.rlv)}</td><td class="num">${rptMoney(x.res.perUnit)}</td></tr>`).join('')}
    </tbody></table></div>
  </section>

  <section class="s brk">
    <h2><span class="no">05</span>Pro forma: ${esc(LABELS[ch.key])}, FSI ${num(ch.fsi, 2)}</h2>
    <div class="two">
      <div class="tw"><table><thead><tr><th>Line</th><th class="num">Amount</th><th class="num">% of revenue</th></tr></thead><tbody>
        ${pfRows.map(([k, v, cls]) => `<tr class="${cls || ''}"><td>${esc(k)}</td><td class="num">${rptMoney(v)}</td><td class="num">${r.revenue ? rptPct(Math.abs(v) / r.revenue * 100) : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <dl class="facts one">
        ${fact('Gross floor area', `${num(r.gfaM2)} m²`, `${num(r.gfaSf)} sf`)}
        ${(() => { const ma = marketArea(f); return fact('Sale price', `$${num(ma.price)}/sf`, `${esc(ma.label)} market area${ma.ward ? ` (${esc(ma.ward)})` : ''}`); })()}
        ${fact('Units', num(r.units), `${num(PF.unitSize)} sf average, ${num(PF.efficiency)}% saleable`)}
        ${fact('Implied height', `≈ ${r.storeys} storeys`, `At a ${num(Math.min(PF.floorplate, f.area * 0.9))} m² floor plate${f.heightM && r.storeys * 3.2 > f.heightM ? ` · above the ${num(f.heightM)} m limit` : ''}`)}
        ${fact('Parking', `${num(r.stalls)} stalls`)}
        ${fact('Community benefits charge', r.cbcApplies ? 'Applies (5+ storeys, 10+ units)' : 'Does not apply')}
      </dl>
    </div>
  </section>

  <section class="s">
    <h2><span class="no">06</span>Sensitivity: residual land value</h2>
    <p class="muted small">Rows change the sale price, columns change the hard cost. The outlined cell is the base case.</p>
    <div class="tw"><table class="sens"><thead><tr><th>Price ↓ · Cost →</th>${steps.map((s) => `<th>${s > 0 ? '+' : ''}${s * 100}%</th>`).join('')}</tr></thead><tbody>
      ${grid.map((row, i) => `<tr><th>$${num(salePrice(f) * (1 + steps[i]))}/sf</th>${row.map((v, j) => `<td class="num${i === 2 && j === 2 ? ' base' : ''}" style="background:color-mix(in srgb, ${v < 0 ? 'var(--r-neg)' : 'var(--r-pos)'} ${Math.round((Math.min(1, Math.abs(v) / maxAbs) * 0.5 + 0.08) * 100)}%, transparent)">${rptMoney(v)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
  </section>

  <section class="s">
    <h2><span class="no">07</span>Assumptions</h2>
    ${(() => {
      const ma = marketArea(f), code = ma.ward ? +ma.ward.match(/\d+/)[0] : null, w = code ? wardActivity(code) : null, city = cityActivity();
      return `<h3>Sale price by market area</h3>
      <p class="small">This site is in <b>${esc(ma.ward || 'an unidentified ward')}</b>, in the <b>${esc(ma.label)}</b> market area, so the pro forma uses <b>$${num(ma.price)}/sf</b>. ${esc(PRICE_NOTE)}</p>
      <div class="tw"><table><thead><tr><th>Market area</th><th>Wards</th><th class="num">Open applications</th><th class="num">Sale price</th></tr></thead><tbody>
        ${MARKET_AREAS.map((a) => `<tr class="${a.key === ma.key ? 'sel' : ''}"><td>${esc(a.label)}${a.key === ma.key ? ' <span class="chip acc">This site</span>' : ''}</td><td>${a.wards.join(', ')}</td><td class="num">${num(areaActivity(a).open)}</td><td class="num">$${num(PF[a.key])}/sf${PF[a.key] !== DEFAULTS[a.key] ? ' <span class="chip edit">edited</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${w ? `<p class="small muted" style="margin-top:8px">Development activity in ward ${code}: ${num(w.open)} open applications proposing about ${num(w.units)} units, a median proposed height of ${w.medStoreys ? num(w.medStoreys) : '—'} storeys (city: ${city.medStoreys ? num(city.medStoreys) : '—'}), and ${num(w.rezonings)} rezoning and Official Plan amendment files since ${w.since}. Units and heights are read from application descriptions and are approximate.</p>` : ''}
      <h3 style="margin-top:16px">All assumptions</h3>`;
    })()}
    <div class="assump">${FIELDS.map(([group, fields]) => `<div class="agroup"><h4>${esc(group)}</h4><dl>${fields.map(([k, label, unit]) => `<div><dt>${esc(label)}</dt><dd>${esc(fmtAssumption(PF[k], unit))}${edited(k) ? ' <span class="chip edit">edited</span>' : ''}</dd></div>`).join('')}</dl></div>`).join('')}</div>
    <p class="small muted" style="margin-top:10px">${FIELDS.some(([, fs]) => fs.some(([k]) => edited(k))) ? 'Values marked “edited” differ from the app’s defaults.' : 'These are the app’s default figures for Toronto high-rise condo in late 2026. Replace them with current market and cost figures.'}</p>
  </section>

  <section class="s brk">
    <h2><span class="no">08</span>Method: what residual land value means</h2>
    <p>Residual land value is the most a developer could pay for this land and still earn their required profit. It is worked out backwards from what the finished project would be worth.</p>
    <div class="formula">RLV = Gross development value − (development costs + developer profit)<br><span class="muted">then ÷ (1 + land closing % + parkland % + CBC % + land carry)</span></div>
    <h3>This site, step by step</h3>
    <table class="walk"><tbody>
      <tr><td>Gross development value</td><td class="num">${rptMoney(r.revenue)}</td></tr>
      <tr><td>− Development costs</td><td class="num">${rptMoney(costs)}</td></tr>
      <tr><td>− Developer profit (${num(PF.profitPct, 1)}% of revenue)</td><td class="num">${rptMoney(r.profit)}</td></tr>
      <tr class="sub"><td>Available for land and land costs</td><td class="num">${rptMoney(r.rlv + r.landLinked)}</td></tr>
      <tr><td>− Land-linked costs</td><td class="num">${rptMoney(r.landLinked)}</td></tr>
      <tr class="total"><td>Residual land value</td><td class="num">${rptMoney(r.rlv)}</td></tr>
    </tbody></table>
    <h3>How to read it</h3>
    <ul class="uses">
      <li><b>Viability.</b> Compare the residual with the asking price or the land’s current-use value. If the residual is lower, the scheme does not work as designed.</li>
      <li><b>Highest and best use.</b> The scenario table shows which density produces the most land value.</li>
      <li><b>Policy impact.</b> Raising development charges, parkland or inclusionary zoning requirements lowers the residual. If it falls below current-use value, development stalls.</li>
      <li><b>Land value capture.</b> The uplift between as-of-right and the selected density is the value a rezoning creates.</li>
      <li><b>Leverage.</b> The residual is a small number left after subtracting two large ones, so small changes in prices or costs swing it a lot. Read it alongside the sensitivity table.</li>
    </ul>
    <div class="disclaimer">This is a screening estimate, not an appraisal. It ignores HST, phasing, inclusionary zoning and site-specific costs such as shoring, remediation and heritage conservation. Data: City of Toronto Open Data (Development Applications, Property Boundaries, Zoning By-law 569-2013, Secondary Plans, SASPs, Major Transit Station Areas, Heritage Register, Ravine Protection, Natural Heritage System, Environmentally Significant Areas, 3D Massing, Former Municipality Boundaries), Open Government Licence – Toronto; TRCA Open Data (regulated area, regulatory floodplain), TRCA Open Data Licence v1.0.</div>
    <footer class="pg"><span>${RPT_BRAND} · ${reportId}</span><span>${esc(title)}</span></footer>
  </section>`;
}

// ---------- Overlay, print ----------
function openReport() {
  if (!site.parcels.length) return;
  $('reportSheet').innerHTML = buildReport();
  $('report').hidden = false;
  document.body.classList.add('report-open');
  $('report').scrollTop = 0;
  $('reportClose').focus();
}
function closeReport() {
  $('report').hidden = true;
  document.body.classList.remove('report-open');
  $('makeReport').focus();
}
$('makeReport').addEventListener('click', openReport);
$('reportClose').addEventListener('click', closeReport);
$('reportPrint').addEventListener('click', () => window.print());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('report').hidden) closeReport(); });
