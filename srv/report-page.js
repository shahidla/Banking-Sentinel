'use strict';

// Banking Sentinel — Risk Analysis Report HTML page
// Served at GET /report/:sessionId — fetches /api/report/:sessionId and renders full per-agent trail

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
  main { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
  /* KPI row */
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .kpi { background: var(--white); border: 1px solid var(--border); border-radius: 4px; padding: 16px; }
  .kpi-label { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--light); margin-bottom: 6px; }
  .kpi-val { font-size: 26px; font-weight: 700; color: var(--dark); line-height: 1; }
  .kpi-sub { font-size: 11px; color: var(--mid); margin-top: 4px; }
  /* Agent sections */
  .section { background: var(--white); border: 1px solid var(--border); border-radius: 4px; margin-bottom: 16px; overflow: hidden; }
  .section-hdr { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--border); background: var(--bg); }
  .section-num { font-family: var(--mono); font-size: 10px; color: var(--light); width: 20px; }
  .section-name { font-weight: 700; font-size: 14px; }
  .section-pattern { font-family: var(--mono); font-size: 10px; color: var(--amber); margin-left: auto; }
  .section-body { padding: 16px 18px; }
  /* Key-value grid */
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .kv { display: flex; flex-direction: column; padding: 5px 0; border-bottom: 1px solid rgba(0,0,0,0.05); }
  .kv-k { font-family: var(--mono); font-size: 10px; color: var(--light); text-transform: uppercase; letter-spacing: 0.5px; }
  .kv-v { font-size: 13px; color: var(--dark); margin-top: 2px; }
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
  .audit-row { display: grid; grid-template-columns: 180px 1fr 1fr 1fr; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(0,0,0,0.05); font-family: var(--mono); font-size: 11px; color: var(--mid); align-items: center; }
  .audit-row:last-child { border-bottom: none; }
  .audit-action { color: var(--dark); font-weight: 600; }
  /* Chains */
  .chain-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chain-item { font-family: var(--mono); font-size: 11px; background: var(--bg); border: 1px solid var(--border); padding: 3px 8px; border-radius: 2px; }
  /* Gaps */
  .gap-item { font-size: 12px; color: var(--amber); padding: 4px 0; border-bottom: 1px solid rgba(196,122,0,0.1); }
  .gap-item:last-child { border-bottom: none; }
  /* APRA refs */
  .ref-item { font-family: var(--mono); font-size: 11px; background: rgba(26,86,219,0.06); color: var(--blue); padding: 3px 8px; border-radius: 2px; display: inline-block; margin: 2px; }
  /* Section col full */
  .full { grid-column: 1 / -1; }
  /* Print */
  @media print {
    header { background: #0f1117 !important; -webkit-print-color-adjust: exact; }
    .print-btn { display: none; }
    .section { break-inside: avoid; }
  }
  /* Loading / error */
  .loading { text-align: center; padding: 60px; color: var(--light); font-family: var(--mono); font-size: 13px; }
  .error { text-align: center; padding: 60px; color: var(--red); }
</style>
</head>
<body>
<header>
  <div>
    <div><h1>Banking Sentinel &nbsp;·&nbsp; Risk Analysis Report</h1></div>
    <div class="sub">APS 221 · CPS 230 · AI Decision Trail</div>
  </div>
  <button class="print-btn" onclick="window.print()">⎙ Print / PDF</button>
</header>
<main id="root"><div class="loading">Loading report…</div></main>

<script>
const SESSION_ID = ${JSON.stringify(sessionId)};

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

function kv(k, v) {
  return '<div class="kv"><div class="kv-k">' + k + '</div><div class="kv-v">' + (v ?? '—') + '</div></div>';
}

function badge(sev) {
  return '<span class="badge ' + (sev || '') + '">' + (sev || '—') + '</span>';
}

function pct(n) { return n != null ? Math.round(n * 100) + '%' : '—'; }
function num(n, dp) { return n != null ? Number(n).toFixed(dp ?? 0) : '—'; }

function section(num, name, pattern, bodyHtml) {
  return '<div class="section">' +
    '<div class="section-hdr">' +
      '<span class="section-num">0' + num + '</span>' +
      '<span class="section-name">' + name + '</span>' +
      '<span class="section-pattern">' + pattern + '</span>' +
    '</div><div class="section-body">' + bodyHtml + '</div></div>';
}

function render(d) {
  const synth = d;
  const pat   = d.patternAssessment || {};
  const traj  = d.trajectoryAnalysis || {};
  const rel   = d.relationshipMap   || {};
  const rag   = d.selfRagEvaluation || {};
  const int_  = d.intent            || {};

  const riskColor = { CRITICAL:'#D42020', HIGH:'#D42020', MEDIUM:'#C47A00', LOW:'#0D7A3E' }[d.riskLevel] || '#888';

  let html = '';

  // ── KPI row ─────────────────────────────────────────────────────────────────
  html += '<div class="kpi-row">';
  html += '<div class="kpi"><div class="kpi-label">Risk Score</div><div class="kpi-val" style="color:' + riskColor + '">' + (d.riskScore ?? '—') + '</div><div class="kpi-sub">' + (d.riskLevel || '—') + ' · ' + pct(d.confidence) + ' confidence</div></div>';
  html += '<div class="kpi"><div class="kpi-label">Customer</div><div class="kpi-val" style="font-size:18px">' + (d.partner || '—') + '</div><div class="kpi-sub">Session: ' + (d.sessionId || '').substring(0, 12) + '…</div></div>';
  html += '<div class="kpi"><div class="kpi-label">APRA Status</div><div class="kpi-val" style="font-size:18px;color:' + (d.apraReady ? '#0D7A3E' : '#C47A00') + '">' + (d.apraReady ? '✓ Ready' : '⚠ Review') + '</div><div class="kpi-sub">' + (d.approvedBy || 'Awaiting approval') + '</div></div>';
  html += '<div class="kpi"><div class="kpi-label">Tokens</div><div class="kpi-val" style="font-size:18px">' + ((d.totalInputTokens || 0) + (d.totalOutputTokens || 0)).toLocaleString() + '</div><div class="kpi-sub">' + (d.totalInputTokens || 0) + ' in · ' + (d.totalOutputTokens || 0) + ' out</div></div>';
  html += '</div>';

  // ── 01 Intake ────────────────────────────────────────────────────────────────
  html += section(1, 'Intake Agent', 'Router / Classifier',
    '<div class="kv-grid">' +
      kv('Query', d.query) +
      kv('Customer ID', d.partner) +
      kv('Risk Analysis', int_.isRiskAnalysis ? '✓ Yes' : '✗ No') +
      kv('Simple Query', int_.isSimpleDataQuery ? '✓ Yes' : '✗ No') +
      kv('Description', int_.description || '—') +
    '</div>');

  // ── 02 Pattern Agent ─────────────────────────────────────────────────────────
  const rpt = pat.rpt1 || {};
  const pal = pat.pal  || {};
  const llm = pat.llm  || {};
  html += section(2, 'Pattern Agent', 'Parallel Multi-Model Execution',
    '<div class="kv-grid">' +
      kv('Overall Signal', pat.signal || '—') +
      kv('Risk Score (RPT-1)', num(rpt.score, 1)) +
      kv('RPT-1 Category', rpt.category || '—') +
      kv('RPT-1 Confidence', pct(rpt.confidence)) +
      kv('Scikit-IF Anomalies', pal.anomalyCount != null ? pal.anomalyCount + '/' + (pal.findings?.length || 0) + ' rows flagged' : '—') +
      kv('LLM Anomalies', (llm.anomalies || []).length + ' detected') +
      '<div class="kv full"><div class="kv-k">Anomaly Narratives</div><div class="kv-v" style="white-space:pre-wrap">' +
        ((llm.anomalies || []).join('\\n') || '—') +
      '</div></div>' +
    '</div>');

  // ── 03 Trajectory Agent ──────────────────────────────────────────────────────
  html += section(3, 'Trajectory Agent', 'Deterministic Rule Engine',
    '<div class="kv-grid">' +
      kv('Current DTI', num(traj.currentDti, 2) + 'x') +
      kv('Future DTI', traj.futureDti != null ? num(traj.futureDti, 2) + 'x' : 'N/A') +
      kv('Days to Expiry', traj.daysToExpiry != null ? traj.daysToExpiry + ' days' : 'N/A') +
      kv('Time to Breach', traj.timeToBreach != null ? traj.timeToBreach + ' days' : 'N/A') +
      kv('Forward Position', traj.forwardPosition || '—') +
      '<div class="kv full"><div class="kv-k">Conflicting Signals</div><div class="kv-v">' +
        ((traj.conflictingSignals || []).map(s => '· ' + s).join('<br>') || '—') +
      '</div></div>' +
    '</div>');

  // ── 04 Relationship Agent ────────────────────────────────────────────────────
  const nodes = rel.nodes || [];
  const edges = rel.edges || [];
  html += section(4, 'Relationship Agent', 'ReAct Loop — SPARQL Graph Traversal',
    '<div class="kv-grid">' +
      kv('Connected Parties', nodes.length) +
      kv('Group Exposure', rel.groupExposure != null ? 'AUD ' + Number(rel.groupExposure).toLocaleString(undefined, {maximumFractionDigits:0}) : '—') +
      kv('APS 221 Utilisation', rel.aps221Pct != null ? num(rel.aps221Pct, 1) + '%' : '—') +
      kv('Confidence', pct(rel.confidence)) +
    '</div>' +
    (nodes.length ? '<div style="margin-top:10px"><div class="kv-k">Connected Entities</div><div class="chain-list">' + nodes.map(n => '<span class="chain-item">' + n + '</span>').join('') + '</div></div>' : '') +
    (edges.length ? '<div style="margin-top:10px"><div class="kv-k">Graph Edges (' + edges.length + ')</div><div style="margin-top:6px;font-family:var(--mono);font-size:11px;color:var(--mid)">' +
        edges.map(e => e.from + ' → ' + e.to + (e.type ? ' [' + e.type + ']' : '') + (e.hop ? ' hop ' + e.hop : '')).join('<br>') +
      '</div></div>' : ''));

  // ── 05 Self-RAG ─────────────────────────────────────────────────────────────
  html += section(5, 'Self-RAG', 'Epistemic Self-Evaluation',
    '<div class="kv-grid">' +
      kv('Overall Confidence', pct(rag.overallConfidence)) +
      kv('Re-query Count', d.requeryCount || 0) +
      kv('Re-query Hint', d.reQueryHint || 'None') +
      kv('Reasoning', rag.reasoning || '—') +
    '</div>' +
    (rag.gaps && rag.gaps.length ? '<div style="margin-top:12px"><div class="kv-k" style="margin-bottom:6px">Evidence Gaps</div>' +
        rag.gaps.map(g => '<div class="gap-item">⚠ ' + g + '</div>').join('') +
      '</div>' : ''));

  // ── 06 Synthesis ─────────────────────────────────────────────────────────────
  const refs  = d.regulatoryRefs  || [];
  const recs  = d.recommendations || [];
  const uncert = d.uncertainties  || [];
  const finds  = d.findings       || [];
  html += section(6, 'Synthesis Agent', 'RAG + Brief Generation',
    (refs.length ? '<div style="margin-bottom:12px">' + refs.map(r => '<span class="ref-item">' + r + '</span>').join('') + '</div>' : '') +
    '<div style="margin-bottom:14px">' +
      finds.map(f => '<div class="finding ' + (f.severity || '') + '">' +
        badge(f.severity) + '<span class="finding-title">' + (f.finding || f.description || '') + '</span>' +
        '<div class="finding-meta" style="margin-top:4px">' +
          (f.standard ? f.standard + ' · ' : '') +
          (f.evidenceSource ? f.evidenceSource + ' · ' : '') +
          pct(f.confidence) + ' confidence' +
        '</div></div>').join('') +
    '</div>' +
    (recs.length ? '<div class="kv-k" style="margin-bottom:8px">Recommendations</div>' +
        recs.map((r,i) => '<div style="padding:5px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:13px">' + (i+1) + '. ' + r + '</div>').join('') : '') +
    (uncert.length ? '<div class="kv-k" style="margin-top:14px;margin-bottom:8px">Uncertainties</div>' +
        uncert.map(u => '<div style="font-size:12px;color:var(--amber);padding:3px 0">⚠ ' + u + '</div>').join('') : ''));

  // ── Audit Trail ──────────────────────────────────────────────────────────────
  const trail = d.auditTrail || [];
  if (trail.length) {
    html += '<div class="section"><div class="section-hdr">' +
      '<span class="section-num">—</span>' +
      '<span class="section-name">Audit Trail · CPS 230</span>' +
    '</div><div class="section-body">' +
      '<div class="audit-row" style="font-weight:700;color:var(--dark)"><span>Action</span><span>Model</span><span>Tokens</span><span>Cost / Latency</span></div>' +
      trail.map(t => '<div class="audit-row">' +
        '<span class="audit-action">' + (t.action || '—') + '</span>' +
        '<span>' + (t.model || '—') + '</span>' +
        '<span>' + (t.tokensIn || 0) + ' in / ' + (t.tokensOut || 0) + ' out</span>' +
        '<span>AUD ' + (t.costAUD || 0).toFixed(4) + ' · ' + (t.latencyMs || 0) + 'ms</span>' +
      '</div>').join('') +
    '</div></div>';
  }

  html += '<div style="font-family:var(--mono);font-size:10px;color:var(--light);margin-top:16px;text-align:right">Generated: ' + new Date(d.generatedAt).toLocaleString() + ' · Session: ' + SESSION_ID + '</div>';
  return html;
}

load();
</script>
</body>
</html>`;
}

module.exports = { renderReportPage };
