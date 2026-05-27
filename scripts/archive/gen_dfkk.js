const fs = require('fs');

// DFKKOP - Open Items (Receivables)
// Records with FAEDN (due date) in the past and no matching DFKKZP = OVERDUE
// Today = 2026-05-21
// Risk loans: L-001 (overdue 45d), L-003 (overdue 30d), L-005 (overdue 15d)

const dfkkop = [
  // L-001: B-001 (30100001) - overdue 45 days - 2 missed payments
  { OPBEL: 'OP-L001-001', VKONT: 'CA-30100001-01', GPART: '30100001', LOAN_ID: 'L-001', BETRW: 8950, FAEDN: '2026-03-01', BUDAT: null, STATUS: 'OPEN', DAYS_OVERDUE: 81, CURRENCY: 'AUD' },
  { OPBEL: 'OP-L001-002', VKONT: 'CA-30100001-01', GPART: '30100001', LOAN_ID: 'L-001', BETRW: 8950, FAEDN: '2026-04-01', BUDAT: null, STATUS: 'OPEN', DAYS_OVERDUE: 50, CURRENCY: 'AUD' },
  // L-002: B-001 second loan - overdue 45 days - 1 missed payment
  { OPBEL: 'OP-L002-001', VKONT: 'CA-30100001-02', GPART: '30100001', LOAN_ID: 'L-002', BETRW: 6580, FAEDN: '2026-04-01', BUDAT: null, STATUS: 'OPEN', DAYS_OVERDUE: 50, CURRENCY: 'AUD' },
  // L-003: B-002 (30100002) - overdue 30 days - 1 missed payment
  { OPBEL: 'OP-L003-001', VKONT: 'CA-30100002-01', GPART: '30100002', LOAN_ID: 'L-003', BETRW: 7420, FAEDN: '2026-04-21', BUDAT: null, STATUS: 'OPEN', DAYS_OVERDUE: 30, CURRENCY: 'AUD' },
  // L-005: B-004 (30100004) - overdue 15 days
  { OPBEL: 'OP-L005-001', VKONT: 'CA-30100004-01', GPART: '30100004', LOAN_ID: 'L-005', BETRW: 9840, FAEDN: '2026-05-06', BUDAT: null, STATUS: 'OPEN', DAYS_OVERDUE: 15, CURRENCY: 'AUD' },
  // Performing loans - closed/paid items (for context, these have BUDAT set)
  { OPBEL: 'OP-L006-001', VKONT: 'CA-30100005-01', GPART: '30100005', LOAN_ID: 'L-006', BETRW: 36200, FAEDN: '2026-04-15', BUDAT: '2026-04-14', STATUS: 'CLEARED', DAYS_OVERDUE: 0, CURRENCY: 'AUD' },
  { OPBEL: 'OP-L008-001', VKONT: 'CA-30100008-01', GPART: '30100008', LOAN_ID: 'L-008', BETRW: 13950, FAEDN: '2026-04-05', BUDAT: '2026-04-04', STATUS: 'CLEARED', DAYS_OVERDUE: 0, CURRENCY: 'AUD' },
  { OPBEL: 'OP-L009-001', VKONT: 'CA-30100009-01', GPART: '30100009', LOAN_ID: 'L-009', BETRW: 62400, FAEDN: '2026-04-01', BUDAT: '2026-03-31', STATUS: 'CLEARED', DAYS_OVERDUE: 0, CURRENCY: 'AUD' },
  { OPBEL: 'OP-L012-001', VKONT: 'CA-30100013-01', GPART: '30100013', LOAN_ID: 'L-012', BETRW: 9680, FAEDN: '2026-04-20', BUDAT: '2026-04-19', STATUS: 'CLEARED', DAYS_OVERDUE: 0, CURRENCY: 'AUD' },
];

const overdue = dfkkop.filter(r => r.STATUS === 'OPEN');
const totalOverdue = overdue.reduce((s, r) => s + r.BETRW, 0);
console.log('Overdue open items:', overdue.length);
console.log('Total overdue amount: AUD', totalOverdue.toLocaleString());
overdue.forEach(r => console.log(' ', r.OPBEL, 'GPART:', r.GPART, 'Due:', r.FAEDN, 'Overdue days:', r.DAYS_OVERDUE));

fs.writeFileSync('C:/Dev/Banking-Sentinel/Data/processed/DFKKOP.json', JSON.stringify({ table: 'DFKKOP', records: dfkkop }, null, 2));
console.log('DFKKOP written:', dfkkop.length, 'records');

// DFKKZP - Payment items (successful payments for performing loans)
const dfkkzp = [
  // B-001 historical payments (before going overdue)
  { ZPBEL: 'ZP-L001-001', VKONT: 'CA-30100001-01', GPART: '30100001', LOAN_ID: 'L-001', BETRW: 8950, BUDAT: '2026-01-01', VALUT: '2026-01-01', STATUS: 'POSTED', CURRENCY: 'AUD' },
  { ZPBEL: 'ZP-L001-002', VKONT: 'CA-30100001-01', GPART: '30100001', LOAN_ID: 'L-001', BETRW: 8950, BUDAT: '2026-02-01', VALUT: '2026-02-01', STATUS: 'POSTED', CURRENCY: 'AUD' },
  // B-002 historical payment (before going overdue)
  { ZPBEL: 'ZP-L003-001', VKONT: 'CA-30100002-01', GPART: '30100002', LOAN_ID: 'L-003', BETRW: 7420, BUDAT: '2026-03-21', VALUT: '2026-03-21', STATUS: 'POSTED', CURRENCY: 'AUD' },
  // Performing loans - current payments
  { ZPBEL: 'ZP-L006-001', VKONT: 'CA-30100005-01', GPART: '30100005', LOAN_ID: 'L-006', BETRW: 36200, BUDAT: '2026-04-14', VALUT: '2026-04-14', STATUS: 'POSTED', CURRENCY: 'AUD' },
  { ZPBEL: 'ZP-L006-002', VKONT: 'CA-30100005-01', GPART: '30100005', LOAN_ID: 'L-006', BETRW: 36200, BUDAT: '2026-03-14', VALUT: '2026-03-14', STATUS: 'POSTED', CURRENCY: 'AUD' },
  { ZPBEL: 'ZP-L008-001', VKONT: 'CA-30100008-01', GPART: '30100008', LOAN_ID: 'L-008', BETRW: 13950, BUDAT: '2026-04-04', VALUT: '2026-04-04', STATUS: 'POSTED', CURRENCY: 'AUD' },
  { ZPBEL: 'ZP-L009-001', VKONT: 'CA-30100009-01', GPART: '30100009', LOAN_ID: 'L-009', BETRW: 62400, BUDAT: '2026-03-31', VALUT: '2026-03-31', STATUS: 'POSTED', CURRENCY: 'AUD' },
  { ZPBEL: 'ZP-L009-002', VKONT: 'CA-30100009-01', GPART: '30100009', LOAN_ID: 'L-009', BETRW: 62400, BUDAT: '2026-02-28', VALUT: '2026-02-28', STATUS: 'POSTED', CURRENCY: 'AUD' },
  { ZPBEL: 'ZP-L012-001', VKONT: 'CA-30100013-01', GPART: '30100013', LOAN_ID: 'L-012', BETRW: 9680, BUDAT: '2026-04-19', VALUT: '2026-04-19', STATUS: 'POSTED', CURRENCY: 'AUD' },
  { ZPBEL: 'ZP-L012-002', VKONT: 'CA-30100013-01', GPART: '30100013', LOAN_ID: 'L-012', BETRW: 9680, BUDAT: '2026-03-20', VALUT: '2026-03-20', STATUS: 'POSTED', CURRENCY: 'AUD' },
];

fs.writeFileSync('C:/Dev/Banking-Sentinel/Data/processed/DFKKZP.json', JSON.stringify({ table: 'DFKKZP', records: dfkkzp }, null, 2));
console.log('DFKKZP written:', dfkkzp.length, 'records');
