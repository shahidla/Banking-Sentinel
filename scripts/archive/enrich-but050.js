// Banking Sentinel — BUT050 Enrichment Script
// Implements the four hidden risk patterns from CONTEXT.md
// Run once: npx cds bind --exec node scripts/enrich-but050.js --profile hybrid
// After running: re-seed GraphDB: npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid

require('dotenv').config();
const cds = require('@sap/cds');

(async () => {
  await cds.connect.to('db');

  // ─── New BusinessPartners (entities that anchor the hidden connections) ──
  const newPartners = [
    { PARTNER: '30910009', BU_TYPE: '2', BU_SORT1: 'TrustCo Group Pty Ltd',   SECTOR_CODE: 'COMMERCIAL' },
    { PARTNER: '30910010', BU_TYPE: '2', BU_SORT1: 'TrustCo Holdings Ltd',     SECTOR_CODE: 'COMMERCIAL' },
    { PARTNER: '30910011', BU_TYPE: '1', BU_SORT1: 'James Whitfield',           SECTOR_CODE: 'RETAIL_PROP' },
    { PARTNER: '30910012', BU_TYPE: '1', BU_SORT1: 'Sandra Whitfield',          SECTOR_CODE: 'RETAIL_PROP' },
  ];

  // ─── BUT050 rows implementing the four hidden risk patterns ─────────────
  const newEdges = [
    // Pattern 1 — Twinkle 1: Connected party chain from 30100003 to TrustCo Holdings
    // 30100003 →[FAMILY_TRUST_MEMBER]→ 30910005 already linked via BCA_GUARANTOR
    // Add direct BUT050 link so SPARQL graph traversal picks it up
    { PARTNER1: '30100003', PARTNER2: '30910005', RELTYP: 'FAMILY_TRUST_MEMBER', VALID_FROM: '2020-07-01', VALID_TO: '9999-12-31' },
    // 30910005 →[FAMILY_TRUST_MEMBER]→ 30910006 already exists
    // Extend chain: 30910006 → TrustCo Group → TrustCo Holdings
    { PARTNER1: '30910006', PARTNER2: '30910009', RELTYP: 'SUBSIDIARY',          VALID_FROM: '2019-01-01', VALID_TO: '9999-12-31' },
    { PARTNER1: '30910009', PARTNER2: '30910010', RELTYP: 'PARENT_COMPANY',      VALID_FROM: '2018-06-01', VALID_TO: '9999-12-31' },

    // Pattern 1 extended: other borrowers also in the TrustCo family trust
    // Creates the connected GROUP that breaches APS 221 collectively
    { PARTNER1: '30100001', PARTNER2: '30910009', RELTYP: 'FAMILY_TRUST_MEMBER', VALID_FROM: '2020-07-01', VALID_TO: '9999-12-31' },
    { PARTNER1: '30100002', PARTNER2: '30910009', RELTYP: 'FAMILY_TRUST_MEMBER', VALID_FROM: '2020-07-01', VALID_TO: '9999-12-31' },

    // Pattern 3 — Sector concentration: four borrowers in RETAIL_PROP linked via TrustCo
    { PARTNER1: '30910010', PARTNER2: '30910011', RELTYP: 'FAMILY_TRUST_MEMBER', VALID_FROM: '2021-03-01', VALID_TO: '9999-12-31' },
    { PARTNER1: '30910010', PARTNER2: '30910012', RELTYP: 'FAMILY_TRUST_MEMBER', VALID_FROM: '2021-03-01', VALID_TO: '9999-12-31' },
  ];

  console.log('=== BUT050 Enrichment ===\n');

  // Insert new partners (ignore duplicates)
  console.log('Inserting new BusinessPartners...');
  for (const p of newPartners) {
    try {
      await cds.run(INSERT.into('bankingsentinel.BusinessPartners').entries(p));
      console.log(`  + ${p.PARTNER} ${p.BU_SORT1}`);
    } catch (e) {
      if (e.message.includes('duplicate') || e.message.includes('unique') || e.message.includes('primary key')) {
        console.log(`  = ${p.PARTNER} already exists`);
      } else {
        console.log(`  ! ${p.PARTNER} error: ${e.message.substring(0, 80)}`);
      }
    }
  }

  // Insert new BUT050 edges (ignore duplicates)
  console.log('\nInserting BUT050 relationships...');
  for (const e of newEdges) {
    try {
      await cds.run(INSERT.into('bankingsentinel.BUT050').entries(e));
      console.log(`  + ${e.PARTNER1} →[${e.RELTYP}]→ ${e.PARTNER2}`);
    } catch (e2) {
      if (e2.message.includes('duplicate') || e2.message.includes('unique') || e2.message.includes('primary key')) {
        console.log(`  = ${e.PARTNER1}→${e.PARTNER2} already exists`);
      } else {
        console.log(`  ! ${e.PARTNER1}→${e.PARTNER2} error: ${e2.message.substring(0, 80)}`);
      }
    }
  }

  // Verify final BUT050 count
  const all = await cds.run(SELECT.from('bankingsentinel.BUT050'));
  console.log(`\nBUT050 total: ${all.length} relationships`);
  console.log('\nFull chain from 30100003:');
  const chain = all.filter(r => ['30100003','30910005','30910006','30910009','30910010'].includes(r.PARTNER1));
  chain.forEach(r => console.log(`  ${r.PARTNER1} →[${r.RELTYP}]→ ${r.PARTNER2}`));

  console.log('\n=== Done — now run: npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid ===');
  process.exit(0);
})();
