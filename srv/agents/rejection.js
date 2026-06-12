// Banking Sentinel — Rejection Node
// AI: Inappropriate request handler — routes action requests to refusal.
//     The deliberate rejection is a FEATURE, not a failure. APRA co-pilot requirement.
// Banking: "Approve the loan for B-001" must be refused. Risk intelligence system ≠ decision system.
//          APRA CPS 230: AI must not make autonomous credit risk decisions.
// SAP: Intake Agent detects action keywords → Rejection Node → END. Logged to AuditLog.

'use strict';
const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');

// Standard refusal message — scripted and rehearsed per v6 Part 3
const REFUSAL = 'I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation.';

async function rejectionNode(state) {
  // Log the inappropriate request attempt for CPS 230 audit trail
  try {
    await cds.run(INSERT.into('bankingsentinel.AuditLog').entries({
      LOG_ID:     uuid(),
      SESSION_ID: state.sessionId,
      ACTION:     'inappropriate_request_rejected',
      QUERY:      state.query,
      RESPONSE:   REFUSAL,
      MODEL:      'rejection_node',
      TOKENS_IN:  0,
      TOKENS_OUT: 0,
      COST_AUD:   0,
      LATENCY_MS: 0,
      CREATED_AT: new Date().toISOString()
    }));
  } catch (e) {
    console.error('[Rejection] AuditLog insert failed:', e.message);
  }

  console.log(`  [Rejection] Inappropriate request detected. Query: "${state.query.substring(0, 60)}"`);

  return { rejectionMessage: REFUSAL };
}

module.exports = { rejectionNode };
