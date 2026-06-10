'use strict';
const cds = require('@sap/cds');
(async () => {
  await cds.connect.to('db');
  const sched = await cds.run(SELECT.from('bankingsentinel.LoanSchedule').orderBy('LOAN_ID','DUE_DATE'));
  const dfkkop = await cds.run(SELECT.from('bankingsentinel.DFKKOP').orderBy('LOAN_ID','FAEDN'));
  console.log('=== LoanSchedule ===');
  sched.forEach(r => console.log(JSON.stringify(r)));
  console.log('\n=== DFKKOP ===');
  dfkkop.forEach(r => console.log(JSON.stringify(r)));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
