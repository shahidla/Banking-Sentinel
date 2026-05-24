// Banking Sentinel — Synthetic Data Enrichment
// Purpose:
//   PAL (Isolation Forest): needs a rich "normal" payment distribution to flag true outliers.
//   RPT-1 (in-context learning): needs diverse labeled DTI examples for better predictions.
//   With only 30 borrowers and ~50 DFKKOP rows, PAL has no reliable "normal" baseline.
//   With only 11 BCA_DTI rows, RPT-1 has a narrow label space.
//
// Run: npx cds bind --exec node scripts/enrich-synthetic-data.js --profile hybrid

'use strict';
require('dotenv').config();
const cds = require('@sap/cds');

// ── Helpers ──────────────────────────────────────────────────────────────────

function rand(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function dateStr(yearsAgo, monthsOffset = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  d.setMonth(d.getMonth() + monthsOffset);
  return d.toISOString().split('T')[0];
}

async function tryInsert(entity, record, label) {
  try {
    await cds.run(INSERT.into(entity).entries(record));
    return 'inserted';
  } catch (e) {
    if (e.message.toLowerCase().includes('duplicate') ||
        e.message.toLowerCase().includes('unique') ||
        e.message.toLowerCase().includes('primary key') ||
        e.message.toLowerCase().includes('entity_already_exists')) {
      return 'exists';
    }
    console.log(`  ! ${label} error: ${e.message.substring(0, 100)}`);
    return 'error';
  }
}

(async () => {
  await cds.connect.to('db');
  console.log('=== Synthetic Data Enrichment ===\n');

  // ── PART 1: DFKKOP synthetic normal payments ──────────────────────────────
  // Goal: give PAL Isolation Forest a strong "normal" baseline.
  // Strategy: 70 on-time rows (DAYS_OVERDUE=0) + 10 minor-late rows (5-15 days).
  // No stressed rows in synthetic data — real stressed rows (30100001: 81/50 days,
  // 30100003: DTI breach) must be clear outliers against this normal distribution.
  //
  // Performing partners (from dataset): 30100005, 30100006, 30100007, 30100008, 30100009, 30100010
  // OPBEL prefix SYN-OP- distinguishes synthetic from real open items.

  console.log('--- Part 1: DFKKOP synthetic normal payments (PAL training baseline) ---');

  const performingPartners = ['30100005', '30100006', '30100007', '30100008', '30100009', '30100010'];
  const syntheticLoans     = ['SYN-L-001', 'SYN-L-002', 'SYN-L-003', 'SYN-L-004', 'SYN-L-005', 'SYN-L-006'];
  const syntheticVkonts    = ['SYN-CA-001', 'SYN-CA-002', 'SYN-CA-003', 'SYN-CA-004', 'SYN-CA-005', 'SYN-CA-006'];

  // 70 on-time payments (DAYS_OVERDUE = 0, STATUS = CLEARED)
  const onTimeRows = Array.from({ length: 70 }, (_, i) => {
    const pi = i % performingPartners.length;
    return {
      OPBEL:        `SYN-OP-${String(i + 1).padStart(4, '0')}`,
      VKONT:        syntheticVkonts[pi],
      GPART:        performingPartners[pi],
      LOAN_ID:      syntheticLoans[pi],
      BETRW:        rand(800, 6500),
      FAEDN:        dateStr(0, -(i % 12) - 1),  // due date: 1-12 months ago
      BUDAT:        dateStr(0, -(i % 12) - 1),  // posted same day — cleared on time
      DAYS_OVERDUE: 0,
      STATUS:       'CLEARED',
      CURRENCY:     'AUD'
    };
  });

  // 10 minor-late payments (DAYS_OVERDUE = 5-15, STATUS = CLEARED)
  // These represent borderline-normal — PAL should see them as within-distribution
  const minorLateRows = Array.from({ length: 10 }, (_, i) => {
    const pi = i % performingPartners.length;
    return {
      OPBEL:        `SYN-OP-${String(71 + i).padStart(4, '0')}`,
      VKONT:        syntheticVkonts[pi],
      GPART:        performingPartners[pi],
      LOAN_ID:      syntheticLoans[pi],
      BETRW:        rand(800, 5000),
      FAEDN:        dateStr(0, -(i % 6) - 1),
      BUDAT:        null,          // not yet cleared — still open but minor
      DAYS_OVERDUE: randInt(5, 15),
      STATUS:       'OPEN',
      CURRENCY:     'AUD'
    };
  });

  const allDfkkopRows = [...onTimeRows, ...minorLateRows];
  let dfkkopInserted = 0, dfkkopExists = 0;

  for (const row of allDfkkopRows) {
    const result = await tryInsert('bankingsentinel.DFKKOP', row, row.OPBEL);
    if (result === 'inserted') dfkkopInserted++;
    else if (result === 'exists') dfkkopExists++;
  }

  console.log(`  DFKKOP: ${dfkkopInserted} inserted, ${dfkkopExists} already existed`);
  console.log(`  PAL training pool: ${dfkkopInserted + dfkkopExists} synthetic rows + existing real rows`);
  console.log(`  Distribution: ~70 on-time (DAYS_OVERDUE=0), ~10 minor-late (5-15 days)`);
  console.log(`  Real stressed rows (30100001: 81d/50d, 30100003 DTI breach) now clear outliers\n`);

  // ── PART 2: BCA_DTI synthetic rows (RPT-1 context diversity) ─────────────
  // Goal: give RPT-1 a diverse label space across the full DTI spectrum.
  // RPT-1 uses in-context learning — more labeled examples = better predictions.
  // Current: 11 rows (thin distribution). Target: 26 rows (15 synthetic added).
  //
  // Distribution design:
  //   LOW    (DTI 1.0-3.5): 5 rows — healthy borrowers, well under limit
  //   MEDIUM (DTI 3.5-5.5): 5 rows — approaching but within limit
  //   HIGH   (DTI 5.5-6.0): 3 rows — near limit, not yet breaching
  //   BREACH (DTI 6.0-8.0): 2 rows — over APRA limit (BREACH_FLAG = true)
  //
  // Partner IDs: use BP range 30100012-30100026 — real SAP sandbox BPs
  // in BusinessPartners table, unlikely to have existing DTI records.

  console.log('--- Part 2: BCA_DTI synthetic rows (RPT-1 context diversity) ---');

  const syntheticDtiRows = [
    // LOW risk — 5 rows (DTI 1.0–3.5)
    { PARTNER: '30100012', DTI_RATIO: 1.2,  TOTAL_DEBT: 120000,   ANNUAL_INCOME: 100000,  BREACH_FLAG: false, INCOME_SOURCE: 'Permanent employment', INCOME_EXPIRY: null },
    { PARTNER: '30100013', DTI_RATIO: 1.8,  TOTAL_DEBT: 180000,   ANNUAL_INCOME: 100000,  BREACH_FLAG: false, INCOME_SOURCE: 'Permanent employment', INCOME_EXPIRY: null },
    { PARTNER: '30100014', DTI_RATIO: 2.4,  TOTAL_DEBT: 240000,   ANNUAL_INCOME: 100000,  BREACH_FLAG: false, INCOME_SOURCE: 'Permanent employment', INCOME_EXPIRY: null },
    { PARTNER: '30100015', DTI_RATIO: 3.0,  TOTAL_DEBT: 360000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Permanent employment', INCOME_EXPIRY: null },
    { PARTNER: '30100016', DTI_RATIO: 3.4,  TOTAL_DEBT: 408000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Permanent employment', INCOME_EXPIRY: null },

    // MEDIUM risk — 5 rows (DTI 3.5–5.5)
    { PARTNER: '30100017', DTI_RATIO: 3.8,  TOTAL_DEBT: 456000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Contractor', INCOME_EXPIRY: dateStr(-1, 12) },
    { PARTNER: '30100018', DTI_RATIO: 4.2,  TOTAL_DEBT: 504000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Contractor', INCOME_EXPIRY: dateStr(-1, 10) },
    { PARTNER: '30100019', DTI_RATIO: 4.7,  TOTAL_DEBT: 564000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Self-employed',  INCOME_EXPIRY: null },
    { PARTNER: '30100020', DTI_RATIO: 5.0,  TOTAL_DEBT: 600000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Contractor', INCOME_EXPIRY: dateStr(0, 6) },
    { PARTNER: '30100021', DTI_RATIO: 5.4,  TOTAL_DEBT: 648000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Contractor', INCOME_EXPIRY: dateStr(0, 4) },

    // HIGH risk — 3 rows (DTI 5.5–6.0, near limit)
    { PARTNER: '30100022', DTI_RATIO: 5.6,  TOTAL_DEBT: 672000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Contractor', INCOME_EXPIRY: dateStr(0, 3) },
    { PARTNER: '30100023', DTI_RATIO: 5.8,  TOTAL_DEBT: 696000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Contractor', INCOME_EXPIRY: dateStr(0, 2) },
    { PARTNER: '30100024', DTI_RATIO: 5.95, TOTAL_DEBT: 714000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: false, INCOME_SOURCE: 'Casual',     INCOME_EXPIRY: dateStr(0, 1) },

    // BREACH — 2 rows (DTI > 6.0, APRA limit breached)
    { PARTNER: '30100025', DTI_RATIO: 6.4,  TOTAL_DEBT: 768000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: true,  INCOME_SOURCE: 'Casual',     INCOME_EXPIRY: dateStr(0, 1) },
    { PARTNER: '30100026', DTI_RATIO: 7.8,  TOTAL_DEBT: 936000,   ANNUAL_INCOME: 120000,  BREACH_FLAG: true,  INCOME_SOURCE: 'Contractor', INCOME_EXPIRY: dateStr(0, 2) },
  ].map(r => ({
    ...r,
    CURRENCY:    'AUD',
    APRA_LIMIT:  6.0,
    BREACH_DATE: r.BREACH_FLAG ? '2026-02-01' : null,  // APRA DTI activation date
  }));

  let dtiInserted = 0, dtiExists = 0;

  for (const row of syntheticDtiRows) {
    const result = await tryInsert('bankingsentinel.BCA_DTI', row, `DTI-${row.PARTNER}`);
    if (result === 'inserted') dtiInserted++;
    else if (result === 'exists') dtiExists++;
  }

  console.log(`  BCA_DTI: ${dtiInserted} inserted, ${dtiExists} already existed`);
  console.log(`  RPT-1 context pool: ${dtiInserted + dtiExists} synthetic + 11 real = ~${dtiInserted + dtiExists + 11} labeled examples`);
  console.log(`  Distribution: 5 LOW (1.0-3.5), 5 MEDIUM (3.5-5.5), 3 HIGH (5.5-6.0), 2 BREACH (6.0+)\n`);

  // ── Verification ──────────────────────────────────────────────────────────
  console.log('--- Verification ---');

  const dfkkopTotal = await cds.run(SELECT.from('bankingsentinel.DFKKOP'));
  const dtiTotal    = await cds.run(SELECT.from('bankingsentinel.BCA_DTI'));
  const dtiBreaches = dtiTotal.filter(r => r.BREACH_FLAG);

  console.log(`  DFKKOP total rows: ${dfkkopTotal.length}`);
  console.log(`    DAYS_OVERDUE=0:  ${dfkkopTotal.filter(r => r.DAYS_OVERDUE === 0).length} rows (PAL normal baseline)`);
  console.log(`    DAYS_OVERDUE>30: ${dfkkopTotal.filter(r => r.DAYS_OVERDUE > 30).length} rows (outlier target for PAL)`);
  console.log(`  BCA_DTI total rows: ${dtiTotal.length} (${dtiBreaches.length} breach)`);
  console.log(`    DTI range: ${Math.min(...dtiTotal.map(r => parseFloat(r.DTI_RATIO))).toFixed(1)} – ${Math.max(...dtiTotal.map(r => parseFloat(r.DTI_RATIO))).toFixed(1)}`);

  console.log('\n=== Done ===');
  console.log('PAL and RPT-1 training data enriched. No re-seeding of GraphDB required.');
  process.exit(0);
})();
