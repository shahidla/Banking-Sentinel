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
const { extractJson } = require('../utils/llm-json');

const progressEmitter = new EventEmitter();
progressEmitter.setMaxListeners(50);

// ── Step 1: Fetch customer data from HANA ────────────────────────────────────
async function fetchCustomerData(customerId) {
  const [loans, dtiRows, payments, history, portfolioOpen, portfolioCleared, thresholdRows] = await Promise.all([
    cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: customerId }).limit(1)),
    cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: customerId }).limit(100)),
    cds.run(SELECT.from('bankingsentinel.DFKKOPK').where({ GPART: customerId }).limit(100)),
    cds.run(SELECT.from('bankingsentinel.DFKKOP').columns('DAYS_OVERDUE', 'BETRW').limit(500)),
    cds.run(SELECT.from('bankingsentinel.DFKKOPK').columns('BETRW').limit(500)),
    cds.run(SELECT.from('bankingsentinel.RegulatoryThresholds').where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' }).limit(1)),
  ]);

  let collateral = [];
  if (loans.length > 0) {
    const loanIds = loans.map(l => l.LOAN_ID);
    collateral = await cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL').where({ LOAN_ID: { in: loanIds } }));
  }

  // Portfolio baseline for anomaly detection: open items (DAYS_OVERDUE may be > 0)
  // plus cleared payment history (always on-time, DAYS_OVERDUE = 0)
  const portfolio = [
    ...portfolioOpen,
    ...portfolioCleared.map(r => ({ DAYS_OVERDUE: 0, BETRW: r.BETRW })),
  ];

  const apraDtiLimit = parseFloat(thresholdRows[0]?.LIMIT_PCT) || 8.0;
  return { loans, dti: dtiRows[0] || null, payments, history, collateral, portfolio, apraDtiLimit };
}

// ── Step 2: RPT-1 — SAP tabular foundation model (consumer API at rpt.cloud.sap) ──
// AI: In-context learning — context rows are historical loan cases with a KNOWN,
//     independently-observed outcome (arrears_outcome from BCA_CREDIT_HISTORY).
//     The query row is this customer's CURRENT profile (from BCA_DTI) with
//     arrears_outcome marked [PREDICT] — RPT-1 infers the likely outcome from
//     the pattern across the 200 historical cases, not from a hardcoded formula.
// Banking: Predicts the customer's likely repayment-arrears risk category from
//          their DTI/debt/income profile, benchmarked against a historical loan book.
// SAP: POST to rpt.cloud.sap/api/predict — personal API token, no AI Core required.
//      Payload follows the SAP Cloud SDK for AI (JS) RPT-1 contract:
//      prediction_config.target_columns[] with prediction_placeholder + task_type.
const RPT1_TARGET_COLUMN = 'arrears_outcome';
const RPT1_PLACEHOLDER   = '[PREDICT]';

async function callRpt1(data, customerId) {
  const apiKey = process.env.SAP_RPT_API_KEY;
  if (!apiKey) throw new Error('SAP_RPT_API_KEY not set');

  const history = await cds.run(SELECT.from('bankingsentinel.BCA_CREDIT_HISTORY'));
  if (history.length < 2) throw new Error('Not enough context rows for RPT-1 (need >= 2)');

  const contextRows = history.map(h => ({
    case_id:        h.CASE_ID,
    dti_ratio:      parseFloat(h.DTI_RATIO)    || 0,
    breach_flag:    h.BREACH_FLAG ? 1 : 0,
    total_debt:     parseFloat(h.TOTAL_DEBT)   || 0,
    annual_income:  parseFloat(h.ANNUAL_INCOME)|| 0,
    arrears_outcome: h.ARREARS_OUTCOME
  }));

  const queryRow = {
    case_id:        `Q-${customerId}`,
    dti_ratio:      parseFloat(data.dti?.DTI_RATIO)    || 0,
    breach_flag:    data.dti?.BREACH_FLAG ? 1 : 0,
    total_debt:     parseFloat(data.dti?.TOTAL_DEBT)   || 0,
    annual_income:  parseFloat(data.dti?.ANNUAL_INCOME)|| 0,
    arrears_outcome: RPT1_PLACEHOLDER
  };

  const payload = {
    index_column: 'case_id',
    rows:         [...contextRows, queryRow],
    prediction_config: {
      target_columns: [
        { name: RPT1_TARGET_COLUMN, prediction_placeholder: RPT1_PLACEHOLDER, task_type: 'classification' }
      ]
    }
  };

  const response = await fetch('https://rpt.cloud.sap/api/predict', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(20000)
  });

  const rawResponse = await response.text();
  console.log(`  [Pattern/RPT-1] HTTP ${response.status} — ${rawResponse.length} chars — context rows:${contextRows.length}`);

  if (!response.ok) throw new Error(`RPT-1 HTTP ${response.status}: ${rawResponse}`);
  const result = JSON.parse(rawResponse);

  // Response field naming has varied across RPT-1 API revisions — check the
  // documented shapes (predictions[] array, top-level predictions, or a
  // single prediction object) and the per-row prediction value as either
  // an array of {prediction, confidence} or a single {prediction, confidence}.
  const predictions  = result.prediction?.predictions || result.predictions || [];
  const myPrediction = predictions.find(p => String(p.case_id ?? p.index ?? '') === `Q-${customerId}`) || predictions[predictions.length - 1];

  let predictionEntry = myPrediction?.[RPT1_TARGET_COLUMN];
  if (Array.isArray(predictionEntry)) predictionEntry = predictionEntry[0];

  const category   = predictionEntry?.prediction ?? predictionEntry ?? null;
  const confidence = predictionEntry?.confidence ?? null;
  if (!category) throw new Error(`RPT-1 response missing ${RPT1_TARGET_COLUMN} prediction: ${rawResponse.slice(0, 500)}`);

  // Score within defined scale: LOW=0-25, MEDIUM=26-50, HIGH=51-75, CRITICAL=76-100
  // Confidence modulates position within that band (not across bands)
  const conf = Math.min(1, Math.max(0, confidence ?? 0.5));
  const scoreFloors = { LOW: 0, MEDIUM: 26, HIGH: 51, CRITICAL: 76 };
  const floor = scoreFloors[category.toUpperCase()] ?? 26;
  const score = Math.round(floor + 24 * conf);
  return { score, category, confidence };
}

// ── Step 3a: Isolation Forest — PAL (HANA native) or scikit-learn (open-source) ────────────
// AI: Isolation Forest detects anomalies by measuring how easily a point is isolated from the rest
// Banking: Train on portfolio payment history (TOP 500 DFKKOP), score this customer's rows
// SAP: Switch via ANOMALY_ENGINE env var:
//      pal    → HANA PAL _SYS_AFL.PAL_ISOLATION_FOREST (requires 3 vCPU + ScriptServer)
//      scikit → ml/anomaly-service.py Flask service (default, works on Free Tier)

async function runPalAnomalyDetection(data, customerId) {
  if (!data.payments.length && !data.history.length) throw new Error('No payment rows for this customer to score');

  const rows = await cds.run(`CALL "PAL_RUN_ISOLATION_FOREST"(?)`, [customerId]);
  if (!rows || rows.length === 0) throw new Error('PAL returned no results — check DFKKOP rows for this customer');

  return rows.map(r => ({
    id:         r.ID,
    score:      Number(r.SCORE),
    label:      r.LABEL,
    reasonCode: r.REASON_CODE || null
  }));
}

async function runScikitAnomalyDetection(data, customerId) {
  if (!data.payments.length && !data.history.length) throw new Error('No payment rows for this customer to score');

  const url = process.env.SCIKIT_SERVICE_URL || 'http://localhost:5001';

  const portfolio = data.portfolio.map(r => ({
    days_overdue: Number(r.DAYS_OVERDUE) || 0,
    amount:       Math.abs(Number(r.BETRW) || 0)
  }));

  // Score this customer's open items (current standing) plus their cleared
  // history (always on-time) — gives the Isolation Forest a real per-customer
  // baseline so current overdue items stand out against their own track record.
  const payments = [
    ...data.payments.map((r, i) => ({
      id:           `P${i + 1}`,
      days_overdue: Number(r.DAYS_OVERDUE) || 0,
      amount:       Math.abs(Number(r.BETRW) || 0)
    })),
    ...data.history.map((r, i) => ({
      id:           `H${i + 1}`,
      days_overdue: 0,
      amount:       Math.abs(Number(r.BETRW) || 0)
    })),
  ];

  const response = await fetch(`${url}/anomaly`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ portfolio, payments }),
    signal:  AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Scikit anomaly service HTTP ${response.status}: ${text}`);
  }

  const result = await response.json();
  console.log(`  [Pattern/scikit] trained_on:${result.trained_on} scored:${result.scored}`);

  return result.results.map(r => ({
    id:         r.id,
    score:      Number(r.score),
    label:      r.label,
    reasonCode: r.reason_code || null
  }));
}

async function runAnomalyDetection(data, customerId) {
  const engine = (process.env.ANOMALY_ENGINE || 'scikit').toLowerCase();
  console.log(`  [Pattern/anomaly] engine:${engine}`);
  return engine === 'pal'
    ? runPalAnomalyDetection(data, customerId)
    : runScikitAnomalyDetection(data, customerId);
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
Each anomaly max 20 words. Empty array if nothing unusual.
IMPORTANT: The current APRA DTI threshold is ${data.apraDtiLimit.toFixed(2)}x. Use this exact value — do not use any other threshold.
IMPORTANT: DTI is a ratio — always express as Xx (e.g. 5.80x), never as a percentage.
IMPORTANT: Only flag DTI as an anomaly if the customer's DTI is AT or ABOVE the threshold. Do not mention DTI if the customer is within limits.`
    },
    { role: 'user', content: `Customer ${customerId}:\n${summary}` }
  ]);

  const text   = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const parsed = extractJson(text) || { anomalies: [] };
  if (!Array.isArray(parsed.anomalies)) console.warn('  [Pattern/LLM] could not parse anomalies JSON — using empty list. Raw:', text.substring(0, 300));

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
      const findings = await runAnomalyDetection(data, customerId);
      const outliers = findings.filter(f => f.label === -1);
      console.log(`  [Pattern/PAL] outliers:${outliers.length} / ${findings.length} payment rows scored`);
      progressEmitter.emit('progress', { sessionId: sid, source: 'pal', anomalyCount: outliers.length, totalScored: findings.length, success: true });
      return { findings, anomalyCount: outliers.length, totalScored: findings.length, success: true };
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
    : { findings: [], anomalyCount: 0, totalScored: 0, success: false, error: palSettled.reason?.message };
  const [rpt1Result, llmResult] = [rpt1Settled.value, llmSettled.value];

  // Step 5 — derive combined signal and risk level
  // Combined anomaly list (used by Synthesis for APRA-ready brief)
  const palAnomalyTexts = palResult.findings
    .filter(f => f.label === -1)
    .map(f => `Payment ${f.id}: isolation score ${f.score.toFixed(3)} — ${f.reasonCode || 'anomalous pattern detected'}`);

  const combinedAnomalies = [...palAnomalyTexts, ...llmResult.anomalies];

  const riskScore  = rpt1Result.score;
  const riskLevel  = riskScore >= 76 ? 'CRITICAL' :
                     riskScore >= 51 ? 'HIGH'     :
                     riskScore >= 26 ? 'MEDIUM'   : 'LOW';
  const confidence = rpt1Result.confidence ?? (rpt1Result.success ? 0.85 : 0.60);
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
