// Development opportunities: ranked list, map layer and score breakdown.
// Uses opportunities.json and the `opp` column in parcel tiles (scripts/build_opportunities.py).
// Loaded after feasibility.js and layers.js; uses their globals.
'use strict';

const OPP = { data: null, layer: L.layerGroup(), on: false, minScore: 70, minArea: 0, inView: true, pipe: false };
const OPP_PARTS = [['zoning', 'Zoning', 25], ['transit', 'Transit station area', 20], ['densityGap', 'Room to add density', 25], ['lotSize', 'Lot size', 15], ['momentum', 'Recent activity nearby', 10], ['secondaryPlan', 'Secondary Plan', 5]];
const OPP_EXCLUDED = {
  condo: 'Registered condominium', designated: 'Designated heritage property', floodplain: 'In the regulatory floodplain',
  zone: 'Zone not meant for intensification (park, utility, employment or institutional)', small: 'Lot under 300 m²',
  nogap: 'Little room to add floor area at the likely density', inplay: 'Already has a rezoning, site plan, condo or subdivision file from the last 6 years',
};
try { const s = JSON.parse(localStorage.getItem('tdr-opp') || 'null'); if (s) Object.assign(OPP, { on: !!s.on, minScore: s.minScore ?? 70, minArea: s.minArea ?? 0, inView: s.inView ?? true, pipe: !!s.pipe }); } catch { /* defaults */ }
const saveOpp = () => { try { localStorage.setItem('tdr-opp', JSON.stringify({ on: OPP.on, minScore: OPP.minScore, minArea: OPP.minArea, inView: OPP.inView, pipe: OPP.pipe })); } catch { /* ignore */ } };

const TYPE_SHORT = { OZ: 'Rezoning', SA: 'Site plan', CD: 'Condo', SB: 'Subdivision', PL: 'Part lot' };
const appLine = (ap) => `${TYPE_SHORT[ap[1]] || ap[1]} · ${ap[2]} · ${(ap[3] || '').slice(0, 4)}`;
// Flag for sites with development applications on them
function appFlag(o) {
  if (!o.n) return '';
  if (o.p) return `<div class="opp-flag pipe">In the pipeline: ${esc(appLine(o.ap[0]))}${o.n > 1 ? ` · ${o.n} files on site` : ''}</div>`;
  return `<div class="opp-flag">${o.n} application${o.n > 1 ? 's' : ''} on site · latest ${esc(appLine(o.ap[0]))}</div>`;
}
const oppColor = (s) => s >= 90 ? css('--opp-5') : s >= 80 ? css('--opp-4') : s >= 70 ? css('--opp-3') : s >= 60 ? css('--opp-2') : css('--opp-1');

function loadOpportunities() {
  if (OPP.data) return Promise.resolve(OPP.data);
  return fetch('opportunities.json').then((r) => r.json()).then((j) => { OPP.data = j; return j; });
}

function filteredOpps() {
  if (!OPP.data) return [];
  const b = map.getBounds();
  return OPP.data.top.filter((o) => (OPP.pipe || !o.p) && o.s >= OPP.minScore && o.area >= OPP.minArea && (!OPP.inView || b.contains([o.lat, o.lon])));
}

function drawOppLayer() {
  OPP.layer.clearLayers();
  if (!OPP.on || !OPP.data) return;
  for (const o of OPP.data.top) {
    if ((o.p && !OPP.pipe) || o.s < OPP.minScore || o.area < OPP.minArea) continue;
    const r = Math.max(4, Math.min(11, 3 + Math.sqrt(o.g) / 40));
    // ring colour flags applications on the site; dashed and faded when already in the pipeline
    const style = o.p ? { color: css('--opp-flag'), weight: 2, dashArray: '3 2', fillOpacity: 0.35 }
      : o.n ? { color: css('--opp-flag'), weight: 2.4, fillOpacity: 0.9 } : { color: css('--opp-stroke'), weight: 1, fillOpacity: 0.9 };
    L.circleMarker([o.lat, o.lon], { renderer, radius: r, fillColor: oppColor(o.s), ...style })
      .bindTooltip(`<b>${o.s}</b> · ${esc(o.a || 'Parcel ' + o.id)}${o.n ? `<br>${o.p ? 'In the pipeline' : `${o.n} application${o.n > 1 ? 's' : ''} on site`}: ${esc(appLine(o.ap[0]))}` : ''}`, { direction: 'top' })
      .on('click', () => openOpportunity(o)).addTo(OPP.layer);
  }
}

function renderOppList() {
  if (!OPP.data) { $('oppList').innerHTML = '<div class="loading">Loading opportunities…</div>'; return; }
  const list = filteredOpps();
  const withApps = list.filter((o) => o.n).length;
  $('oppCount').textContent = `${fmt.format(list.length)} site${list.length === 1 ? '' : 's'} ${OPP.inView ? 'in this map view' : 'citywide'} scoring ${OPP.minScore}+` +
    (withApps ? ` · ${fmt.format(withApps)} with applications on site (flagged)` : '');
  $('oppList').innerHTML = list.length ? list.slice(0, 60).map((o) => `
    <div class="opp" data-id="${o.id}">
      <span class="opp-score" style="background:${oppColor(o.s)}">${o.s}</span>
      <div class="opp-body">
        <div class="addr">${esc(o.a || 'Parcel ' + o.id)}</div>
        <div class="opp-meta">${num(o.area)} m² lot · +${num(o.g)} m² potential · FSI ${num(o.t, 1)}${o.m ? ` · ${esc(o.m)} station` : ''}</div>
        <div class="opp-meta"><code>${esc(o.z || 'Former by-law')}</code></div>
        ${appFlag(o)}
      </div>
    </div>`).join('') + (list.length > 60 ? `<div class="hint">Showing the top 60. Zoom in or raise the minimum score to narrow the list.</div>` : '')
    : '<div class="empty">No sites match here. Zoom out, turn off “Only this map view”, or lower the minimum score.</div>';
}

async function openOpportunity(o) {
  site.assemble = false; $('assemble').checked = false;
  await selectAt(o.lat, o.lon, false);   // select first, so the Site tab does not pick its own parcel
  setMode('site');
  map.flyTo([o.lat, o.lon], 17, { duration: 0.6 });
}

// Breakdown for the site panel
function oppHtml() {
  const P = site.parcels; if (!P.length || !PARCELS.index.oppParts) return '';
  const rows = P.map((p) => {
    const o = p.opp;
    if (o == null) return '';
    const name = P.length > 1 ? `<b>${esc(p.addresses[0] || 'Parcel ' + p.id)}</b>: ` : '';
    if (typeof o === 'number') return `<div class="opp-why">${name}Not scored. ${esc(OPP_EXCLUDED[PARCELS.index.oppExcluded[String(-o)]] || '')}</div>`;
    const [score, ...parts] = o;
    const pipeNote = o[12] ? '<div class="opp-flag pipe" style="margin-bottom:6px">Already in the pipeline: a rezoning, site plan, condo or subdivision file from the last 6 years is on this site. The score is shown for reference.</div>' : '';
    const bars = OPP_PARTS.map(([, label, max], i) => `<div class="opp-part"><span>${label}</span><span class="opp-track"><span style="width:${parts[i] / max * 100}%"></span></span><span class="n">${parts[i]}/${max}</span></div>`).join('');
    return `${pipeNote}<div class="opp-head">${name}<span class="opp-score" style="background:${oppColor(score)}">${score}</span><span>of 100${parts[6] ? ` · −${parts[6]} for constraints` : ''}</span></div>
      <div class="opp-bars">${bars}</div>
      <div class="hint">Likely density FSI ${num(o[8], 1)} (nearby approvals or zoning) · about ${num(o[9])} m² more floor area than today · ${o[10]} recent files nearby.</div>`;
  });
  // development applications located on the selected parcels
  const onSite = APPS.filter((a) => a.pts.some((q) => P.some((sp) => q[0] >= sp.bb[1] && q[0] <= sp.bb[3] && q[1] >= sp.bb[0] && q[1] <= sp.bb[2] && inRing(q[0], q[1], sp.pts))))
    .sort((x, y) => (y.submitted || '').localeCompare(x.submitted || ''));
  const apps = onSite.length ? `<h3 class="opp-sub">Applications on this site (${onSite.length})</h3>` + onSite.map((a) => `
    <div class="opp-app"><span class="badge"><span class="dot" style="background:${typeColor(a.type)}"></span>${esc(TYPE_LABEL[a.type] || a.type)}</span>
      <span class="pill ${CLOSED.has(a.status) ? '' : 'open'}">${esc(a.status)}</span> <span class="fn-inline">${esc(fmtDate(a.submitted))}</span>
      <div class="opp-why">${esc((a.desc || '').slice(0, 160))}${(a.desc || '').length > 160 ? '…' : ''}${a.url ? ` <a href="${esc(a.url)}" target="_blank" rel="noopener">City file ↗</a>` : ''}</div></div>`).join('')
    : '<div class="opp-why">No development applications on this site.</div>';
  return rows.join('') + apps;
}

// ---------- Wiring ----------
const _renderSite = renderSite;
renderSite = function () { _renderSite(); const el = $('siteOpp'); if (el) { const h = oppHtml(); el.innerHTML = h; el.closest('section').hidden = !h; } };

$('oppMin').value = OPP.minScore; $('oppMinVal').textContent = OPP.minScore;
$('oppArea').value = OPP.minArea; $('oppInView').checked = OPP.inView;
$('oppMin').addEventListener('input', (e) => { OPP.minScore = +e.target.value; $('oppMinVal').textContent = OPP.minScore; saveOpp(); renderOppList(); drawOppLayer(); });
$('oppArea').addEventListener('change', (e) => { OPP.minArea = +e.target.value; saveOpp(); renderOppList(); drawOppLayer(); });
$('oppInView').addEventListener('change', (e) => { OPP.inView = e.target.checked; saveOpp(); renderOppList(); });
$('oppPipe').checked = OPP.pipe;
$('oppPipe').addEventListener('change', (e) => { OPP.pipe = e.target.checked; saveOpp(); renderOppList(); drawOppLayer(); });
$('oppList').addEventListener('click', (e) => { const el = e.target.closest('.opp'); if (!el) return; const o = OPP.data.top.find((x) => String(x.id) === el.dataset.id); if (o) openOpportunity(o); });
map.on('moveend', () => { if (!$('oppPane').hidden) renderOppList(); });

function setOppLayer(on) {
  OPP.on = on; saveOpp();
  const cb = document.getElementById('ov-opp'); if (cb) cb.checked = on;
  if (on) { OPP.layer.addTo(map); loadOpportunities().then(drawOppLayer); } else OPP.layer.remove();
}
// add a row to the Map layers panel
(function addLayerRow() {
  const body = document.querySelector('.layers-body'); if (!body) return;
  body.insertAdjacentHTML('afterbegin', `<label class="layer-row"><input type="checkbox" id="ov-opp" ${OPP.on ? 'checked' : ''}>
    <span class="sw sw-opp"></span><span><b>Development opportunities</b><small>Opportunity score 50–100</small></span></label>`);
  document.getElementById('ov-opp').addEventListener('change', (e) => setOppLayer(e.target.checked));
})();
if (OPP.on) setOppLayer(true);

// third tab
const _setMode = setMode;
setMode = function (m) {
  const opp = m === 'opp';
  if (!opp) { $('oppPane').hidden = true; _setMode(m); for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', b.dataset.tab === m); return; }
  siteMode = false;
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', b.dataset.tab === 'opp');
  $('radarPane').hidden = true; $('sitePane').hidden = true; $('oppPane').hidden = false;
  circle.remove(); pin.remove();
  if (!OPP.on) setOppLayer(true);
  if (map.getZoom() > 14) map.setZoom(13);
  loadOpportunities().then(renderOppList);
  try { localStorage.setItem('tdr-tab', m); } catch { /* ignore */ }
};

// reopen the Opportunities tab if it was the last one used
(function restoreTab() {
  let tab = null; try { tab = localStorage.getItem('tdr-tab'); } catch { /* ignore */ }
  if (tab !== 'opp') return;
  const t = setInterval(() => { if (APPS.length && PARCELS.index) { clearInterval(t); setMode('opp'); } }, 300);
})();
