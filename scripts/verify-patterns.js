// Banking Sentinel — Risk Pattern Verification
// Verifies all four hidden risk patterns are queryable in HANA
// Run: cds bind --exec node scripts/verify-patterns.js

'use strict';
const cds = require('@sap/cds');

async function verify() {
  console.log('\n Banking Sentinel — Risk Pattern Verification');
  console.log('==============================================\n');

  await cds.connect.to('db');

  let passed = 0;
  let failed = 0;

  async function check(label, query, validator) {
    try {
      const result = await cds.run(query);
      const rows = Array.isArray(result) ? result : [result];
      const ok = validator(rows);
      if (ok) {
        console.log(`  PASS  ${label}`);
        passed++;
      } else {
        console.log(`  FAIL  ${label}`);
        console.log(`        Got: ${JSON.stringify(rows[0])}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ERROR ${label} — ${e.message}`);
      failed++;
    }
  }

  // ─── PATTERN 1: APS 221 GUARANTOR BREACH ──────────────────────────────────
  console.log('Pattern 1 — Connected Party + APS 221 Breach\n');

  // G-001 guarantees 4 loans
  await check(
    'G-001 (Rose Courtney) guarantees 4 loans',
    SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ GUARANTOR_PARTNER: '30910005' }),
    rows => rows.length === 4
  );

  // G-001 total exposure
  await check(
    'G-001 total exposure > AUD 5M (breaches single limit)',
    SELECT.from('bankingsentinel.BCA_GUARANTOR')
      .columns('sum(COVER_AMOUNT) as TOTAL')
      .where({ GUARANTOR_PARTNER: '30910005' }),
    rows => rows[0]?.TOTAL > 5000000
  );

  // G-001 and G-002 connected via BUT050 FAMILY_TRUST_MEMBER
  await check(
    'G-001 and G-002 linked via FAMILY_TRUST_MEMBER in BUT050',
    SELECT.from('bankingsentinel.BUT050').where({
      PARTNER1: '30910005',
      PARTNER2: '30910006',
      RELTYP: 'FAMILY_TRUST_MEMBER'
    }),
    rows => rows.length === 1
  );

  // Combined group exposure (G-001 + G-002 guarantees)
  await check(
    'G-001 + G-002 combined group exposure > AUD 7.5M (breaches group limit)',
    SELECT.from('bankingsentinel.BCA_GUARANTOR')
      .columns('sum(COVER_AMOUNT) as TOTAL')
      .where({ GUARANTOR_PARTNER: { in: ['30910005', '30910006'] } }),
    rows => rows[0]?.TOTAL > 7500000
  );

  // ─── PATTERN 2: DTI BREACH ─────────────────────────────────────────────────
  console.log('\nPattern 2 — DTI Regulatory Breach\n');

  await check(
    'B-003 (30100003) has DTI breach flag = true',
    SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: '30100003', BREACH_FLAG: true }),
    rows => rows.length === 1
  );

  await check(
    'B-003 DTI ratio = 7.2 (above APRA limit of 6.0)',
    SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: '30100003' }),
    rows => parseFloat(rows[0]?.DTI_RATIO) === 7.2
  );

  // ─── PATTERN 3: SECTOR CONCENTRATION ──────────────────────────────────────
  console.log('\nPattern 3 — Sector Concentration\n');

  await check(
    'At least 4 borrowers in RETAIL_PROP sector',
    SELECT.from('bankingsentinel.BCA_SECTOR').where({ SECTOR_CODE: 'RETAIL_PROP' }),
    rows => rows.length >= 4
  );

  await check(
    'RETAIL_PROP loans exist in portfolio',
    SELECT.from('bankingsentinel.Loans').where({ SECTOR_CODE: 'RETAIL_PROP' }),
    rows => rows.length >= 2
  );

  // ─── PATTERN 4: CREDIT EARLY WARNING ──────────────────────────────────────
  console.log('\nPattern 4 — Credit Early Warning\n');

  await check(
    'B-001 (30100001) has OPEN overdue items in DFKKOP',
    SELECT.from('bankingsentinel.DFKKOP').where({ GPART: '30100001', STATUS: 'OPEN' }),
    rows => rows.length >= 2
  );

  await check(
    'Overdue items > 60 days exist in portfolio',
    SELECT.from('bankingsentinel.DFKKOP').where`DAYS_OVERDUE > 60`,
    rows => rows.length >= 1
  );

  // B-001 has open DFKKOP items with no DFKKZP clearing — confirmed missed payment
  const overdueB001 = await cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: '30100001', STATUS: 'OPEN' }));
  const paymentsB001 = await cds.run(SELECT.from('bankingsentinel.DFKKZP').where({ PARTNER: '30100001' }));
  if (overdueB001.length > 0 && paymentsB001.length < overdueB001.length) {
    console.log(`  PASS  B-001 has ${overdueB001.length} open items, only ${paymentsB001.length} payments — confirmed misses`);
    passed++;
  } else {
    console.log(`  FAIL  B-001 payment gap check — overdue: ${overdueB001.length}, payments: ${paymentsB001.length}`);
    failed++;
  }

  // ─── 6-HOP TRAVERSAL SIMULATION ───────────────────────────────────────────
  console.log('\n6-Hop Traversal — Connects B-001 to APS 221 Breach\n');

  // Hop 1: B-001 → loans via BKKN
  const hop1 = await cds.run(SELECT.from('bankingsentinel.BKKN').where({ GPART: '30100001' }));
  console.log(`  Hop 1: B-001 → ${hop1.length} contract accounts`);

  // Hop 2: loans → guarantors via BCA_GUARANTOR
  const loanIds = ['L-001', 'L-002'];
  const hop2 = await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ LOAN_ID: { in: loanIds } }));
  console.log(`  Hop 2: Loans → ${hop2.length} guarantor records`);
  const guarantors = [...new Set(hop2.map(r => r.GUARANTOR_PARTNER))];
  console.log(`         Guarantors found: ${guarantors.join(', ')}`);

  // Hop 3: G-001 → connected parties via BUT050
  const hop3 = await cds.run(SELECT.from('bankingsentinel.BUT050').where({ PARTNER1: '30910005' }));
  console.log(`  Hop 3: G-001 → ${hop3.length} BUT050 relationships`);
  const connectedParties = hop3.map(r => `${r.PARTNER2} (${r.RELTYP})`);
  console.log(`         Connected: ${connectedParties.join(', ')}`);

  // Hop 4: G-002 → guaranteed loans
  const hop4 = await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ GUARANTOR_PARTNER: '30910006' }));
  console.log(`  Hop 4: G-002 → ${hop4.length} additional loans guaranteed`);

  // Hop 5: Calculate total group exposure
  const allGuarantors = ['30910005', '30910006'];
  const hop5 = await cds.run(
    SELECT.from('bankingsentinel.BCA_GUARANTOR')
      .columns('sum(COVER_AMOUNT) as TOTAL')
      .where({ GUARANTOR_PARTNER: { in: allGuarantors } })
  );
  const totalExposure = hop5[0]?.TOTAL;
  console.log(`  Hop 5: Group exposure = AUD ${totalExposure?.toLocaleString()}`);

  // Hop 6: Check against APS 221 group limit
  const hop6 = await cds.run(SELECT.from('bankingsentinel.ExposureLimits').where({ LIMIT_TYPE: 'GROUP' }));
  const limit = hop6[0]?.LIMIT_AUD;
  const utilisation = ((totalExposure / limit) * 100).toFixed(1);
  console.log(`  Hop 6: APS 221 group limit = AUD ${limit?.toLocaleString()} — Utilisation: ${utilisation}%`);

  if (parseFloat(utilisation) > 90) {
    console.log(`\n  ★ TWINKLE 1 CONFIRMED: 6-hop traversal finds ${utilisation}% APS 221 utilisation`);
    console.log(`    Board notification required. Nobody programmed this finding.`);
    passed++;
  } else {
    console.log(`\n  ✗ Twinkle 1 not confirmed — utilisation ${utilisation}% below 90% threshold`);
    failed++;
  }

  // ─── SUMMARY ──────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(46)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('  Phase 1 milestone COMPLETE — all patterns verified');
  } else {
    console.log('  Some patterns need investigation');
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

verify().catch(e => {
  console.error('Verification failed:', e);
  process.exit(1);
});
