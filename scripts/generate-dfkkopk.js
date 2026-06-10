// One-time generator: DFKKOPK (cleared items / payment history) seed data.
// 12 months of cleared monthly payments per demo loan (Mar 2025 - Feb 2026),
// capped so history never predates the loan's APPROVED_DATE (only L-004,
// approved 2025-08-10, is affected -> 6 months, Sep 2025 - Feb 2026).
'use strict';
const fs = require('fs');
const path = require('path');

const LOANS = [
  { LOAN_ID: 'L-001', GPART: '30100001', VKONT: 'CA-30100001-01', day: 1,  amount: 8950,  approved: '2022-03-15' },
  { LOAN_ID: 'L-002', GPART: '30100001', VKONT: 'CA-30100001-02', day: 1,  amount: 6580,  approved: '2023-06-01' },
  { LOAN_ID: 'L-003', GPART: '30100002', VKONT: 'CA-30100002-01', day: 21, amount: 7420,  approved: '2021-11-20' },
  { LOAN_ID: 'L-004', GPART: '30100003', VKONT: 'CA-30100003-01', day: 10, amount: 41800, approved: '2025-08-10' },
  { LOAN_ID: 'L-005', GPART: '30100004', VKONT: 'CA-30100004-01', day: 28, amount: 9840,  approved: '2023-02-28' },
  { LOAN_ID: 'L-006', GPART: '30100005', VKONT: 'CA-30100005-01', day: 15, amount: 36200, approved: '2024-01-15' },
  { LOAN_ID: 'L-007', GPART: '30100006', VKONT: 'CA-30100006-01', day: 1,  amount: 940,   approved: '2024-04-01' },
  { LOAN_ID: 'L-008', GPART: '30100008', VKONT: 'CA-30100008-01', day: 5,  amount: 13950, approved: '2022-09-05' },
  { LOAN_ID: 'L-009', GPART: '30100009', VKONT: 'CA-30100009-01', day: 1,  amount: 62400, approved: '2023-07-01' },
  { LOAN_ID: 'L-010', GPART: '30100010', VKONT: 'CA-30100010-01', day: 12, amount: 5300,  approved: '2023-10-12' },
  { LOAN_ID: 'L-011', GPART: '30100012', VKONT: 'CA-30100012-01', day: 15, amount: 905,   approved: '2024-06-15' },
  { LOAN_ID: 'L-012', GPART: '30100013', VKONT: 'CA-30100013-01', day: 20, amount: 9680,  approved: '2021-05-20' },
];

// History window: Mar 2025 (year=2025, month=2) .. Feb 2026 (year=2026, month=1) inclusive
const WINDOW_MONTHS = [];
for (let y = 2025, m = 2; ; ) {
  WINDOW_MONTHS.push({ y, m });
  if (y === 2026 && m === 1) break;
  m++;
  if (m > 11) { m = 0; y++; }
}

function fmt(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.toISOString().slice(0, 10);
}

function dayBefore(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

const records = [];

for (const loan of LOANS) {
  const [ay, am, ad] = loan.approved.split('-').map(Number);
  const approvedDate = new Date(Date.UTC(ay, am - 1, ad));

  let seq = 0;
  for (const { y, m } of WINDOW_MONTHS) {
    const faedn = new Date(Date.UTC(y, m, loan.day));
    if (faedn <= approvedDate) continue; // skip months before/at origination

    seq++;
    const seqStr = String(seq).padStart(2, '0');
    const loanNum = loan.LOAN_ID.replace('-', ''); // L-001 -> L001 (matches existing DFKKOP OPBEL convention)
    records.push({
      OPBEL: `OP-${loanNum}-H${seqStr}`,
      VKONT: loan.VKONT,
      GPART: loan.GPART,
      LOAN_ID: loan.LOAN_ID,
      BETRW: loan.amount,
      FAEDN: fmt(y, m, loan.day),
      AUGDT: dayBefore(y, m, loan.day),
      AUGBL: `CL-${loanNum}-${seqStr}`,
      CURRENCY: 'AUD',
    });
  }
}

const out = { table: 'DFKKOPK', records };
const outPath = path.join(__dirname, '..', 'Data', 'processed', 'DFKKOPK.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${records.length} records to ${outPath}`);

// Per-loan counts summary
const counts = {};
for (const r of records) counts[r.LOAN_ID] = (counts[r.LOAN_ID] || 0) + 1;
console.log(counts);
