// Banking Sentinel — Pattern Agent (Agent 2)
// AI: First specialist agent — establishes baseline risk signal before graph traversal
// Banking: RPT-1 quantifies the risk score; PAL finds statistical outliers; LLM narrates them
// SAP: RPT-1 via rpt.cloud.sap consumer API + HANA PAL Isolation Forest + Claude LLM
//      All three always run. Educational popup shows all three outputs side-by-side.

'use strict';
const cds = require('@sap/cds');
const { ChatAnthropic } = require('@langchain/anthropic');

// ── Step 1: Fetch customer data from HANA ────────────────────────────────────
async function fetchCustomerData(customerId) {
  const [loansResult, dtiResult, paymentsResult] = await Promise.allSettled([
    cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: customerId }).limit(1)),
    cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: customerId }).limit(100)),
  ]);

  const loans    = loansResult.status    === 'fulfilled' ? loansResult.value    : [];
  const dtiRows  = dtiResult.status      === 'fulfilled' ? dtiResult.value      : [];
  const payments = paymentsResult.status === 'fulfilled' ? paymentsResult.value : [];

  let collateral = [];
  if (loans.length > 0) {
    const loanIds = loans.map(l => l.LOAN_ID);
    try {
      collateral = await cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL').where({ LOAN_ID: { in: loanIds } }));
    } catch (e) {
      console.warn('  [Pattern] Collateral fetch failed:', e.message);
    }
  }

  return { loans, dti: dtiRows[0] || null, payments, collateral };
}

// ── Step 2: RPT-1 — SAP tabular foundation model (consumer API at rpt.cloud.sap) ──
// AI: In-context learning — send example rows with known labels, predict the query row
// Banking: Classify borrower risk category from DTI, breach flag, debt, income features
// SAP: POST to rpt.cloud.sap/api/predict — personal API token, no AI Core required
async function callRpt1(data, customerId) {
  const apiKey = process.env.SAP_RPT_API_KEY;
  if (!apiKey) throw new Error('SAP_RPT_API_KEY not set');

  const allDti = await cds.run(SELECT.from('bankingsentinel.BCA_DTI').limit(20));
  const contextRows = allDti.map(d => ({
    partner_id:    String(d.PARTNER),
    dti_ratio:     parseFloat(d.DTI_RATIO)    || 0,
    breach_flag:   d.BREACH_FLAG ? 1 : 0,
    total_debt:    parseFloat(d.TOTAL_DEBT)   || 0,
    annual_income: parseFloat(d.ANNUAL_INCOME)|| 0,
    risk_category: d.BREACH_FLAG                  ? 'HIGH'   :
                   parseFloat(d.DTI_RATIO) >= 5.5  ? 'MEDIUM' : 'LOW'
  }));

  if (contextRows.length < 2) throw new Error('Not enough context rows for RPT-1 (need >= 2)');

  const queryRow = {
    partner_id:    `Q-${customerId}`,
    dti_ratio:     parseFloat(data.dti?.DTI_RATIO)    || 0,
    breach_flag:   data.dti?.BREACH_FLAG ? 1 : 0,
    total_debt:    parseFloat(data.dti?.TOTAL_DEBT)   || 0,
    annual_income: parseFloat(data.dti?.ANNUAL_INCOME)|| 0,
    risk_category: '[PREDICT]'
  };

  const payload = {
    rows:         [...contextRows.slice(0, 20), queryRow],
    index_column: 'partner_id'
  };

  const response = await fetch('https://rpt.cloud.sap/api/predict', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(20000)
  });

  const rawResponse = await response.text();
  console.log(`  [Pattern/RPT-1] HTTP ${response.status} — ${rawResponse.length} chars`);

  if (!response.ok) throw new Error(`RPT-1 HTTP ${response.status}: ${rawResponse}`);
  const result = JSON.parse(rawResponse);

  const predictions  = result.prediction?.predictions || [];
  const myPrediction = predictions.find(p => String(p.partner_id) === `Q-${customerId}`) || predictions[0];
  const category     = myPrediction?.risk_category?.[0]?.prediction || null;
  const confidence   = myPrediction?.risk_category?.[0]?.confidence || null;
  if (!category) throw new Error('RPT-1 response missing prediction');

  const scoreMap = { 'LOW': 15, 'MEDIUM': 45, 'HIGH': 70, 'CRITICAL': 90 };
  const score    = scoreMap[category.toUpperCase()] ?? 50;
  return { score, category, confidence };
}

// ── Step 2 fallback: HANA-derived estimate when RPT-1 is unavailable ─────────
function estimateScoreFromData(data) {
  const dtiScore     = Math.min(((parseFloat(data.dti?.DTI_RATIO) || 0) / 6.0) * 35, 35);
  const maxOverdue   = Math.max(...data.payments.map(p => p.DAYS_OVERDUE || 0), 0);
  const overdueScore = Math.min((maxOverdue / 180) * 35, 35);
  const breachScore  = data.dti?.BREACH_FLAG ? 20 : 0;
  const loanScore    = Math.min(data.loans.length * 3, 10);
  return { score: Math.round(dtiScore + overdueScore + breachScore + loanScore), category: null, confidence: null };
}

// ── Step 3a: PAL — HANA Isolation Forest (train on portfolio, score one customer) ──
// AI: Isolation Forest detects anomalies by measuring how easily a point is isolated
// Banking: Train on all DFKKOP payment records, score this customer's rows
//          PAL_ISOLATION_FOREST_EXPLAIN returns REASON_CODE — which feature drove the anomaly
// SAP: _SYS_AFL.PAL_ISOLATION_FOREST (train) → _SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN (score)
//      Requires AFL__SYS_AFL_AFLPAL_EXECUTE privilege on the HDI technical user
async function runPalAnomalyDetection(data) {
  // Train on full portfolio DFKKOP (no ID column — PAL_ISOLATION_FOREST requirement)
  const allPayments = await cds.run(
    SELECT.from('bankingsentinel.DFKKOP').columns('DAYS_OVERDUE', 'BETRW').limit(500)
  );
  if (allPayments.length < 2) throw new Error('Insufficient portfolio DFKKOP rows for PAL training');

  if (!data.payments.length) throw new Error('No payment rows for this customer to score');

  // Build inline training data (UNION ALL from fetched rows, no ID column)
  const trainUnion = allPayments.map(p =>
    `SELECT CAST(${parseFloat(p.DAYS_OVERDUE) || 0} AS DOUBLE) AS "DAYS_OVERDUE", ` +
    `CAST(${parseFloat(p.BETRW) || 0} AS DOUBLE) AS "AMOUNT" FROM DUMMY`
  ).join('\nUNION ALL ');

  // Build scoring data (ID as first column — PAL_ISOLATION_FOREST_EXPLAIN requirement)
  const scoreUnion = data.payments.map((p, i) =>
    `SELECT CAST('P${i + 1}' AS NVARCHAR(20)) AS "ID", ` +
    `CAST(${parseFloat(p.DAYS_OVERDUE) || 0} AS DOUBLE) AS "DAYS_OVERDUE", ` +
    `CAST(${parseFloat(p.BETRW) || 0} AS DOUBLE) AS "AMOUNT" FROM DUMMY`
  ).join('\nUNION ALL ');

  // Param table column names match PAL spec: PARAM_NAME, INT_VALUE, DOUBLE_VALUE, STRING_VALUE
  const sql = `
    DO BEGIN
      lt_train = ${trainUnion};

      lt_train_param =
        SELECT CAST('SEED' AS NVARCHAR(256)) AS "PARAM_NAME",
               CAST(42 AS INTEGER)            AS "INT_VALUE",
               CAST(NULL AS DOUBLE)            AS "DOUBLE_VALUE",
               CAST(NULL AS NVARCHAR(100))     AS "STRING_VALUE"
        FROM DUMMY;

      CALL _SYS_AFL.PAL_ISOLATION_FOREST(:lt_train, :lt_train_param, lt_model);

      lt_score = ${scoreUnion};

      -- EXPLAIN: LABEL = -1 for outliers, 1 for inliers. REASON_CODE = feature attribution.
      lt_explain_param =
        SELECT CAST('CONTAMINATION' AS NVARCHAR(256)) AS "PARAM_NAME",
               CAST(NULL AS INTEGER)                   AS "INT_VALUE",
               CAST(0.1 AS DOUBLE)                     AS "DOUBLE_VALUE",
               CAST(NULL AS NVARCHAR(100))              AS "STRING_VALUE"
        FROM DUMMY
        UNION ALL
        SELECT CAST('EXPLAIN_SCOPE' AS NVARCHAR(256)),
               CAST(1 AS INTEGER),
               CAST(NULL AS DOUBLE),
               CAST(NULL AS NVARCHAR(100))
        FROM DUMMY;

      CALL _SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN(:lt_score, :lt_model, :lt_explain_param, lt_result);

      SELECT "ID", "SCORE", "LABEL", "REASON_CODE" FROM :lt_result;
    END;
  `;

  const rows = await cds.run(sql);
  return (rows || []).map(r => ({
    id:         r.ID,
    score:      Number(r.SCORE),
    label:      r.LABEL,        // -1 = outlier (anomaly), 1 = inlier (normal)
    reasonCode: r.REASON_CODE || null
  }));
}

// ── Step 3b: LLM — Claude narrative anomaly detection ────────────────────────
// AI: LLM reasons over structured data to produce a human-readable anomaly narrative
// Banking: APRA CPS 230 requires human-readable justification for AI risk decisions
// SAP: claude-sonnet-4-6 via @langchain/anthropic — returns JSON anomaly list
async function runLlmAnomalyDetection(data, customerId) {
  const llm = new ChatAnthropic({
    model:     process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    apiKey:    process.env.ANTHROPIC_API_KEY,
    maxTokens: 400
  });

  const summary = JSON.stringify({
    dti:             data.dti,
    loans:           data.loans.slice(0, 5),
    recentPayments:  data.payments.slice(0, 10),
    collateralCount: data.collateral.length
  });

  const response = await llm.invoke([
    {
      role:    'system',
      content: `You are a banking risk analyst. Identify specific anomalies in the customer data.
Return JSON only: { "anomalies": ["anomaly 1", "anomaly 2"] }
Each anomaly max 20 words. Empty array if nothing unusual.`
    },
    { role: 'user', content: `Customer ${customerId}:\n${summary}` }
  ]);

  const text   = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const match  = text.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : { anomalies: [] };

  return {
    anomalies:  Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
    tokensIn:   response.usage_metadata?.input_tokens  || 0,
    tokensOut:  response.usage_metadata?.output_tokens || 0
  };
}

// ── Pattern Agent — main LangGraph node ──────────────────────────────────────
async function patternAgent(state) {
  const customerId = state.intent?.customerId || state.customerId;
  console.log(`  [Pattern] Analysing: ${customerId}`);

  if (!customerId) {
    console.warn('  [Pattern] No customerId — returning MEDIUM default');
    return {
      patternAssessment: {
        riskScore: 50, riskLevel: 'MEDIUM', confidence: 0.30, signal: 'unclear',
        rpt1:      { score: 50, category: null, confidence: null, success: false },
        pal:       { findings: [], anomalyCount: 0, success: false, error: 'No customerId' },
        llm:       { anomalies: [], tokensIn: 0, tokensOut: 0 },
        anomalies: []
      }
    };
  }

  // Step 1 — fetch customer data
  const data = await fetchCustomerData(customerId);
  console.log(`  [Pattern] Fetched — loans:${data.loans.length} payments:${data.payments.length} collateral:${data.collateral.length}`);

  // Step 2 — RPT-1 risk score
  let rpt1Result  = { score: 50, category: null, confidence: null, success: false };
  try {
    const r        = await callRpt1(data, customerId);
    rpt1Result     = { ...r, success: true };
    console.log(`  [Pattern/RPT-1] score:${r.score} category:${r.category} confidence:${r.confidence}`);
  } catch (e) {
    const est      = estimateScoreFromData(data);
    rpt1Result     = { ...est, success: false, error: e.message };
    console.warn(`  [Pattern/RPT-1] unavailable (${e.message}) — estimated:${est.score}`);
  }

  // Step 3 — PAL Isolation Forest (always runs)
  // AI: Train on portfolio, score customer — HANA-native, no LLM cost
  // Banking: Statistical baseline — which payments are structurally anomalous vs the portfolio
  let palResult = { findings: [], anomalyCount: 0, success: false, error: null };
  try {
    const findings = await runPalAnomalyDetection(data);
    const outliers = findings.filter(f => f.label === -1);
    palResult      = { findings, anomalyCount: outliers.length, success: true, error: null };
    console.log(`  [Pattern/PAL] outliers:${outliers.length} / ${findings.length} payment rows scored`);
  } catch (e) {
    palResult.error = e.message;
    console.warn(`  [Pattern/PAL] failed (${e.message})`);
  }

  // Step 4 — LLM narrative anomaly detection (always runs)
  // AI: Reasoning over structured data to produce APRA-ready narrative
  // Banking: CPS 230 requires human-readable justification — LLM provides this
  let llmResult = { anomalies: [], tokensIn: 0, tokensOut: 0 };
  try {
    llmResult = await runLlmAnomalyDetection(data, customerId);
    console.log(`  [Pattern/LLM] anomalies:${llmResult.anomalies.length} tokens:${llmResult.tokensIn}in/${llmResult.tokensOut}out`);
  } catch (e) {
    console.warn(`  [Pattern/LLM] failed (${e.message})`);
  }

  // Step 5 — derive combined signal and risk level
  // Combined anomaly list (used by Synthesis for APRA-ready brief)
  const palAnomalyTexts = palResult.findings
    .filter(f => f.label === -1)
    .map(f => `Payment ${f.id}: isolation score ${f.score.toFixed(3)} — ${f.reasonCode || 'anomalous pattern detected'}`);

  const combinedAnomalies = [...palAnomalyTexts, ...llmResult.anomalies];

  const riskScore  = rpt1Result.score;
  const riskLevel  = riskScore >= 75 ? 'CRITICAL' :
                     riskScore >= 50 ? 'HIGH'     :
                     riskScore >= 25 ? 'MEDIUM'   : 'LOW';
  const confidence = rpt1Result.success ? 0.85 : 0.60;
  const signal     = combinedAnomalies.length > 2 ? 'concerning' :
                     combinedAnomalies.length > 0 ? 'unclear'    : 'stable';

  console.log(`  [Pattern] Done — score:${riskScore} level:${riskLevel} signal:${signal} anomalies:${combinedAnomalies.length}`);

  return {
    patternAssessment: {
      riskScore,
      riskLevel,
      confidence,
      signal,

      // Individual method outputs — shown in educational popup side-by-side
      rpt1: rpt1Result,
      pal:  palResult,
      llm:  llmResult,

      // Combined anomaly list for downstream agents and Synthesis
      anomalies: combinedAnomalies
    },
    totalInputTokens:  llmResult.tokensIn,
    totalOutputTokens: llmResult.tokensOut
  };
}

// Routing: score < 30 → low_risk → skips Relationship + Trajectory
//          score >= 30 → high_risk → full pipeline
function routeAfterPattern(state) {
  const score = state.patternAssessment?.riskScore ?? 50;
  const route = score < 30 ? 'low_risk' : 'high_risk';
  console.log(`  [Pattern→Route] Score ${score} → ${route}`);
  return route;
}

module.exports = { patternAgent, routeAfterPattern };
