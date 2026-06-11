// One-off: verify Trajectory Agent's +3% rate-stress projection (RATE_STRESS_BUFFER,
// APG 223) against the "post-APRA-notice" DTI limit (6.0x) — the same toggle the
// /a2a/sync-apra and /api/reset-threshold endpoints use. Reverts to 8.0x afterwards
// regardless of outcome, so it leaves the demo in its baseline state.
'use strict';
const cds = require('@sap/cds');
const { trajectoryAgent } = require('../srv/agents/trajectory-agent');

const CUSTOMERS = ['30100001', '30100003', '30100004', '30100008'];

(async () => {
  await cds.connect.to('db');

  await cds.run(
    UPDATE('bankingsentinel.RegulatoryThresholds').set({ LIMIT_PCT: 6.0 }).where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' })
  );
  console.log('--- DTI limit set to 6.0x (post-APRA-notice) ---');

  try {
    for (const customerId of CUSTOMERS) {
      const { trajectoryAnalysis: t } = await trajectoryAgent({ intent: { customerId } });
      console.log(`\n${customerId}`);
      console.log(`  currentDti:          ${t.currentDti}`);
      console.log(`  futureDtiRateStress: ${t.futureDtiRateStress}`);
      console.log(`  forwardPosition:     ${t.forwardPosition}`);
      t.conflictingSignals.forEach(s => console.log(`    - ${s}`));
    }
  } finally {
    await cds.run(
      UPDATE('bankingsentinel.RegulatoryThresholds').set({ LIMIT_PCT: 8.0 }).where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' })
    );
    console.log('\n--- DTI limit reverted to 8.0x (Demo 1 baseline) ---');
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
