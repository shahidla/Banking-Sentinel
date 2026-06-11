// One-off: verify Trajectory Agent's new +3% rate-stress projection
// (RegulatoryThresholds.RATE_STRESS_BUFFER, APG 223) against real HANA data.
'use strict';
const cds = require('@sap/cds');
const { trajectoryAgent } = require('../srv/agents/trajectory-agent');

const CUSTOMERS = ['30100001', '30100003', '30100004', '30100008'];

(async () => {
  await cds.connect.to('db');

  for (const customerId of CUSTOMERS) {
    const { trajectoryAnalysis: t } = await trajectoryAgent({ intent: { customerId } });
    console.log(`\n${customerId}`);
    console.log(`  currentDti:          ${t.currentDti}`);
    console.log(`  futureDti:           ${t.futureDti}`);
    console.log(`  futureDtiRateStress: ${t.futureDtiRateStress}`);
    console.log(`  daysToExpiry:        ${t.daysToExpiry}`);
    console.log(`  forwardPosition:     ${t.forwardPosition}`);
    console.log(`  conflictingSignals:`);
    t.conflictingSignals.forEach(s => console.log(`    - ${s}`));
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
