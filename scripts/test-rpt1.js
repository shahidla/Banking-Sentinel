// One-off: probe rpt.cloud.sap to find the largest BCA_CREDIT_HISTORY context
// size that returns HTTP 200 within a reasonable time, after a live run with
// 200 context rows returned HTTP 504 ("try again with fewer rows or columns").
'use strict';
const cds = require('@sap/cds');

const RPT1_TARGET_COLUMN = 'arrears_outcome';
const RPT1_PLACEHOLDER   = '[PREDICT]';

(async () => {
  await cds.connect.to('db');
  const apiKey = process.env.SAP_RPT_API_KEY;
  if (!apiKey) throw new Error('SAP_RPT_API_KEY not set');

  const history = await cds.run(SELECT.from('bankingsentinel.BCA_CREDIT_HISTORY'));
  console.log(`Loaded ${history.length} history rows`);

  const allContext = history.map(h => ({
    case_id:        h.CASE_ID,
    dti_ratio:      parseFloat(h.DTI_RATIO)    || 0,
    breach_flag:    h.BREACH_FLAG ? 1 : 0,
    total_debt:     parseFloat(h.TOTAL_DEBT)   || 0,
    annual_income:  parseFloat(h.ANNUAL_INCOME)|| 0,
    arrears_outcome: h.ARREARS_OUTCOME
  }));

  const queryRow = {
    case_id:        'Q-30100001',
    dti_ratio:      4.5,
    breach_flag:    0,
    total_debt:     500000,
    annual_income:  150000,
    arrears_outcome: RPT1_PLACEHOLDER
  };

  const sizes = [200, 100, 50, 25];
  for (const n of sizes) {
    const contextRows = allContext.slice(0, n);
    const payload = {
      index_column: 'case_id',
      rows:         [...contextRows, queryRow],
      prediction_config: {
        target_columns: [
          { name: RPT1_TARGET_COLUMN, prediction_placeholder: RPT1_PLACEHOLDER, task_type: 'classification' }
        ]
      }
    };

    const start = Date.now();
    try {
      const response = await fetch('https://rpt.cloud.sap/api/predict', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(60000)
      });
      const text = await response.text();
      const ms = Date.now() - start;
      console.log(`n=${n}: HTTP ${response.status} in ${ms}ms — ${text.slice(0, 300)}`);
      if (response.ok) {
        console.log(`  -> SUCCESS at n=${n}, full response:`, text.slice(0, 1500));
        break;
      }
    } catch (e) {
      const ms = Date.now() - start;
      console.log(`n=${n}: ERROR in ${ms}ms — ${e.message}`);
    }
  }

  process.exit(0);
})().catch(e => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
