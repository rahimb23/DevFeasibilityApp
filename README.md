# Toronto Development Radar

A map of City of Toronto development applications with a site feasibility tool.

- **Area radar:** pick a point and a radius to see every development application nearby. It shows totals for units, height, status and year, upcoming community meetings, and links to each City file.
- **Site feasibility:** click a property parcel, or assemble several, to see:
  - lot size and existing buildings
  - zoning (By-law 569-2013), height and coverage limits
  - Secondary Plan, Site and Area Specific Policies, Major Transit Station Area, heritage and ravine flags
  - density on nearby approved and proposed projects
  - a residual land value pro forma, with assumptions you can edit and a price/cost sensitivity grid

All data comes from [City of Toronto Open Data](https://open.toronto.ca/) (Open Government Licence – Toronto).

## How it's hosted

The site is static and served by GitHub Pages. The workflow `.github/workflows/deploy.yml` rebuilds it from fresh City data every night (09:17 UTC), on every push to `main`, and on demand (Actions → *Build and deploy site* → *Run workflow*).

One-time setup: in the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.

## Repository layout

| Path | What it is |
|---|---|
| `site/` | The page: `index.html`, `feasibility.js` (parcel panel and RLV model), `streets.js` (street basemap and address search) |
| `build.sh` | Downloads the data and builds the complete site into `_site/` |
| `scripts/fetch_data.py` | Downloads the City datasets (looked up by name through the CKAN API) |
| `scripts/export_apps.js` | Pulls the development applications feed and groups it into one record per application |
| `scripts/build_snapshot.py` | Writes `applications.json`, `streets.json` (basemap and geocoder) and `wards.json` |
| `scripts/build_precedents.py` | Adds GFA, site area and FSI to each application |
| `scripts/build_parcels.py` | Joins every parcel to zoning, overlays, policies, heritage, ravines, 3D massing and addresses, then writes map tiles |
| `server.js`, `public/` | Optional live Node server (radar only) that proxies the City feed |

## Build locally

```bash
pip install -r requirements.txt
./build.sh                      # about 5–10 minutes; downloads about 750 MB
python3 -m http.server -d _site 8000
```

Set `SKIP_FETCH=1` to rebuild from data already in `data/raw/`.

## Notes and limits

- Residual land value is a screening estimate: (revenue − hard costs − contingency − soft costs − development charges − demolition − sales − financing − profit) ÷ (1 + land closing % + parkland % + CBC % + land carry). The default assumptions are placeholders, so replace them with current market and cost figures.
- Units, storeys, GFA and FSI for applications are read from free-text descriptions, so treat them as estimates.
- About 5% of parcels are outside Zoning By-law 569-2013, where a former municipal by-law applies. The panel flags these.
- Address search works offline from the City's street centreline: addresses, intersections ("King & Spadina") and wards.
