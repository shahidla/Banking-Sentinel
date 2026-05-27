const fs = require('fs');

// BCA_GUARANTOR - Guarantor assignments
// This is the key graph edge: Loan -> Guarantor (BusinessPartner)
// G-001 = Rose Courtney (30910005) covers L-001, L-002, L-003, L-004
// G-002 = Eric Miller (30910006) covers L-005, L-006
// G-003 = George Clark (30910007) covers L-009, L-010
// G-004 = Alex Baker (30910008) covers L-011, L-012

const records = [
  // G-001 Rose Courtney (30910005) - covers B-001 and B-002 loans
  { LOAN_ID: 'L-001', GUARANTOR_PARTNER: '30910005', GUARANTOR_NAME: 'Rose Courtney', COVER_AMOUNT: 1850000, CURRENCY: 'AUD', VALID_FROM: '2022-03-15', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  { LOAN_ID: 'L-002', GUARANTOR_PARTNER: '30910005', GUARANTOR_NAME: 'Rose Courtney', COVER_AMOUNT: 980000, CURRENCY: 'AUD', VALID_FROM: '2023-06-01', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  { LOAN_ID: 'L-003', GUARANTOR_PARTNER: '30910005', GUARANTOR_NAME: 'Rose Courtney', COVER_AMOUNT: 1250000, CURRENCY: 'AUD', VALID_FROM: '2021-11-20', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  // L-004 is B-003 (DTI breach) - also covered by G-001 for risk concentration
  { LOAN_ID: 'L-004', GUARANTOR_PARTNER: '30910005', GUARANTOR_NAME: 'Rose Courtney', COVER_AMOUNT: 2100000, CURRENCY: 'AUD', VALID_FROM: '2025-08-10', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  // G-002 Eric Miller (30910006) - covers B-004 and B-005
  { LOAN_ID: 'L-005', GUARANTOR_PARTNER: '30910006', GUARANTOR_NAME: 'Eric Miller', COVER_AMOUNT: 1650000, CURRENCY: 'AUD', VALID_FROM: '2023-02-28', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  { LOAN_ID: 'L-006', GUARANTOR_PARTNER: '30910006', GUARANTOR_NAME: 'Eric Miller', COVER_AMOUNT: 1850000, CURRENCY: 'AUD', VALID_FROM: '2024-01-15', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  // G-003 George Clark (30910007) - covers B-008 and B-009
  { LOAN_ID: 'L-009', GUARANTOR_PARTNER: '30910007', GUARANTOR_NAME: 'George Clark', COVER_AMOUNT: 3200000, CURRENCY: 'AUD', VALID_FROM: '2023-07-01', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  { LOAN_ID: 'L-010', GUARANTOR_PARTNER: '30910007', GUARANTOR_NAME: 'George Clark', COVER_AMOUNT: 890000, CURRENCY: 'AUD', VALID_FROM: '2023-10-12', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  // G-004 Alex Baker (30910008) - covers B-010 and B-011
  { LOAN_ID: 'L-011', GUARANTOR_PARTNER: '30910008', GUARANTOR_NAME: 'Alex Baker', COVER_AMOUNT: 28000, CURRENCY: 'AUD', VALID_FROM: '2024-06-15', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
  { LOAN_ID: 'L-012', GUARANTOR_PARTNER: '30910008', GUARANTOR_NAME: 'Alex Baker', COVER_AMOUNT: 1680000, CURRENCY: 'AUD', VALID_FROM: '2021-05-20', VALID_TO: '9999-12-31', STATUS: 'ACTIVE' },
];

// Compute G-001 total exposure
const g001 = records.filter(r => r.GUARANTOR_PARTNER === '30910005').reduce((s, r) => s + r.COVER_AMOUNT, 0);
const g002 = records.filter(r => r.GUARANTOR_PARTNER === '30910006').reduce((s, r) => s + r.COVER_AMOUNT, 0);
console.log('G-001 (Rose Courtney) total exposure: AUD', g001.toLocaleString(), '- APS 221 limit: 5,000,000');
console.log('G-002 (Eric Miller) total exposure:   AUD', g002.toLocaleString());
console.log('Combined group exposure (G-001+G-002): AUD', (g001 + g002).toLocaleString(), '- limit: 7,500,000 - BREACH:', (g001 + g002) > 7500000);

fs.writeFileSync('C:/Dev/Banking-Sentinel/Data/processed/BCA_GUARANTOR.json', JSON.stringify({ table: 'BCA_GUARANTOR', records }, null, 2));
console.log('BCA_GUARANTOR written:', records.length, 'records');
