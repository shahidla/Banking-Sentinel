'use strict';
const cds = require('@sap/cds');

async function main() {
  await cds.connect.to('db');

  const customerId = '30100001';

  // 1. BCA_DTI
  const dti = await cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: customerId }));
  console.log('\n=== BCA_DTI ===');
  console.log(JSON.stringify(dti, null, 2));

  // 2. BusinessPartners for customer + connected parties
  const bps = await cds.run(SELECT.from('bankingsentinel.BusinessPartners').where({ PARTNER: { in: [customerId, '30910005', '30910006'] } }));
  console.log('\n=== BusinessPartners (30100001 + connected) ===');
  console.log(JSON.stringify(bps, null, 2));

  // 3. BUT050 - all relationships involving 30100001
  const but050 = await cds.run(`SELECT * FROM bankingsentinel_BUT050 WHERE PARTNER1 = '${customerId}' OR PARTNER2 = '${customerId}'`);
  console.log('\n=== BUT050 (relationships) ===');
  console.log(JSON.stringify(but050, null, 2));

  // 4. Loans for 30100001 and connected parties
  const loans = await cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: { in: [customerId, '30910005', '30910006'] } }));
  console.log('\n=== Loans (30100001 + connected) ===');
  console.log(JSON.stringify(loans, null, 2));

  // 5. DFKKOP - ALL payment records for 30100001
  const payments = await cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: customerId }));
  console.log('\n=== DFKKOP (all payments for 30100001) ===');
  console.log(JSON.stringify(payments, null, 2));

  // 6. Portfolio DFKKOP (all customers) for Isolation Forest context
  const portfolio = await cds.run(SELECT.from('bankingsentinel.DFKKOP').columns('GPART','DAYS_OVERDUE','BETRW').limit(500));
  console.log('\n=== DFKKOP PORTFOLIO (all customers, for anomaly context) ===');
  console.log(JSON.stringify(portfolio, null, 2));

  // 7. LoanSchedule for 30100001's loans
  const loanIds = loans.filter(l => l.PARTNER === customerId).map(l => l.LOAN_ID);
  if (loanIds.length > 0) {
    const schedule = await cds.run(SELECT.from('bankingsentinel.LoanSchedule').where({ LOAN_ID: { in: loanIds } }));
    console.log('\n=== LoanSchedule (30100001 loans) ===');
    console.log(JSON.stringify(schedule, null, 2));
  }

  // 8. BCA_GUARANTOR for all loans in group
  const allLoanIds = loans.map(l => l.LOAN_ID);
  if (allLoanIds.length > 0) {
    const guarantors = await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ LOAN_ID: { in: allLoanIds } }));
    console.log('\n=== BCA_GUARANTOR ===');
    console.log(JSON.stringify(guarantors, null, 2));
  }

  // 9. BCA_COLLATERAL for 30100001 loans
  if (loanIds.length > 0) {
    const collateral = await cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL').where({ LOAN_ID: { in: loanIds } }));
    console.log('\n=== BCA_COLLATERAL ===');
    console.log(JSON.stringify(collateral, null, 2));
  }

  // 10. RegulatoryThresholds
  const thresholds = await cds.run(SELECT.from('bankingsentinel.RegulatoryThresholds'));
  console.log('\n=== RegulatoryThresholds ===');
  console.log(JSON.stringify(thresholds, null, 2));

  // 11. ExposureLimits
  const limits = await cds.run(SELECT.from('bankingsentinel.ExposureLimits'));
  console.log('\n=== ExposureLimits ===');
  console.log(JSON.stringify(limits, null, 2));

  // 12. RiskAssessments for this customer
  const assessments = await cds.run(SELECT.from('bankingsentinel.RiskAssessments').where({ PARTNER: customerId }).orderBy('CREATED_AT desc').limit(3));
  console.log('\n=== RiskAssessments (last 3 runs) ===');
  console.log(JSON.stringify(assessments, null, 2));

  // 13. AuditLog for latest session
  const audit = await cds.run(SELECT.from('bankingsentinel.AuditLog').orderBy('CREATED_AT desc').limit(5));
  console.log('\n=== AuditLog (last 5 entries) ===');
  console.log(JSON.stringify(audit, null, 2));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
