'use strict';
// Banking Sentinel — Evidence Explanation Generator
// Called via GET /api/explain-stream/:sessionId (SSE)
// Pulls raw HANA data, streams LLM-written evidence sections to the browser

const cds = require('@sap/cds');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

function mkClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Raw data pull ─────────────────────────────────────────────────────────────
async function pullRawData(customerId) {
  const [dtiRows, bpRows, loans, payments, thresholds, limits] = await Promise.all([
    cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.BusinessPartners').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: customerId })),
    cds.run(SELECT.from('bankingsentinel.RegulatoryThresholds')),
    cds.run(SELECT.from('bankingsentinel.ExposureLimits')),
  ]);

  const loanIds = loans.map(l => l.LOAN_ID);
  let schedule = [], collateral = [], guarantors = [];
  if (loanIds.length > 0) {
    [schedule, collateral, guarantors] = await Promise.all([
      cds.run(SELECT.from('bankingsentinel.LoanSchedule').where({ LOAN_ID: { in: loanIds } })),
      cds.run(SELECT.from('bankingsentinel.BCA_COLLATERAL').where({ LOAN_ID: { in: loanIds } })),
      cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ LOAN_ID: { in: loanIds } })),
    ]);
  }

  // BUT050 — direct SQL because CDS entity name maps to bankingsentinel_BUT050
  let but050 = [];
  try {
    but050 = await cds.run(
      `SELECT * FROM "bankingsentinel_BUT050" WHERE PARTNER1 = '${customerId}' OR PARTNER2 = '${customerId}'`
    );
  } catch (_) {}

  // Portfolio — all DFKKOP rows for anomaly context
  const portfolio = await cds.run(
    SELECT.from('bankingsentinel.DFKKOP').columns('GPART', 'DAYS_OVERDUE', 'BETRW', 'STATUS').limit(200)
  );

  return {
    dti:        dtiRows[0] || null,
    bp:         bpRows[0]  || null,
    loans,
    payments,
    schedule,
    collateral,
    guarantors,
    but050,
    portfolio,
    thresholds,
    limits,
  };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function esc(v) {
  if (v === null || v === undefined) return '<span class="null-val">—</span>';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function tbl(rows, highlightFn) {
  if (!rows || rows.length === 0) return '<p class="no-data">No records found in this table.</p>';
  const cols = Object.keys(rows[0]);
  const thead = `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
  const tbody = '<tbody>' + rows.map(r =>
    '<tr>' + cols.map(c => {
      const v = r[c];
      const flagged = highlightFn ? highlightFn(c, v) : false;
      const cls = flagged ? ' class="flag"' : '';
      return `<td${cls}>${esc(v)}</td>`;
    }).join('') + '</tr>'
  ).join('') + '</tbody>';
  return `<table>${thead}${tbody}</table>`;
}

function kv(label, value, flagged) {
  const cls = flagged ? ' class="kv-flag"' : '';
  return `<div class="kv-row"><span class="kv-label">${label}</span><span class="kv-val"${cls}>${esc(value)}</span></div>`;
}

// ── Static HTML builders ──────────────────────────────────────────────────────

function buildSnapshotHtml(raw, dtiLimit) {
  const d = raw.dti || {};
  const b = raw.bp  || {};
  const totalDebt    = parseFloat(d.TOTAL_DEBT)   || 0;
  const income       = parseFloat(d.ANNUAL_INCOME) || 0;
  const dtiRatio     = parseFloat(d.DTI_RATIO)     || 0;
  const buffer       = (dtiLimit - dtiRatio).toFixed(2);
  const bufferPct    = dtiLimit > 0 ? Math.round((dtiRatio / dtiLimit) * 100) : 0;

  const creditLoans  = raw.loans.filter(l => l.LOAN_TYPE !== 'TERM_DEP');
  const termDeps     = raw.loans.filter(l => l.LOAN_TYPE === 'TERM_DEP');

  return `
    <div class="kv-grid">
      ${kv('Customer ID',   d.PARTNER || b.PARTNER || '—')}
      ${kv('Name',          b.BU_SORT1 || '—')}
      ${kv('Sector',        b.SECTOR_CODE || '—')}
      ${kv('DTI Ratio',     dtiRatio.toFixed(2) + 'x', dtiRatio >= dtiLimit * 0.9)}
      ${kv('APRA DTI Limit', dtiLimit.toFixed(2) + 'x')}
      ${kv('Buffer Remaining', buffer + 'x  (' + bufferPct + '% of limit used)', dtiRatio >= dtiLimit * 0.9)}
      ${kv('Total Debt',    'AUD ' + totalDebt.toLocaleString())}
      ${kv('Annual Income', income > 0 ? 'AUD ' + income.toLocaleString() : '— (not recorded)', !income)}
      ${kv('Income Source', d.INCOME_SOURCE || '— (not documented)', !d.INCOME_SOURCE)}
      ${kv('Income Expiry', d.INCOME_EXPIRY || '— (not documented)', !d.INCOME_EXPIRY)}
      ${kv('BREACH_FLAG',   d.BREACH_FLAG ? 'true' : 'false')}
    </div>
    <div class="sub-title">Credit Loans (${creditLoans.length} records)</div>
    ${tbl(creditLoans)}
    ${termDeps.length > 0 ? `<div class="sub-title warn">Term Deposits in Loans Table (${termDeps.length} records — not debt)</div>${tbl(termDeps)}` : ''}
  `;
}

function buildPaymentsHtml(raw) {
  const overdueFlag = (c, v) => (c === 'DAYS_OVERDUE' && parseInt(v) > 0) || (c === 'STATUS' && v === 'OPEN');
  const payHtml = tbl(raw.payments, overdueFlag);

  // LoanSchedule — cross-reference to show missing vs present
  const scheduleRows = raw.schedule.map(s => {
    const dfkkop = raw.payments.find(p => p.LOAN_ID === s.LOAN_ID && p.FAEDN === s.DUE_DATE);
    return {
      LOAN_ID:       s.LOAN_ID,
      DUE_DATE:      s.DUE_DATE,
      AMOUNT_DUE:    s.AMOUNT_DUE,
      DFKKOP_RECORD: dfkkop ? dfkkop.OPBEL : '⚠ MISSING',
      STATUS:        dfkkop ? dfkkop.STATUS : '⚠ NOT IN LEDGER',
      DAYS_OVERDUE:  dfkkop ? dfkkop.DAYS_OVERDUE : '—',
    };
  });
  const schedFlag = (c, v) => String(v).startsWith('⚠') || (c === 'DAYS_OVERDUE' && parseInt(v) > 0);

  return `
    <div class="sub-title">DFKKOP — Payment Ledger (all records for this customer)</div>
    ${payHtml}
    <div class="sub-title">LoanSchedule vs DFKKOP — Cross-Reference</div>
    ${tbl(scheduleRows, schedFlag)}
  `;
}

function buildDtiHtml(raw, dtiLimit, agentState) {
  const d = raw.dti || {};
  const dtiRatio  = parseFloat(d.DTI_RATIO)     || 0;
  const totalDebt = parseFloat(d.TOTAL_DEBT)     || 0;
  const income    = parseFloat(d.ANNUAL_INCOME)  || 0;
  const buffer    = dtiLimit - dtiRatio;
  const bufferAud = Math.round(buffer * income);

  const traj = agentState?.trajectoryAnalysis || {};

  return `
    <div class="sub-title">BCA_DTI record</div>
    ${tbl([d])}
    <div class="sub-title">Regulatory threshold (source: RegulatoryThresholds table)</div>
    ${tbl(raw.thresholds.filter(t => t.THRESHOLD_TYPE === 'DEBT_TO_INCOME'))}
    <div class="calc-box">
      <div class="calc-row"><span>DTI Calculation</span><span>${totalDebt.toLocaleString()} ÷ ${income.toLocaleString()} = <strong>${dtiRatio.toFixed(2)}x</strong></span></div>
      <div class="calc-row"><span>APRA Limit</span><span><strong>${dtiLimit.toFixed(2)}x</strong></span></div>
      <div class="calc-row ${buffer < 0.5 ? 'flag' : ''}"><span>Buffer Remaining</span><span><strong>${buffer.toFixed(2)}x</strong> = AUD ${bufferAud.toLocaleString()} additional debt capacity</span></div>
      ${traj.forwardPosition ? `<div class="calc-row"><span>Forward Position</span><span><strong>${traj.forwardPosition}</strong>${traj.timeToBreach ? ' — breach in ' + traj.timeToBreach + ' days' : ''}</span></div>` : ''}
    </div>
  `;
}

function buildCollateralHtml(raw) {
  const totalCollateral = raw.collateral.reduce((s, c) => s + (parseFloat(c.VALUE) || 0), 0);
  const totalDebt       = parseFloat(raw.dti?.TOTAL_DEBT) || 0;
  const coverage        = totalDebt > 0 ? Math.round((totalCollateral / totalDebt) * 100) : 0;

  return `
    <div class="sub-title">BCA_COLLATERAL</div>
    ${tbl(raw.collateral)}
    <div class="sub-title">BCA_GUARANTOR</div>
    ${tbl(raw.guarantors)}
    <div class="calc-box">
      <div class="calc-row"><span>Total Collateral Registered</span><span>AUD ${totalCollateral.toLocaleString()}</span></div>
      <div class="calc-row"><span>Total Debt</span><span>AUD ${totalDebt.toLocaleString()}</span></div>
      <div class="calc-row ${coverage < 100 ? 'flag' : ''}"><span>Coverage Ratio</span><span><strong>${coverage}%</strong></span></div>
    </div>
  `;
}

function buildRelationshipsHtml(raw, relMap, groupLimit) {
  const groupExposure = relMap?.groupExposure || 0;
  const pct           = groupLimit > 0 ? Math.round((groupExposure / groupLimit) * 100) : 0;
  const isBreach      = groupExposure > groupLimit;

  return `
    <div class="sub-title">BUT050 — Relationship Edges</div>
    ${tbl(raw.but050)}
    ${relMap ? `
    <div class="sub-title">Graph Traversal Result (SPARQL → RDF)</div>
    <div class="calc-box">
      <div class="calc-row"><span>Network Nodes</span><span>${relMap.nodes || '—'}</span></div>
      <div class="calc-row"><span>Network Edges</span><span>${relMap.edges || '—'}</span></div>
      <div class="calc-row"><span>Group Exposure</span><span>AUD ${(groupExposure).toLocaleString()}</span></div>
      <div class="calc-row"><span>APS 221 Group Limit</span><span>AUD ${groupLimit.toLocaleString()}</span></div>
      <div class="calc-row ${isBreach ? 'flag' : ''}"><span>Limit Usage</span><span><strong>${pct}%</strong>${isBreach ? ' — BREACH' : ''}</span></div>
    </div>
    <div class="sub-title">Group Exposure Breakdown (from agent output)</div>
    <p style="font-size:12px;color:#94a3b8;line-height:1.7">${(relMap.finding || '').replace(/\n/g,'<br>')}</p>
    ` : '<p class="no-data">Graph traversal data not available for this session.</p>'}
  `;
}

function buildAnomalyHtml(raw, patternAss) {
  // Portfolio summary for context
  const portCounts = {};
  raw.portfolio.forEach(p => {
    const bucket = parseInt(p.DAYS_OVERDUE) === 0 ? '0 days (cleared)' :
                   parseInt(p.DAYS_OVERDUE) <= 30  ? '1-30 days' :
                   parseInt(p.DAYS_OVERDUE) <= 60  ? '31-60 days' :
                   parseInt(p.DAYS_OVERDUE) <= 90  ? '61-90 days' : '90+ days';
    portCounts[bucket] = (portCounts[bucket] || 0) + 1;
  });
  const portRows = Object.entries(portCounts).map(([range, count]) => ({ DaysOverdueBucket: range, PaymentCount: count }));

  const anomalies = patternAss?.anomalies || [];
  const isolScores = patternAss?.isolationScores || [];

  return `
    <div class="sub-title">Portfolio Payment Distribution (all customers — DFKKOP)</div>
    ${tbl(portRows)}
    <div class="sub-title">Customer Payments with Isolation Scores</div>
    ${raw.payments.length > 0 ? tbl(raw.payments.map(p => {
      const iso = isolScores.find ? isolScores.find(s => s.recordId === p.OPBEL) : null;
      return {
        OPBEL:         p.OPBEL,
        LOAN_ID:       p.LOAN_ID,
        DAYS_OVERDUE:  p.DAYS_OVERDUE,
        STATUS:        p.STATUS,
        AMOUNT:        p.BETRW,
        ISOLATION_SCORE: iso ? iso.score : (parseInt(p.DAYS_OVERDUE) > 60 ? '~1.000 (outlier)' : '<0.5 (normal)'),
      };
    }), (c, v) => c === 'ISOLATION_SCORE' && String(v).includes('outlier')) : '<p class="no-data">No payment records.</p>'}
    ${anomalies.length > 0 ? `
    <div class="sub-title">LLM-Detected Anomalies (${anomalies.length})</div>
    <ul class="anomaly-list">${anomalies.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    ` : ''}
  `;
}

function buildVerdictHtml(synth, riskRow) {
  const s   = synth || {};
  const row = riskRow || {};
  const findings = s.findings || (row.FINDINGS ? JSON.parse(row.FINDINGS) : []);

  return `
    <div class="kv-grid">
      ${kv('Risk Score',   (s.riskScore || row.RISK_SCORE || '—') + ' / 100', (s.riskScore || 0) >= 70)}
      ${kv('Risk Level',   s.riskLevel  || row.RISK_LEVEL || '—', ['HIGH','CRITICAL'].includes(s.riskLevel || row.RISK_LEVEL))}
      ${kv('Confidence',   s.confidence != null ? Math.round(s.confidence * 100) + '%' : '—')}
      ${kv('APRA Ready',   s.apraReady === true ? 'Yes' : 'No — human review required', !s.apraReady)}
    </div>
    <div class="sub-title">Key Findings</div>
    <div class="findings-list">
      ${findings.map(f => `
        <div class="finding-card ${(f.severity || '').toLowerCase()}">
          <div class="finding-sev">${f.standard || ''} · ${f.severity || ''}</div>
          <div class="finding-text">${esc(f.finding)}</div>
          <div class="finding-src">Source: ${esc(f.evidenceSource)}</div>
        </div>
      `).join('')}
    </div>
    ${(s.recommendations || []).length > 0 ? `
    <div class="sub-title">Recommendations</div>
    <ol class="rec-list">${s.recommendations.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
    ` : ''}
  `;
}

// ── LLM prompt builders ───────────────────────────────────────────────────────

function buildPaymentPrompt(raw, customerId) {
  const overdue = raw.payments.filter(p => parseInt(p.DAYS_OVERDUE) > 0);
  const cleared = raw.payments.filter(p => p.STATUS === 'CLEARED');
  const missingSchedule = raw.schedule.filter(s =>
    !raw.payments.some(p => p.LOAN_ID === s.LOAN_ID && p.FAEDN === s.DUE_DATE)
  );

  return `Customer ${customerId} payment analysis. Raw data:

DFKKOP records: ${JSON.stringify(raw.payments)}
LoanSchedule: ${JSON.stringify(raw.schedule)}

Facts: ${overdue.length} of ${raw.payments.length} payment records are overdue. ${cleared.length} are cleared.
${overdue.map(p => `Record ${p.OPBEL}: ${p.DAYS_OVERDUE} days overdue on loan ${p.LOAN_ID}, AUD ${p.BETRW}, status ${p.STATUS}, booking date: ${p.BUDAT || 'empty'}`).join('\n')}
${missingSchedule.length > 0 ? `Missing from DFKKOP: ${missingSchedule.length} scheduled payments have no corresponding ledger entry (loans: ${missingSchedule.map(s=>s.LOAN_ID).join(', ')}).` : ''}

Explain what these payment records show. Point to specific record IDs and days-overdue values. What does the absence of BUDAT (booking date) mean? What is the significance of the ${overdue.length > 0 ? overdue.reduce((m,p) => Math.max(m, parseInt(p.DAYS_OVERDUE)), 0) + '-day' : ''} maximum overdue record? Be plain and factual. Max 120 words.`;
}

function buildDtiPrompt(raw, dtiLimit, agentState, customerId) {
  const d = raw.dti || {};
  const traj = agentState?.trajectoryAnalysis || {};
  const dtiRatio = parseFloat(d.DTI_RATIO) || 0;
  const income   = parseFloat(d.ANNUAL_INCOME) || 0;
  const debt     = parseFloat(d.TOTAL_DEBT) || 0;
  const buffer   = dtiLimit - dtiRatio;

  return `Customer ${customerId} DTI analysis. Raw data:

BCA_DTI: ${JSON.stringify(d)}
APRA DTI Limit: ${dtiLimit}x (from RegulatoryThresholds table)
DTI calculation: ${debt.toLocaleString()} ÷ ${income.toLocaleString()} = ${dtiRatio.toFixed(2)}x
Buffer: ${buffer.toFixed(2)}x (${Math.round((dtiRatio/dtiLimit)*100)}% of limit used)
Income source field: ${d.INCOME_SOURCE || 'EMPTY'}
Income expiry field: ${d.INCOME_EXPIRY || 'EMPTY'}
${traj.forwardPosition ? `Forward position: ${traj.forwardPosition}` : ''}

Explain the DTI ratio, how close it is to the APRA limit, what the empty income source/expiry fields mean for risk, and what the trajectory implies. Be plain and factual. Max 120 words.`;
}

function buildRelationshipsPrompt(raw, relMap, groupLimit, singleLimit, customerId) {
  const exposure   = relMap?.groupExposure || 0;
  const pct        = groupLimit > 0 ? Math.round((exposure / groupLimit) * 100) : 0;
  const isBreach   = exposure > groupLimit;

  return `Customer ${customerId} connected party analysis. Raw data:

BUT050 edges: ${JSON.stringify(raw.but050)}
BCA_GUARANTOR: ${JSON.stringify(raw.guarantors)}
Graph traversal result: ${relMap ? JSON.stringify({ nodes: relMap.nodes, edges: relMap.edges, groupExposure: relMap.groupExposure, aps221Pct: relMap.aps221Pct, finding: relMap.finding }) : 'not available'}

APS 221 Limits: Single=$${singleLimit.toLocaleString()}, Group=$${groupLimit.toLocaleString()}
Group exposure: AUD ${exposure.toLocaleString()} = ${pct}% of group limit.${isBreach ? ' BREACH.' : ''}

Explain how the connected party network was identified using BUT050, how the group exposure was calculated by traversing the graph, why this exceeds the APS 221 limit, and what the regulatory obligation is. Be plain and factual. Max 130 words.`;
}

function buildAnomalyPrompt(raw, patternAss, customerId) {
  const portDays = raw.portfolio.map(p => parseInt(p.DAYS_OVERDUE) || 0);
  const portMean = portDays.length ? (portDays.reduce((a, b) => a + b, 0) / portDays.length).toFixed(1) : 0;
  const maxOverdue = Math.max(...(raw.payments.map(p => parseInt(p.DAYS_OVERDUE) || 0)), 0);
  const anomalies  = patternAss?.anomalies || [];

  return `Customer ${customerId} anomaly detection analysis.

Portfolio context (all DFKKOP records): ${raw.portfolio.length} records, mean days overdue = ${portMean} days.
Customer payments max overdue: ${maxOverdue} days.
Isolation Forest anomaly score for worst payment: ~1.000 (maximum = absolute outlier in portfolio).
LLM-detected anomalies: ${anomalies.join('; ') || 'none listed'}

Explain what the Isolation Forest algorithm is (in simple terms) and why a score of 1.000 for the ${maxOverdue}-day payment is significant. Compare it to the portfolio average of ${portMean} days. Why does this matter beyond just knowing the payment is overdue? Be plain and factual for four audiences (banker, SAP, AI, general). Max 130 words.`;
}

function buildVerdictPrompt(synth, riskRow, customerId, dtiLimit, groupLimit) {
  const s   = synth || {};
  const row = riskRow || {};
  const findings = s.findings || (row.FINDINGS ? (() => { try { return JSON.parse(row.FINDINGS); } catch (_) { return []; } })() : []);

  return `Customer ${customerId} final risk verdict.

Risk score: ${s.riskScore || row.RISK_SCORE}/100. Level: ${s.riskLevel || row.RISK_LEVEL}.
Key findings: ${findings.map(f => f.finding).join(' | ')}
APRA Ready: ${s.apraReady ? 'yes' : 'no'}.

Based on these findings, explain what mandatory actions the bank must take and by when (APS 221 requires Board notification within 3 business days of a breach, APRA notification within 5 business days, remediation plan within 15). Keep it specific and actionable. Max 120 words.`;
}

// ── Stream LLM narrative ──────────────────────────────────────────────────────
async function* streamNarrative(prompt, client) {
  const stream = client.messages.stream({
    model:      MODEL,
    max_tokens: 700,
    system:     `You are a banking risk analyst writing an evidence paper section.
Write in clear, plain prose. No markdown, no bullet points, no headers.
Be specific — reference exact numbers and record IDs from the data provided.
Write so that a banker, an SAP administrator, an AI engineer, and a general reader can all follow.
Evidence first: state the raw data fact, then explain why it matters.`,
    messages:   [{ role: 'user', content: prompt }],
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function generateExplanation(sessionId, graph, pushFn) {
  let customerId  = null;
  let agentState  = {};

  // 1. Try LangGraph checkpoint (most detailed — has per-agent outputs)
  try {
    const checkpoint = await graph.getState({ configurable: { thread_id: sessionId } });
    if (checkpoint?.values) {
      agentState = checkpoint.values;
      customerId = agentState.customerId || agentState.intent?.customerId;
    }
  } catch (_) {}

  // 2. Fallback: RiskAssessments table
  if (!customerId) {
    try {
      const row = await cds.run(
        SELECT.one.from('bankingsentinel.RiskAssessments').where({ SESSION_ID: sessionId })
      );
      if (row) { customerId = row.PARTNER; agentState.synthesisResultFromDb = row; }
    } catch (_) {}
  }

  if (!customerId) {
    pushFn({ type: 'explain_error', error: 'Session not found. The pipeline may still be running, or this session has no checkpoint.' });
    return;
  }

  pushFn({ type: 'explain_start', sessionId, partnerId: customerId });

  // 3. Pull raw HANA data
  let raw;
  try {
    raw = await pullRawData(customerId);
  } catch (err) {
    pushFn({ type: 'explain_error', error: 'HANA connection failed: ' + err.message });
    return;
  }

  const client    = mkClient();
  const dtiLimit  = parseFloat(raw.thresholds.find(t => t.THRESHOLD_TYPE === 'DEBT_TO_INCOME')?.LIMIT_PCT ?? 6.0);
  const groupLimit = parseFloat(raw.limits.find(l => l.LIMIT_TYPE === 'GROUP')?.LIMIT_AUD ?? 7500000);
  const singleLimit = parseFloat(raw.limits.find(l => l.LIMIT_TYPE === 'SINGLE')?.LIMIT_AUD ?? 5000000);

  // ── Section 1: Customer Snapshot ─────────────────────────────────────────
  pushFn({ type: 'explain_section_begin', sectionId: 'snapshot', icon: '01',
    title: 'Customer Snapshot', subtitle: 'Source: BusinessPartners · BCA_DTI · Loans',
    staticHtml: buildSnapshotHtml(raw, dtiLimit) });
  pushFn({ type: 'explain_section_end', sectionId: 'snapshot' });

  // ── Section 2: Payment Evidence ──────────────────────────────────────────
  pushFn({ type: 'explain_section_begin', sectionId: 'payments', icon: '02',
    title: 'Payment Evidence', subtitle: 'Source: DFKKOP (payment ledger) · LoanSchedule',
    staticHtml: buildPaymentsHtml(raw) });
  for await (const delta of streamNarrative(buildPaymentPrompt(raw, customerId), client)) {
    pushFn({ type: 'explain_text_delta', sectionId: 'payments', delta });
  }
  pushFn({ type: 'explain_section_end', sectionId: 'payments' });

  // ── Section 3: DTI & Income Analysis ─────────────────────────────────────
  pushFn({ type: 'explain_section_begin', sectionId: 'dti', icon: '03',
    title: 'Debt-to-Income Analysis', subtitle: 'Source: BCA_DTI · RegulatoryThresholds',
    staticHtml: buildDtiHtml(raw, dtiLimit, agentState) });
  for await (const delta of streamNarrative(buildDtiPrompt(raw, dtiLimit, agentState, customerId), client)) {
    pushFn({ type: 'explain_text_delta', sectionId: 'dti', delta });
  }
  pushFn({ type: 'explain_section_end', sectionId: 'dti' });

  // ── Section 4: Collateral & Guarantors ───────────────────────────────────
  pushFn({ type: 'explain_section_begin', sectionId: 'collateral', icon: '04',
    title: 'Collateral & Guarantors', subtitle: 'Source: BCA_COLLATERAL · BCA_GUARANTOR',
    staticHtml: buildCollateralHtml(raw) });
  pushFn({ type: 'explain_section_end', sectionId: 'collateral' });

  // ── Section 5: Connected Party Network ───────────────────────────────────
  const relMap = agentState.relationshipMap || null;
  pushFn({ type: 'explain_section_begin', sectionId: 'relationships', icon: '05',
    title: 'Connected Party Network', subtitle: 'Source: BUT050 (SAP) · GraphDB SPARQL traversal',
    staticHtml: buildRelationshipsHtml(raw, relMap, groupLimit) });
  for await (const delta of streamNarrative(buildRelationshipsPrompt(raw, relMap, groupLimit, singleLimit, customerId), client)) {
    pushFn({ type: 'explain_text_delta', sectionId: 'relationships', delta });
  }
  pushFn({ type: 'explain_section_end', sectionId: 'relationships' });

  // ── Section 6: Anomaly Detection ─────────────────────────────────────────
  const patternAss = agentState.patternAssessment || null;
  pushFn({ type: 'explain_section_begin', sectionId: 'anomaly', icon: '06',
    title: 'Statistical Anomaly Detection', subtitle: 'Source: DFKKOP full portfolio · HANA PAL Isolation Forest',
    staticHtml: buildAnomalyHtml(raw, patternAss) });
  for await (const delta of streamNarrative(buildAnomalyPrompt(raw, patternAss, customerId), client)) {
    pushFn({ type: 'explain_text_delta', sectionId: 'anomaly', delta });
  }
  pushFn({ type: 'explain_section_end', sectionId: 'anomaly' });

  // ── Section 7: Final Verdict ──────────────────────────────────────────────
  let riskRow = null;
  try {
    riskRow = await cds.run(
      SELECT.one.from('bankingsentinel.RiskAssessments').where({ SESSION_ID: sessionId })
    );
  } catch (_) {}

  const synth = agentState.synthesisResult || null;
  pushFn({ type: 'explain_section_begin', sectionId: 'verdict', icon: '07',
    title: 'Final Verdict & Mandatory Actions', subtitle: 'Consolidated from all 7 agents · APRA obligations',
    staticHtml: buildVerdictHtml(synth, riskRow) });
  for await (const delta of streamNarrative(buildVerdictPrompt(synth, riskRow, customerId, dtiLimit, groupLimit), client)) {
    pushFn({ type: 'explain_text_delta', sectionId: 'verdict', delta });
  }
  pushFn({ type: 'explain_section_end', sectionId: 'verdict' });

  pushFn({ type: 'explain_complete', sectionsGenerated: 7 });
}

module.exports = { generateExplanation };
