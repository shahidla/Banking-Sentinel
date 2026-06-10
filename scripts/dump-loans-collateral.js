'use strict';
const cds = require('@sap/cds');
const DEMO_IDS = ['30100001','30100002','30100003','30100004','30100005','30100006','30100008','30100009','30100010','30100012','30100013'];
(async () => {
  await cds.connect.to('db');
  const loans = await cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: { in: DEMO_IDS } }).orderBy('LOAN_ID'));
  const collat = await cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL').orderBy('LOAN_ID'));
  const guar = await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').orderBy('LOAN_ID'));
  console.log('=== Loans ===');
  loans.forEach(r => console.log(JSON.stringify(r)));
  console.log('\n=== BCA_COLLATERAL ===');
  collat.forEach(r => console.log(JSON.stringify(r)));
  console.log('\n=== BCA_GUARANTOR ===');
  guar.forEach(r => console.log(JSON.stringify(r)));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
