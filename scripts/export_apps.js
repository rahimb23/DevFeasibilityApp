// Fetch the City's development applications feed and write it in the same shape as the
// live server's /api/applications endpoint. Usage: node scripts/export_apps.js <out.json>
'use strict';
const fs = require('fs');
const { loadFeed } = require('../server.js');

loadFeed()
  .then(({ meta, apps }) => {
    fs.writeFileSync(process.argv[2] || 'data/apps.json', JSON.stringify({ meta, apps }));
    console.log(`wrote ${apps.length} applications`);
  })
  .catch((e) => { console.error(e); process.exit(1); });
