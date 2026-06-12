// Banking Sentinel — Synthesis Agent (Agent 5)
// AI: Synthesis under uncertainty — holds contradictions, assigns confidence per finding
// Banking: Produces the APRA-ready risk brief the risk officer signs off on before board notification
// SAP: HANA Vector search on APRA regulatory docs (HyDE optional) + writes to RiskAssessments entity

'use strict';
const cds = require('@sap/cds');
const { ChatAnthropic } = require('@langchain/anthropic');
const { hana_vector_search } = require('../tools/mcp-tools');
const { getLangchainHandler } = require('../observability/langfuse-client');
const { validateAgentOutput, crossCheckClaimsAgainstSources } = require('../guardrails/validate');
const { extractJson } = require('../utils/llm-json');

async function synthesisAgent(state) {
  const customerId = state.intent?.customerId || state.customerId;
  const sessionId  = state.sessionId;
  console.log(`  [Synthesis] Building APRA-ready brief: ${customerId}`);

  const pattern    = state.patternAssessment  || {};
  const trajectory = state.trajectoryAnalysis || {};
  const relationship = state.relationshipMap  || {};

  // ── HANA Vector search — per-signal retrieval for higher RAGAS faithfulness ──
  // One targeted query per risk signal → more precise chunks, less generic content
  const reflection    = state.reflectionEvaluation || {};
  const reflectionHistory = state.reflectionHistory || [];

  const signalQueries = [
    trajectory.currentDti > 0
      ? `DTI ratio ${trajectory.currentDti} debt-to-income limit APS 220 residential mortgage APRA activation`
      : null,
    relationship.groupExposure > 0
      ? `connected party group exposure APS 221 large exposure single obligor board notification ${(relationship.groupExposure/1e6).toFixed(1)}M`
      : null,
    (trajectory.conflictingSignals || []).length > 0
      ? 'income contract expiry forward DTI trajectory deteriorating risk assessment APRA'
      : null,
    'CPS 230 operational resilience AI model governance audit trail evidence'
  ].filter(Boolean);

  let regulatoryDocs = [];
  let regulatoryContextUnavailable = false;
  try {
    const seen = new Set();
    for (const q of signalQueries) {
      const chunks = await hana_vector_search({ query: q, topK: 5, useHyDE: false });
      for (const c of chunks) {
        if (!seen.has(c.DOC_ID)) { seen.add(c.DOC_ID); regulatoryDocs.push(c); }
      }
    }
    regulatoryDocs = regulatoryDocs.slice(0, 7); // cap at 7 to stay within token budget
    console.log(`  [Synthesis] Retrieved ${regulatoryDocs.length} APRA regulatory chunks (per-signal, deduped)`);
  } catch (e) {
    console.error('  [Synthesis] HANA Vector search failed:', e.message);
    regulatoryContextUnavailable = true;
  }

  const regulatoryRefs    = [...new Set(regulatoryDocs.map(d => d.STANDARD).filter(Boolean))];
  const regulatoryContext = regulatoryContextUnavailable
    ? 'REGULATORY CONTEXT UNAVAILABLE — OpenAI embedding service failed. Apply general APRA knowledge only.'
    : regulatoryDocs.map(d => `[${d.STANDARD}] ${d.CONTENT}`).join('\n\n') || 'No regulatory docs retrieved — apply general APRA knowledge.';

  // ── LLM synthesis — APRA-ready risk brief ────────────────────────────────
  const lfHandler = getLangchainHandler(state.traceId, 'synthesis-agent');
  const llm = new ChatAnthropic({
    model:     process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    apiKey:    process.env.ANTHROPIC_API_KEY,
    maxTokens: 2500,
    callbacks: lfHandler ? [lfHandler] : []
  });

  const agentContext = JSON.stringify({
    customerId,
    pattern: {
      riskScore:    pattern.riskScore,
      riskLevel:    pattern.riskLevel,
      confidence:   pattern.confidence,
      signal:       pattern.signal,
      rpt1Category: pattern.rpt1?.category,
      rpt1Conf:     pattern.rpt1?.confidence,
      palFlagged:   `${pattern.pal?.anomalyCount ?? 0}/${pattern.pal?.totalScored ?? 0} payment rows`,
      anomalies:    pattern.anomalies || []
    },
    trajectory: {
      currentDti:         trajectory.currentDti,
      futureDti:          trajectory.futureDti,
      daysToExpiry:       trajectory.daysToExpiry,
      timeToBreach:       trajectory.timeToBreach,
      conflictingSignals: trajectory.conflictingSignals || [],
      forwardPosition:    trajectory.forwardPosition
    },
    relationship: {
      groupExposure: relationship.groupExposure,
      aps221Pct:     relationship.aps221Pct,
      nodeCount:     relationship.nodes?.length,
      edgeCount:     relationship.edges?.length,
      finding:       relationship.finding,
      confidence:    relationship.confidence
    },
    reflection: {
      overallConfidence: reflection.overallConfidence,
      iterations:        reflectionHistory.length,
      gaps:              reflection.gaps || [],
      reasoning:         reflection.reasoning
    }
  });

  const response = await llm.invoke([
    {
      role:    'system',
      content: `You are a banking risk officer preparing an APRA-compliant risk assessment brief.
Analyse ALL agent findings below and produce a structured JSON risk brief. Include EVERY finding the evidence supports — do not truncate.

Risk score scale: LOW=0-25, MEDIUM=26-50, HIGH=51-75, CRITICAL=76-100.
riskLevel must match riskScore: score 51 = HIGH, score 76 = CRITICAL, score 25 = LOW, score 50 = MEDIUM.
Reference the conflictingSignals array — each unresolved conflict reduces confidence and must appear as a finding or uncertainty.
Pattern confidence (rpt1Conf) is the real RPT-1 confidence from the tabular model — cite it in findings.
palFlagged shows anomaly count as "X/N payment rows" — use this exact format in findings.
Reflection reasoning explains the evidence quality decision — cite it if relevant.

Return ONLY valid JSON. Keep each finding under 20 words. Max 5 findings, 3 recommendations, 3 uncertainties.
{
  "riskScore": <0-100 integer>,
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "confidence": <0.00-1.00>,
  "findings": [{"finding": "<max 20 words>", "standard": "<APS221|CPS230|DTI_NOTICE>", "severity": "<HIGH|MEDIUM|LOW>", "evidenceSource": "<agent name>", "confidence": <0.00-1.00>}],
  "recommendations": ["<action, max 15 words>"],
  "regulatoryRefs": ["<APS221|CPS230|DTI_NOTICE>"],
  "uncertainties": ["<data gap, max 15 words>"],
  "apraReady": <true|false>
}
Return ONLY the JSON object. No markdown, no explanation, no code fences.`
    },
    {
      role:    'user',
      content: `Customer: ${customerId}\n\nAgent findings:\n${agentContext}\n\nAPRA regulatory context:\n${regulatoryContext || 'No regulatory docs retrieved — apply general APRA knowledge.'}`
    }
  ]);

  // Extract text from LangChain response — content can be a string or array of content blocks
  let rawText;
  if (typeof response.content === 'string') {
    rawText = response.content;
  } else if (Array.isArray(response.content)) {
    rawText = response.content.map(b => (typeof b === 'string' ? b : b.text || '')).join('');
  } else {
    rawText = String(response.content);
  }
  // Strip markdown code fences, then extract the first balanced JSON object
  const text = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const brief = extractJson(text);
  if (!brief) console.warn('  [Synthesis] JSON parse failed. Raw LLM output:', rawText.substring(0, 800));

  // Coerce riskScore to number if LLM returned it as string
  if (brief && typeof brief.riskScore === 'string') brief.riskScore = parseInt(brief.riskScore, 10);

  // Fallback if LLM response is malformed
  if (!brief || typeof brief.riskScore !== 'number') {
    console.warn('  [Synthesis] LLM response malformed — using pattern fallback');
    brief = {
      riskScore:       pattern.riskScore ?? 50,
      riskLevel:       pattern.riskLevel ?? 'MEDIUM',
      confidence:      0.50,
      findings:        [{ finding: `Risk analysis for ${customerId} completed via pattern agent`, evidenceSource: 'pattern-agent', confidence: pattern.confidence ?? 0.5 }],
      recommendations: ['Escalate to senior credit officer for manual review'],
      regulatoryRefs:  regulatoryRefs.length > 0 ? regulatoryRefs : ['CPS230'],
      uncertainties:   ['LLM synthesis response malformed — manual review required'],
      apraReady:       false
    };
  }

  // Surface regulatory context failure — ensures risk officer knows citations may be incomplete
  if (regulatoryContextUnavailable) {
    brief.uncertainties = [...(brief.uncertainties || []), 'Regulatory context unavailable — APRA citations may be incomplete (OpenAI embedding service unreachable)'];
  }

  // Deterministic apraReady — not LLM-decided (item 24)
  // All four conditions must hold: sufficient confidence, Reflection passed, reg docs retrieved, no context failure
  const reflectionPassed = (reflection.overallConfidence ?? 1) >= 0.70 || reflectionHistory.length === 0;
  brief.apraReady = (
    (brief.confidence || 0) >= 0.70 &&
    reflectionPassed &&
    regulatoryRefs.length > 0 &&
    !regulatoryContextUnavailable
  );

  // Merge retrieved regulatory refs, filter to known standards only (prevent LLM hallucination)
  const KNOWN_STANDARDS = new Set(['APS221', 'CPS230', 'DTI_NOTICE']);
  const llmRefs = (brief.regulatoryRefs || []).filter(r => KNOWN_STANDARDS.has(r));
  brief.regulatoryRefs = [...new Set([...llmRefs, ...regulatoryRefs])];

  const tokensIn  = response.usage_metadata?.input_tokens  || 0;
  const tokensOut = response.usage_metadata?.output_tokens || 0;

  // ── CPS 230 guardrail validation ──────────────────────────────────────────────
  const validation = validateAgentOutput(brief, 'synthesis-agent');
  if (!validation.valid) {
    console.warn(`  [Synthesis] CPS 230 validation issues: ${validation.issues.join('; ')}`);
    if (validation.action === 'REFUSE') {
      brief.uncertainties = [...(brief.uncertainties || []), `CPS 230 guardrail: confidence ${((brief.confidence || 0) * 100).toFixed(0)}% below minimum — finding generation blocked`];
    }
  }
  const claimsText     = (brief.findings || []).map(f => f.finding).join(' ');
  const hallucRisk     = crossCheckClaimsAgainstSources(claimsText, regulatoryDocs);
  if (hallucRisk < 0.30 && regulatoryDocs.length > 0) {
    console.warn(`  [Synthesis] Hallucination risk indicator: claim-source overlap ${(hallucRisk * 100).toFixed(0)}% — findings may not be grounded in retrieved regulatory context`);
    brief.uncertainties = [...(brief.uncertainties || []), `CPS 230 guardrail: low claim-source overlap (${(hallucRisk * 100).toFixed(0)}%) — findings warrant manual review`];
  }
  console.log(`  [Synthesis] CPS 230 validation: ${validation.action} | claim-source overlap: ${(hallucRisk * 100).toFixed(0)}%`);

  // ── Persist to RiskAssessments HANA table (fire-and-forget — don't block return) ──
  const { v4: uuid } = require('uuid');
  cds.run(INSERT.into('bankingsentinel.RiskAssessments').entries({
    SESSION_ID:  sessionId || uuid(),
    PARTNER:     customerId,
    RISK_SCORE:  brief.riskScore,
    RISK_LEVEL:  brief.riskLevel,
    FINDINGS:    JSON.stringify(brief.findings),
    CONFIDENCE:  brief.confidence,
    CREATED_AT:  new Date().toISOString()
  })).then(() => console.log(`  [Synthesis] Persisted → HANA RiskAssessments session:${sessionId}`))
     .catch(e => console.warn('  [Synthesis] RiskAssessments insert failed:', e.message));

  console.log(`  [Synthesis] Done — score:${brief.riskScore} level:${brief.riskLevel} confidence:${brief.confidence} apraReady:${brief.apraReady}`);
  console.log(`  [Synthesis] Regulatory refs: ${(brief.regulatoryRefs || []).join(', ') || 'none'}`);
  (brief.findings || []).forEach((f, i) =>
    console.log(`  [Synthesis] Finding ${i+1}: [${f.severity}] ${f.finding} (src:${f.evidenceSource} conf:${f.confidence})`));
  (brief.recommendations || []).forEach((r, i) =>
    console.log(`  [Synthesis] Rec ${i+1}: ${r}`));
  (brief.uncertainties || []).forEach((u, i) =>
    console.log(`  [Synthesis] Uncertainty ${i+1}: ${u}`));

  return {
    synthesisResult: {
      riskScore:       brief.riskScore,
      riskLevel:       brief.riskLevel,
      confidence:      brief.confidence,
      findings:        brief.findings        || [],
      recommendations: brief.recommendations || [],
      regulatoryRefs:  brief.regulatoryRefs  || [],
      uncertainties:   brief.uncertainties   || [],
      apraReady:       brief.apraReady       || false
    },
    // Strip EMBEDDING before persisting to state — too large for PostgresSaver
    retrievedDocs: regulatoryDocs.map(({ DOC_ID, TITLE, STANDARD, CONTENT }) => ({ DOC_ID, TITLE, STANDARD, CONTENT })),
    totalInputTokens:  tokensIn,
    totalOutputTokens: tokensOut
  };
}

module.exports = { synthesisAgent };
