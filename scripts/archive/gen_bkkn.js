const fs = require('fs');

// BKKN - Contract Account to Business Partner link
// Every loan's VKONT maps back to the borrower GPART

const loans = JSON.parse(fs.readFileSync('C:/Dev/Banking-Sentinel/Data/processed/BCA_LOAN_HDR.json')).records;

const records = loans.map(l => ({
  VKONT: l.VKONT,
  GPART: l.PARTNER,
  BUKRS: 'AU10',
  GSBER: 'RETAIL_BANKING',
  VALID_FROM: l.START_DATE,
  VALID_TO: '9999-12-31'
}));

fs.writeFileSync('C:/Dev/Banking-Sentinel/Data/processed/BKKN.json', JSON.stringify({ table: 'BKKN', records }, null, 2));
console.log('BKKN written:', records.length, 'records');
