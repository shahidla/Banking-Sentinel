require('dotenv').config();
const cds = require('@sap/cds');
(async () => {
  await cds.connect.to('db');
  const partner = await cds.run(SELECT.from('bankingsentinel.BusinessPartners').where({ PARTNER: '30100003' }));
  console.log('30100003:', JSON.stringify(partner));
  const loans = await cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: '30100003' }).columns('LOAN_ID','AMOUNT','STATUS'));
  console.log('Loans:', JSON.stringify(loans));
  const guarantors = await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ LOAN_ID: { in: loans.map(l=>l.LOAN_ID) } }));
  console.log('Guarantors:', JSON.stringify(guarantors));
  const but050 = await cds.run(SELECT.from('bankingsentinel.BUT050'));
  console.log('ALL BUT050:', JSON.stringify(but050));
  process.exit(0);
})();
