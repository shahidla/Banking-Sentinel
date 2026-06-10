// One-off: create the BCA_CREDIT_HISTORY table directly via the runtime DB
// connection (cds deploy --to hana is unavailable here — cf CLI not logged in).
// Purely additive DDL — creates one new table, touches nothing else.
'use strict';
const cds = require('@sap/cds');

(async () => {
  await cds.connect.to('db');
  try {
    await cds.run(`CREATE COLUMN TABLE bankingsentinel_BCA_CREDIT_HISTORY (
      CASE_ID NVARCHAR(10) NOT NULL,
      DTI_RATIO DECIMAL(5,2),
      TOTAL_DEBT DECIMAL(15,2),
      ANNUAL_INCOME DECIMAL(15,2),
      BREACH_FLAG BOOLEAN,
      ARREARS_OUTCOME NVARCHAR(10),
      PRIMARY KEY(CASE_ID)
    )`);
    console.log('OK — table bankingsentinel_BCA_CREDIT_HISTORY created');
  } catch (e) {
    console.error('CREATE TABLE FAILED:', e.message);
    process.exit(1);
  }

  try {
    const rows = await cds.run(SELECT.from('bankingsentinel.BCA_CREDIT_HISTORY').limit(1));
    console.log('CDS entity lookup OK — rows returned:', rows.length);
  } catch (e) {
    console.error('CDS ENTITY LOOKUP FAILED:', e.message);
    process.exit(1);
  }

  process.exit(0);
})();
