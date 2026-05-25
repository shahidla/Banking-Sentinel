// Banking Sentinel — Pattern Agent (Agent 2)
// AI: First specialist agent — establishes baseline risk signal before graph traversal
// Banking: RPT-1 quantifies the risk score; PAL finds statistical outliers; LLM narrates them
// SAP: RPT-1 via rpt.cloud.sap consumer API + HANA PAL Isolation Forest + Claude LLM
//      All three always run. Educational popup shows all three outputs side-by-side.

'use strict';
const cds = require('@sap/cds');
const { EventEmitter } = require('events');
const { startSpan, endSpan } = require('../observability/langfuse-client');
const { ChatAnthropic } = require('@langchain/anthropic');

const progressEmitter = new EventEmitter();
progressEmitter.setMaxListeners(50);

// ── Step 1: Fetch customer data from HANA ────────────────────────────────────
async function fetchCustomerData(customerId) {
  const [loans, dtiRows, payments] = await Promise.all([
    cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: customerId }).limit(1)),
    cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: customerId }).limit(100)),
  ]);

  let collateral = [];
  if (loans.length > 0) {
    const loanIds = loans.map(l => l.LOAN_ID);
    collateral = await cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL').where({ LOAN_ID: { in: loanIds } }));
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

// ── Step 3a: PAL — HANA Isolation Forest (train on portfolio, score one customer) ──
// AI: Isolation Forest detects anomalies by measuring how easily a point is isolated
// Banking: Train on all DFKKOP payment records, score this customer's rows
//          PAL_ISOLATION_FOREST_EXPLAIN returns REASON_CODE — which feature drove the anomaly
// SAP: PAL_RUN_ISOLATION_FOREST stored procedure — self-contained, reads from DFKKOP directly,
//      returns result set to caller. No ScriptServer, no caller temp tables, no connection issue.
async function runPalAnomalyDetection(data, customerId) {
  if (!data.payments.length) throw new Error('No payment rows for this customer to score');

  const rows = await cds.run(`CALL "PAL_RUN_ISOLATION_FOREST"(?)`, [customerId]);

  if (!rows || rows.length === 0) throw new Error('PAL returned no results — check DFKKOP rows for this customer');

  return rows.map(r => ({
    id:         r.ID,
    score:      Number(r.SCORE),
    label:      r.LABEL,
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
  const span = startSpan(state.traceId, 'pattern-agent', { customerId });
  console.log(`  [Pattern] Analysing: ${customerId}`);

  if (!customerId) throw new Error('Pattern Agent: no customerId in state — intake agent must extract it');

  // Step 1 — fetch customer data
  const data = await fetchCustomerData(customerId);
  console.log(`  [Pattern] Fetched — loans:${data.loans.length} payments:${data.payments.length} collateral:${data.collateral.length}`);

  // Steps 2-4 — RPT-1, PAL, LLM all run in parallel. Each emits a progress event
  // the moment it settles so the UI can bold each result as it arrives.
  const sid = state.sessionId;

  const rpt1Promise = (async () => {
    try {
      const r = await callRpt1(data, customerId);
      console.log(`  [Pattern/RPT-1] score:${r.score} category:${r.category} confidence:${r.confidence}`);
      progressEmitter.emit('progress', { sessionId: sid, source: 'rpt1', score: r.score, category: r.category, confidence: r.confidence, success: true });
      return { ...r, success: true };
    } catch (e) {
      progressEmitter.emit('progress', { sessionId: sid, source: 'rpt1', success: false, error: e.message });
      throw e;
    }
  })();

  const palPromise = (async () => {
    try {
      const findings = await runPalAnomalyDetection(data, customerId);
      const outliers = findings.filter(f => f.label === -1);
      console.log(`  [Pattern/PAL] outliers:${outliers.length} / ${findings.length} payment rows scored`);
      progressEmitter.emit('progress', { sessionId: sid, source: 'pal', anomalyCount: outliers.length, success: true });
      return { findings, anomalyCount: outliers.length, success: true };
    } catch (e) {
      progressEmitter.emit('progress', { sessionId: sid, source: 'pal', success: false, error: e.message });
      throw e;
    }
  })();

  const llmPromise = (async () => {
    try {
      const r = await runLlmAnomalyDetection(data, customerId);
      console.log(`  [Pattern/LLM] anomalies:${r.anomalies.length} tokens:${r.tokensIn}in/${r.tokensOut}out`);
      progressEmitter.emit('progress', { sessionId: sid, source: 'llm', anomalyCount: r.anomalies.length, success: true });
      return r;
    } catch (e) {
      progressEmitter.emit('progress', { sessionId: sid, source: 'llm', success: false, error: e.message });
      throw e;
    }
  })();

  // allSettled so all three emit progress events before we check failures
  const [rpt1Settled, palSettled, llmSettled] = await Promise.allSettled([rpt1Promise, palPromise, llmPromise]);

  // RPT-1 and LLM are blocking — PAL requires HANA Cloud ScriptServer (3 vCPU, not on Free Tier)
  // PAL failure is non-fatal: upgrade to paid HANA Cloud + grant AFL__SYS_AFL_AFLPAL_EXECUTE to #OO user
  const failures = [
    rpt1Settled.status === 'rejected' && `RPT-1: ${rpt1Settled.reason?.message}`,
    llmSettled.status  === 'rejected' && `LLM: ${llmSettled.reason?.message}`
  ].filter(Boolean);
  if (failures.length > 0) throw new Error(`Pattern Agent failed:\n${failures.join('\n')}`);
  if (palSettled.status === 'rejected')
    console.warn(`  [Pattern/PAL] Skipped (ScriptServer unavailable — needs 3 vCPU paid HANA Cloud): ${palSettled.reason?.message}`);

  const palResult = palSettled.status === 'fulfilled'
    ? palSettled.value
    : { findings: [], anomalyCount: 0, success: false, error: palSettled.reason?.message };
  const [rpt1Result, llmResult] = [rpt1Settled.value, llmSettled.value];

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

  endSpan(span, { riskScore, riskLevel, signal, anomalyCount: combinedAnomalies.length }, {
    rpt1Success: rpt1Result.success,
    palAnomalies: palResult.anomalyCount,
    llmAnomalies: llmResult.anomalies?.length,
    tokensIn: llmResult.tokensIn,
    tokensOut: llmResult.tokensOut
  });

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

module.exports = { patternAgent, routeAfterPattern, progressEmitter };
