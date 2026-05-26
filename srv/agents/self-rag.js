// Banking Sentinel — Self-RAG Node (Phase 6)
// AI: Epistemic quality evaluation — agent reads its own outputs and judges if confidence is earned.
//     Not a counter. Not a threshold check. The LLM reasons about whether evidence is complete.
// Banking: Risk officer pauses before signing: "Do I have enough data to stand behind this finding?"
//          If relationship traversal found 3 nodes but zero exposure, that's incomplete — get more.
// SAP: LangGraph conditional edge — selfRagCheck routes back to 'relationship' with a targeted hint,
//      or forward to 'humanApproval' if confidence is genuinely earned.

'use strict';
const { ChatAnthropic } = require('@langchain/anthropic');
const { getLangchainHandler } = require('../observability/langfuse-client');

async function selfRagCheckNode(state) {
  const customerId = state.intent?.customerId || state.customerId;
  const pattern    = state.patternAssessment  || {};
  const rel        = state.relationshipMap    || {};
  const traj       = state.trajectoryAnalysis || {};
  const reqCount   = state.requeryCount ?? 0;

  console.log(`  [SelfRAG] Evaluating evidence quality — attempt ${reqCount + 1} for ${customerId}`);

  const lfHandler = getLangchainHandler(state.traceId, 'self-rag');
  const llm = new ChatAnthropic({
    model:     process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    apiKey:    process.env.ANTHROPIC_API_KEY,
    maxTokens: 400,
    callbacks: lfHandler ? [lfHandler] : []
  });

  // ── Summarise all agent outputs for evaluation ────────────────────────────
  const agentSummary = JSON.stringify({
    customerId,
    pattern: {
      riskScore:    pattern.riskScore,
      riskLevel:    pattern.riskLevel,
      confidence:   pattern.confidence,
      signal:       pattern.signal,
      anomalyCount: pattern.anomalies?.length || 0,
      rpt1Success:  pattern.rpt1?.success,
      palOutliers:  pattern.pal?.anomalyCount || 0,
      palSuccess:   pattern.pal?.success
    },
    relationship: {
      nodeCount:     rel.nodes?.length    || 0,
      edgeCount:     rel.edges?.length    || 0,
      nodes:         rel.nodes            || [],
      groupExposure: rel.groupExposure    || 0,
      aps221Pct:     rel.aps221Pct        || 0,
      confidence:    rel.confidence       || 0,
      finding:       rel.finding          || null
    },
    trajectory: {
      currentDti:           traj.currentDti,
      futureDti:            traj.futureDti,
      forwardPosition:      traj.forwardPosition,
      conflictingSignals:   traj.conflictingSignals || [],
      conflictCount:        traj.conflictingSignals?.length || 0
    },
    requeryCount: reqCount
  });

  const response = await llm.invoke([
    {
      role:    'system',
      content: `You are a banking risk quality analyst. Your job is to evaluate whether the agent findings are complete enough to proceed to human approval, or whether a targeted re-query is needed.

Evaluate these four dimensions:
1. GRAPH COMPLETENESS — Is the relationship traversal complete? Few nodes with zero group exposure likely means the traversal stopped before reaching parent entities or guarantor networks.
2. SIGNAL CONSISTENCY — Are Pattern and Relationship findings consistent? HIGH risk score + zero APS 221 exposure = inconsistency that needs resolution.
3. CONFLICTING SIGNALS — Are the trajectory conflicts explained by the graph findings, or are they still unresolved?
4. EVIDENCE TRAIL — Is every risk claim backed by a specific connected entity, TRBK record, or exposure figure?

Return ONLY valid JSON:
{
  "overallConfidence": <0.00-1.00>,
  "gaps": ["<specific gap 1>", "<specific gap 2>"],
  "reQueryHint": "<one specific, actionable instruction for the Relationship Agent — which entity to start from, what to look for deeper, what exposure to recalculate>",
  "reasoning": "<one sentence explaining the confidence level>"
}

If findings are complete and consistent, overallConfidence >= 0.75.
If graph traversal clearly stopped early or exposure is zero despite HIGH risk, overallConfidence <= 0.65.`
    },
    {
      role:    'user',
      content: `Evaluate evidence quality for customer ${customerId}:\n${agentSummary}`
    }
  ]);

  let rawText;
  if (typeof response.content === 'string') {
    rawText = response.content;
  } else if (Array.isArray(response.content)) {
    rawText = response.content.map(b => (typeof b === 'string' ? b : b.text || '')).join('');
  } else {
    rawText = String(response.content);
  }
  const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  let evaluation;
  try {
    evaluation = match ? JSON.parse(match[0]) : null;
  } catch (e) {
    evaluation = null;
  }

  if (!evaluation || typeof evaluation.overallConfidence !== 'number') {
    // Default below re-query threshold (0.70) so a parse failure triggers re-query, not proceed.
    // 0.75 would silently route to approval — masking a real LLM/format failure.
    console.warn('  [SelfRAG] LLM response malformed — defaulting confidence to 0.60 (requery)');
    evaluation = { overallConfidence: 0.60, gaps: ['Self-RAG evaluation unavailable — response malformed'], reQueryHint: '', reasoning: 'Self-RAG parse failure — routing to requery rather than proceeding blindly' };
  }

  const tokensIn  = response.usage_metadata?.input_tokens  || 0;
  const tokensOut = response.usage_metadata?.output_tokens || 0;

  console.log(`  [SelfRAG] confidence:${evaluation.overallConfidence.toFixed(2)} gaps:${evaluation.gaps?.length || 0} reQueryHint:"${(evaluation.reQueryHint || '').substring(0, 70)}..."`);
  console.log(`  [SelfRAG] reasoning: ${evaluation.reasoning}`);

  return {
    selfRagEvaluation: evaluation,
    reQueryHint:       evaluation.reQueryHint,
    requeryCount:      reqCount + 1,
    totalInputTokens:  tokensIn,
    totalOutputTokens: tokensOut
  };
}

// ── Routing function — reads real Self-RAG confidence, not raw agent scores ──
// AI: Conditional edge — below 0.70 triggers re-query; cap at 2 re-queries to avoid infinite loop
// Banking: Two re-queries max — same as a risk officer asking for more data twice before deciding
// SAP: LangGraph addConditionalEdges — 'requery' → relationship, 'proceed' → humanApproval
function checkConfidence(state) {
  const evaluation = state.selfRagEvaluation;
  const reqCount   = state.requeryCount ?? 0;

  // Self-RAG evaluated confidence is authoritative. Fall back to min of agent scores only if unavailable.
  const confidence = (evaluation?.overallConfidence !== undefined)
    ? evaluation.overallConfidence
    : Math.min(state.patternAssessment?.confidence ?? 1, state.relationshipMap?.confidence ?? 1);

  if (confidence < 0.70 && reqCount < 3) {
    console.log(`  [SelfRAG→Route] confidence:${confidence.toFixed(2)} below 0.70 — re-querying (attempt ${reqCount})`);
    return 'requery';
  }

  const reason = confidence >= 0.70 ? 'sufficient' : 'max re-queries reached — proceeding';
  console.log(`  [SelfRAG→Route] confidence:${confidence.toFixed(2)} ${reason} → humanApproval`);
  return 'proceed';
}

module.exports = { selfRagCheckNode, checkConfidence };
