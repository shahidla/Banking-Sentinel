const fs = require('fs');

// BCA_LOAN_COND - Loan conditions (interest rate conditions per loan)
const loans = JSON.parse(fs.readFileSync('C:/Dev/Banking-Sentinel/Data/processed/BCA_LOAN_HDR.json')).records;

const records = loans
  .filter(l => !l.LOAN_ID.startsWith('TD-'))
  .map(l => ({
    LOAN_ID: l.LOAN_ID,
    COND_TYPE: l.LOAN_TYPE === 'PERSONAL' ? 'FIXED' : 'VARIABLE',
    RATE: l.INTEREST_RATE,
    MARGIN: l.LOAN_TYPE === 'PERSONAL' ? null : 2.74,
    BASE_RATE_INDEX: l.LOAN_TYPE === 'PERSONAL' ? null : 'RBA_CASH_RATE',
    VALID_FROM: l.START_DATE,
    VALID_TO: '9999-12-31',
    CURRENCY: 'AUD',
    REVIEW_DATE: l.LOAN_TYPE !== 'PERSONAL' ? '2026-10-01' : null
  }));

fs.writeFileSync('C:/Dev/Banking-Sentinel/Data/processed/BCA_LOAN_COND.json', JSON.stringify({ table: 'BCA_LOAN_COND', records }, null, 2));
console.log('BCA_LOAN_COND written:', records.length, 'records');
