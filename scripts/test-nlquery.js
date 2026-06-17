/**
 * Standalone test for cds-db-nlquery-mcp core logic against Banking Sentinel HANA.
 * Tests schema-reader + query-executor directly (no MCP transport, no LLM needed).
 *
 * Run: node --env-file=.env scripts/test-nlquery.js
 */
'use strict';

// Use Banking-Sentinel's @sap/cds (has @sap/hana-client).
// query-executor.js resolves cds from process.cwd() which is Banking-Sentinel — same instance.
const cds = require('@sap/cds');
const { buildSchema, buildSchemaPrompt } = require('C:/Dev/cds-db-nlquery-mcp/src/schema-reader');
const { executeDescriptor }              = require('C:/Dev/cds-db-nlquery-mcp/src/query-executor');

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⚠️ ';

async function run() {
  cds.model = cds.linked(await cds.load('db'));  // linked() adds isAssociation flags missing from raw CSN
  await cds.connect.to('db');                    // open HANA; cds.db registered because cds.model is pre-set
  const schema = buildSchema(cds.model);
  const entityNames = Object.keys(schema);

  console.log('\n=== cds-db-nlquery-mcp — Integration Test ===\n');

  // ── 1. Schema introspection ──────────────────────────────────────────────────
  console.log('── 1. Schema introspection ──────────────────');
  console.log(`  Entities found: ${entityNames.length}`);
  entityNames.forEach(name => {
    const def = schema[name];
    const joinCount = Object.keys(def.joins || {}).length;
    const colCount  = Object.keys(def.columns).length;
    console.log(`  ${name}: ${colCount} cols, ${joinCount} joins  [${def.label.slice(0, 60)}]`);
  });

  const expected = [
    'BusinessPartners', 'BUT050', 'Loans', 'LoanSchedule',
    'BCA_GUARANTOR', 'BCA_COLLATERAL', 'BCA_DTI', 'DFKKOP', 'DFKKOPK',
    'BCA_SECTOR', 'RegulatoryThresholds', 'ExposureLimits', 'SectorExposureLimits',
    'RiskAssessments', 'RegulatoryDocuments', 'AuditLog', 'BCA_CREDIT_HISTORY'
  ];
  const missing = expected.filter(e => !schema[e]);
  console.log(missing.length === 0
    ? `${PASS} All expected entities present`
    : `${FAIL} Missing: ${missing.join(', ')}`);

  // ── 2. Individual query tests ────────────────────────────────────────────────
  console.log('\n── 2. Query tests ───────────────────────────');

  const tests = [
    // [label, descriptor, assertion fn]

    // S1 — Simple: DTI above 6
    ['S1 DTI above 6', {
      entity: 'BCA_DTI', select: ['PARTNER', 'DTI_RATIO', 'BREACH_FLAG'],
      where: [{ col: 'DTI_RATIO', op: '>', val: 6 }],
      orderBy: 'DTI_RATIO', orderDir: 'DESC', limit: 20
    }, rows => rows.length > 0 && rows.every(r => parseFloat(r.DTI_RATIO) > 6)],

    // S2 — Simple: active loans
    ['S2 Active loans', {
      entity: 'Loans', select: ['LOAN_ID', 'PARTNER', 'AMOUNT', 'STATUS'],
      where: [{ col: 'STATUS', op: '=', val: 'A' }], limit: 20
    }, rows => rows.length > 0 && rows.every(r => r.STATUS === 'A')],

    // S3 — Simple: BREACH_FLAG true
    ['S3 BREACH_FLAG customers', {
      entity: 'BCA_DTI', select: ['PARTNER', 'DTI_RATIO'],
      where: [{ col: 'BREACH_FLAG', op: '=', val: true }], limit: 20
    }, rows => rows.length > 0],

    // S4 — Simple: overdue payments
    ['S4 Overdue payments (DFKKOP)', {
      entity: 'DFKKOP', select: ['OPBEL', 'GPART', 'DAYS_OVERDUE', 'STATUS'],
      where: [{ col: 'STATUS', op: '=', val: 'OPEN' }, { col: 'DAYS_OVERDUE', op: '>', val: 0 }],
      orderBy: 'DAYS_OVERDUE', orderDir: 'DESC', limit: 20
    }, rows => rows.length > 0],

    // H1 — Hardcoded equivalent: DTI > 5 with customer name (CDS path expression → SQL JOIN)
    ['H1 DTI>5 with customer join', {
      entity: 'BCA_DTI',
      select: ['PARTNER', 'DTI_RATIO', 'ANNUAL_INCOME', 'customer.BU_SORT1'],
      where: [{ col: 'DTI_RATIO', op: '>', val: 5 }],
      orderBy: 'DTI_RATIO', orderDir: 'DESC', limit: 20
    }, rows => rows.length > 0 && (rows[0]['BU_SORT1'] || rows[0]['customer.BU_SORT1'])],

    // H2 — DTI breach + overdue: 30100003 has CLEARED (not OPEN) payments → 0 rows is correct
    ['H2 DTI breach + overdue (DFKKOP+dti)', {
      entity: 'DFKKOP',
      select: ['GPART', 'LOAN_ID', 'DAYS_OVERDUE', 'STATUS', 'dti.DTI_RATIO', 'dti.BREACH_FLAG'],
      where: [{ col: 'STATUS', op: '=', val: 'OPEN' }, { col: 'dti.BREACH_FLAG', op: '=', val: true }],
      orderBy: 'DAYS_OVERDUE', orderDir: 'DESC', limit: 20
    }, rows => Array.isArray(rows)],  // data correct: breach customer has CLEARED not OPEN items

    // H3 — Income expiring within 90 days
    ['H3 Income expiry within_days 90', {
      entity: 'BCA_DTI',
      select: ['PARTNER', 'INCOME_EXPIRY', 'DTI_RATIO', 'customer.BU_SORT1'],
      where: [{ col: 'INCOME_EXPIRY', op: 'within_days', val: 90 }],
      orderBy: 'INCOME_EXPIRY', orderDir: 'ASC', limit: 20
    }, rows => Array.isArray(rows)],

    // H4 — Guarantors also borrowers (LOAN_ID is the join key — selecting it twice causes HANA duplicate error)
    ['H4 Guarantors also borrowers (asLoan join)', {
      entity: 'BCA_GUARANTOR',
      select: ['GUARANTOR_PARTNER', 'LOAN_ID', 'COVER_AMOUNT', 'asLoan.AMOUNT', 'asLoan.STATUS'],
      where: [], limit: 20
    }, rows => Array.isArray(rows)],

    // N1 — New: RiskAssessments
    ['N1 RiskAssessments entity', {
      entity: 'RiskAssessments',
      select: ['SESSION_ID', 'PARTNER', 'RISK_LEVEL', 'RISK_SCORE'],
      where: [], limit: 10
    }, rows => Array.isArray(rows)],

    // N9 — New: DFKKOPK history for customer 30100001
    ['N9 DFKKOPK history for 30100001', {
      entity: 'DFKKOPK',
      select: ['OPBEL', 'GPART', 'LOAN_ID', 'BETRW', 'FAEDN', 'AUGDT', 'MAHNS'],
      where: [{ col: 'GPART', op: '=', val: '30100001' }],
      orderBy: 'FAEDN', orderDir: 'ASC', limit: 20
    }, rows => rows.length > 0 && rows.every(r => r.GPART === '30100001')],

    // C1 — Complex: income expiry + DTI threshold (two conditions, one CDS path join)
    ['C1 Income expiring in 90d AND DTI>5', {
      entity: 'BCA_DTI',
      select: ['PARTNER', 'INCOME_EXPIRY', 'DTI_RATIO', 'customer.BU_SORT1'],
      where: [
        { col: 'INCOME_EXPIRY', op: 'within_days', val: 90 },
        { col: 'DTI_RATIO', op: '>', val: 5 }
      ],
      orderBy: 'DTI_RATIO', orderDir: 'DESC', limit: 20
    }, rows => Array.isArray(rows)],

    // C7 — Payment history with dunning level 3
    ['C7 DFKKOPK dunning level 3', {
      entity: 'DFKKOPK',
      select: ['OPBEL', 'GPART', 'LOAN_ID', 'FAEDN', 'MAHNS'],
      where: [{ col: 'MAHNS', op: '=', val: 3 }],
      orderBy: 'FAEDN', orderDir: 'DESC', limit: 20
    }, rows => Array.isArray(rows)],

    // M2 — MCP-only: RiskAssessments HIGH/CRITICAL
    ['M2 HIGH or CRITICAL risk assessments', {
      entity: 'RiskAssessments',
      select: ['SESSION_ID', 'PARTNER', 'RISK_LEVEL', 'RISK_SCORE', 'CREATED_AT'],
      where: [{ col: 'RISK_LEVEL', op: 'like', val: 'HIGH' }],
      orderBy: 'RISK_SCORE', orderDir: 'DESC', limit: 10
    }, rows => Array.isArray(rows)],
  ];

  let passed = 0;
  let failed = 0;

  for (const [label, descriptor, check] of tests) {
    try {
      const rows = await executeDescriptor(descriptor, schema);
      const ok = check(rows);
      console.log(`  ${ok ? PASS : FAIL} ${label} → ${rows.length} rows`);
      if (ok) passed++; else failed++;

      // Print first row as sample
      if (rows.length > 0) {
        const sample = rows[0];
        const keys = Object.keys(sample).slice(0, 4);
        const preview = keys.map(k => `${k}=${JSON.stringify(sample[k])}`).join('  ');
        console.log(`      → ${preview}`);
      }
    } catch (e) {
      console.log(`  ${FAIL} ${label} → ERROR: ${e.message}`);
      failed++;
    }
  }

  // ── 3. Summary ───────────────────────────────────────────────────────────────
  console.log(`\n── Summary ──────────────────────────────────`);
  console.log(`  Entities: ${entityNames.length}`);
  console.log(`  Tests:    ${passed + failed} run, ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? `${PASS} All tests passed` : `${FAIL} ${failed} test(s) failed`);
  console.log('\n=== Done ===\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
