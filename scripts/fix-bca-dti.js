// One-off: fix two BCA_DTI data-integrity bugs found during the demo-data audit.
// 30100003: ANNUAL_INCOME corrected so DTI_RATIO=7.2 is internally consistent
//           (TOTAL_DEBT/ANNUAL_INCOME), and BREACH_FLAG/BREACH_DATE set to match
//           the documented story ("Business loan, DTI 7.2 (APRA breach)").
// 30100012: DTI_RATIO corrected from 1.90 to 0.19 (10x decimal typo) to match
//           TOTAL_DEBT/ANNUAL_INCOME — story ("Personal loan, performing") unaffected.
'use strict';
const cds = require('@sap/cds');

(async () => {
  await cds.connect.to('db');
  const E = 'bankingsentinel.BCA_DTI';

  await UPDATE(E).set({
    ANNUAL_INCOME: 291666.67,
    BREACH_FLAG: true,
    BREACH_DATE: '2025-08-10'
  }).where({ PARTNER: '30100003' });

  await UPDATE(E).set({
    DTI_RATIO: 0.19
  }).where({ PARTNER: '30100012' });

  const rows = await cds.run(SELECT.from(E).where({ PARTNER: { in: ['30100003','30100012'] } }));
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
