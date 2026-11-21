#!/usr/bin/env bash
# Build the static site into _site/ from fresh City of Toronto Open Data.
# Needs Python 3.10+ with shapely, pyshp and numpy, and Node 18+.
set -euo pipefail
RAW="${RAW:-data/raw}"
OUT="${OUT:-_site}"
mkdir -p data
if [ "${SKIP_FETCH:-0}" != "1" ]; then python3 scripts/fetch_data.py "$RAW"; fi
node scripts/export_apps.js data/apps.json
rm -rf "$OUT" && cp -r site "$OUT"
python3 scripts/build_snapshot.py data/apps.json "$RAW/centreline.geojson" "$RAW/wards.geojson" "$OUT"
python3 scripts/build_precedents.py "$OUT/applications.json" "$RAW/parcels.geojson"
python3 scripts/build_parcels.py "$RAW" "$OUT"
python3 scripts/build_layers.py "$RAW" "$OUT"
python3 scripts/build_opportunities.py "$OUT"
touch "$OUT/.nojekyll"
echo "Built $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
