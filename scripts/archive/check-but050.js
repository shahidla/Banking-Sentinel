require('dotenv').config();
const cds = require('@sap/cds');
(async () => {
  await cds.connect.to('db');
  const rows = await cds.run(SELECT.from('bankingsentinel.BUT050'));
  console.log(`BUT050 rows: ${rows.length}`);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})();
