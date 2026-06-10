// One-off: fill data gaps found during the 11-customer demo data audit.
// Adds LoanSchedule (3 rows each) + DFKKOP history for L-007, L-009, L-010,
// L-011 (which had loans but no repayment schedule/history), and a CASH
// collateral row for TD-002 (matching TD-001's CASH=amount pattern).
// Values follow the existing seed conventions: AMOUNT_DUE ratios consistent
// with same-LOAN_TYPE peers, schedule = 3 monthly rows on the loan's
// approval day-of-month (PAID/PAID/PENDING), one CLEARED DFKKOP row tied to
// the 2nd (paid) due date, BUDAT = FAEDN - 1 day.
'use strict';
const cds = require('@sap/cds');

(async () => {
  await cds.connect.to('db');

  await INSERT.into('bankingsentinel.LoanSchedule').entries([
    { LOAN_ID: 'L-007', DUE_DATE: '2026-03-01', AMOUNT_DUE: 940,   PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-007', DUE_DATE: '2026-04-01', AMOUNT_DUE: 940,   PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-007', DUE_DATE: '2026-06-01', AMOUNT_DUE: 940,   PRINCIPAL: 0, INTEREST: 0 },

    { LOAN_ID: 'L-009', DUE_DATE: '2026-03-01', AMOUNT_DUE: 62400, PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-009', DUE_DATE: '2026-04-01', AMOUNT_DUE: 62400, PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-009', DUE_DATE: '2026-06-01', AMOUNT_DUE: 62400, PRINCIPAL: 0, INTEREST: 0 },

    { LOAN_ID: 'L-010', DUE_DATE: '2026-03-12', AMOUNT_DUE: 5300,  PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-010', DUE_DATE: '2026-04-12', AMOUNT_DUE: 5300,  PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-010', DUE_DATE: '2026-05-12', AMOUNT_DUE: 5300,  PRINCIPAL: 0, INTEREST: 0 },

    { LOAN_ID: 'L-011', DUE_DATE: '2026-03-15', AMOUNT_DUE: 905,   PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-011', DUE_DATE: '2026-04-15', AMOUNT_DUE: 905,   PRINCIPAL: 0, INTEREST: 0 },
    { LOAN_ID: 'L-011', DUE_DATE: '2026-05-15', AMOUNT_DUE: 905,   PRINCIPAL: 0, INTEREST: 0 },
  ]);

  await INSERT.into('bankingsentinel.DFKKOP').entries([
    { OPBEL: 'OP-L007-001', VKONT: 'CA-30100006-01', GPART: '30100006', LOAN_ID: 'L-007', BETRW: 940,  FAEDN: '2026-04-01', BUDAT: '2026-03-31', DAYS_OVERDUE: 0, STATUS: 'CLEARED', CURRENCY: 'AUD' },
    { OPBEL: 'OP-L010-001', VKONT: 'CA-30100010-01', GPART: '30100010', LOAN_ID: 'L-010', BETRW: 5300, FAEDN: '2026-04-12', BUDAT: '2026-04-11', DAYS_OVERDUE: 0, STATUS: 'CLEARED', CURRENCY: 'AUD' },
    { OPBEL: 'OP-L011-001', VKONT: 'CA-30100012-01', GPART: '30100012', LOAN_ID: 'L-011', BETRW: 905,  FAEDN: '2026-04-15', BUDAT: '2026-04-14', DAYS_OVERDUE: 0, STATUS: 'CLEARED', CURRENCY: 'AUD' },
  ]);

  await INSERT.into('bankingsentinel.BCA_COLLATERAL').entries([
    { LOAN_ID: 'TD-002', COLLAT_ID: 'COL-TD02-01', COLLAT_TYPE: 'CASH', VALUE: 180000, CURRENCY: 'AUD' },
  ]);

  const sched = await cds.run(SELECT.from('bankingsentinel.LoanSchedule').where({ LOAN_ID: { in: ['L-007','L-009','L-010','L-011'] } }).orderBy('LOAN_ID','DUE_DATE'));
  const dfkkop = await cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ LOAN_ID: { in: ['L-007','L-010','L-011'] } }));
  const collat = await cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL').where({ LOAN_ID: 'TD-002' }));
  console.log('LoanSchedule:', JSON.stringify(sched, null, 2));
  console.log('DFKKOP:', JSON.stringify(dfkkop, null, 2));
  console.log('BCA_COLLATERAL:', JSON.stringify(collat, null, 2));
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
