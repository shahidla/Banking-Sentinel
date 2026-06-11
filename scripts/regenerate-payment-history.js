// One-off (Step 3 of IF redesign): regenerate Data/processed/DFKKOPK.json with
// realistic payment_delay_days variance (AUGDT - FAEDN, was hardcoded -1 for
// all 138 rows) and add the new MAHNS (dunning level, 0-3) column to both
// DFKKOPK and DFKKOP per the agreed demo narrative:
//  - clean performers (L-004, L-006..L-012 except the 4 distressed below):
//    flat 0-1 day variance, MAHNS=0 throughout
//  - distressed loans (L-001, L-002, L-003, L-005): clean for the first
//    7 months, then escalating delay/MAHNS in the last 5 months, ending at
//    the same magnitude as their currently-open DFKKOP item
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'Data', 'processed');

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 12-value cycling pattern of small ±1 day variance for clean months
const CLEAN_VARIANCE = [0, 1, -1, 0, 1, 0, -1, 0, 0, 1, -1, 0];

// Last 5 months (H08-H12) escalation: [delayDays, mahns], ending at the
// loan's currently-open DFKKOP overdue magnitude
const DISTRESSED_ESCALATION = {
  'L-001': [[1, 0], [4, 0], [12, 1], [35, 2], [81, 3]],
  'L-002': [[1, 0], [3, 0], [9, 1], [24, 2], [50, 3]],
  'L-003': [[0, 0], [2, 0], [6, 1], [16, 1], [30, 2]],
  'L-005': [[0, 0], [1, 0], [4, 0], [9, 1], [15, 1]],
};

// MAHNS for currently-open DFKKOP rows, by DAYS_OVERDUE bucket
const DFKKOP_MAHNS = {
  'OP-L001-001': 3, // 81d overdue
  'OP-L001-002': 3, // 50d overdue
  'OP-L002-001': 3, // 50d overdue
  'OP-L003-001': 2, // 30d overdue
  'OP-L005-001': 1, // 15d overdue
};

// --- DFKKOPK ---
const dfkkopkPath = path.join(DATA_DIR, 'DFKKOPK.json');
const dfkkopk = JSON.parse(fs.readFileSync(dfkkopkPath, 'utf8'));

// group records by LOAN_ID, preserving order (already chronological H01..H12)
const byLoan = new Map();
for (const r of dfkkopk.records) {
  if (!byLoan.has(r.LOAN_ID)) byLoan.set(r.LOAN_ID, []);
  byLoan.get(r.LOAN_ID).push(r);
}

for (const [loanId, rows] of byLoan) {
  const escalation = DISTRESSED_ESCALATION[loanId];
  const n = rows.length;
  rows.forEach((r, i) => {
    let delay, mahns;
    if (escalation && i >= n - escalation.length) {
      [delay, mahns] = escalation[i - (n - escalation.length)];
    } else {
      delay = CLEAN_VARIANCE[i % CLEAN_VARIANCE.length];
      mahns = 0;
    }
    r.AUGDT = addDays(r.FAEDN, delay);
    r.MAHNS = mahns;
  });
}

fs.writeFileSync(dfkkopkPath, JSON.stringify(dfkkopk, null, 2) + '\n');
console.log(`Updated ${dfkkopk.records.length} DFKKOPK records (AUGDT variance + MAHNS) -> ${dfkkopkPath}`);

// --- DFKKOP ---
const dfkkopPath = path.join(DATA_DIR, 'DFKKOP.json');
const dfkkop = JSON.parse(fs.readFileSync(dfkkopPath, 'utf8'));

for (const r of dfkkop.records) {
  r.MAHNS = DFKKOP_MAHNS[r.OPBEL] ?? 0;
}

fs.writeFileSync(dfkkopPath, JSON.stringify(dfkkop, null, 2) + '\n');
console.log(`Updated ${dfkkop.records.length} DFKKOP records (MAHNS) -> ${dfkkopPath}`);
