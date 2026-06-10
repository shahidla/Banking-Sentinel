// Banking Sentinel — RAGAS-style Evaluation (Phase 8)
// AI: LLM-as-judge — Claude evaluates its own synthesis output against retrieved regulatory docs
//     Equivalent to RAGAS (Python) faithfulness + answer_relevance metrics, in Node.js
// Banking: "Is the risk brief grounded in actual APRA regulations, or is it hallucinating?"
//          A brief that cites APS 221 but contradicts the retrieved clause is worse than no brief.
// SAP: Scores submitted to Langfuse via submitScore() — visible in dashboard, filterable by run

'use strict';
const { ChatAnthropic } = require('@langchain/anthropic');
const { submitScore, getLangchainHandler } = require('./langfuse-client');
const { extractJson } = require('../utils/llm-json');

// ── Faithfulness score ────────────────────────────────────────────────────────
// AI: For each finding in the brief, check if it is supported by the retrieved regulatory chunks.
//     Score = proportion of findings with direct documentary support (0.0 – 1.0)
// Banking: APS 221 breach finding must be traceable to a retrieved APS 221 chunk.
//          If no retrieved chunk mentions APS 221 and the brief cites it anyway → hallucination.
// SAP: Uses claude-haiku (low cost) — this is a meta-evaluation, not primary reasoning

async function evaluateFaithfulness(traceId, synthesisResult, regulatoryDocs) {
  if (!synthesisResult?.findings?.length || !regulatoryDocs?.length) return null;

  const findings = synthesisResult.findings
    .map((f, i) => `Finding ${i + 1}: "${f.finding || f}" (source: ${f.evidenceSource || 'unspecified'})`)
    .join('\n');

  const context = regulatoryDocs
    .map(d => `[${d.STANDARD}] ${d.CONTENT}`)
    .join('\n\n');

  const prompt = `You are evaluating an AI-generated banking risk brief for factual grounding.

RETRIEVED REGULATORY CONTEXT:
${context}

RISK BRIEF FINDINGS:
${findings}

For each finding, determine if it is directly supported by the retrieved context above.
A finding is "supported" if the retrieved context contains explicit information that justifies the finding.
A finding is "unsupported" if it goes beyond or contradicts the retrieved context.

Respond with JSON only:
{
  "supported": <number of supported findings>,
  "total": <total findings>,
  "faithfulness": <supported/total as decimal 0.0-1.0>,
  "unsupportedFindings": [<list of unsupported finding numbers>],
  "comment": "<one sentence summary>"
}`;

  try {
    const lfHandler = getLangchainHandler(traceId, 'ragas-faithfulness');
    const llm = new ChatAnthropic({
      model:     process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      apiKey:    process.env.ANTHROPIC_API_KEY,
      maxTokens: 300,
      callbacks: lfHandler ? [lfHandler] : []
    });

    const response = await llm.invoke([{ role: 'user', content: prompt }]);
    const raw = typeof response.content === 'string'
      ? response.content
      : response.content.map(b => b.text || '').join('');

    const result = extractJson(raw);
    if (!result) return null;

    await submitScore(traceId, 'faithfulness', result.faithfulness, result.comment);
    console.log(`  [RAGAS] faithfulness: ${result.faithfulness.toFixed(2)} (${result.supported}/${result.total} findings supported)`);
    if (result.comment) console.log(`  [RAGAS] faithfulness comment: ${result.comment}`);
    return result;
  } catch (e) {
    console.warn('  [RAGAS] faithfulness evaluation failed:', e.message);
    return null;
  }
}

// ── Answer relevance score ────────────────────────────────────────────────────
// AI: Does the brief actually answer the risk question asked?
//     Score = 0.0 (off-topic) to 1.0 (directly addresses the query)
// Banking: A brief about sector concentration when the query asked about DTI is irrelevant.
// SAP: Scored independently of faithfulness — both appear in Langfuse trace view

async function evaluateAnswerRelevance(traceId, query, synthesisResult) {
  if (!synthesisResult?.findings?.length || !query) return null;

  const briefSummary = [
    `Risk score: ${synthesisResult.riskScore} / ${synthesisResult.riskLevel}`,
    `Findings: ${synthesisResult.findings.map(f => f.finding || f).join(' | ')}`,
    `Recommendations: ${(synthesisResult.recommendations || []).join(' | ')}`
  ].join('\n');

  const prompt = `You are evaluating whether an AI-generated risk brief answers the original query.

ORIGINAL QUERY: "${query}"

RISK BRIEF SUMMARY:
${briefSummary}

Score how directly and completely the brief answers the query.
1.0 = perfectly answers the query with specific evidence
0.5 = partially answers but misses key aspects
0.0 = does not address the query

Respond with JSON only:
{
  "relevance": <0.0-1.0>,
  "comment": "<one sentence>"
}`;

  try {
    const lfHandler = getLangchainHandler(traceId, 'ragas-relevance');
    const llm = new ChatAnthropic({
      model:     process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      apiKey:    process.env.ANTHROPIC_API_KEY,
      maxTokens: 150,
      callbacks: lfHandler ? [lfHandler] : []
    });

    const response = await llm.invoke([{ role: 'user', content: prompt }]);
    const raw = typeof response.content === 'string'
      ? response.content
      : response.content.map(b => b.text || '').join('');

    const result = extractJson(raw);
    if (!result) return null;

    await submitScore(traceId, 'answer_relevance', result.relevance, result.comment);
    console.log(`  [RAGAS] answer_relevance: ${result.relevance.toFixed(2)}`);
    return result;
  } catch (e) {
    console.warn('  [RAGAS] answer_relevance evaluation failed:', e.message);
    return null;
  }
}

// ── Run full evaluation suite — returns { faithfulness, answer_relevance } ────
async function runRagasEvaluation(traceId, query, synthesisResult, regulatoryDocs) {
  if (!traceId) return null;
  const [faithSettled, relevSettled] = await Promise.allSettled([
    evaluateFaithfulness(traceId, synthesisResult, regulatoryDocs),
    evaluateAnswerRelevance(traceId, query, synthesisResult)
  ]);
  const faithResult = faithSettled.status === 'fulfilled' ? faithSettled.value : null;
  const relevResult = relevSettled.status === 'fulfilled' ? relevSettled.value : null;
  if (faithSettled.status === 'rejected') console.warn('  [RAGAS] faithfulness failed:', faithSettled.reason?.message);
  if (relevSettled.status === 'rejected') console.warn('  [RAGAS] relevance failed:',    relevSettled.reason?.message);
  const result = {
    faithfulness:     faithResult?.faithfulness ?? null,
    answer_relevance: relevResult?.relevance    ?? null
  };
  const hasAnyScore = result.faithfulness != null || result.answer_relevance != null;
  return hasAnyScore ? result : null;
}

module.exports = { runRagasEvaluation, evaluateFaithfulness, evaluateAnswerRelevance };
