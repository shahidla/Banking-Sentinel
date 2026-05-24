// Banking Sentinel — Agent Stubs (remaining)
// Phase 6: selfRagCheckNode — real confidence evaluation + re-query loop

'use strict';

// ─── SELF-RAG CHECK STUB (Phase 6) ──────────────────────────────────────────
// AI: Epistemic reasoning — agent evaluates its own confidence before proceeding
// Banking: Risk officer double-checks if unsure before presenting to board. Below 70% = get more data.
// SAP: LangGraph conditional edge — if confidence < 0.70 AND requeryCount < 2 → loop back to Relationship

function selfRagCheckNode(state) {
  const patternConf = state.patternAssessment?.confidence ?? 1;
  const relConf     = state.relationshipMap?.confidence   ?? 1;
  console.log(`  [SelfRAG] STUB — confidence: pattern=${patternConf} relationship=${relConf}`);
  return { requeryCount: (state.requeryCount ?? 0) + 1 };
}

function checkConfidence(state) {
  const patternConf = state.patternAssessment?.confidence ?? 1;
  const relConf     = state.relationshipMap?.confidence   ?? 1;
  if ((patternConf < 0.70 || relConf < 0.70) && (state.requeryCount ?? 0) < 2) {
    console.log(`  [SelfRAG→Route] Confidence below threshold — re-querying (attempt ${(state.requeryCount ?? 0) + 1})`);
    return 'requery';
  }
  console.log(`  [SelfRAG→Route] Confidence sufficient — proceeding to human approval`);
  return 'proceed';
}

module.exports = { selfRagCheckNode, checkConfidence };
