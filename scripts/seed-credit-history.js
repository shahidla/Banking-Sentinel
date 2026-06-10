// One-off: populate BCA_CREDIT_HISTORY from Data/processed/BCA_CREDIT_HISTORY.json.
// Standalone (does not touch the other 12 seeded tables) — see scripts/seed.js
// for the full reseed pipeline, which has also been updated for future use.
'use strict';
const cds  = require('@sap/cds');
const fs   = require('fs');
const path = require('path');

(async () => {
  await cds.connect.to('db');

  const file = path.join(__dirname, '..', 'Data', 'processed', 'BCA_CREDIT_HISTORY.json');
  const { records } = JSON.parse(fs.readFileSync(file));

  const E = 'bankingsentinel.BCA_CREDIT_HISTORY';
  await DELETE.from(E);
  await INSERT.into(E).entries(records);

  const count = await cds.run(SELECT.one.from(E).columns('count(*) as n'));
  console.log(`OK — BCA_CREDIT_HISTORY seeded: ${count.n} rows`);
  process.exit(0);
})().catch(e => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
