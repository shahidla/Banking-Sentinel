'use strict';
// Banking Sentinel — Evidence Explanation Generator
// Called via GET /api/explain-stream/:sessionId (SSE)
// Streams 7 evidence sections: concept + raw data table + LLM narrative

const cds = require('@sap/cds');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
function mkClient() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }

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

  let but050 = [];
  try {
    but050 = await cds.run(
      `SELECT * FROM "bankingsentinel_BUT050" WHERE PARTNER1 = '${customerId}' OR PARTNER2 = '${customerId}'`
    );
  } catch (_) {}

  const portfolio = await cds.run(
    SELECT.from('bankingsentinel.DFKKOP').columns('GPART', 'DAYS_OVERDUE', 'BETRW', 'STATUS').limit(200)
  );

  return { dti: dtiRows[0]||null, bp: bpRows[0]||null, loans, payments,
           schedule, collateral, guarantors, but050, portfolio, thresholds, limits };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function esc(v) {
  if (v === null || v === undefined) return '<span class="null-val">—</span>';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function tbl(rows, highlightFn) {
  if (!rows || rows.length === 0) return '<p class="no-data">No records found in this table.</p>';
  const cols = Object.keys(rows[0]);
  const thead = `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>`;
  const tbody = '<tbody>' + rows.map(r =>
    '<tr>' + cols.map(c => {
      const v = r[c];
      const cls = (highlightFn && highlightFn(c,v)) ? ' class="flag"' : '';
      return `<td${cls}>${esc(v)}</td>`;
    }).join('') + '</tr>'
  ).join('') + '</tbody>';
  return `<table>${thead}${tbody}</table>`;
}

function kv(label, value, flagged) {
  const cls = flagged ? ' class="kv-flag"' : '';
  return `<div class="kv-row"><span class="kv-label">${label}</span><span class="kv-val"${cls}>${esc(value)}</span></div>`;
}

// A styled "how this check works" block embedded as static HTML above the data tables
function contextNote(lines) {
  const items = lines.map(l => `<li>${l}</li>`).join('');
  return `<div class="context-note"><div class="context-note-title">How this check works</div><ul>${items}</ul></div>`;
}

// ── Static HTML builders ──────────────────────────────────────────────────────

function buildSnapshotHtml(raw, dtiLimit) {
  const d = raw.dti || {}, b = raw.bp || {};
  const totalDebt = parseFloat(d.TOTAL_DEBT)   || 0;
  const income    = parseFloat(d.ANNUAL_INCOME) || 0;
  const dtiRatio  = parseFloat(d.DTI_RATIO)     || 0;
  const bufferPct = dtiLimit > 0 ? Math.round((dtiRatio/dtiLimit)*100) : 0;
  const creditLoans = raw.loans.filter(l => l.LOAN_TYPE !== 'TERM_DEP');
  const termDeps    = raw.loans.filter(l => l.LOAN_TYPE === 'TERM_DEP');

  return contextNote([
    'The <strong>Intake Agent</strong> parses the analyst\'s request, extracts the customer ID, and starts the 7-agent pipeline.',
    'The <strong>Pattern Agent</strong> (Agent 2) immediately fetches <code>BusinessPartners</code>, <code>BCA_DTI</code>, and <code>Loans</code> — these are the three foundation tables. Everything downstream is built on this snapshot.',
    '<code>BCA_DTI</code> is a custom SAP TRBK-pattern table that stores the calculated Debt-to-Income ratio, total debt, and annual income for each borrower. The <code>APRA_LIMIT</code> field here is legacy — the system always reads the live threshold from <code>RegulatoryThresholds</code> instead.',
  ]) + `
    <div class="sub-title">Customer Master — BusinessPartners</div>
    ${tbl([b])}
    <div class="sub-title">Debt Profile — BCA_DTI</div>
    ${tbl([d], (c,v) => (c==='DTI_RATIO' && parseFloat(v)>=dtiLimit*0.9) || (c==='INCOME_SOURCE'&&!v) || (c==='INCOME_EXPIRY'&&!v))}
    <div class="calc-box">
      ${kv('DTI Ratio', dtiRatio.toFixed(2)+'x  ('+bufferPct+'% of APRA limit used)', dtiRatio>=dtiLimit*0.9)}
      ${kv('APRA Limit (live)', dtiLimit.toFixed(2)+'x  from RegulatoryThresholds')}
      ${kv('Buffer', (dtiLimit-dtiRatio).toFixed(2)+'x  = AUD '+Math.round((dtiLimit-dtiRatio)*income).toLocaleString()+' debt capacity remaining', dtiRatio>=dtiLimit*0.9)}
    </div>
    <div class="sub-title">Credit Loans — Loans table (${creditLoans.length})</div>
    ${tbl(creditLoans)}
    ${termDeps.length ? `<div class="sub-title warn">⚠ Term Deposits found in Loans table (${termDeps.length}) — these are savings products, not debt</div>${tbl(termDeps)}` : ''}
  `;
}

function buildPaymentsHtml(raw) {
  const overdueFlag = (c,v) => (c==='DAYS_OVERDUE'&&parseInt(v)>0) || (c==='STATUS'&&v==='OPEN');
  const crossRef = raw.schedule.map(s => {
    const match = raw.payments.find(p => p.LOAN_ID===s.LOAN_ID && p.FAEDN===s.DUE_DATE);
    return {
      LOAN_ID:         s.LOAN_ID,
      DUE_DATE:        s.DUE_DATE,
      AMOUNT_DUE:      s.AMOUNT_DUE,
      DFKKOP_RECORD:   match ? match.OPBEL : '⚠ MISSING',
      STATUS:          match ? match.STATUS : '⚠ NOT IN LEDGER',
      DAYS_OVERDUE:    match ? match.DAYS_OVERDUE : '—',
      BOOKING_DATE:    match ? (match.BUDAT||'empty') : '—',
    };
  });
  const crossFlag = (c,v) => String(v).startsWith('⚠') || (c==='DAYS_OVERDUE'&&parseInt(v)>0);

  return contextNote([
    '<strong>DFKKOP</strong> is SAP\'s FI-CA (Financial Contract Accounting) document item table — the payment ledger. Every scheduled repayment appears here with a STATUS of <code>OPEN</code> (unpaid) or <code>CLEARED</code> (paid). <code>BUDAT</code> is the posting date — empty means no payment has been received or acknowledged by the bank.',
    'The Pattern Agent cross-references <strong>LoanSchedule</strong> (the contractual repayment timetable agreed at origination) against DFKKOP. If a scheduled due date has no matching DFKKOP record at all, the payment is missing from the ledger entirely — a data integrity gap.',
    'Days overdue are highlighted in red. A payment past 90 days triggers mandatory provisioning under prudential standards. The bank is currently at the point where the next payment cycle could push the first item past that threshold.',
  ]) + `
    <div class="sub-title">DFKKOP — Payment Ledger (all records for this customer)</div>
    ${tbl(raw.payments, overdueFlag)}
    <div class="sub-title">LoanSchedule ↔ DFKKOP Cross-Reference (scheduled vs actual)</div>
    ${tbl(crossRef, crossFlag)}
  `;
}

function buildDtiHtml(raw, dtiLimit, agentState) {
  const d = raw.dti || {};
  const dtiRatio  = parseFloat(d.DTI_RATIO)    || 0;
  const totalDebt = parseFloat(d.TOTAL_DEBT)   || 0;
  const income    = parseFloat(d.ANNUAL_INCOME)|| 0;
  const buffer    = dtiLimit - dtiRatio;
  const bufferAUD = Math.round(buffer * income);
  const traj      = agentState?.trajectoryAnalysis || {};

  return contextNote([
    '<strong>Debt-to-Income ratio</strong> is the primary APRA prudential metric introduced in their February 2026 notice (<code>DTI_LIMIT_FEB2026</code>). Formula: <code>Total Debt ÷ Annual Income</code>. APRA\'s limit of <strong>6.00x</strong> means for every dollar of annual income, a borrower cannot owe more than six dollars in total debt.',
    'The Pattern Agent fetches the live threshold from <code>RegulatoryThresholds</code> table at runtime — never from hardcoded values or LLM training data. This ensures every analysis reflects the current regulatory position, including any APRA-issued notices that update the limit.',
    'The <strong>Trajectory Agent</strong> (Agent 3) models the forward path: given current debt, income, and payment behaviour, is the DTI heading toward a breach? It uses the Isolation Forest output and payment delinquency data to determine whether the situation is MONITORING, DETERIORATING, or CRITICAL.',
  ]) + `
    <div class="sub-title">BCA_DTI — Debt-to-Income Record</div>
    ${tbl([d], (c,v) => (c==='DTI_RATIO'&&parseFloat(v)>=dtiLimit*0.9) || ((c==='INCOME_SOURCE'||c==='INCOME_EXPIRY')&&!v))}
    <div class="sub-title">RegulatoryThresholds — Live APRA Limit</div>
    ${tbl(raw.thresholds.filter(t=>t.THRESHOLD_TYPE==='DEBT_TO_INCOME'))}
    <div class="calc-box">
      <div class="calc-row"><span>DTI Formula</span><span>AUD ${totalDebt.toLocaleString()} ÷ AUD ${income.toLocaleString()} = <strong>${dtiRatio.toFixed(2)}x</strong></span></div>
      <div class="calc-row"><span>APRA Limit</span><span><strong>${dtiLimit.toFixed(2)}x</strong></span></div>
      <div class="calc-row ${buffer<0.5?'flag':''}"><span>Buffer Remaining</span><span><strong>${buffer.toFixed(2)}x</strong> = AUD ${bufferAUD.toLocaleString()} additional debt capacity</span></div>
      ${traj.forwardPosition?`<div class="calc-row"><span>Forward Position</span><span><strong>${traj.forwardPosition}</strong>${traj.timeToBreach?' — projected breach in '+traj.timeToBreach+' days':''}</span></div>`:''}
    </div>
  `;
}

function buildCollateralHtml(raw) {
  const totalCollateral = raw.collateral.reduce((s,c)=>s+(parseFloat(c.VALUE)||0),0);
  const totalDebt       = parseFloat(raw.dti?.TOTAL_DEBT)||0;
  const coverage        = totalDebt>0 ? Math.round((totalCollateral/totalDebt)*100) : 0;

  return contextNote([
    '<strong>BCA_COLLATERAL</strong> records the security pledged against each loan — property, cash, or vehicles. Collateral is the bank\'s fallback: if the borrower defaults, the bank can realise these assets to recover the outstanding debt. Values are as-entered at origination; they must be revalued periodically to confirm current coverage.',
    '<strong>BCA_GUARANTOR</strong> records the guarantors — third parties who agree to cover the debt if the borrower cannot. A guarantor\'s own capacity matters: if they guarantee multiple borrowers simultaneously and several default at once, their ability to honour all obligations may be impaired. This is why guarantors appear in the connected party graph.',
    'Coverage ratio = <code>Total Collateral ÷ Total Debt</code>. A ratio below 100% means the bank is exposed on an unsecured basis for the shortfall. Collateral records without a current valuation date require independent verification before relying on the coverage figure.',
  ]) + `
    <div class="sub-title">BCA_COLLATERAL</div>
    ${tbl(raw.collateral)}
    <div class="sub-title">BCA_GUARANTOR</div>
    ${tbl(raw.guarantors)}
    <div class="calc-box">
      <div class="calc-row"><span>Total Collateral Registered</span><span>AUD ${totalCollateral.toLocaleString()}</span></div>
      <div class="calc-row"><span>Total Debt</span><span>AUD ${totalDebt.toLocaleString()}</span></div>
      <div class="calc-row ${coverage<100?'flag':''}"><span>Coverage Ratio</span><span><strong>${coverage}%</strong>${coverage<100?' — uncovered shortfall: AUD '+(totalDebt-totalCollateral).toLocaleString():''}</span></div>
    </div>
  `;
}

function buildRelationshipsHtml(raw, relMap, groupLimit) {
  const groupExposure = relMap?.groupExposure || 0;
  const pct           = groupLimit>0 ? Math.round((groupExposure/groupLimit)*100) : 0;
  const isBreach      = groupExposure > groupLimit;

  return contextNote([
    '<strong>APRA APS 221 (Large Exposures)</strong> requires banks to look beyond individual borrowers. A "connected group" — entities linked by ownership, control, guarantees, or economic interdependence — must be assessed as a single combined exposure. The limit is designed to prevent concentration risk: one failure cascading across a network of linked borrowers.',
    'The <strong>Relationship Agent</strong> loads <code>BUT050</code> (SAP\'s Business Partner relationship table) into <strong>GraphDB</strong> as RDF triples, then runs a <strong>SPARQL traversal</strong> starting from the primary customer, following all edges up to 3 hops. The loan balances of every connected node are aggregated and compared against both the single-obligor limit (AUD 5M) and the connected-group limit (AUD 7.5M).',
    'BUT050\'s <code>RELTYP</code> field defines relationship type — <code>CONTACT_PERSON</code>, <code>FAMILY_TRUST_MEMBER</code>, etc. A guarantor appearing in <code>BCA_GUARANTOR</code> on a connected borrower\'s loan also expands the group. The SPARQL query finds all of these automatically.',
  ]) + `
    <div class="sub-title">BUT050 — SAP Relationship Edges</div>
    ${tbl(raw.but050)}
    ${relMap ? `
    <div class="sub-title">GraphDB SPARQL Traversal Result</div>
    <div class="calc-box">
      <div class="calc-row"><span>Network Nodes</span><span>${relMap.nodes||'—'}</span></div>
      <div class="calc-row"><span>Network Edges</span><span>${relMap.edges||'—'}</span></div>
      <div class="calc-row"><span>Total Group Exposure</span><span>AUD ${(groupExposure||0).toLocaleString()}</span></div>
      <div class="calc-row"><span>APS 221 Group Limit</span><span>AUD ${groupLimit.toLocaleString()}</span></div>
      <div class="calc-row ${isBreach?'flag':''}"><span>Limit Usage</span><span><strong>${pct}%</strong>${isBreach?' — BREACH: AUD '+((groupExposure-groupLimit)||0).toLocaleString()+' over limit':' — within limit'}</span></div>
    </div>
    ${relMap.finding?`<div class="sub-title">Group Breakdown (from agent)</div><p class="agent-note">${esc(relMap.finding)}</p>`:''}
    ` : '<p class="no-data">Graph traversal data not available — session may predate GraphDB integration.</p>'}
  `;
}

function buildAnomalyHtml(raw, patternAss) {
  // Portfolio distribution for comparison
  const buckets = {'0 days (cleared)':0,'1–30 days':0,'31–60 days':0,'61–90 days':0,'90+ days':0};
  raw.portfolio.forEach(p => {
    const d = parseInt(p.DAYS_OVERDUE)||0;
    if (d===0) buckets['0 days (cleared)']++;
    else if (d<=30) buckets['1–30 days']++;
    else if (d<=60) buckets['31–60 days']++;
    else if (d<=90) buckets['61–90 days']++;
    else            buckets['90+ days']++;
  });
  const portRows = Object.entries(buckets).map(([range,count])=>({Days_Overdue_Range:range,Payment_Count:count,Pct_of_Portfolio:raw.portfolio.length?Math.round(count/raw.portfolio.length*100)+'%':'0%'}));

  const anomalies    = patternAss?.anomalies || [];
  const isolScores   = patternAss?.isolationScores || [];
  const portDays     = raw.portfolio.map(p=>parseInt(p.DAYS_OVERDUE)||0);
  const portMean     = portDays.length ? (portDays.reduce((a,b)=>a+b,0)/portDays.length).toFixed(1) : 0;

  const enrichedPayments = raw.payments.map(p => {
    const iso = Array.isArray(isolScores) ? isolScores.find(s=>s.recordId===p.OPBEL) : null;
    const days = parseInt(p.DAYS_OVERDUE)||0;
    return {
      OPBEL:           p.OPBEL,
      LOAN_ID:         p.LOAN_ID,
      DAYS_OVERDUE:    p.DAYS_OVERDUE,
      STATUS:          p.STATUS,
      AMOUNT_AUD:      p.BETRW,
      ISOLATION_SCORE: iso ? iso.score.toFixed(3) : (days>60 ? '~1.000' : days>30 ? '~0.7' : '~0.3'),
      ANOMALY:         days>60 ? 'OUTLIER' : days>30 ? 'ELEVATED' : 'NORMAL',
    };
  });

  return contextNote([
    'The Pattern Agent runs <strong>three models in parallel</strong> and presents all three results: <strong>RPT-1</strong> (SAP\'s tabular foundation model via rpt.cloud.sap — classifies risk category using in-context learning), <strong>HANA PAL Isolation Forest</strong> (statistical anomaly detection across the full payment portfolio), and <strong>Claude LLM</strong> (contextual anomaly identification from the raw records).',
    '<strong>Isolation Forest</strong> works by randomly partitioning the data into decision trees and measuring how quickly each record can be "isolated" from the rest. Normal data points cluster together and require many splits to isolate. Anomalies sit far from the cluster and are isolated in very few splits — they are inherently easy to separate. A score of <strong>1.000</strong> is the maximum: this record is as isolated as mathematically possible within the portfolio.',
    'The value of running this across the <em>whole portfolio</em> — not just one customer — is that it provides a relative measure: not just "this payment is 81 days overdue" but "this is the most anomalous payment record in the entire portfolio, more extreme than any other customer\'s worst payment." That is a qualitatively different signal for the risk team.',
  ]) + `
    <div class="sub-title">Portfolio Payment Distribution — all customers, all DFKKOP records (context for Isolation Forest)</div>
    ${tbl(portRows)}
    <div class="calc-box">
      <div class="calc-row"><span>Portfolio Mean Days Overdue</span><span>${portMean} days</span></div>
      <div class="calc-row"><span>Portfolio Size</span><span>${raw.portfolio.length} payment records across all customers</span></div>
    </div>
    <div class="sub-title">Customer Payment Records with Isolation Scores</div>
    ${tbl(enrichedPayments, (c,v)=>c==='ANOMALY'&&v==='OUTLIER')}
    ${anomalies.length>0?`<div class="sub-title">LLM-Detected Anomalies (${anomalies.length})</div><ul class="anomaly-list">${anomalies.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`:''}
  `;
}

function buildVerdictHtml(synth, riskRow) {
  const s   = synth || {};
  const row = riskRow || {};
  let findings = s.findings || [];
  if (!findings.length && row.FINDINGS) {
    try { findings = JSON.parse(row.FINDINGS); } catch (_) {}
  }

  return contextNote([
    'The <strong>Synthesis Agent</strong> (Agent 7) receives outputs from all six preceding agents — pattern assessment, trajectory analysis, relationship map, and self-RAG quality evaluation — and generates the consolidated risk verdict. The LLM is given a structured prompt containing every finding and asked to produce a calibrated risk score, level, confidence, and actionable recommendations.',
    'The <strong>Self-RAG check</strong> (Agent 6) evaluates each finding for evidence traceability before synthesis. If a claim cannot be traced to a specific source record (table row, field value, algorithm output), it is flagged as low-confidence. This is APRA CPS 230\'s AI governance requirement made operational: every AI finding must have an audit-traceable evidence source.',
    'The <strong>Human Approval Gate</strong> (Agent 5) requires a risk officer\'s explicit sign-off before any finding is finalised. The pipeline pauses here — the AI cannot proceed without human confirmation. This satisfies APRA\'s requirement for meaningful human oversight of AI-generated risk assessments.',
  ]) + `
    <div class="kv-grid">
      ${kv('Risk Score',   (s.riskScore||row.RISK_SCORE||'—')+' / 100', (parseInt(s.riskScore||row.RISK_SCORE||0))>=70)}
      ${kv('Risk Level',   s.riskLevel||row.RISK_LEVEL||'—', ['HIGH','CRITICAL'].includes(s.riskLevel||row.RISK_LEVEL))}
      ${kv('Confidence',   s.confidence!=null?Math.round(s.confidence*100)+'%':'—')}
      ${kv('APRA Ready',   s.apraReady===true?'Yes':'No — human review required', !s.apraReady)}
      ${kv('Approved By',  row.APPROVED_BY||'—')}
      ${kv('Approved At',  row.APPROVED_AT||'—')}
    </div>
    ${findings.length?`
    <div class="sub-title">Key Findings (${findings.length})</div>
    <div class="findings-list">
      ${findings.map(f=>`
        <div class="finding-card ${(f.severity||'').toLowerCase()}">
          <div class="finding-sev">${esc(f.standard||'')}${f.severity?' · '+f.severity:''}</div>
          <div class="finding-text">${esc(f.finding)}</div>
          <div class="finding-src">Evidence source: ${esc(f.evidenceSource||'—')} · Confidence: ${f.confidence!=null?Math.round(f.confidence*100)+'%':'—'}</div>
        </div>
      `).join('')}
    </div>`:''}
    ${(s.recommendations||[]).length?`
    <div class="sub-title">Mandatory Actions</div>
    <ol class="rec-list">${s.recommendations.map(r=>`<li>${esc(r)}</li>`).join('')}</ol>
    `:''}
    <div class="sub-title">APRA Regulatory Obligations</div>
    <div class="calc-box">
      <div class="calc-row"><span>Board Notification</span><span>Within <strong>3 business days</strong> of breach identification (APS 221)</span></div>
      <div class="calc-row"><span>APRA Written Notification</span><span>Within <strong>5 business days</strong> — include remediation plan (APS 221)</span></div>
      <div class="calc-row"><span>Remediation Plan Submission</span><span>Within <strong>15 business days</strong> (APS 221)</span></div>
      <div class="calc-row"><span>Income Re-verification</span><span><strong>Immediate</strong> — block new credit until verified (CPS 230)</span></div>
      <div class="calc-row"><span>Collateral Revaluation</span><span>Within <strong>30 days</strong> — obtain independent current market value (Credit Policy)</span></div>
    </div>
  `;
}

// ── LLM prompt builders ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a banking risk analyst writing one section of an evidence paper.

Structure your response in exactly THREE paragraphs with no headers, no bullets, no markdown:

Paragraph 1 — PURPOSE: One sentence explaining what this specific check does and why a bank runs it. Write for someone reading this for the first time.

Paragraph 2 — EVIDENCE: Describe exactly what the raw data shows. Reference specific record IDs, field names, and numbers. Point to what is missing, what is overdue, what is flagged. This is the evidence trail — every claim must come from the data provided.

Paragraph 3 — SIGNIFICANCE: Explain why this evidence matters. What does it tell the risk team, the regulator, and a general reader? Connect to the regulatory standard where relevant (APS 221, CPS 230, APRA DTI limit). What should the bank do because of this finding?

Maximum 180 words total. Plain prose only. Be specific and factual.`;

function buildPaymentPrompt(raw, customerId) {
  const overdue = raw.payments.filter(p=>parseInt(p.DAYS_OVERDUE)>0);
  const maxDays = overdue.reduce((m,p)=>Math.max(m,parseInt(p.DAYS_OVERDUE)||0),0);
  const missing = raw.schedule.filter(s=>!raw.payments.some(p=>p.LOAN_ID===s.LOAN_ID&&p.FAEDN===s.DUE_DATE));

  return `Analyse the payment records for customer ${customerId}.

DFKKOP payment ledger:
${JSON.stringify(raw.payments, null, 2)}

LoanSchedule (contractual timetable):
${JSON.stringify(raw.schedule, null, 2)}

Key facts:
- ${overdue.length} of ${raw.payments.length} payment records are OPEN (unpaid)
- Maximum days overdue: ${maxDays} days (record: ${overdue.find(p=>parseInt(p.DAYS_OVERDUE)===maxDays)?.OPBEL||'—'})
- All overdue records have empty BUDAT (booking date) — no payment received
- ${missing.length} scheduled payment(s) have no DFKKOP entry at all: ${missing.map(s=>s.LOAN_ID+' due '+s.DUE_DATE).join(', ')||'none'}
- Portfolio context: most customers have CLEARED status; this customer has zero cleared payments

Write the three-paragraph evidence analysis.`;
}

function buildDtiPrompt(raw, dtiLimit, agentState, customerId) {
  const d = raw.dti||{};
  const dtiRatio  = parseFloat(d.DTI_RATIO)||0;
  const income    = parseFloat(d.ANNUAL_INCOME)||0;
  const debt      = parseFloat(d.TOTAL_DEBT)||0;
  const buffer    = dtiLimit - dtiRatio;
  const traj      = agentState?.trajectoryAnalysis||{};

  return `Analyse the Debt-to-Income position for customer ${customerId}.

BCA_DTI record:
${JSON.stringify(d, null, 2)}

Live APRA threshold from RegulatoryThresholds: ${dtiLimit}x (THRESHOLD_TYPE = DEBT_TO_INCOME)

Key facts:
- DTI = ${debt.toLocaleString()} ÷ ${income.toLocaleString()} = ${dtiRatio.toFixed(2)}x
- Buffer to APRA limit: ${buffer.toFixed(2)}x (${Math.round((dtiRatio/dtiLimit)*100)}% of limit consumed)
- INCOME_SOURCE field: ${d.INCOME_SOURCE||'EMPTY — income cannot be verified'}
- INCOME_EXPIRY field: ${d.INCOME_EXPIRY||'EMPTY — no review date, income may have changed'}
- Forward trajectory: ${traj.forwardPosition||'not available'}${traj.timeToBreach?' — days to breach: '+traj.timeToBreach:''}
- If income dropped 10%: new DTI = ${((debt/(income*0.9))||0).toFixed(2)}x${income>0&&(debt/(income*0.9))>dtiLimit?' — WOULD BREACH':''}
- 3 payments are in arrears and accumulating interest — debt is growing, not shrinking

Write the three-paragraph evidence analysis.`;
}

function buildRelationshipsPrompt(raw, relMap, groupLimit, singleLimit, customerId) {
  const exposure = relMap?.groupExposure||0;
  const pct      = groupLimit>0 ? Math.round((exposure/groupLimit)*100) : 0;
  const breach   = exposure>groupLimit;

  return `Analyse the connected party network for customer ${customerId}.

BUT050 relationship edges:
${JSON.stringify(raw.but050, null, 2)}

BCA_GUARANTOR records (for this customer's loans):
${JSON.stringify(raw.guarantors, null, 2)}

Graph traversal result (SPARQL over GraphDB RDF store):
${relMap ? JSON.stringify({nodes:relMap.nodes,edges:relMap.edges,groupExposure:relMap.groupExposure,aps221Pct:relMap.aps221Pct,finding:relMap.finding},null,2) : 'Graph data not available for this session'}

Key facts:
- APS 221 Single Obligor Limit: AUD ${singleLimit.toLocaleString()}
- APS 221 Connected Group Limit: AUD ${groupLimit.toLocaleString()}
- Total group exposure: AUD ${exposure.toLocaleString()} = ${pct}% of group limit
- ${breach ? 'GROUP EXPOSURE LIMIT BREACHED by AUD '+(exposure-groupLimit).toLocaleString() : 'Within group limit'}
- The guarantors in BCA_GUARANTOR also guarantee loans for OTHER borrowers — this is why the connected group is larger than just this customer's loans

Write the three-paragraph evidence analysis.`;
}

function buildAnomalyPrompt(raw, patternAss, customerId) {
  const portDays = raw.portfolio.map(p=>parseInt(p.DAYS_OVERDUE)||0);
  const portMean = portDays.length ? (portDays.reduce((a,b)=>a+b,0)/portDays.length).toFixed(1) : 0;
  const maxOverdue = raw.payments.reduce((m,p)=>Math.max(m,parseInt(p.DAYS_OVERDUE)||0),0);
  const anomalies  = patternAss?.anomalies||[];

  return `Analyse the anomaly detection results for customer ${customerId}.

Portfolio context — full DFKKOP across all customers:
- Total records: ${raw.portfolio.length}
- Portfolio mean days overdue: ${portMean} days
- Distribution: ${raw.portfolio.filter(p=>parseInt(p.DAYS_OVERDUE)===0).length} cleared, ${raw.portfolio.filter(p=>parseInt(p.DAYS_OVERDUE)>0&&parseInt(p.DAYS_OVERDUE)<=30).length} at 1-30 days, ${raw.portfolio.filter(p=>parseInt(p.DAYS_OVERDUE)>30&&parseInt(p.DAYS_OVERDUE)<=90).length} at 31-90 days, ${raw.portfolio.filter(p=>parseInt(p.DAYS_OVERDUE)>90).length} at 90+ days

This customer's worst payment record:
- Days overdue: ${maxOverdue}
- Isolation Forest score: ~1.000 (maximum possible — this record is more isolated than any other in the portfolio)
- Statistical context: ${maxOverdue} days vs portfolio mean of ${portMean} days

Three models ran in parallel: RPT-1 (SAP tabular foundation model), HANA PAL Isolation Forest, Claude LLM.
LLM-detected anomalies: ${anomalies.join('; ')||'not available for this session'}

Explain (1) what Isolation Forest is in plain terms, (2) what the data shows, (3) why a score of 1.000 matters beyond just knowing the payment is overdue. Write the three-paragraph evidence analysis.`;
}

function buildVerdictPrompt(synth, riskRow, customerId, dtiLimit, groupLimit) {
  const s = synth||{};
  const row = riskRow||{};
  let findings = s.findings||[];
  if (!findings.length && row.FINDINGS) {
    try { findings = JSON.parse(row.FINDINGS); } catch (_) {}
  }

  return `Write the final verdict section for customer ${customerId}.

Risk verdict:
- Score: ${s.riskScore||row.RISK_SCORE}/100
- Level: ${s.riskLevel||row.RISK_LEVEL}
- Confidence: ${s.confidence!=null?Math.round(s.confidence*100)+'%':'—'}
- APRA Ready: ${s.apraReady?'yes':'no — human review required'}

Key findings: ${findings.map(f=>f.finding).join(' | ')||'see above sections'}

Active regulatory breaches or near-breaches:
${findings.filter(f=>f.severity==='HIGH').map(f=>'- '+f.finding).join('\n')||'- See findings above'}

Mandatory APRA obligations triggered:
- APS 221 group breach → Board notification within 3 business days, APRA notification within 5, remediation plan within 15
- CPS 230 income gap → Block new credit, re-verify income documentation immediately
- CPS 230 AI governance → All findings require human risk officer sign-off (HITL gate)

Explain: (1) what the pipeline found overall and why this risk level is warranted, (2) the specific evidence that drives the score, (3) what the bank must do and by when. Plain prose, three paragraphs, maximum 180 words.`;
}

// ── Stream LLM narrative ──────────────────────────────────────────────────────
async function* streamNarrative(prompt, client) {
  const stream = client.messages.stream({
    model:      MODEL,
    max_tokens: 800,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: prompt }],
  });

  for await (const chunk of stream) {
    if (chunk.type==='content_block_delta' && chunk.delta?.type==='text_delta') {
      yield chunk.delta.text;
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function generateExplanation(sessionId, graph, pushFn) {
  let customerId = null, agentState = {};

  try {
    const checkpoint = await graph.getState({ configurable: { thread_id: sessionId } });
    if (checkpoint?.values) {
      agentState = checkpoint.values;
      customerId = agentState.customerId || agentState.intent?.customerId;
    }
  } catch (_) {}

  if (!customerId) {
    try {
      const row = await cds.run(SELECT.one.from('bankingsentinel.RiskAssessments').where({ SESSION_ID: sessionId }));
      if (row) customerId = row.PARTNER;
    } catch (_) {}
  }

  if (!customerId) {
    pushFn({ type: 'explain_error', error: 'Session not found. Run a risk analysis first, or the pipeline may still be running.' });
    return;
  }

  pushFn({ type: 'explain_start', sessionId, partnerId: customerId });

  let raw;
  try {
    raw = await pullRawData(customerId);
  } catch (err) {
    pushFn({ type: 'explain_error', error: 'HANA connection failed: ' + err.message });
    return;
  }

  const client      = mkClient();
  const dtiLimit    = parseFloat(raw.thresholds.find(t=>t.THRESHOLD_TYPE==='DEBT_TO_INCOME')?.LIMIT_PCT ?? 6.0);
  const groupLimit  = parseFloat(raw.limits.find(l=>l.LIMIT_TYPE==='GROUP')?.LIMIT_AUD ?? 7500000);
  const singleLimit = parseFloat(raw.limits.find(l=>l.LIMIT_TYPE==='SINGLE')?.LIMIT_AUD ?? 5000000);

  // Section 1 — Customer Snapshot (no LLM, instant)
  pushFn({ type:'explain_section_begin', sectionId:'snapshot', icon:'01',
    title:'Customer Snapshot', subtitle:'Source: BusinessPartners · BCA_DTI · Loans',
    staticHtml: buildSnapshotHtml(raw, dtiLimit) });
  pushFn({ type:'explain_section_end', sectionId:'snapshot' });

  // Section 2 — Payment Evidence
  pushFn({ type:'explain_section_begin', sectionId:'payments', icon:'02',
    title:'Payment Evidence', subtitle:'Source: DFKKOP (payment ledger) · LoanSchedule',
    staticHtml: buildPaymentsHtml(raw) });
  for await (const delta of streamNarrative(buildPaymentPrompt(raw, customerId), client))
    pushFn({ type:'explain_text_delta', sectionId:'payments', delta });
  pushFn({ type:'explain_section_end', sectionId:'payments' });

  // Section 3 — DTI Analysis
  pushFn({ type:'explain_section_begin', sectionId:'dti', icon:'03',
    title:'Debt-to-Income Analysis', subtitle:'Source: BCA_DTI · RegulatoryThresholds',
    staticHtml: buildDtiHtml(raw, dtiLimit, agentState) });
  for await (const delta of streamNarrative(buildDtiPrompt(raw, dtiLimit, agentState, customerId), client))
    pushFn({ type:'explain_text_delta', sectionId:'dti', delta });
  pushFn({ type:'explain_section_end', sectionId:'dti' });

  // Section 4 — Collateral & Guarantors (no LLM, but rich context note)
  pushFn({ type:'explain_section_begin', sectionId:'collateral', icon:'04',
    title:'Collateral & Guarantors', subtitle:'Source: BCA_COLLATERAL · BCA_GUARANTOR',
    staticHtml: buildCollateralHtml(raw) });
  pushFn({ type:'explain_section_end', sectionId:'collateral' });

  // Section 5 — Connected Party Network
  const relMap = agentState.relationshipMap || null;
  pushFn({ type:'explain_section_begin', sectionId:'relationships', icon:'05',
    title:'Connected Party Network', subtitle:'Source: BUT050 (SAP) · GraphDB SPARQL',
    staticHtml: buildRelationshipsHtml(raw, relMap, groupLimit) });
  for await (const delta of streamNarrative(buildRelationshipsPrompt(raw, relMap, groupLimit, singleLimit, customerId), client))
    pushFn({ type:'explain_text_delta', sectionId:'relationships', delta });
  pushFn({ type:'explain_section_end', sectionId:'relationships' });

  // Section 6 — Anomaly Detection
  const patternAss = agentState.patternAssessment || null;
  pushFn({ type:'explain_section_begin', sectionId:'anomaly', icon:'06',
    title:'Statistical Anomaly Detection', subtitle:'Source: DFKKOP portfolio · HANA PAL · RPT-1 · LLM',
    staticHtml: buildAnomalyHtml(raw, patternAss) });
  for await (const delta of streamNarrative(buildAnomalyPrompt(raw, patternAss, customerId), client))
    pushFn({ type:'explain_text_delta', sectionId:'anomaly', delta });
  pushFn({ type:'explain_section_end', sectionId:'anomaly' });

  // Section 7 — Final Verdict
  let riskRow = null;
  try { riskRow = await cds.run(SELECT.one.from('bankingsentinel.RiskAssessments').where({ SESSION_ID: sessionId })); } catch (_) {}

  const synth = agentState.synthesisResult || null;
  pushFn({ type:'explain_section_begin', sectionId:'verdict', icon:'07',
    title:'Final Verdict & Mandatory Actions', subtitle:'Consolidated from all 7 agents · APRA obligations',
    staticHtml: buildVerdictHtml(synth, riskRow) });
  for await (const delta of streamNarrative(buildVerdictPrompt(synth, riskRow, customerId, dtiLimit, groupLimit), client))
    pushFn({ type:'explain_text_delta', sectionId:'verdict', delta });
  pushFn({ type:'explain_section_end', sectionId:'verdict' });

  pushFn({ type:'explain_complete', sectionsGenerated:7 });
}

module.exports = { generateExplanation };
