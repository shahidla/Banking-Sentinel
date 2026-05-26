// Banking Sentinel — Synthesis Agent (Agent 5)
// AI: Synthesis under uncertainty — holds contradictions, assigns confidence per finding
// Banking: Produces the APRA-ready risk brief the risk officer signs off on before board notification
// SAP: HANA Vector search on APRA regulatory docs (HyDE optional) + writes to RiskAssessments entity

'use strict';
const cds = require('@sap/cds');
const { ChatAnthropic } = require('@langchain/anthropic');
const { hana_vector_search } = require('../tools/mcp-tools');
const { getLangchainHandler } = require('../observability/langfuse-client');

async function synthesisAgent(state) {
  const customerId = state.intent?.customerId || state.customerId;
  const sessionId  = state.sessionId;
  console.log(`  [Synthesis] Building APRA-ready brief: ${customerId}`);

  const pattern    = state.patternAssessment  || {};
  const trajectory = state.trajectoryAnalysis || {};
  const relationship = state.relationshipMap  || {};

  // ── HANA Vector search — retrieve relevant APRA regulatory chunks ──────────
  // Query combines all active risk signals to retrieve the most relevant standards
  const searchQuery = [
    trajectory.currentDti > 6.0       ? 'DTI limit breach monitoring APS 221 large exposure' : 'DTI ratio CPS 230 risk management',
    relationship.groupExposure > 0     ? 'connected party group exposure APS 221 concentration limit board notification' : '',
    trajectory.forwardPosition === 'DETERIORATING' ? 'income expiry forward DTI deteriorating trajectory risk assessment' : '',
    'operational risk management CPS 230 board notification requirements audit trail'
  ].filter(Boolean).join(' ');

  let regulatoryDocs = [];
  let regulatoryContextUnavailable = false;
  try {
    regulatoryDocs = await hana_vector_search({ query: searchQuery, topK: 3, useHyDE: false });
    console.log(`  [Synthesis] Retrieved ${regulatoryDocs.length} APRA regulatory chunks from HANA Vector`);
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
    maxTokens: 700,
    callbacks: lfHandler ? [lfHandler] : []
  });

  const agentContext = JSON.stringify({
    customerId,
    pattern: {
      riskScore:  pattern.riskScore,
      riskLevel:  pattern.riskLevel,
      confidence: pattern.confidence,
      signal:     pattern.signal,
      anomalies:  (pattern.anomalies || []).slice(0, 5)
    },
    trajectory: {
      currentDti:         trajectory.currentDti,
      futureDti:          trajectory.futureDti,
      daysToExpiry:       trajectory.daysToExpiry,
      timeToBreach:       trajectory.timeToBreach,
      conflictingSignals: trajectory.conflictingSignals,
      forwardPosition:    trajectory.forwardPosition
    },
    relationship: {
      groupExposure: relationship.groupExposure,
      aps221Pct:     relationship.aps221Pct,
      nodeCount:     relationship.nodes?.length,
      edgeCount:     relationship.edges?.length
    }
  });

  const response = await llm.invoke([
    {
      role:    'system',
      content: `You are a banking risk officer preparing an APRA-compliant risk assessment brief.
Analyse the agent findings and produce a structured JSON risk brief.
Return ONLY valid JSON matching this exact structure:
{
  "riskScore": <0-100 integer>,
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "confidence": <0.00-1.00>,
  "findings": [{"finding": "<max 25 words>", "standard": "<APS221|CPS230|DTI_NOTICE>", "severity": "<HIGH|MEDIUM|LOW>", "evidenceSource": "<agent name>", "confidence": <0.00-1.00>}],
  "recommendations": ["<action>"],
  "regulatoryRefs": ["<APS221|CPS230|DTI_NOTICE>"],
  "uncertainties": ["<data gap>"],
  "apraReady": <true|false>
}
Return ONLY the JSON object. No markdown, no explanation, no code fences.
Max 4 findings, 3 recommendations, 3 uncertainties. apraReady=true only if evidence trail is complete.`
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
  // Strip markdown code fences if LLM wrapped JSON in ```json ... ```
  const text  = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  let brief;
  try {
    brief = match ? JSON.parse(match[0]) : null;
  } catch (e) {
    console.warn('  [Synthesis] JSON parse failed. Raw LLM output:', rawText.substring(0, 500));
    brief = null;
  }

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
    brief.apraReady = false;
  }

  // Merge retrieved regulatory refs into whatever the LLM produced
  if (regulatoryRefs.length > 0) {
    brief.regulatoryRefs = [...new Set([...(brief.regulatoryRefs || []), ...regulatoryRefs])];
  }

  const tokensIn  = response.usage_metadata?.input_tokens  || 0;
  const tokensOut = response.usage_metadata?.output_tokens || 0;

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
