// Banking Sentinel — Human Approval Node (Phase 5)
// AI: Human-in-the-loop — LangGraph interruptBefore halts execution before this node
//     On resume (POST /a2a/approve), this node runs, logs approval, then Synthesis executes
// Banking: APRA CPS 230 co-pilot requirement — risk officer reviews before final brief is sealed
// SAP: Solace event published from server when interrupt detected; HTML UI shows pause + Approve button

'use strict';

async function humanApprovalNode(state) {
  const customerId = state.intent?.customerId || state.customerId;
  console.log(`  [HumanApproval] Approved — resuming Synthesis for customer: ${customerId}`);
  // Graph was paused before this node via interruptBefore: ['humanApproval']
  // Execution arrives here only after POST /a2a/approve resumes the graph
  // No state changes needed — Synthesis reads from existing patternAssessment + trajectoryAnalysis
  return {};
}

module.exports = { humanApprovalNode };
