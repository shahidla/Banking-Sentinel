// Banking Sentinel — Trajectory Agent (Agent 3)
// AI: Threshold proximity + conflicting signals — the "where is this heading?" reasoning type
// Banking: DTI 7.2 today + income contract expires 60 days → effective DTI goes critical imminently
// SAP: BCA_DTI.INCOME_EXPIRY drives forward DTI; LoanSchedule confirms payment obligations during expiry window
// SAP: RegulatoryThresholds.RATE_STRESS_BUFFER (APG 223 serviceability buffer, 3%) drives the rate-stress DTI projection

'use strict';
const cds = require('@sap/cds');
const { startSpan, endSpan } = require('../observability/langfuse-client');

const INCOME_EXPIRY_WARN_DAYS = 365; // flag if income expires within 12 months

async function trajectoryAgent(state) {
  const customerId = state.intent?.customerId || state.customerId;
  const span = startSpan(state.traceId, 'trajectory-agent', { customerId });
  console.log(`  [Trajectory] Analysing forward position: ${customerId}`);

  if (!customerId) throw new Error('Trajectory Agent: no customerId in state');

  // Fetch DTI threshold dynamically — APRA Notice button updates this to 6.0 via apra-embedder.js
  const thresholdRows = await cds.run(
    SELECT.from('bankingsentinel.RegulatoryThresholds').where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' }).limit(1)
  );
  const APRA_DTI_LIMIT = parseFloat(thresholdRows[0]?.LIMIT_PCT) || 8.0;

  // Fetch APG 223 serviceability buffer (rate-stress test)
  const rateStressRows = await cds.run(
    SELECT.from('bankingsentinel.RegulatoryThresholds').where({ THRESHOLD_TYPE: 'RATE_STRESS_BUFFER' }).limit(1)
  );
  const RATE_STRESS_BUFFER_PCT = parseFloat(rateStressRows[0]?.LIMIT_PCT) || 3.0;

  // Fetch DTI data
  const dtiRows = await cds.run(
    SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: customerId }).limit(1)
  );
  const dti = dtiRows[0] || null;

  if (!dti) throw new Error(`Trajectory Agent: no BCA_DTI record found for customer ${customerId}`);

  const currentDti   = parseFloat(dti.DTI_RATIO)    || 0;
  const totalDebt    = parseFloat(dti.TOTAL_DEBT)    || 0;
  const annualIncome = parseFloat(dti.ANNUAL_INCOME) || 0;
  const breachFlag   = dti.BREACH_FLAG || false;

  // ── Forward DTI: model income loss at contract expiry ─────────────────────
  // If income expires in N days, only N/365 of annual income remains this year.
  // Effective DTI = total debt / (income × remaining fraction)
  // This reveals the annualised servicing burden after the contract ends.
  let daysToExpiry    = null;
  let futureDti       = null;
  let incomeExpiryIso = null;

  if (dti.INCOME_EXPIRY) {
    const expiryDate = new Date(dti.INCOME_EXPIRY);
    incomeExpiryIso  = expiryDate.toISOString().split('T')[0];
    const today      = new Date();
    daysToExpiry     = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));

    if (daysToExpiry > 0 && daysToExpiry < INCOME_EXPIRY_WARN_DAYS && annualIncome > 0) {
      const effectiveIncome = annualIncome * (daysToExpiry / 365);
      futureDti = parseFloat((totalDebt / effectiveIncome).toFixed(2));
    }
  }

  // ── Forward DTI: model APRA APG 223 +3% rate-stress scenario ──────────────
  // A uniform rate rise increases the annual cost of servicing total debt by
  // RATE_STRESS_BUFFER_PCT; effective income shrinks by that amount.
  let futureDtiRateStress = null;
  if (annualIncome > 0) {
    const additionalAnnualCost = totalDebt * (RATE_STRESS_BUFFER_PCT / 100);
    const stressedIncome = annualIncome - additionalAnnualCost;
    if (stressedIncome > 0) {
      futureDtiRateStress = parseFloat((totalDebt / stressedIncome).toFixed(2));
    }
  }
  const rateStressBreach = futureDtiRateStress !== null
    && futureDtiRateStress > APRA_DTI_LIMIT
    && currentDti <= APRA_DTI_LIMIT;

  // ── Conflicting signals ────────────────────────────────────────────────────
  const conflictingSignals = [];
  const patternRiskLevel   = state.patternAssessment?.riskLevel;
  const patternSignal      = state.patternAssessment?.signal;
  const patternAnomalies   = state.patternAssessment?.anomalies?.length || 0;

  if (breachFlag && patternRiskLevel === 'LOW') {
    conflictingSignals.push('DTI breach flag active but Pattern Agent scored LOW risk — possible data lag');
  }
  if (!breachFlag && (patternRiskLevel === 'HIGH' || patternRiskLevel === 'CRITICAL')) {
    conflictingSignals.push(`RPT-1 scored ${patternRiskLevel} risk but no formal DTI breach on record — early warning signal`);
  }
  if (daysToExpiry !== null && daysToExpiry < 90) {
    conflictingSignals.push(`Income contract expires in ${daysToExpiry} days — primary servicing income at risk`);
  }
  if (daysToExpiry !== null && daysToExpiry < 90 && breachFlag) {
    conflictingSignals.push('Active APRA DTI breach combined with imminent income loss — compounding risk event');
  }
  if (patternSignal === 'concerning' && !breachFlag) {
    conflictingSignals.push(`${patternAnomalies} statistical anomalies flagged but no regulatory breach recorded — off-balance-sheet exposure possible`);
  }
  if (futureDti !== null && futureDti > APRA_DTI_LIMIT * 1.5) {
    conflictingSignals.push(`Forward DTI of ${futureDti.toFixed(1)}× projected — ${((futureDti / APRA_DTI_LIMIT - 1) * 100).toFixed(0)}% above APRA limit post-expiry`);
  }
  if (rateStressBreach) {
    conflictingSignals.push(`DTI of ${currentDti.toFixed(1)}× is within the APRA limit of ${APRA_DTI_LIMIT}× today, but a standard +${RATE_STRESS_BUFFER_PCT}% rate-stress test (APG 223 serviceability buffer) projects ${futureDtiRateStress.toFixed(1)}× — would breach the limit`);
  }

  // ── Scheduled payment obligations during expiry window ───────────────────
  try {
    const loanRows = await cds.run(
      SELECT.from('bankingsentinel.Loans').where({ PARTNER: customerId }).columns('LOAN_ID')
    );
    if (loanRows.length > 0 && daysToExpiry !== null && daysToExpiry < INCOME_EXPIRY_WARN_DAYS) {
      const loanIds          = loanRows.map(l => l.LOAN_ID);
      const upcomingPayments = await cds.run(
        incomeExpiryIso
          ? SELECT.from('bankingsentinel.LoanSchedule')
              .where({ LOAN_ID: { in: loanIds } })
              .where('DUE_DATE <=', incomeExpiryIso)
              .limit(20)
          : SELECT.from('bankingsentinel.LoanSchedule').where({ LOAN_ID: { in: loanIds } }).limit(20)
      );
      if (upcomingPayments.length > 0) {
        const totalDue = upcomingPayments.reduce((s, p) => s + (parseFloat(p.AMOUNT_DUE) || 0), 0);
        conflictingSignals.push(`AUD ${totalDue.toLocaleString()} in scheduled payments fall within income expiry window`);
      }
    }
  } catch (e) {
    throw new Error(`Trajectory Agent: LoanSchedule query failed — ${e.message}`);
  }

  // ── Time to breach ─────────────────────────────────────────────────────────
  // Negative = days since breach (already active), positive = days until projected breach
  let timeToBreach = null;
  if (breachFlag) {
    if (dti.BREACH_DATE) {
      const breachDate = new Date(dti.BREACH_DATE);
      const today      = new Date();
      timeToBreach = -Math.floor((today - breachDate) / (1000 * 60 * 60 * 24));
    } else {
      timeToBreach = 0;
    }
  } else if (futureDti !== null && futureDti > APRA_DTI_LIMIT) {
    timeToBreach = daysToExpiry; // breach projected at income expiry
  }

  // ── Forward position ───────────────────────────────────────────────────────
  let forwardPosition;
  const isDeteriorating = breachFlag
    || (futureDti !== null && futureDti > APRA_DTI_LIMIT)
    || (daysToExpiry !== null && daysToExpiry < 90)
    || rateStressBreach;
  const isStable = !breachFlag
    && currentDti < APRA_DTI_LIMIT * 0.80
    && (daysToExpiry === null || daysToExpiry > INCOME_EXPIRY_WARN_DAYS);
  // Only IMPROVING when DTI is clearly below limit with no income risk — else MONITORING
  const isImproving = !breachFlag && currentDti < APRA_DTI_LIMIT * 0.70 && daysToExpiry === null;

  forwardPosition = isDeteriorating ? 'DETERIORATING' : isStable ? 'STABLE' : isImproving ? 'IMPROVING' : 'MONITORING';

  console.log(`  [Trajectory] DTI current:${currentDti} future:${futureDti} rateStress:${futureDtiRateStress} daysToExpiry:${daysToExpiry} timeToBreach:${timeToBreach} position:${forwardPosition} signals:${conflictingSignals.length}`);
  conflictingSignals.forEach((s, i) => console.log(`  [Trajectory] Signal ${i+1}: ${s}`));

  endSpan(span, { forwardPosition, currentDti, futureDti, futureDtiRateStress, daysToExpiry }, {
    conflictingSignals: conflictingSignals.length,
    timeToBreach
  });

  return {
    trajectoryAnalysis: {
      currentDti,
      futureDti,
      futureDtiRateStress,
      daysToExpiry,
      timeToBreach,
      conflictingSignals,
      forwardPosition
    }
  };
}

module.exports = { trajectoryAgent };
