// One-off: create the DFKKOPK table directly via the runtime DB connection
// (cds deploy --to hana is unavailable here — cf CLI not logged in).
// Purely additive DDL — creates one new table, touches nothing else.
'use strict';
const cds = require('@sap/cds');

(async () => {
  await cds.connect.to('db');
  try {
    await cds.run(`CREATE COLUMN TABLE bankingsentinel_DFKKOPK (
      OPBEL NVARCHAR(20) NOT NULL,
      VKONT NVARCHAR(20),
      GPART NVARCHAR(10),
      LOAN_ID NVARCHAR(15),
      BETRW DECIMAL(15,2),
      FAEDN DATE,
      AUGDT DATE,
      AUGBL NVARCHAR(20),
      CURRENCY NVARCHAR(3),
      PRIMARY KEY(OPBEL)
    )`);
    console.log('OK — table bankingsentinel_DFKKOPK created');
  } catch (e) {
    console.error('CREATE TABLE FAILED:', e.message);
    process.exit(1);
  }

  try {
    const rows = await cds.run(SELECT.from('bankingsentinel.DFKKOPK').limit(1));
    console.log('CDS entity lookup OK — rows returned:', rows.length);
  } catch (e) {
    console.error('CDS ENTITY LOOKUP FAILED:', e.message);
    process.exit(1);
  }

  process.exit(0);
})();
