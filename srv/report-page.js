'use strict';

// Banking Sentinel — Risk Analysis Report (merged View Details + Report)
// Served at GET /report/:sessionId
// Shows identical content to the View Details modal: "How It Works" + "What It Found" per agent

function renderReportPage(sessionId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banking Sentinel — Risk Analysis Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --dark: #0f1117; --mid: #4A4A4A; --light: #767676; --border: #e2e6ea;
    --bg: #f8f9fb; --white: #ffffff;
    --green: #0D7A3E; --green-light: rgba(13,122,62,0.08);
    --red: #D42020; --red-light: rgba(212,32,32,0.08);
    --amber: #C47A00; --amber-light: rgba(196,122,0,0.08);
    --blue: #1A56DB; --yellow: #FFD000;
    --mono: 'Courier New', monospace; --sans: 'Segoe UI', system-ui, sans-serif;
  }
  body { font-family: var(--sans); background: var(--bg); color: var(--dark); font-size: 14px; line-height: 1.6; }
  header { background: var(--dark); color: white; padding: 18px 32px; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-size: 18px; font-weight: 700; }
  header .sub { font-family: var(--mono); font-size: 10px; color: rgba(255,255,255,0.5); letter-spacing: 1.5px; text-transform: uppercase; margin-top: 3px; }
  .print-btn { font-family: var(--mono); font-size: 10px; padding: 6px 14px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.2); cursor: pointer; border-radius: 2px; letter-spacing: 1px; text-transform: uppercase; }
  .print-btn:hover { background: rgba(255,255,255,0.15); }
  main { max-width: 1000px; margin: 0 auto; padding: 32px 24px; }
  /* KPI row */
  .kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 28px; }
  .kpi { background: var(--white); border: 1px solid var(--border); border-radius: 4px; padding: 16px; }
  .kpi-label { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--light); margin-bottom: 6px; }
  .kpi-val { font-size: 24px; font-weight: 700; color: var(--dark); line-height: 1; }
  .kpi-sub { font-size: 11px; color: var(--mid); margin-top: 4px; }
  /* Agent sections */
  .section { background: var(--white); border: 1px solid var(--border); border-radius: 4px; margin-bottom: 16px; overflow: hidden; }
  .section-hdr { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--border); background: var(--dark); color: white; }
  .section-num { font-family: var(--mono); font-size: 10px; color: rgba(255,255,255,0.4); width: 24px; }
  .section-name { font-weight: 700; font-size: 14px; }
  .section-pattern { font-family: var(--mono); font-size: 10px; color: var(--yellow); margin-left: auto; }
  /* How It Works block */
  .how-block { padding: 14px 18px; background: rgba(15,17,23,0.03); border-bottom: 1px solid var(--border); }
  .how-title { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--light); margin-bottom: 10px; }
  .how-grid { display: grid; grid-template-columns: 160px 1fr; gap: 0; }
  .how-item { display: contents; }
  .how-item .how-k { font-family: var(--mono); font-size: 10px; color: var(--amber); padding: 4px 12px 4px 0; border-bottom: 1px solid rgba(0,0,0,0.04); }
  .how-item .how-v { font-size: 12px; color: var(--mid); padding: 4px 0; border-bottom: 1px solid rgba(0,0,0,0.04); line-height: 1.5; }
  /* What It Found block */
  .found-block { padding: 16px 18px; }
  .found-title { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--light); margin-bottom: 12px; }
  /* Key-value grid */
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .kv { display: flex; flex-direction: column; padding: 5px 0; border-bottom: 1px solid rgba(0,0,0,0.05); }
  .kv-k { font-family: var(--mono); font-size: 10px; color: var(--light); text-transform: uppercase; letter-spacing: 0.5px; }
  .kv-v { font-size: 13px; color: var(--dark); margin-top: 2px; }
  .full { grid-column: 1 / -1; }
  /* Findings */
  .finding { border: 1px solid var(--border); border-left-width: 4px; border-radius: 2px; padding: 10px 14px; margin-bottom: 8px; }
  .finding.CRITICAL, .finding.HIGH { border-left-color: var(--red); background: var(--red-light); }
  .finding.MEDIUM { border-left-color: var(--amber); background: var(--amber-light); }
  .finding.LOW { border-left-color: var(--green); background: var(--green-light); }
  .finding-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  .finding-meta { font-family: var(--mono); font-size: 10px; color: var(--mid); }
  /* Severity badge */
  .badge { display: inline-block; font-family: var(--mono); font-size: 9px; padding: 2px 7px; border-radius: 2px; font-weight: 700; margin-right: 4px; }
  .badge.CRITICAL, .badge.HIGH { background: rgba(212,32,32,0.12); color: var(--red); }
  .badge.MEDIUM { background: rgba(196,122,0,0.12); color: var(--amber); }
  .badge.LOW { background: rgba(13,122,62,0.12); color: var(--green); }
  .badge.PASS { background: rgba(13,122,62,0.12); color: var(--green); }
  /* Audit trail */
  .audit-row { display: grid; grid-template-columns: 200px 1fr 120px 160px; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(0,0,0,0.05); font-family: var(--mono); font-size: 11px; color: var(--mid); align-items: center; }
  .audit-row:last-child { border-bottom: none; }
  .audit-action { color: var(--dark); font-weight: 600; }
  /* Chains / tags */
  .chain-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chain-item { font-family: var(--mono); font-size: 11px; background: var(--bg); border: 1px solid var(--border); padding: 3px 8px; border-radius: 2px; }
  /* Gaps */
  .gap-item { font-size: 12px; color: var(--amber); padding: 4px 0; border-bottom: 1px solid rgba(196,122,0,0.1); }
  .gap-item:last-child { border-bottom: none; }
  /* APRA refs */
  .ref-item { font-family: var(--mono); font-size: 11px; background: rgba(26,86,219,0.06); color: var(--blue); padding: 3px 8px; border-radius: 2px; display: inline-block; margin: 2px; }
  /* Reflection iteration */
  .reflect-iter { background: var(--bg); border: 1px solid var(--border); border-radius: 3px; padding: 10px 12px; margin-bottom: 8px; }
  .reflect-iter-hdr { font-family: var(--mono); font-size: 10px; color: var(--light); margin-bottom:6px; }
  /* Print */
  @media print {
    header { background: #0f1117 !important; -webkit-print-color-adjust: exact; }
    .section-hdr { background: #0f1117 !important; -webkit-print-color-adjust: exact; }
    .print-btn { display: none; }
    .section { break-inside: avoid; }
  }
  .loading { text-align: center; padding: 60px; color: var(--light); font-family: var(--mono); font-size: 13px; }
  .error { text-align: center; padding: 60px; color: var(--red); }
  .sub-hdr { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--light); margin: 14px 0 6px; }
</style>
</head>
<body>
<header>
  <div>
    <div><h1>Banking Sentinel &nbsp;·&nbsp; Risk Analysis Report</h1></div>
    <div class="sub">APS 221 · CPS 230 · AI Decision Trail</div>
  </div>
  <div style="display:flex;gap:8px">
    <button class="print-btn" onclick="window.open('/explain/${sessionId}','_blank')">Evidence Trail ↗</button>
    <button class="print-btn" onclick="window.print()">⎙ Print / PDF</button>
  </div>
</header>
<main id="root"><div class="loading">Loading report…</div></main>

<script>
const SESSION_ID = ${JSON.stringify(sessionId)};

// ── Static "How It Works" content — mirrors AGENT_HOW in main UI ─────────────
const AGENT_HOW = {
  intake: {
    how: [
      { k: 'AI Model',       v: 'Claude Haiku (claude-haiku-4-5-20251001) — fast, cheap, structured JSON output.' },
      { k: 'What it does',   v: 'Parses natural language risk queries, extracts customer ID, classifies intent, and routes to: RISK_ASSESS (full 6-agent pipeline), SIMPLE_QUERY (direct HANA lookup), or REJECTION (inappropriate request).' },
      { k: 'Why needed',     v: 'Risk models cannot process free text. Intake extracts structured intent as JSON — without this every downstream agent would need its own NL parser.' },
      { k: 'SAP Technology', v: 'CAP A2A service endpoint (JSON-RPC 2.0) · Solace topic banking/intake/complete' }
    ]
  },
  pattern: {
    how: [
      { k: 'AI Pattern',     v: 'Three independent risk signals run simultaneously via Promise.allSettled — no single model decides alone.' },
      { k: 'RPT-1',          v: 'rpt.cloud.sap consumer API — tabular foundation model. Classifies risk category (HIGH/MEDIUM/LOW/CRITICAL) and returns real confidence (e.g. 0.82).' },
      { k: 'Isolation Forest', v: 'Scikit-learn / HANA PAL — detects statistical payment outliers from DFKKOP records. Reports flagged rows as X/Y payment rows with z-score reason codes.' },
      { k: 'LLM Narrative',  v: 'Claude Haiku — generates human-readable anomaly narrative for CPS 230 justification, synthesising DTI, income, and overdue payment patterns.' },
      { k: 'Why three models', v: 'RPT-1 scores financial ratios. Isolation Forest catches statistical outliers. LLM catches narrative signals like income expiry risk. Each catches what the others miss.' },
      { k: 'SAP Technology', v: 'rpt.cloud.sap tabular API · HANA PAL ScriptServer (requires 3 vCPU AFL) · Solace banking/pattern/progress per sub-result' }
    ]
  },
  trajectory: {
    how: [
      { k: 'AI Pattern',           v: 'Pure formula and rule-based logic — no LLM. DTI projection is deterministic arithmetic. Conflicting signals are if/else rules.' },
      { k: 'Forward DTI formula',  v: 'futureDti = totalDebt / (annualIncome × daysToExpiry / 365). Calculated when INCOME_EXPIRY is set in BCA_DTI.' },
      { k: 'Rate-Stress DTI formula', v: 'futureDtiRateStress = totalDebt / (annualIncome - totalDebt × bufferPct). bufferPct (3%) read live from RegulatoryThresholds (RATE_STRESS_BUFFER, APG 223). Applies to every customer, independent of income expiry.' },
      { k: 'timeToBreach meaning', v: 'Negative = days already in breach (since BREACH_DATE). Positive = projected days until breach after income expiry.' },
      { k: 'Why no LLM',           v: 'Arithmetic projection does not need a language model. LLM would add latency and hallucination risk without any gain over deterministic calculation.' },
      { k: 'Execution order',      v: 'Runs BEFORE Relationship Agent intentionally — provides forward DTI position as context for the APS 221 exposure assessment.' },
      { k: 'SAP Technology',       v: 'BCA_DTI.INCOME_EXPIRY + BREACH_DATE + LoanSchedule via HANA CAP CDS · No external ML call' }
    ]
  },
  relationship: {
    how: [
      { k: 'AI Pattern',        v: 'ReAct — Claude Haiku with tool-calling iteratively reasons about graph findings and decides which tool to invoke next. Up to 6 ReAct steps.' },
      { k: 'Tools',             v: 'hana_graph_traverse (BFS via BUT050 + BCA_GUARANTOR), exposure_calculator (SUM(Loans.AMOUNT) across all connected entities), apra_threshold_check (APS 221 % of limit).' },
      { k: 'Why graph traversal', v: 'APS 221 requires exposure aggregation across ALL connected parties — parents, subsidiaries, guarantors, family trusts. SQL cannot find multi-hop relationships. SPARQL traverses up to 8 hops in one query.' },
      { k: 'Execution order',   v: 'Runs AFTER Trajectory Agent — uses forward DTI position to judge whether group exposure is material given an imminent income expiry.' },
      { k: 'SAP Technology',    v: 'GraphDB RDF triple store (sandbox = HANA Knowledge Graph Engine in production) · SPARQL 1.1 property paths · BUT050 + BCA_GUARANTOR graph edges' }
    ]
  },
  reflection: {
    how: [
      { k: 'AI Pattern',       v: 'LLM reads ALL previous agent outputs and evaluates evidence quality — not a threshold check. Returns structured evaluation with gaps and a targeted re-query hint.' },
      { k: 'Four dimensions',  v: '(1) Graph completeness — did traversal reach parent entities? (2) Signal consistency — HIGH RPT-1 + zero APS 221 = inconsistency. (3) Conflicting signals resolved? (4) Evidence trail — every risk claim backed by specific data.' },
      { k: 'Routing logic',    v: 'confidence < 0.70 → re-queries Relationship Agent with targeted reQueryHint. Max 2 re-queries. ≥ 0.70 → proceeds to Human Approval.' },
      { k: 'Why needed',       v: 'Prevents presenting incomplete findings to a risk officer. Catches cases where the graph found 0 connected parties despite an RPT-1 HIGH score — a suspicious inconsistency.' },
      { k: 'SAP Technology',   v: 'LangGraph addConditionalEdges · Claude Haiku · Langfuse quality scoring · reflectionHistory array — one entry per iteration preserved in state' }
    ]
  },
  humanApproval: {
    how: [
      { k: 'AI Pattern',        v: 'LangGraph interruptBefore pauses execution — not an agent, a deliberate break for human decision.' },
      { k: 'Why required',      v: 'APRA CPS 230 co-pilot requirement — no risk brief is sealed without a risk officer reviewing preliminary findings and explicitly signing off.' },
      { k: 'HITL OFF mode',     v: 'Default: auto-approves immediately without pausing. Toggle HITL: ON in the header to require explicit risk officer approval for every run.' },
      { k: 'State preservation', v: 'PostgresSaver saves the complete LangGraph checkpoint. Resuming the graph after approval continues from the exact same state — all agent outputs intact.' },
      { k: 'SAP Technology',    v: 'LangGraph interrupt() · PostgresSaver (PostgreSQL/Supabase) · graph.updateState() on resume · Solace banking/human/approval' }
    ]
  },
  synthesis: {
    how: [
      { k: 'AI Pattern',       v: 'Retrieval-Augmented Generation — one targeted HANA Vector search per active risk signal, then Claude Haiku generates the APRA-ready brief from the retrieved regulatory chunks.' },
      { k: 'Per-signal retrieval', v: 'Four separate searches: DTI → APS 220 DTI clauses, group exposure → APS 221 connected party limits, income expiry → CPS 230 risk management, governance → CPS 230 AI oversight. Deduped, capped at 7 chunks.' },
      { k: 'Why RAG',          v: 'Brief must cite specific APRA standards, not training data. APRA standards change — Vector store is updated via the APRA Notice button. Without RAG, LLM cites outdated training-data versions.' },
      { k: 'apraReady flag',   v: 'Deterministic — not LLM-decided. All must pass: synthesis confidence ≥ 0.70, regulatory refs retrieved, no unresolved Reflection gaps, no embedding service failure.' },
      { k: 'SAP Technology',   v: 'HANA Vector Engine cosine similarity · OpenAI text-embedding-3-small · Claude Haiku · RiskAssessments HANA entity · Langfuse RAGAS evaluation' }
    ]
  }
};

async function load() {
  const root = document.getElementById('root');
  try {
    const res = await fetch('/api/report/' + SESSION_ID);
    const d = await res.json();
    if (!res.ok) { root.innerHTML = '<div class="error">Error: ' + (d.error || res.status) + '</div>'; return; }
    root.innerHTML = render(d);
  } catch (e) {
    root.innerHTML = '<div class="error">Failed to load: ' + e.message + '</div>';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function kv(k, v) {
  return '<div class="kv"><div class="kv-k">' + k + '</div><div class="kv-v">' + (v ?? '—') + '</div></div>';
}
function badge(sev) {
  return '<span class="badge ' + (sev || '') + '">' + (sev || '—') + '</span>';
}
function pct(n) { return n != null ? Math.round(n * 100) + '%' : '—'; }
function num(n, dp) { return n != null ? Number(n).toFixed(dp ?? 0) : '—'; }

function howBlock(key) {
  const h = AGENT_HOW[key];
  if (!h) return '';
  return '<div class="how-block"><div class="how-title">How It Works</div>' +
    '<div class="how-grid">' +
      h.how.map(item =>
        '<div class="how-item">' +
          '<div class="how-k">' + item.k + '</div>' +
          '<div class="how-v">' + item.v + '</div>' +
        '</div>'
      ).join('') +
    '</div></div>';
}

function section(n, name, pattern, howKey, bodyHtml) {
  return '<div class="section">' +
    '<div class="section-hdr">' +
      '<span class="section-num">0' + n + '</span>' +
      '<span class="section-name">' + name + '</span>' +
      '<span class="section-pattern">' + pattern + '</span>' +
    '</div>' +
    howBlock(howKey) +
    '<div class="found-block"><div class="found-title">What It Found</div>' + bodyHtml + '</div>' +
  '</div>';
}

// ── Main render ───────────────────────────────────────────────────────────────
function render(d) {
  const pat   = d.patternAssessment  || {};
  const traj  = d.trajectoryAnalysis || {};
  const rel   = d.relationshipMap    || {};
  const reflection     = d.reflectionEvaluation || {};
  const reflectionHist = d.reflectionHistory    || [];
  const int_  = d.intent             || {};
  const synth_finds = d.findings     || [];
  const refs   = d.regulatoryRefs    || [];
  const recs   = d.recommendations   || [];
  const uncert = d.uncertainties     || [];
  const trail  = d.auditTrail        || [];

  const riskColor = { CRITICAL:'#D42020', HIGH:'#D42020', MEDIUM:'#C47A00', LOW:'#0D7A3E' }[d.riskLevel] || '#888';

  let html = '';

  // ── KPI row ─────────────────────────────────────────────────────────────────
  html += '<div class="kpi-row">';
  html += '<div class="kpi"><div class="kpi-label">Risk Score</div>' +
    '<div class="kpi-val" style="color:' + riskColor + '">' + (d.riskScore ?? '—') + '</div>' +
    '<div class="kpi-sub">' + (d.riskLevel || '—') + ' RISK</div></div>';

  html += '<div class="kpi"><div class="kpi-label">Confidence</div>' +
    '<div class="kpi-val">' + pct(d.confidence) + '</div>' +
    '<div class="kpi-sub">Synthesis confidence</div></div>';

  html += '<div class="kpi"><div class="kpi-label">APRA Status</div>' +
    '<div class="kpi-val" style="font-size:18px;color:' + (d.apraReady ? '#0D7A3E' : '#C47A00') + '">' +
      (d.apraReady ? '✓ Ready' : '⚠ Review') +
    '</div><div class="kpi-sub">' + (d.approvedBy || 'Auto-approved') + '</div></div>';

  html += '<div class="kpi"><div class="kpi-label">Tokens</div>' +
    '<div class="kpi-val" style="font-size:18px">' + ((d.totalInputTokens || 0) + (d.totalOutputTokens || 0)).toLocaleString() + '</div>' +
    '<div class="kpi-sub">' + (d.totalInputTokens || 0) + ' in · ' + (d.totalOutputTokens || 0) + ' out</div></div>';

  html += '<div class="kpi"><div class="kpi-label">Cost · Latency</div>' +
    '<div class="kpi-val" style="font-size:18px">AUD ' + (d.totalCostAUD || 0).toFixed(4) + '</div>' +
    '<div class="kpi-sub">' + Math.round((d.totalLatencyMs || 0) / 1000) + 's total</div></div>';
  html += '</div>';

  // ── Customer + Session ──────────────────────────────────────────────────────
  html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:4px;padding:14px 18px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">' +
    kv('Customer', d.partner) +
    kv('Session', SESSION_ID) +
    kv('Generated', new Date(d.generatedAt).toLocaleString()) +
    kv('Standard', d.standard || 'CPS 230 · APS 221') +
    kv('Query', d.query) +
    (d.trbkTables ? kv('SAP Tables', d.trbkTables.join(' · ')) : '') +
  '</div>';

  // ── 01 Intake ────────────────────────────────────────────────────────────────
  html += section(1, 'Intake Agent', 'Router / Classifier', 'intake',
    '<div class="kv-grid">' +
      kv('Query', d.query) +
      kv('Customer ID', d.partner) +
      kv('Intent', int_.isRiskAnalysis ? 'Risk Analysis' : (int_.isSimpleDataQuery ? 'Simple Query' : '—')) +
      kv('Route', int_.isRiskAnalysis ? 'RISK_ASSESS → full 6-agent pipeline' : (int_.isSimpleDataQuery ? 'SIMPLE_QUERY' : '—')) +
      kv('Inappropriate', int_.isInappropriateRequest ? '✗ Rejected' : '✓ Allowed') +
      kv('Description', int_.description || '—') +
    '</div>');

  // ── 02 Pattern Agent ─────────────────────────────────────────────────────────
  const rpt1 = pat.rpt1 || {};
  const pal  = pat.pal  || {};
  const llm  = pat.llm  || {};
  html += section(2, 'Pattern Agent', 'Parallel Multi-Model Execution', 'pattern',
    '<div class="kv-grid">' +
      kv('Overall Signal', pat.signal || '—') +
      kv('RPT-1 Category', rpt1.category || '—') +
      kv('RPT-1 Score', num(rpt1.score, 1)) +
      kv('RPT-1 Confidence', pct(rpt1.confidence)) +
      kv('Scikit-IF Flagged', pal.success === false ? ((pal.error || '').includes('No payment rows') ? 'No payment data — customer has no DFKKOP records' : 'Unavailable — scikit service not running') : (pal.anomalyCount != null ? pal.anomalyCount + ' / ' + (pal.totalScored ?? '?') + ' payment rows' : '—')) +
      kv('Scikit-IF Outliers', (pal.findings || []).filter(f => f.label === -1).map(f => 'row ' + f.id + (f.reasonCode ? ' (' + f.reasonCode + ')' : '') + ' score:' + (f.score != null ? Number(f.score).toFixed(3) : '?')).join(', ') || 'None') +
      kv('LLM Anomalies', (llm.anomalies || []).length + ' detected') +
    '</div>' +
    ((llm.anomalies || []).length ?
      '<div class="sub-hdr">LLM Anomaly Narrative</div>' +
      (llm.anomalies || []).map((a, i) => '<div style="padding:5px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:13px">' + (i+1) + '. ' + a + '</div>').join('') : ''));

  // ── 03 Trajectory Agent ──────────────────────────────────────────────────────
  html += section(3, 'Trajectory Agent', 'Deterministic Rule Engine (No LLM)', 'trajectory',
    '<div class="kv-grid">' +
      kv('Current DTI', traj.currentDti != null ? num(traj.currentDti, 2) + 'x' : '—') +
      kv('Forward DTI', traj.futureDti  != null ? num(traj.futureDti, 2) + 'x' : '—') +
      kv('Rate-Stress DTI (+3%, APG 223)', traj.futureDtiRateStress != null ? num(traj.futureDtiRateStress, 2) + 'x' : '—') +
      kv('Days to Income Expiry', traj.daysToExpiry  != null ? traj.daysToExpiry  + ' days' : '—') +
      kv('Time to Breach',        traj.timeToBreach  != null ? traj.timeToBreach  + ' days' : '—') +
      kv('Forward Position', traj.forwardPosition || '—') +
    '</div>' +
    ((traj.conflictingSignals || []).length ?
      '<div class="sub-hdr">Conflicting Signals</div>' +
      (traj.conflictingSignals || []).map((s, i) => '<div style="padding:5px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:13px">' + (i+1) + '. ' + s + '</div>').join('') : ''));

  // ── 04 Relationship Agent ────────────────────────────────────────────────────
  const rnodes = rel.nodes || [];
  const redges = rel.edges || [];
  html += section(4, 'Relationship Agent', 'ReAct Loop — SPARQL Graph Traversal', 'relationship',
    '<div class="kv-grid">' +
      kv('Connected Parties', rnodes.length || '—') +
      kv('Max Hops', rel.hops != null ? rel.hops : '—') +
      kv('Group Exposure', rel.groupExposure != null ? 'AUD ' + Number(rel.groupExposure).toLocaleString(undefined, {maximumFractionDigits:0}) : '—') +
      kv('APS 221 Utilisation', rel.aps221Pct != null ? num(rel.aps221Pct, 1) + '% of limit' : '—') +
      kv('Confidence', pct(rel.confidence)) +
      kv('Finding', rel.finding || '—') +
    '</div>' +
    (rnodes.length ? '<div class="sub-hdr">Connected Entities</div><div class="chain-list">' + rnodes.map(n => '<span class="chain-item">' + n + '</span>').join('') + '</div>' : '') +
    (redges.length ? '<div class="sub-hdr">Connected Risk Chain (' + redges.length + ' edges)</div>' +
      '<div style="font-family:var(--mono);font-size:11px;color:var(--mid);margin-top:4px">' +
        redges.map(e => '→ ' + e.from + ' → ' + e.to + (e.type ? ' [' + e.type + ']' : '') + (e.hop ? ' · hop ' + e.hop : '')).join('<br>') +
      '</div>' : ''));

  // ── 05 Reflection ────────────────────────────────────────────────────────────
  html += section(5, 'Reflection', 'Epistemic Self-Evaluation', 'reflection',
    '<div class="kv-grid">' +
      kv('Overall Confidence', pct(reflection.overallConfidence)) +
      kv('Re-query Count', d.requeryCount != null ? d.requeryCount + ' / 2 max' : '—') +
      kv('Re-query Hint', d.reQueryHint || 'None') +
      kv('Reasoning', reflection.reasoning || '—') +
    '</div>' +
    ((reflection.gaps || []).length ?
      '<div class="sub-hdr">Evidence Gaps</div>' +
      (reflection.gaps || []).map(g => '<div class="gap-item">⚠ ' + g + '</div>').join('') : '') +
    (reflectionHist.length > 1 ?
      '<div class="sub-hdr">Re-query History (' + reflectionHist.length + ' iterations)</div>' +
      reflectionHist.map((iter, i) => '<div class="reflect-iter">' +
        '<div class="reflect-iter-hdr">Iteration ' + (i+1) + ' · confidence: ' + pct(iter.overallConfidence) + '</div>' +
        '<div style="font-size:12px;color:var(--mid)">' + (iter.reasoning || '—') + '</div>' +
        ((iter.gaps || []).length ? '<div style="margin-top:6px">' + iter.gaps.map(g => '<div class="gap-item">⚠ ' + g + '</div>').join('') + '</div>' : '') +
      '</div>').join('') : ''));

  // ── 06 Human Approval ────────────────────────────────────────────────────────
  const hitlMode = d.hitlEnabled ? 'HITL: ON — manual approval required' : 'HITL: OFF — auto-approved';
  html += section(6, 'Human Approval', 'Human-in-the-Loop (CPS 230)', 'humanApproval',
    '<div class="kv-grid">' +
      kv('Mode', hitlMode) +
      kv('Approved By', d.approvedBy || (d.hitlEnabled ? 'Pending' : 'Auto-approved (HITL OFF)')) +
      kv('CPS 230 Requirement', 'Risk officer sign-off before APRA brief is sealed') +
    '</div>');

  // ── 07 Synthesis ─────────────────────────────────────────────────────────────
  html += section(7, 'Synthesis Agent', 'RAG + Brief Generation', 'synthesis',
    '<div class="kv-grid">' +
      kv('Risk Score', d.riskScore != null ? d.riskScore + ' / 100' : '—') +
      kv('Risk Level', d.riskLevel || '—') +
      kv('Confidence', pct(d.confidence)) +
      kv('APRA Ready', d.apraReady ? '✓ Yes' : '✗ No — ' + (uncert[0] || 'see uncertainties')) +
    '</div>' +
    (refs.length ?
      '<div class="sub-hdr">Regulatory References Retrieved</div>' +
      '<div style="margin-bottom:12px">' + refs.map(r => '<span class="ref-item">' + r + '</span>').join('') + '</div>' : '') +
    (synth_finds.length ?
      '<div class="sub-hdr">Findings (' + synth_finds.length + ')</div>' +
      synth_finds.map(f => '<div class="finding ' + (f.severity || '') + '">' +
        badge(f.severity) +
        '<span class="finding-title">' + (f.finding || f.description || '') + '</span>' +
        '<div class="finding-meta" style="margin-top:4px">' +
          (f.standard ? f.standard + ' · ' : '') +
          (f.evidenceSource ? f.evidenceSource + ' · ' : '') +
          pct(f.confidence) + ' confidence' +
        '</div></div>').join('') : '') +
    (recs.length ?
      '<div class="sub-hdr">Recommendations</div>' +
      recs.map((r,i) => '<div style="padding:5px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:13px">' + (i+1) + '. ' + r + '</div>').join('') : '') +
    (uncert.length ?
      '<div class="sub-hdr">Uncertainties</div>' +
      uncert.map(u => '<div style="font-size:12px;color:var(--amber);padding:3px 0">⚠ ' + u + '</div>').join('') : ''));

  // ── Audit Trail (CPS 230) ────────────────────────────────────────────────────
  if (trail.length) {
    html += '<div class="section"><div class="section-hdr">' +
      '<span class="section-num">—</span>' +
      '<span class="section-name">Audit Trail</span>' +
      '<span class="section-pattern">CPS 230 · Full Decision Log</span>' +
    '</div><div class="found-block">' +
      '<div class="audit-row" style="font-weight:700;color:var(--dark);font-family:var(--mono);font-size:11px">' +
        '<span>Action</span><span>Model</span><span>Tokens</span><span>Cost · Latency</span>' +
      '</div>' +
      trail.map(t =>
        '<div class="audit-row">' +
          '<span class="audit-action">' + (t.action || '—') + '</span>' +
          '<span>' + (t.model || '—') + '</span>' +
          '<span>' + (t.tokensIn || 0) + ' in / ' + (t.tokensOut || 0) + ' out</span>' +
          '<span>AUD ' + Number(t.costAUD || 0).toFixed(4) + ' · ' + (t.latencyMs || 0) + 'ms</span>' +
        '</div>'
      ).join('') +
      '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:24px;font-family:var(--mono);font-size:11px;color:var(--mid)">' +
        '<span>Total cost: <strong>AUD ' + Number(d.totalCostAUD || 0).toFixed(4) + '</strong></span>' +
        '<span>Total latency: <strong>' + Math.round((d.totalLatencyMs || 0) / 1000) + 's</strong></span>' +
        '<span>Total tokens: <strong>' + ((d.totalInputTokens || 0) + (d.totalOutputTokens || 0)).toLocaleString() + '</strong></span>' +
      '</div>' +
    '</div></div>';
  }

  html += '<div style="font-family:var(--mono);font-size:10px;color:var(--light);margin-top:16px;text-align:right">' +
    'Generated: ' + new Date(d.generatedAt).toLocaleString() + ' · Session: ' + SESSION_ID +
  '</div>';

  return html;
}

load();
</script>
</body>
</html>`;
}

module.exports = { renderReportPage };
