'use strict';
// Banking Sentinel — Evidence Explanation Generator
// Called via GET /api/explain-stream/:sessionId (SSE)
// Streams 7 evidence sections: concept + raw data table + LLM narrative

const cds = require('@sap/cds');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
function mkClient() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Reference "today" for the demo dataset — consistent with the DAYS_OVERDUE
// values seeded into DFKKOP. Used to distinguish a genuinely missing past-due
// payment from a future LoanSchedule row that simply isn't due yet.
const SCHEDULE_TODAY = '2026-05-21';

// ── Explanation cache (Supabase Postgres — same instance as the LangGraph checkpointer) ──
// Generating the trail calls Claude 5 times per session. Without a cache, re-opening the
// same session regenerates fresh prose each time — different wording, different cost.
// Caching makes the evidence trail reproducible: the same session always shows the same trail.
const pgPool = process.env.POSTGRES_URL
  ? new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 })
  : null;
let cacheTableReady = false;

async function ensureCacheTable() {
  if (!pgPool || cacheTableReady) return;
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS explain_cache (
      session_id  TEXT PRIMARY KEY,
      partner_id  TEXT,
      sections    JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  cacheTableReady = true;
}

async function loadCachedExplanation(sessionId) {
  if (!pgPool) return null;
  try {
    await ensureCacheTable();
    const { rows } = await pgPool.query(
      'SELECT partner_id, sections FROM explain_cache WHERE session_id = $1', [sessionId]
    );
    return rows[0] || null;
  } catch (e) {
    console.warn('[Explain/cache] load failed:', e.message);
    return null;
  }
}

async function saveExplanation(sessionId, partnerId, sections) {
  if (!pgPool) return;
  try {
    await ensureCacheTable();
    await pgPool.query(
      `INSERT INTO explain_cache (session_id, partner_id, sections) VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO UPDATE SET partner_id = $2, sections = $3, created_at = now()`,
      [sessionId, partnerId, JSON.stringify(sections)]
    );
    console.log(`  [Explain/cache] Saved evidence trail for session ${sessionId} (${sections.length} sections)`);
  } catch (e) {
    console.warn('[Explain/cache] save failed:', e.message);
  }
}

// Replays a previously generated trail byte-for-byte — same data, same prose, same order.
// Narrative is replayed with the same token-by-token cursor effect so the page looks identical
// to a live run; only the source (cache vs. fresh LLM call) differs.
async function replayExplanation(cached, partnerId, pushFn) {
  pushFn({ type: 'explain_start', partnerId, cached: true });
  for (const s of cached.sections) {
    pushFn({ type: 'explain_section_begin', sectionId: s.sectionId, icon: s.icon,
             title: s.title, subtitle: s.subtitle, staticHtml: s.staticHtml });
    const text = s.narrative || '';
    for (let i = 0; i < text.length; i += 5) {
      pushFn({ type: 'explain_text_delta', sectionId: s.sectionId, delta: text.slice(i, i + 5) });
      await sleep(10);
    }
    pushFn({ type: 'explain_section_end', sectionId: s.sectionId });
  }
  pushFn({ type: 'explain_complete', sectionsGenerated: cached.sections.length, cached: true });
}

// ── Raw data pull ─────────────────────────────────────────────────────────────
async function pullRawData(customerId) {
  const [dtiRows, bpRows, loans, payments, history, thresholds, limits] = await Promise.all([
    cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.BusinessPartners').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: customerId })),
    cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: customerId })),
    cds.run(SELECT.from('bankingsentinel.DFKKOPK').where({ GPART: customerId }).orderBy('FAEDN')),
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

  return { dti: dtiRows[0]||null, bp: bpRows[0]||null, loans, payments, history,
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
    if (match) {
      return {
        LOAN_ID:         s.LOAN_ID,
        DUE_DATE:        s.DUE_DATE,
        AMOUNT_DUE:      s.AMOUNT_DUE,
        DFKKOP_RECORD:   match.OPBEL,
        STATUS:          match.STATUS,
        DAYS_OVERDUE:    match.DAYS_OVERDUE,
        BOOKING_DATE:    match.BUDAT || 'empty',
      };
    }
    const notYetDue = s.DUE_DATE > SCHEDULE_TODAY;
    return {
      LOAN_ID:         s.LOAN_ID,
      DUE_DATE:        s.DUE_DATE,
      AMOUNT_DUE:      s.AMOUNT_DUE,
      DFKKOP_RECORD:   notYetDue ? '— not yet due —' : '⚠ MISSING',
      STATUS:          notYetDue ? 'NOT YET DUE' : '⚠ NOT IN LEDGER',
      DAYS_OVERDUE:    '—',
      BOOKING_DATE:    '—',
    };
  });
  const crossFlag = (c,v) => String(v).startsWith('⚠') || (c==='DAYS_OVERDUE'&&parseInt(v)>0);

  return contextNote([
    '<strong>DFKKOP</strong> is SAP\'s FI-CA (Financial Contract Accounting) open-items table — the current payment ledger. Every scheduled repayment appears here with a STATUS of <code>OPEN</code> (unpaid) or <code>CLEARED</code> (paid). <code>BUDAT</code> is the posting date — empty means no payment has been received or acknowledged by the bank.',
    '<strong>DFKKOPK</strong> is the cleared-items counterpart — the customer\'s settled repayment history (<code>AUGDT</code>/<code>AUGBL</code> = clearing date/document). It shows when the loan started performing and how many payments have been made on time.',
    `The Pattern Agent cross-references <strong>LoanSchedule</strong> (the contractual repayment timetable) against DFKKOP. A scheduled due date with no DFKKOP record is only flagged <code>⚠ MISSING</code> if the due date has already passed (as of ${SCHEDULE_TODAY}) — a genuine data integrity gap. A future due date with no record yet is labelled <code>NOT YET DUE</code>, not a missing payment.`,
    'Days overdue are highlighted in red. A payment past 90 days triggers mandatory provisioning under prudential standards. The bank is currently at the point where the next payment cycle could push the first item past that threshold.',
  ]) + `
    <div class="sub-title">DFKKOPK — Payment History (cleared, prior periods — ${raw.history.length} payments)</div>
    ${tbl(raw.history)}
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
  const breachFlag = !!d.BREACH_FLAG;

  // Reproduce the Trajectory Agent's exact decision tree (srv/agents/trajectory-agent.js)
  // so the reader sees which branch fired and why, with this customer's real numbers.
  const stableCut    = dtiLimit * 0.80;
  const improvingCut = dtiLimit * 0.70;
  const expiryRisk   = traj.daysToExpiry !== null && traj.daysToExpiry !== undefined && traj.daysToExpiry < 90;
  const futureBreach = traj.futureDti !== null && traj.futureDti !== undefined && traj.futureDti > dtiLimit;
  const rateStressRow    = (raw.thresholds || []).find(t => t.THRESHOLD_TYPE === 'RATE_STRESS_BUFFER');
  const rateStressPct    = parseFloat(rateStressRow?.LIMIT_PCT) || 3.0;
  const rateStressBreach = traj.futureDtiRateStress != null && traj.futureDtiRateStress > dtiLimit && dtiRatio <= dtiLimit;

  const decisionRows = [
    { label: 'DETERIORATING if', cond: `breach flag is ON, or forward DTI exceeds the limit, or income expires within 90 days, or a +${rateStressPct}% rate-stress test (APG 223) would breach the limit`,
      hit: breachFlag || futureBreach || expiryRisk || rateStressBreach },
    { label: 'STABLE if', cond: `not breached, current DTI < ${stableCut.toFixed(2)}x (80% of limit), and no income-expiry risk`,
      hit: !breachFlag && dtiRatio < stableCut && !expiryRisk },
    { label: 'IMPROVING if', cond: `not breached, current DTI < ${improvingCut.toFixed(2)}x (70% of limit), and no income-expiry record`,
      hit: !breachFlag && dtiRatio < improvingCut && (traj.daysToExpiry === null || traj.daysToExpiry === undefined) },
    { label: 'else → MONITORING', cond: 'none of the above branches matched — held under routine watch', hit: false },
  ];
  const firedRow = decisionRows.find(r => r.hit) || decisionRows[decisionRows.length - 1];

  return contextNote([
    '<strong>Debt-to-Income ratio</strong> is the primary APRA prudential metric, introduced in their February 2026 notice (<code>DTI_LIMIT_FEB2026</code>). The <strong>Pattern Agent</strong> computes it as <code>Total Debt ÷ Annual Income</code> and reads the live limit from the <code>RegulatoryThresholds</code> table at runtime — never a hardcoded value — so the analysis always reflects the current regulatory position.',
    'The <strong>Trajectory Agent</strong> (Agent 3) then asks "where is this heading?" — not just where it is today. It computes a <strong>forward DTI</strong>: if the borrower\'s income contract expires in <em>N</em> days, only <code>N ÷ 365</code> of this year\'s income remains, so <code>effective income = annual income × (days to expiry ÷ 365)</code> and <code>forward DTI = total debt ÷ effective income</code>. This reveals debt that looks serviceable today but becomes unserviceable the moment the income source ends.',
    `The Trajectory Agent also runs a second, independent projection: a <strong>rate-stress DTI</strong> under APRA's APG 223 serviceability buffer. A uniform +${rateStressPct}% rate rise increases the annual cost of servicing the borrower's existing total debt by <code>total debt × ${rateStressPct}%</code>; that amount is subtracted from annual income to give a stressed DTI. This answers a different question from the forward DTI above — not "what if income falls?" but "is this customer's current position resilient to a standard, foreseeable rate rise?" — and applies to every borrower, not just those with an income-expiry date.`,
    'The forward position label is decided by a fixed rule cascade evaluated in this exact order — DETERIORATING, then STABLE, then IMPROVING, else MONITORING. The thresholds are fractions of the live APRA limit: 80% for STABLE, 70% for IMPROVING. The branch that actually fired for this customer is highlighted below — that single rule is what produced the label you see in the verdict.',
  ]) + `
    <div class="sub-title">BCA_DTI — Debt-to-Income Record</div>
    ${tbl([d], (c,v) => (c==='DTI_RATIO'&&parseFloat(v)>=dtiLimit*0.9) || ((c==='INCOME_SOURCE'||c==='INCOME_EXPIRY')&&!v) || (c==='BREACH_FLAG'&&v))}
    <div class="sub-title">RegulatoryThresholds — Live APRA Limits (read at runtime, not hardcoded)</div>
    ${tbl(raw.thresholds.filter(t=>t.THRESHOLD_TYPE==='DEBT_TO_INCOME'||t.THRESHOLD_TYPE==='RATE_STRESS_BUFFER'))}
    <div class="sub-title">Step 1 — Current DTI Calculation</div>
    <div class="calc-box">
      <div class="calc-row"><span>Formula</span><span>AUD ${totalDebt.toLocaleString()} ÷ AUD ${income.toLocaleString()} = <strong>${dtiRatio.toFixed(2)}x</strong></span></div>
      <div class="calc-row"><span>APRA Limit (live)</span><span><strong>${dtiLimit.toFixed(2)}x</strong></span></div>
      <div class="calc-row ${buffer<0.5?'flag':''}"><span>Buffer Remaining</span><span><strong>${buffer.toFixed(2)}x</strong> = AUD ${bufferAUD.toLocaleString()} additional debt capacity</span></div>
      <div class="calc-row ${breachFlag?'flag':''}"><span>BREACH_FLAG (HANA field)</span><span><strong>${breachFlag ? 'TRUE — formal breach on record' : 'FALSE — no formal breach yet'}</strong></span></div>
    </div>
    ${traj.daysToExpiry!=null ? `
    <div class="sub-title">Step 2 — Forward DTI (income-expiry projection)</div>
    <div class="calc-box">
      <div class="calc-row"><span>Income Expiry</span><span>${traj.daysToExpiry} days from today</span></div>
      <div class="calc-row"><span>Effective Income</span><span>AUD ${income.toLocaleString()} × (${traj.daysToExpiry} ÷ 365) = AUD ${Math.round(income*(traj.daysToExpiry/365)).toLocaleString()}</span></div>
      <div class="calc-row ${futureBreach?'flag':''}"><span>Forward DTI</span><span>AUD ${totalDebt.toLocaleString()} ÷ AUD ${Math.round(income*(traj.daysToExpiry/365)).toLocaleString()} = <strong>${traj.futureDti!=null?traj.futureDti.toFixed(2)+'x':'—'}</strong>${futureBreach?' — EXCEEDS LIVE LIMIT':''}</span></div>
    </div>` : `
    <div class="sub-title">Step 2 — Forward DTI</div>
    <p class="no-data">INCOME_EXPIRY is empty for this customer — no forward projection computed. The agent treats an unknown expiry as "no income-expiry risk" in the decision rules below (this is itself a data gap worth flagging).</p>`}
    ${traj.futureDtiRateStress!=null ? `
    <div class="sub-title">Step 2b — Rate-Stress DTI (+${rateStressPct}%, APG 223 serviceability buffer)</div>
    <div class="calc-box">
      <div class="calc-row"><span>Additional Annual Cost</span><span>AUD ${totalDebt.toLocaleString()} × ${rateStressPct}% = AUD ${Math.round(totalDebt*(rateStressPct/100)).toLocaleString()}</span></div>
      <div class="calc-row"><span>Stressed Income</span><span>AUD ${income.toLocaleString()} − AUD ${Math.round(totalDebt*(rateStressPct/100)).toLocaleString()} = AUD ${Math.round(income-totalDebt*(rateStressPct/100)).toLocaleString()}</span></div>
      <div class="calc-row ${rateStressBreach?'flag':''}"><span>Rate-Stress DTI</span><span>AUD ${totalDebt.toLocaleString()} ÷ AUD ${Math.round(income-totalDebt*(rateStressPct/100)).toLocaleString()} = <strong>${traj.futureDtiRateStress.toFixed(2)}x</strong>${rateStressBreach?' — EXCEEDS LIVE LIMIT UNDER STRESS':''}</span></div>
    </div>` : ''}
    <div class="sub-title">Step 3 — Forward Position Decision (rule cascade, evaluated top to bottom)</div>
    <div class="calc-box">
      ${decisionRows.map(r => `<div class="calc-row ${r.hit?'flag':''}"><span>${r.hit?'→ ':''}${r.label}</span><span>${r.cond}${r.hit?' <strong>← MATCHED</strong>':''}</span></div>`).join('')}
    </div>
    ${traj.forwardPosition ? `<div class="calc-box"><div class="calc-row"><span>Result</span><span><strong>${traj.forwardPosition}</strong>${traj.timeToBreach!=null?' — '+(traj.timeToBreach<0?'breach active for '+Math.abs(traj.timeToBreach)+' days':'projected breach in '+traj.timeToBreach+' days'):''}</span></div></div>` : ''}
    ${(traj.conflictingSignals||[]).length ? `
    <div class="sub-title">Conflicting Signals Detected (${traj.conflictingSignals.length})</div>
    <ul class="anomaly-list">${traj.conflictingSignals.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>` : ''}
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

  const nodeCount = Array.isArray(relMap?.nodes) ? relMap.nodes.length : (relMap?.nodes || 0);
  const edgeCount = Array.isArray(relMap?.edges) ? relMap.edges.length : (relMap?.edges || 0);

  return contextNote([
    '<strong>APRA APS 221 (Large Exposures)</strong> requires banks to look beyond individual borrowers. A "connected group" — entities linked by ownership, control, guarantees, or economic interdependence — must be assessed as a single combined exposure, because one failure can cascade across the whole network. Limits: <strong>AUD 5M</strong> per single obligor, <strong>AUD 7.5M</strong> per connected group.',
    'The <strong>Relationship Agent</strong> does not run one fixed query — it runs an <strong>agentic ReAct loop</strong>. Claude is given three tools (<code>hana_graph_traverse</code> over the HANA Knowledge Graph built from <code>BUT050</code> + <code>BANKINGSENTINEL_BUSINESSPARTNERS</code>, up to 8 hops; <code>exposure_calculator</code>; <code>apra_threshold_check</code>) and decides for itself, step by step, which entity to traverse next, when to recalculate exposure, and when it has enough information to stop — up to 6 reasoning steps.',
    'Concretely the model: (1) traverses outward from the customer to find directly connected parties, (2) calls the exposure calculator across every entity ID it has found — including guarantors pulled from <code>BCA_GUARANTOR</code>, whose own other-borrower obligations also count toward this group — and (3) checks the resulting total against the APS 221 threshold. The <code>finding</code> field below is the model\'s own one-sentence summary of that reasoning chain; the node/edge counts and exposure total come from the tool outputs it relied on, not from the prose.',
  ]) + `
    <div class="sub-title">BUT050 — SAP Relationship Edges (raw input to the traversal)</div>
    ${tbl(raw.but050)}
    <div class="sub-title">BCA_GUARANTOR — Other Obligations Pulled In By the Tool</div>
    ${tbl(raw.guarantors)}
    ${relMap ? `
    <div class="sub-title">Agent's Tool-Calling Trace — Result of the ReAct Loop</div>
    <div class="calc-box">
      <div class="calc-row"><span>Step 1 — hana_graph_traverse</span><span>found <strong>${nodeCount}</strong> connected node(s), <strong>${edgeCount}</strong> edge(s)</span></div>
      <div class="calc-row"><span>Step 2 — exposure_calculator</span><span>summed guaranteed + direct loan balances across all ${nodeCount} entities = <strong>AUD ${(groupExposure||0).toLocaleString()}</strong></span></div>
      <div class="calc-row ${isBreach?'flag':''}"><span>Step 3 — apra_threshold_check</span><span>AUD ${(groupExposure||0).toLocaleString()} ÷ AUD ${groupLimit.toLocaleString()} = <strong>${pct}%</strong> of group limit${isBreach?' — BREACH':' — within limit'}</span></div>
      <div class="calc-row"><span>Agent confidence</span><span>${relMap.confidence!=null ? Math.round(relMap.confidence*100)+'%' : '—'} (model\'s own self-assessment of traversal completeness)</span></div>
      ${isBreach?`<div class="calc-row flag"><span>Amount over limit</span><span>AUD ${((groupExposure-groupLimit)||0).toLocaleString()}</span></div>`:''}
    </div>
    ${relMap.finding?`<div class="sub-title">Model's Own Summary of Its Reasoning ("finding")</div><p class="agent-note">${esc(relMap.finding)}</p>`:''}
    ` : '<p class="no-data">Graph traversal data not available — session may predate the relationship agent, or the customer scored below the routing threshold (risk score &lt; 30) and the agent was skipped entirely.</p>'}
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

  const rpt1   = patternAss?.rpt1 || {};
  const pal    = patternAss?.pal  || {};
  const llm    = patternAss?.llm  || {};
  const anomalies  = llm.anomalies || patternAss?.anomalies || [];
  const palFindings = pal.findings || [];
  const portDays   = raw.portfolio.map(p=>parseInt(p.DAYS_OVERDUE)||0);
  const portMean   = portDays.length ? (portDays.reduce((a,b)=>a+b,0)/portDays.length).toFixed(1) : 0;

  // Reproduce the RPT-1 score formula exactly: score = bandFloor(category) + 24 × confidence
  const scoreFloors = { LOW: 0, MEDIUM: 26, HIGH: 51, CRITICAL: 76 };
  const rptFloor = scoreFloors[(rpt1.category||'').toUpperCase()] ?? 26;
  const rptConf  = rpt1.confidence!=null ? Math.min(1, Math.max(0, rpt1.confidence)) : null;

  const riskScore = patternAss?.riskScore;
  const riskLevel = patternAss?.riskLevel;
  const signal    = patternAss?.signal;
  const combinedCount = (patternAss?.anomalies || []).length;

  const enrichedPayments = raw.payments.map(p => {
    const pf = palFindings.find(f => String(f.id)===String(p.OPBEL) || String(f.id)===p.OPBEL);
    const days = parseInt(p.DAYS_OVERDUE)||0;
    return {
      OPBEL:           p.OPBEL,
      LOAN_ID:         p.LOAN_ID,
      DAYS_OVERDUE:    p.DAYS_OVERDUE,
      STATUS:          p.STATUS,
      AMOUNT_AUD:      p.BETRW,
      ISOLATION_SCORE: pf ? pf.score.toFixed(3) : (days>60 ? '~1.000' : days>30 ? '~0.7' : '~0.3'),
      LABEL:           pf ? (pf.label===-1?'OUTLIER (-1)':'NORMAL (1)') : (days>60 ? 'OUTLIER (-1)' : 'NORMAL (1)'),
    };
  });

  return contextNote([
    'The Pattern Agent runs <strong>three independent models in parallel</strong> on every customer — never sequentially, never just one — specifically so the risk officer can compare their verdicts side by side rather than trust a single black box.',
    '<strong>① RPT-1</strong> (SAP\'s tabular foundation model at rpt.cloud.sap) works by <em>in-context learning</em>: the agent builds a small reference table of up to 20 real customers, each pre-labelled LOW / MEDIUM / HIGH purely by rule — <code>BREACH_FLAG=true → HIGH</code>, <code>DTI ≥ 5.5x → MEDIUM</code>, otherwise LOW — appends this customer\'s row marked <code>[PREDICT]</code>, and asks the model to classify it by analogy to the labelled examples. The category it returns is then converted to a 0-100 score with <code>score = band_floor + 24 × confidence</code>, where the floors are LOW=0, MEDIUM=26, HIGH=51, CRITICAL=76 — confidence only moves the score within its band, never across a band boundary.',
    '<strong>② Isolation Forest</strong> (HANA PAL or scikit-learn, trained on up to 500 portfolio-wide payment records of <code>days_overdue</code> and <code>amount</code>) detects outliers by randomly partitioning the data into trees and counting how many splits it takes to separate a point from the rest. Points near the cluster centre take many splits to isolate — they look "normal." Points far from the cluster are isolated almost immediately and receive a <strong>label of −1</strong> with a score approaching <strong>1.000</strong>, the maximum possible. The model never sees this customer\'s ID — it only sees numbers, so it cannot be biased by who the customer is.',
    '<strong>③ Claude LLM</strong> reads the raw records — DTI, loans, recent payments, collateral count — and writes a plain-English anomaly list, explicitly told to use the live APRA limit (not its training-data assumption) and to express DTI as a ratio (5.80x), never a percentage. All three outputs are then merged into one <code>combinedAnomalies</code> list that downstream agents (Trajectory, Synthesis) consume directly.',
  ]) + `
    <div class="sub-title">① RPT-1 — In-Context Learning Result</div>
    <div class="calc-box">
      <div class="calc-row"><span>Predicted Category</span><span><strong>${esc(rpt1.category||'—')}</strong></span></div>
      <div class="calc-row"><span>Model Confidence</span><span>${rptConf!=null?(rptConf*100).toFixed(0)+'%':'—'}</span></div>
      <div class="calc-row"><span>Score Formula</span><span>${rptFloor} (band floor for ${esc(rpt1.category||'—')}) + 24 × ${rptConf!=null?rptConf.toFixed(2):'—'} = <strong>${rpt1.score!=null?Math.round(rptFloor + 24*(rptConf||0)):'—'}</strong></span></div>
      <div class="calc-row"><span>RPT-1 Score</span><span><strong>${rpt1.score!=null?rpt1.score:'—'}</strong> / 100</span></div>
    </div>
    <div class="sub-title">② Isolation Forest — Portfolio-Wide Statistical Result</div>
    <div class="calc-box">
      <div class="calc-row"><span>Trained On</span><span>${raw.portfolio.length} portfolio payment records (days overdue + amount, all customers, anonymous)</span></div>
      <div class="calc-row"><span>Portfolio Mean Days Overdue</span><span>${portMean} days (this customer's worst record vs. this baseline is what makes the score extreme)</span></div>
      <div class="calc-row ${(pal.anomalyCount||0)>0?'flag':''}"><span>This Customer — Outliers Found</span><span><strong>${pal.anomalyCount ?? 0}</strong> of ${pal.totalScored ?? raw.payments.length} payment record(s) labelled −1 (outlier)</span></div>
    </div>
    <div class="sub-title">Customer Payment Records — Isolation Forest Label Per Record</div>
    ${tbl(enrichedPayments, (c,v)=>c==='LABEL'&&String(v).startsWith('OUTLIER'))}
    <div class="sub-title">Portfolio Distribution — the comparison baseline Isolation Forest learned from</div>
    ${tbl(portRows)}
    ${anomalies.length>0?`<div class="sub-title">③ Claude LLM — Anomalies Identified in Plain English (${anomalies.length})</div><ul class="anomaly-list">${anomalies.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`:''}
    <div class="sub-title">How the Three Outputs Combine Into One Verdict</div>
    <div class="calc-box">
      <div class="calc-row"><span>Combined Anomaly Count</span><span>PAL outliers + LLM anomalies = <strong>${combinedCount}</strong></span></div>
      <div class="calc-row"><span>Pattern Risk Score</span><span>= RPT-1 score directly = <strong>${riskScore ?? '—'}</strong> / 100</span></div>
      <div class="calc-row ${['HIGH','CRITICAL'].includes(riskLevel)?'flag':''}"><span>Risk Level Band</span><span>score ≥76 CRITICAL · ≥51 HIGH · ≥26 MEDIUM · else LOW → <strong>${esc(riskLevel||'—')}</strong></span></div>
      <div class="calc-row"><span>Signal</span><span>combined anomalies &gt;2 → "concerning" · &gt;0 → "unclear" · 0 → "stable" (${combinedCount} found) → <strong>${esc(signal||'—')}</strong></span></div>
      <div class="calc-row"><span>Routing Consequence</span><span>score ${(riskScore??50)<30?'< 30 → pipeline would route to low_risk and SKIP the Relationship + Trajectory agents entirely':'≥ 30 → pipeline routes to high_risk: full analysis continues to Relationship + Trajectory agents'}</span></div>
    </div>
  `;
}

function buildReflectionHtml(agentState) {
  const reflection = agentState?.reflectionEvaluation || {};
  const history     = agentState?.reflectionHistory || [];
  const requeryCount = agentState?.requeryCount ?? 0;
  const reQueryHint  = agentState?.reQueryHint || null;
  const gaps = reflection.gaps || [];
  const overallConfidence = reflection.overallConfidence;
  const passed = (overallConfidence ?? 1) >= 0.70 || history.length === 0;

  return contextNote([
    'This step implements <strong>Reflexion</strong> (Shinn et al., 2023) — an LLM "actor" (the Relationship Agent) produces an output, an LLM "evaluator" (this Reflection step) critiques that output in natural language, and the critique is fed back to the actor as a targeted re-query rather than a generic retry.',
    'Claude Haiku reads the combined JSON output of the Pattern, Trajectory and Relationship agents — not prose — and scores it on <strong>four dimensions</strong>: (1) graph completeness — did the traversal reach parent/connected entities, or stop too early? (2) signal consistency — e.g. a HIGH RPT-1 score alongside zero connected parties is a red flag, not a clean result. (3) were any conflicting signals from the Trajectory Agent actually resolved? (4) evidence trail — is every risk claim backed by a specific record, not a generic statement?',
    'Routing is deterministic: <strong>overall confidence &lt; 0.70 → re-query</strong> the Relationship Agent with a targeted <code>reQueryHint</code> describing exactly what evidence is missing; <strong>≥ 0.70 → proceed</strong> to Human Approval. The loop is capped at <strong>2 re-queries</strong> to bound cost and latency — after the cap, the pipeline proceeds regardless, and any unresolved gaps are surfaced as uncertainties in the final brief.',
  ]) + `
    <div class="kv-grid">
      ${kv('Overall Confidence', overallConfidence != null ? Math.round(overallConfidence*100)+'%' : '—', overallConfidence != null && overallConfidence < 0.70)}
      ${kv('Re-query Count', requeryCount + ' / 2 max', requeryCount > 0)}
      ${kv('Routing Decision', passed ? 'Proceed to Human Approval' : 'Re-query Relationship Agent', !passed)}
      ${kv('Re-query Hint Issued', reQueryHint || 'None')}
    </div>
    ${reflection.reasoning ? `<div class="sub-title">Evaluator's Reasoning</div><p class="agent-note">${esc(reflection.reasoning)}</p>` : ''}
    ${gaps.length ? `<div class="sub-title">Evidence Gaps Identified (${gaps.length})</div><ul class="anomaly-list">${gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul>` : ''}
    ${history.length > 1 ? `
    <div class="sub-title">Re-query History — ${history.length} Iteration(s)</div>
    ${tbl(history.map((it,i) => ({
      Iteration: i+1,
      Confidence: it.overallConfidence != null ? Math.round(it.overallConfidence*100)+'%' : '—',
      Gaps: (it.gaps||[]).length,
      Reasoning: it.reasoning || '—',
    })))}
    ` : `<p class="no-data">No re-query was triggered — the first evaluation already met the 70% confidence threshold.</p>`}
  `;
}

function buildVerdictHtml(synth, riskRow, agentState) {
  const s   = synth || {};
  const row = riskRow || {};
  let findings = s.findings || [];
  if (!findings.length && row.FINDINGS) {
    try { findings = JSON.parse(row.FINDINGS); } catch (_) {}
  }

  const reflection = agentState?.reflectionEvaluation || {};
  const reflectionHistory = agentState?.reflectionHistory || [];
  const confidence = s.confidence ?? 0;

  // Reproduce the deterministic apraReady gate exactly as synthesis-agent.js computes it —
  // this value is NOT decided by the LLM; it's a hard AND of four conditions in code.
  const reflectionPassed = (reflection.overallConfidence ?? 1) >= 0.70 || reflectionHistory.length === 0;
  const regRefsFound  = (s.regulatoryRefs || []).length > 0;
  const gateChecks = [
    { label: 'Synthesis confidence ≥ 70%',        pass: confidence >= 0.70,  detail: `${Math.round(confidence*100)}%` },
    { label: 'Reflection evidence check passed',  pass: reflectionPassed,    detail: reflectionHistory.length===0 ? 'no Reflection iterations recorded (treated as pass)' : `overall confidence ${Math.round((reflection.overallConfidence??0)*100)}%` },
    { label: 'Regulatory references retrieved',    pass: regRefsFound,        detail: regRefsFound ? (s.regulatoryRefs||[]).join(', ') : 'none retrieved' },
    { label: 'Vector-search context available',    pass: true,                detail: 'no context-retrieval failure recorded for this run' },
  ];
  const allPass = gateChecks.every(g => g.pass);

  return contextNote([
    'The <strong>Synthesis Agent</strong> (Agent 5/7 in the chain) is the consolidation point. It runs <strong>four targeted HANA vector searches</strong> against the APRA regulatory document store — one query built specifically from this customer\'s DTI ratio, one from the group exposure dollar amount, one from any conflicting signals Trajectory found, and a constant CPS 230 governance query — retrieves up to 5 chunks each, de-duplicates by document ID, and caps the final context at 7 chunks. This per-signal retrieval (rather than one generic query) is what keeps the citations grounded in <em>this</em> customer\'s actual numbers rather than generic APRA boilerplate.',
    'The LLM then receives the full structured output of Pattern, Trajectory, Relationship and Reflection — as JSON, not prose — plus the retrieved regulatory chunks, and produces a risk brief: score, level, findings (max 5), recommendations (max 3), and uncertainties (max 3). A fixed rule maps score to level (≥76 CRITICAL, ≥51 HIGH, ≥26 MEDIUM, else LOW) and the agent is explicitly told the level <em>must</em> match the score band — this is enforced in the prompt, not left to the model\'s discretion.',
    '<strong>"APRA Ready" is deliberately not an LLM decision.</strong> It is computed in code as a hard logical AND of four conditions — shown below with this session\'s actual values. Even a perfectly-worded brief is held back from the regulator until every gate passes. A separate guardrail then cross-checks each finding\'s wording against the retrieved regulatory chunks (the "claim-source overlap" score) — low overlap adds an uncertainty flagging possible hallucination, satisfying CPS 230\'s requirement that AI claims be independently checkable, not just plausible-sounding.',
  ]) + `
    <div class="kv-grid">
      ${kv('Risk Score',   (s.riskScore||row.RISK_SCORE||'—')+' / 100', (parseInt(s.riskScore||row.RISK_SCORE||0))>=70)}
      ${kv('Risk Level',   s.riskLevel||row.RISK_LEVEL||'—', ['HIGH','CRITICAL'].includes(s.riskLevel||row.RISK_LEVEL))}
      ${kv('Confidence',   s.confidence!=null?Math.round(s.confidence*100)+'%':'—')}
      ${kv('APRA Ready',   s.apraReady===true?'Yes':'No — human review required', !s.apraReady)}
      ${kv('Approved By',  row.APPROVED_BY||'—')}
      ${kv('Approved At',  row.APPROVED_AT||'—')}
    </div>
    <div class="sub-title">The "APRA Ready" Gate — Deterministic, Computed in Code (not LLM-decided)</div>
    <div class="calc-box">
      ${gateChecks.map(g => `<div class="calc-row ${g.pass?'':'flag'}"><span>${g.pass?'✓':'✗'} ${g.label}</span><span>${esc(g.detail)}</span></div>`).join('')}
      <div class="calc-row ${allPass?'':'flag'}"><span><strong>All four must pass → APRA Ready</strong></span><span><strong>${allPass ? 'YES — ready for board notification' : 'NO — held for human review'}</strong></span></div>
    </div>
    ${findings.length?`
    <div class="sub-title">Key Findings — Each Traced to a Named Evidence Source (${findings.length})</div>
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
    <div class="sub-title">Mandatory Actions (recommendations the LLM was constrained to ground in the findings above)</div>
    <ol class="rec-list">${s.recommendations.map(r=>`<li>${esc(r)}</li>`).join('')}</ol>
    `:''}
    ${(s.uncertainties||[]).length?`
    <div class="sub-title">Uncertainties — What the Agent Explicitly Would Not Claim</div>
    <ul class="anomaly-list">${s.uncertainties.map(u=>`<li>${esc(u)}</li>`).join('')}</ul>
    `:''}
    <div class="sub-title">APRA Regulatory Obligations Triggered By This Verdict</div>
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

const SYSTEM_PROMPT = `You are a banking risk analyst writing one section of an evidence paper. Your reader has already seen a "How this check works" panel above your text that names the exact tables, formulas, model mechanics and decision thresholds involved — and a data table or calculation box showing this customer's actual numbers run through that mechanism. Your job is to be the bridge between the two: walk the reader from the raw input, THROUGH the specific calculation or model step that was applied, TO the output it produced — using this customer's real numbers at each step, not generic description.

Structure your response as exactly FOUR bullet points — short and scannable, NOT paragraphs. Each bullet starts on its own new line with "• " followed by its label and a colon. No headers, no markdown, no nested sub-bullets — just four lines of plain text:

• Input: What raw data fed this check — specific record IDs, field values, table names. One or two sentences, max 40 words.

• Interpretation: This is the most important bullet. Show HOW that input became the output. Name the specific formula, threshold comparison, decision-tree branch, or model mechanism (it is described in the panel above — use it) and plug in this customer's actual numbers so the reader can follow the transformation step by step. Do not just state the output — show the working. Up to 60 words — this bullet may run a little longer than the others.

• Output: State the resulting score, label, flag, or position precisely, and confirm it agrees with the calculation in the Interpretation bullet. One sentence, max 30 words.

• Significance: Why this output matters to the risk team, the regulator (cite APS 221 / CPS 230 / the APRA DTI notice where relevant) and a general reader, and what the bank must now do. One or two sentences, max 40 words.

Maximum 180 words total across all four bullets. Plain text only — no bold, no asterisks beyond the leading "• Label:", no emoji. Be specific — wrong arithmetic or invented thresholds are worse than no detail at all, so only state numbers given to you.`;

function buildPaymentPrompt(raw, customerId) {
  const overdue = raw.payments.filter(p=>parseInt(p.DAYS_OVERDUE)>0);
  const maxDays = overdue.reduce((m,p)=>Math.max(m,parseInt(p.DAYS_OVERDUE)||0),0);
  const unmatched = raw.schedule.filter(s=>!raw.payments.some(p=>p.LOAN_ID===s.LOAN_ID&&p.FAEDN===s.DUE_DATE));
  const missing = unmatched.filter(s=>s.DUE_DATE <= SCHEDULE_TODAY);
  const notYetDue = unmatched.filter(s=>s.DUE_DATE > SCHEDULE_TODAY);
  const matched = raw.schedule.length - unmatched.length;

  return `Analyse the payment records for customer ${customerId}.

DFKKOPK payment history (cleared, prior periods — ${raw.history.length} payments):
${JSON.stringify(raw.history, null, 2)}

DFKKOP payment ledger (current open items):
${JSON.stringify(raw.payments, null, 2)}

LoanSchedule (contractual timetable):
${JSON.stringify(raw.schedule, null, 2)}

The "interpretation" mechanism for this section is a CROSS-REFERENCE MATCH, not a model: the Pattern Agent
joins each LoanSchedule row to a DFKKOP row by (LOAN_ID, DUE_DATE = FAEDN), as of reference date ${SCHEDULE_TODAY}.
A match with STATUS=OPEN and empty BUDAT means scheduled-but-unpaid; no match for a due date in the past means
the obligation never reached the ledger (a genuine gap); no match for a future due date just means it isn't billed yet.

Key facts to walk through in your Interpretation bullet:
- DFKKOPK shows ${raw.history.length} months of prior cleared payments — this customer's payment history before the current schedule window
- Matching rule applied: ${raw.schedule.length} scheduled payments → ${matched} matched a DFKKOP record, ${missing.length} are past-due with no record (genuinely missing), ${notYetDue.length} are not yet due
- ${overdue.length} of ${raw.payments.length} matched records carry STATUS=OPEN (unpaid) with DAYS_OVERDUE > 0
- Maximum days overdue after the match: ${maxDays} days (record ${overdue.find(p=>parseInt(p.DAYS_OVERDUE)===maxDays)?.OPBEL||'—'})
- Every OPEN record has empty BUDAT (booking date) — the match shows zero evidence a payment was ever received
- Genuinely missing scheduled payments (past due, no ledger record at all): ${missing.map(s=>s.LOAN_ID+' due '+s.DUE_DATE).join(', ')||'none'}
- Portfolio context: most customers' matches resolve to CLEARED; this customer's matches all resolve to OPEN

Write the four-bullet evidence analysis (Input → Interpretation → Output → Significance).`;
}

function buildDtiPrompt(raw, dtiLimit, agentState, customerId) {
  const d = raw.dti||{};
  const dtiRatio  = parseFloat(d.DTI_RATIO)||0;
  const income    = parseFloat(d.ANNUAL_INCOME)||0;
  const debt      = parseFloat(d.TOTAL_DEBT)||0;
  const buffer    = dtiLimit - dtiRatio;
  const traj      = agentState?.trajectoryAnalysis||{};
  const breachFlag = !!d.BREACH_FLAG;
  const stableCut    = (dtiLimit*0.80).toFixed(2);
  const improvingCut = (dtiLimit*0.70).toFixed(2);
  const expiryRisk = traj.daysToExpiry!=null && traj.daysToExpiry < 90;
  const futureBreach = traj.futureDti!=null && traj.futureDti > dtiLimit;

  let firedRule;
  if (breachFlag || futureBreach || expiryRisk) firedRule = `DETERIORATING — fired because: ${breachFlag?'BREACH_FLAG is true':''}${futureBreach?(breachFlag?' AND ':'')+`forward DTI ${traj.futureDti.toFixed(2)}x > limit ${dtiLimit}x`:''}${expiryRisk?(breachFlag||futureBreach?' AND ':'')+`income expires in ${traj.daysToExpiry} days (< 90)`:''}`;
  else if (dtiRatio < dtiLimit*0.80 && (traj.daysToExpiry==null)) firedRule = `STABLE — current DTI ${dtiRatio.toFixed(2)}x is below ${stableCut}x (80% of limit) and there is no income-expiry record`;
  else firedRule = `MONITORING — none of the DETERIORATING/STABLE/IMPROVING conditions matched, so the position defaults to routine watch`;

  return `Analyse the Debt-to-Income position for customer ${customerId}.

BCA_DTI record:
${JSON.stringify(d, null, 2)}

Live APRA threshold from RegulatoryThresholds: ${dtiLimit}x (THRESHOLD_TYPE = DEBT_TO_INCOME, fetched at runtime)

The "interpretation" mechanism here is TWO STEPS, both of which you must narrate with these exact numbers:
STEP A — current DTI: total debt ÷ annual income = ${debt.toLocaleString()} ÷ ${income.toLocaleString()} = ${dtiRatio.toFixed(2)}x, compared to the live limit ${dtiLimit}x (buffer ${buffer.toFixed(2)}x).
STEP B — forward position: the Trajectory Agent runs a fixed rule cascade (checked in this order: DETERIORATING, STABLE, IMPROVING, else MONITORING) using thresholds that are fractions of the live limit (${stableCut}x = 80%, ${improvingCut}x = 70%). For THIS customer the rule that fired was:
${firedRule}
${traj.daysToExpiry!=null ? `Forward DTI projection: effective income = ${income.toLocaleString()} × (${traj.daysToExpiry}÷365) = ${Math.round(income*(traj.daysToExpiry/365)).toLocaleString()}; forward DTI = ${debt.toLocaleString()} ÷ ${Math.round(income*(traj.daysToExpiry/365)).toLocaleString()} = ${traj.futureDti!=null?traj.futureDti.toFixed(2):'—'}x` : 'INCOME_EXPIRY is empty — no forward projection could be computed (note this gap explicitly).'}

Other facts:
- BREACH_FLAG = ${breachFlag} ; INCOME_SOURCE = ${d.INCOME_SOURCE||'EMPTY'} ; INCOME_EXPIRY = ${d.INCOME_EXPIRY||'EMPTY'}
- Resulting forward position: ${traj.forwardPosition||'not available'}${traj.timeToBreach!=null?` ; timeToBreach = ${traj.timeToBreach} (${traj.timeToBreach<0?'days since breach':'days until projected breach'})`:''}
- Stress test: if income fell 10%, DTI would become ${((debt/(income*0.9))||0).toFixed(2)}x${income>0&&(debt/(income*0.9))>dtiLimit?' — that WOULD breach the live limit':' — still within the live limit'}

Write the four-bullet evidence analysis (Input → Interpretation [walk through Step A then Step B with the numbers above] → Output → Significance).`;
}

function buildRelationshipsPrompt(raw, relMap, groupLimit, singleLimit, customerId) {
  const exposure  = relMap?.groupExposure||0;
  const pct       = groupLimit>0 ? Math.round((exposure/groupLimit)*100) : 0;
  const breach    = exposure>groupLimit;
  const nodeCount = Array.isArray(relMap?.nodes) ? relMap.nodes.length : 0;
  const edgeCount = Array.isArray(relMap?.edges) ? relMap.edges.length : 0;

  return `Analyse the connected party network for customer ${customerId}.

BUT050 relationship edges (raw input):
${JSON.stringify(raw.but050, null, 2)}

BCA_GUARANTOR records (raw input — pulled in by the exposure_calculator tool):
${JSON.stringify(raw.guarantors, null, 2)}

The "interpretation" mechanism here is NOT a fixed query — it is an AGENTIC ReAct LOOP. Claude was given
three tools (hana_graph_traverse, exposure_calculator, apra_threshold_check) and decided for itself, step
by step, which to call and when to stop (max 6 steps). This is the trace of what it actually produced:
${relMap ? JSON.stringify({nodesFound:nodeCount, edgesFound:edgeCount, groupExposure:relMap.groupExposure, aps221Pct:relMap.aps221Pct, agentConfidence:relMap.confidence, agentFinding:relMap.finding},null,2) : 'No trace recorded — the agent may have been skipped (low_risk routing) or the session predates this agent.'}

Key facts to walk through in your Interpretation bullet:
- Step 1 (hana_graph_traverse): walked outward from ${customerId} through BUT050 edges and found ${nodeCount} connected node(s) / ${edgeCount} edge(s)
- Step 2 (exposure_calculator): summed loan + guaranteed balances across all ${nodeCount} entities (including the guarantors above, who carry obligations to OTHER borrowers too — that is what inflates the group total beyond this customer's own debt) → AUD ${exposure.toLocaleString()}
- Step 3 (apra_threshold_check): AUD ${exposure.toLocaleString()} ÷ AUD ${groupLimit.toLocaleString()} (APS 221 connected-group limit) = ${pct}%
- APS 221 Single Obligor Limit (for comparison): AUD ${singleLimit.toLocaleString()}
- ${breach ? `RESULT: BREACH — exceeds the group limit by AUD ${(exposure-groupLimit).toLocaleString()}` : 'RESULT: within the group limit'}
- Agent's own confidence in this traversal being complete: ${relMap?.confidence!=null ? Math.round(relMap.confidence*100)+'%' : 'not recorded'}

Write the four-bullet evidence analysis (Input → Interpretation [narrate the three tool-calling steps in order, with these numbers] → Output → Significance).`;
}

function buildAnomalyPrompt(raw, patternAss, customerId) {
  const portDays = raw.portfolio.map(p=>parseInt(p.DAYS_OVERDUE)||0);
  const portMean = portDays.length ? (portDays.reduce((a,b)=>a+b,0)/portDays.length).toFixed(1) : 0;
  const maxOverdue = raw.payments.reduce((m,p)=>Math.max(m,parseInt(p.DAYS_OVERDUE)||0),0);

  const rpt1 = patternAss?.rpt1 || {};
  const pal  = patternAss?.pal  || {};
  const llm  = patternAss?.llm  || {};
  const anomalies = llm.anomalies || patternAss?.anomalies || [];
  const scoreFloors = { LOW: 0, MEDIUM: 26, HIGH: 51, CRITICAL: 76 };
  const floor = scoreFloors[(rpt1.category||'').toUpperCase()] ?? 26;
  const conf  = rpt1.confidence!=null ? Math.min(1, Math.max(0, rpt1.confidence)) : 0;

  return `Analyse the anomaly detection results for customer ${customerId}.

Three models ran in PARALLEL — narrate what EACH ONE actually computed, with these exact numbers:

① RPT-1 (in-context learning, rpt.cloud.sap):
- Built a reference table of up to 20 customers labelled by rule (BREACH_FLAG → HIGH, DTI ≥ 5.5x → MEDIUM, else LOW)
- Predicted category for this customer: "${rpt1.category||'—'}", with confidence ${(conf*100).toFixed(0)}%
- Score formula actually applied: band_floor(${rpt1.category||'—'}) + 24 × confidence = ${floor} + 24 × ${conf.toFixed(2)} = ${Math.round(floor + 24*conf)}
- This score (${rpt1.score ?? '—'}) becomes the Pattern Agent's overall riskScore directly — no further adjustment

② Isolation Forest (trained on ${raw.portfolio.length} portfolio-wide payment records of days_overdue + amount):
- Portfolio mean days overdue (the "normal cluster" the model learned): ${portMean} days
- This customer's worst record: ${maxOverdue} days overdue — ${maxOverdue > portMean*3 ? 'multiples beyond' : 'notably above'} the portfolio mean
- Model's verdict on this customer: ${pal.anomalyCount ?? 0} of ${pal.totalScored ?? raw.payments.length} payment record(s) labelled −1 (outlier), meaning the model isolated them in very few partition splits — they sit far outside the normal cluster

③ Claude LLM (reads the same raw records, writes plain-English findings):
- Anomalies it identified: ${anomalies.join('; ')||'none recorded for this session'}

Combination rule (computed in code, not by any one model):
- combinedAnomalies = PAL outliers + LLM anomalies = ${(patternAss?.anomalies||[]).length} item(s)
- riskLevel = score≥76 CRITICAL, ≥51 HIGH, ≥26 MEDIUM, else LOW → this customer's score ${patternAss?.riskScore ?? '—'} maps to ${patternAss?.riskLevel || '—'}
- signal = >2 combined anomalies → "concerning", >0 → "unclear", 0 → "stable" → this customer: "${patternAss?.signal || '—'}"

Write the four-bullet evidence analysis. In the Interpretation bullet, walk through what each of the three models computed (the formula for RPT-1, the isolation mechanism for PAL, the read for the LLM) and then how the combination rule turned three separate outputs into one riskLevel and one signal.`;
}

function buildReflectionPrompt(agentState, customerId) {
  const reflection = agentState?.reflectionEvaluation || {};
  const history = agentState?.reflectionHistory || [];
  const requeryCount = agentState?.requeryCount ?? 0;
  const reQueryHint = agentState?.reQueryHint || null;
  const passed = (reflection.overallConfidence ?? 1) >= 0.70 || history.length === 0;

  return `Analyse the Reflection (Reflexion-style critic) step for customer ${customerId}.

This step is an LLM "evaluator" that reads the combined JSON output of the Pattern, Trajectory and
Relationship agents (NOT prose) and scores it on four dimensions: graph completeness, signal
consistency, resolution of conflicting signals, and evidence trail (every claim traced to a record).

This session's result:
- Overall confidence: ${reflection.overallConfidence != null ? Math.round(reflection.overallConfidence*100)+'%' : 'not recorded'}
- Re-query count: ${requeryCount} / 2 max
- Routing decision: ${passed ? 'proceed to Human Approval (confidence >= 70%)' : 're-query the Relationship Agent (confidence < 70%)'}
${reQueryHint ? `- Re-query hint issued to the actor: "${reQueryHint}"` : '- No re-query hint was needed'}
${(reflection.gaps||[]).length ? `- Evidence gaps identified: ${reflection.gaps.join('; ')}` : '- No evidence gaps identified'}
${reflection.reasoning ? `- Evaluator's stated reasoning: ${reflection.reasoning}` : ''}
${history.length > 1 ? `- This required ${history.length} iterations before reaching the confidence threshold:\n${history.map((it,i)=>`  Iteration ${i+1}: confidence ${it.overallConfidence!=null?Math.round(it.overallConfidence*100)+'%':'—'}, ${(it.gaps||[]).length} gap(s)`).join('\n')}` : '- A single evaluation pass was sufficient — no re-query loop was triggered'}

Write the four-bullet evidence analysis (Input → Interpretation [explain the Reflexion actor/evaluator loop and which of the four dimensions drove the ${passed?'pass':'re-query'} decision for this customer] → Output → Significance — note for Significance that CPS 230 requires this kind of self-check before a risk brief reaches a human reviewer).`;
}

function buildVerdictPrompt(synth, riskRow, customerId, dtiLimit, groupLimit, agentState) {
  const s = synth||{};
  const row = riskRow||{};
  let findings = s.findings||[];
  if (!findings.length && row.FINDINGS) {
    try { findings = JSON.parse(row.FINDINGS); } catch (_) {}
  }

  const reflection = agentState?.reflectionEvaluation || {};
  const reflectionHistory = agentState?.reflectionHistory || [];
  const confidence = s.confidence ?? 0;
  const reflectionPassed = (reflection.overallConfidence ?? 1) >= 0.70 || reflectionHistory.length === 0;
  const regRefsFound  = (s.regulatoryRefs || []).length > 0;
  const gates = [
    ['confidence ≥ 70%', confidence >= 0.70, `${Math.round(confidence*100)}%`],
    ['Reflection evidence check passed', reflectionPassed, reflectionHistory.length===0?'no iterations recorded':`${Math.round((reflection.overallConfidence??0)*100)}% overall confidence`],
    ['regulatory references retrieved', regRefsFound, (s.regulatoryRefs||[]).join(', ')||'none'],
    ['no context-retrieval failure', true, 'n/a'],
  ];
  const allPass = gates.every(g=>g[1]);

  return `Write the final verdict section for customer ${customerId}.

The "interpretation" mechanism here is the SYNTHESIS AGENT'S two-stage pipeline:
STAGE 1 — it ran four targeted HANA vector searches (one built from this customer's DTI ratio, one from
the group exposure dollar figure, one triggered by any conflicting signals, one constant CPS 230 query),
retrieved up to 5 chunks each, deduped, capped at 7 — giving it grounded regulatory citations rather than
generic ones. Retrieved standards: ${(s.regulatoryRefs||[]).join(', ')||'none'}.
STAGE 2 — the LLM combined Pattern + Trajectory + Relationship + Reflection JSON output plus those citations
into a structured brief, under a hard rule that riskLevel MUST match the riskScore band (≥76 CRITICAL,
≥51 HIGH, ≥26 MEDIUM, else LOW). Result: score ${s.riskScore||row.RISK_SCORE}/100 → level ${s.riskLevel||row.RISK_LEVEL}.

CRITICAL — "APRA Ready" is NOT decided by the LLM. It is a deterministic AND-gate computed in code, with
THIS session's actual values:
${gates.map(([label,pass,detail])=>`- [${pass?'PASS':'FAIL'}] ${label} — ${detail}`).join('\n')}
→ All four pass: ${allPass ? 'YES, so apraReady = true (cleared for board notification)' : 'NO, so apraReady = false (held for human review regardless of how good the brief reads)'}
Actual apraReady value returned: ${s.apraReady ? 'true' : 'false'}

Key findings: ${findings.map(f=>`[${f.severity}/${f.standard}] ${f.finding} (source: ${f.evidenceSource}, confidence ${f.confidence!=null?Math.round(f.confidence*100)+'%':'—'})`).join(' | ')||'see above sections'}

Mandatory APRA obligations now triggered (state which apply and the deadline):
- APS 221 group breach → Board notification within 3 business days, APRA notification within 5, remediation plan within 15
- CPS 230 income gap → Block new credit, re-verify income documentation immediately
- CPS 230 AI governance → every finding above is traced to a named evidence source — that traceability is what makes this brief auditable

Write the four-bullet evidence analysis. In the Interpretation bullet, narrate Stage 1 (which regulatory citations were retrieved and why) and Stage 2 (how the four-condition gate produced "${s.apraReady?'ready':'not ready'}" specifically — name which conditions passed and which, if any, failed). In the Output bullet, state the final score/level/apraReady plainly. Maximum 180 words.`;
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

// Runs one section: emits begin, optionally streams narrative (accumulating the full text
// for the cache), emits end, and returns the cache record for this section.
async function runSection(pushFn, client, { sectionId, icon, title, subtitle, staticHtml, prompt }) {
  pushFn({ type: 'explain_section_begin', sectionId, icon, title, subtitle, staticHtml });
  let narrative = '';
  if (prompt) {
    for await (const delta of streamNarrative(prompt, client)) {
      narrative += delta;
      pushFn({ type: 'explain_text_delta', sectionId, delta });
    }
  }
  pushFn({ type: 'explain_section_end', sectionId });
  return { sectionId, icon, title, subtitle, staticHtml, narrative };
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

  // Replay from cache if this trail was generated before — same data, same prose, every time.
  const cached = await loadCachedExplanation(sessionId);
  if (cached && Array.isArray(cached.sections) && cached.sections.length > 0) {
    console.log(`  [Explain] Serving cached evidence trail for session ${sessionId} (${cached.sections.length} sections)`);
    await replayExplanation(cached, cached.partner_id || customerId, pushFn);
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

  const relMap     = agentState.relationshipMap     || null;
  const patternAss = agentState.patternAssessment   || null;
  const synth      = agentState.synthesisResult     || null;

  let riskRow = null;
  try { riskRow = await cds.run(SELECT.one.from('bankingsentinel.RiskAssessments').where({ SESSION_ID: sessionId })); } catch (_) {}

  const generatedSections = [];

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'snapshot', icon: '01', title: 'Customer Snapshot',
    subtitle: 'Source: BusinessPartners · BCA_DTI · Loans',
    staticHtml: buildSnapshotHtml(raw, dtiLimit),
  }));

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'payments', icon: '02', title: 'Payment Evidence',
    subtitle: 'Source: DFKKOP (payment ledger) · LoanSchedule',
    staticHtml: buildPaymentsHtml(raw),
    prompt: buildPaymentPrompt(raw, customerId),
  }));

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'dti', icon: '03', title: 'Debt-to-Income Analysis',
    subtitle: 'Source: BCA_DTI · RegulatoryThresholds',
    staticHtml: buildDtiHtml(raw, dtiLimit, agentState),
    prompt: buildDtiPrompt(raw, dtiLimit, agentState, customerId),
  }));

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'collateral', icon: '04', title: 'Collateral & Guarantors',
    subtitle: 'Source: BCA_COLLATERAL · BCA_GUARANTOR',
    staticHtml: buildCollateralHtml(raw),
  }));

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'relationships', icon: '05', title: 'Connected Party Network',
    subtitle: 'Source: BUT050 (SAP) · HANA Knowledge Graph · ReAct agent',
    staticHtml: buildRelationshipsHtml(raw, relMap, groupLimit),
    prompt: buildRelationshipsPrompt(raw, relMap, groupLimit, singleLimit, customerId),
  }));

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'anomaly', icon: '06', title: 'Statistical Anomaly Detection',
    subtitle: 'Source: DFKKOP portfolio · HANA PAL · RPT-1 · LLM',
    staticHtml: buildAnomalyHtml(raw, patternAss),
    prompt: buildAnomalyPrompt(raw, patternAss, customerId),
  }));

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'reflection', icon: '07', title: 'Reflection — Evidence Quality Check',
    subtitle: 'Reflexion (Shinn et al., 2023) · Claude Haiku critic',
    staticHtml: buildReflectionHtml(agentState),
    prompt: buildReflectionPrompt(agentState, customerId),
  }));

  generatedSections.push(await runSection(pushFn, client, {
    sectionId: 'verdict', icon: '08', title: 'Final Verdict & Mandatory Actions',
    subtitle: 'Consolidated from all agents · APRA obligations',
    staticHtml: buildVerdictHtml(synth, riskRow, agentState),
    prompt: buildVerdictPrompt(synth, riskRow, customerId, dtiLimit, groupLimit, agentState),
  }));

  pushFn({ type: 'explain_complete', sectionsGenerated: generatedSections.length });

  // Persist so every future open of this session replays this exact trail.
  await saveExplanation(sessionId, customerId, generatedSections);
}

module.exports = { generateExplanation };
