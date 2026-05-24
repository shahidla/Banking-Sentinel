// Banking Sentinel — Agent Stubs for Phases 4–6
// These nodes exist in the graph topology now so the full routing is in place.
// Phase 4: patternAgent + relationshipAgent (ReAct loop + HANA graph traversal)
// Phase 5: trajectoryAgent + synthesisAgent (conflicting signals + HANA vector + human-in-the-loop)
// Phase 6: selfRagCheckNode (confidence evaluation + re-query loop)

'use strict';

// ─── PATTERN AGENT STUB (Phase 4) ───────────────────────────────────────────
// AI: Pattern recognition across incomplete data — something feels wrong before any rule fires
// Banking: DTI 7.2, income expiry in 3 months, 81 days overdue — individually borderline,
//          together = HIGH risk that a rules-based system misses
// SAP: Calls RPT-1 via Generative AI Hub API + HANA PAL for payment anomaly detection

async function patternAgentStub(state) {
  console.log(`  [Pattern] STUB — Phase 4 will implement RPT-1 + HANA PAL. Defaulting score 50.`);
  return {
    patternAssessment: {
      riskScore:  50,
      riskLevel:  'MEDIUM',
      confidence: 0.50,
      anomalies:  [],
      signal:     'unclear',
      note:       'Phase 4 stub — RPT-1 tabular scoring + HANA PAL anomaly detection not yet implemented'
    }
  };
}

// Routing function: low_risk (<30) skips Relationship + Trajectory agents
// High_risk (>=30) runs full pipeline — greyed-out in Panel 2 for low risk customers
function routeAfterPattern(state) {
  const score = state.patternAssessment?.riskScore ?? 50;
  console.log(`  [Pattern→Route] Score ${score} → ${score < 30 ? 'low_risk (skip graph traversal)' : 'high_risk (full pipeline)'}`);
  return score < 30 ? 'low_risk' : 'high_risk';
}

// ─── RELATIONSHIP AGENT STUB (Phase 4) ──────────────────────────────────────
// AI: Relationship ambiguity — nature and strength of connections, not just existence
// Banking: Parent-subsidiary = full exposure. Family trust = reasoning required. G-001→G-002 via BUT050.
// SAP: HANA Knowledge Graph Engine SPARQL on BUT050 + BCA_GUARANTOR, up to 8 hops

async function relationshipAgentStub(state) {
  console.log(`  [Relationship] STUB — Phase 4 will implement HANA Knowledge Graph + ReAct loop.`);
  return {
    relationshipMap: {
      nodes:          [],
      edges:          [],
      groupExposure:  0,
      aps221Pct:      0,
      confidence:     0.50,
      note:           'Phase 4 stub — HANA Knowledge Graph Engine SPARQL traversal not yet implemented'
    }
  };
}

// ─── TRAJECTORY AGENT STUB (Phase 5) ────────────────────────────────────────
// AI: Threshold proximity + conflicting signals (inseparable reasoning type)
// Banking: DTI 5.9 today + income expiry in 3 months = effective 9.2 — trajectory, not snapshot
// SAP: BCA_DTI.INCOME_EXPIRY field drives forward calculation; BCA_LOAN_SCHED confirms trajectory

async function trajectoryAgentStub(state) {
  console.log(`  [Trajectory] STUB — Phase 5 will implement forward DTI + conflicting signal resolution.`);
  return {
    trajectoryAnalysis: {
      currentDti:         null,
      futureDti:          null,
      daysToExpiry:       null,
      timeToBreach:       null,
      conflictingSignals: [],
      forwardPosition:    'UNKNOWN',
      note:               'Phase 5 stub — conflicting signal resolution + time-to-breach calculation not yet implemented'
    }
  };
}

// ─── SELF-RAG CHECK STUB (Phase 6) ──────────────────────────────────────────
// AI: Epistemic reasoning — agent evaluates its own confidence before proceeding
// Banking: Risk officer double-checks if unsure before presenting to board. Below 70% = get more data.
// SAP: LangGraph conditional edge — if confidence < 0.70 AND requeryCount < 2 → loop back to Relationship

function selfRagCheckNode(state) {
  const patternConf = state.patternAssessment?.confidence ?? 1;
  const relConf = state.relationshipMap?.confidence ?? 1;
  console.log(`  [SelfRAG] STUB — confidence: pattern=${patternConf}, relationship=${relConf}`);
  return { requeryCount: (state.requeryCount ?? 0) + 1 };
}

function checkConfidence(state) {
  const patternConf = state.patternAssessment?.confidence ?? 1;
  const relConf = state.relationshipMap?.confidence ?? 1;
  if ((patternConf < 0.70 || relConf < 0.70) && (state.requeryCount ?? 0) < 2) {
    console.log(`  [SelfRAG→Route] Confidence below threshold — re-querying (attempt ${(state.requeryCount ?? 0) + 1})`);
    return 'requery';
  }
  console.log(`  [SelfRAG→Route] Confidence sufficient — proceeding to human approval`);
  return 'proceed';
}

// ─── HUMAN APPROVAL STUB (Phase 5) ──────────────────────────────────────────
// AI: interrupt() — LangGraph halts execution here, waits for human resume event
// Banking: APRA CPS 230 co-pilot requirement — risk officer reviews before Synthesis executes
// SAP: Solace publishes banking/human/approval event. HTML UI shows pause indicator + Approve button.

async function humanApprovalNode(state) {
  // In Phase 5: LangGraph interrupt() fires here, Solace event published, execution halts
  // In Phase 3: pass-through — no interrupt yet
  console.log(`  [HumanApproval] STUB — Phase 5 will implement LangGraph interrupt() + Solace event`);
  return {};
}

// ─── SYNTHESIS AGENT STUB (Phase 5) ─────────────────────────────────────────
// AI: Synthesis under uncertainty — holds contradictions, confidence per finding
// Banking: The APRA-ready risk brief with evidence trail — what the risk officer signs off on
// SAP: Retrieves APRA docs via hana_vector_search MCP tool. Writes to RiskAssessments HANA table.

async function synthesisAgentStub(state) {
  console.log(`  [Synthesis] STUB — Phase 5 will implement full APRA-ready risk brief generation.`);
  const customerId = state.intent?.customerId || state.customerId || 'Unknown';
  return {
    synthesisResult: {
      riskScore:       state.patternAssessment?.riskScore ?? 50,
      riskLevel:       state.patternAssessment?.riskLevel ?? 'MEDIUM',
      confidence:      0.50,
      findings:        [{ finding: `Risk analysis for ${customerId} — full synthesis in Phase 5`, evidenceSource: 'stub' }],
      recommendations: ['Phase 5 will implement full APRA-ready recommendations'],
      regulatoryRefs:  [],
      uncertainties:   ['Full agent pipeline not yet implemented — Phase 3 scaffold'],
      apraReady:       false,
      note:            'Phase 5 stub'
    }
  };
}

module.exports = {
  patternAgentStub,
  routeAfterPattern,
  relationshipAgentStub,
  trajectoryAgentStub,
  selfRagCheckNode,
  checkConfidence,
  humanApprovalNode,
  synthesisAgentStub
};
