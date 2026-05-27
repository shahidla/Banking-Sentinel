'use strict';
const cds = require('@sap/cds');

cds.connect.to('db').then(async () => {
  const tables = [
    'BusinessPartners','BPRoles','BUT050','BKKN','Loans','LoanConditions',
    'LoanSchedule','BCA_GUARANTOR','DFKKOP','DFKKZP',
    'BCA_SECTOR','BCA_DTI','BCA_RISK_CLASS','RegulatoryThresholds',
    'ExposureLimits','SectorExposureLimits'
  ];
  console.log('\nTable                    Records');
  console.log('─'.repeat(33));
  for (const t of tables) {
    try {
      const r = await cds.run(SELECT.from('bankingsentinel.' + t));
      console.log(t.padEnd(24), r.length);
    } catch(e) {
      console.log(t.padEnd(24), 'ERROR:', e.message.substring(0,40));
    }
  }
  console.log();
  process.exit(0);
});
