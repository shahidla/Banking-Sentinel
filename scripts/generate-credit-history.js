// Banking Sentinel — RPT-1 Context Corpus Generator
// Generates 200 synthetic historical loan-performance cases for BCA_CREDIT_HISTORY.
// AI:      RPT-1 in-context learning corpus — feature columns (dti_ratio, total_debt,
//          annual_income, breach_flag) + an independently-generated outcome label
//          (arrears_outcome) so the model learns a probabilistic pattern, not a formula.
// Banking: arrears_outcome is generated from a smooth probability curve centered on the
//          APRA DTI limit (6.0) plus Gaussian noise — DTI correlates with repayment
//          stress but does not determine it, matching real-world credit risk behaviour.
// Run: node scripts/generate-credit-history.js

'use strict';
const fs   = require('fs');
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'Data', 'processed', 'BCA_CREDIT_HISTORY.json');
const ROW_COUNT = 200;
const SEED = 0x42424242;

// ─── Seeded PRNG (mulberry32) — reproducible across runs ─────────────────────
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

function randUniform(min, max) {
  return min + rand() * (max - min);
}

function randLogUniform(min, max) {
  const logMin = Math.log(min), logMax = Math.log(max);
  return Math.exp(randUniform(logMin, logMax));
}

// Box-Muller transform — standard normal sample
function randGaussian() {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

const APRA_DTI_LIMIT = 6.0;

function generateRow(i) {
  const dtiRatio  = Math.round(randUniform(0.5, 9.0) * 100) / 100;
  const totalDebt = Math.round(randLogUniform(25000, 3200000) * 100) / 100;
  const annualIncome = Math.round((totalDebt / dtiRatio) * 100) / 100;
  const breachFlag = dtiRatio >= APRA_DTI_LIMIT;

  // Probability of arrears stress — smooth curve centered on the APRA limit,
  // not a hard cutoff. DTI 6.0 -> 0.50, DTI 3.0 -> ~0.12, DTI 9.0 -> ~0.88.
  const p = sigmoid((dtiRatio - APRA_DTI_LIMIT) / 1.5);

  // Real-world noise: DTI correlates with, but does not determine, the outcome.
  const stress = Math.min(1, Math.max(0, p + randGaussian() * 0.15));

  let arrearsOutcome;
  if (stress < 0.25)      arrearsOutcome = 'LOW';
  else if (stress < 0.50) arrearsOutcome = 'MEDIUM';
  else if (stress < 0.75) arrearsOutcome = 'HIGH';
  else                     arrearsOutcome = 'CRITICAL';

  return {
    CASE_ID:         `HIST-${String(i + 1).padStart(4, '0')}`,
    DTI_RATIO:       dtiRatio,
    TOTAL_DEBT:      totalDebt,
    ANNUAL_INCOME:   annualIncome,
    BREACH_FLAG:     breachFlag,
    ARREARS_OUTCOME: arrearsOutcome,
  };
}

const records = Array.from({ length: ROW_COUNT }, (_, i) => generateRow(i));

fs.writeFileSync(OUT_PATH, JSON.stringify({ records }, null, 2));

// ─── Summary ──────────────────────────────────────────────────────────────────
const counts = records.reduce((acc, r) => {
  acc[r.ARREARS_OUTCOME] = (acc[r.ARREARS_OUTCOME] || 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${records.length} rows to ${OUT_PATH}`);
console.log('Outcome distribution:', counts);

// Sanity check: outcome should NOT be a deterministic step function of DTI —
// show a few rows where DTI is high but outcome is LOW, and vice versa.
const highDtiLow = records.filter(r => r.DTI_RATIO >= 6.5 && r.ARREARS_OUTCOME === 'LOW');
const lowDtiHigh = records.filter(r => r.DTI_RATIO <= 3.5 && (r.ARREARS_OUTCOME === 'HIGH' || r.ARREARS_OUTCOME === 'CRITICAL'));
console.log(`High-DTI (>=6.5) but LOW outcome: ${highDtiLow.length} rows`);
console.log(`Low-DTI (<=3.5) but HIGH/CRITICAL outcome: ${lowDtiHigh.length} rows`);
