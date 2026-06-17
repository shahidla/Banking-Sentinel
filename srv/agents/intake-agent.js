// Banking Sentinel — Intake Agent (Agent 1)
// AI: Intent understanding and routing — determines which agents activate and in what order
// Banking: "Analyse B-001 risk" ≠ "What is total loan amount?" ≠ "Approve the loan"
//          Three very different actions requiring three very different responses
// SAP: First LangGraph node. Sets state.intent which drives all conditional edges downstream.

'use strict';
const { ChatAnthropic } = require('@langchain/anthropic');
const { getLangchainHandler } = require('../observability/langfuse-client');
const { extractJson } = require('../utils/llm-json');

const INTAKE_SYSTEM = `You are the Intake Agent for Banking Sentinel, an AI risk intelligence system for a major Australian bank.

Your job: parse the user's query and classify it precisely.

CLASSIFICATION RULES:

SIMPLE_DATA_QUERY vs RISK_ANALYSIS — the deciding question is not whether a specific
customer is named, but whether the request can be answered by RETRIEVING existing
stored data as-is, or whether it requires the system to SYNTHESIZE a judgment that
does not already exist as a stored fact.

SIMPLE_DATA_QUERY — retrieving, listing, or displaying records or facts that already
exist in the data, however the request is scoped (portfolio-wide OR a single named
customer). Histories, lists, counts, and individual field lookups are all retrieval,
even when narrowed to one customer.
  Examples:
  - "What is the total loan amount?", "How many borrowers do we have?", "List all loans"
  - "What is B-001's DTI ratio?", "Show me customer 30100001's repayment history"
  - "Which customers have a DTI above 5?", "Which guarantors are also borrowers?"

RISK_ANALYSIS — the system must reason across multiple signals to produce a
conclusion, score, or assessment that is not itself a stored value — i.e. the answer
requires judgment, not lookup. Always scoped to a specific customer (deep-dive
analysis needs a subject), but the customer being named is not by itself the signal —
the signal is that the request asks for an assessment.
  Examples:
  - "Analyse borrower 30100001", "What is the risk profile of 30100003?"
  - "Check 30100001 for all risk dimensions", "Run a full analysis on 30100002"
  - "Is there an APS 221 breach for customer 30100001?"

INAPPROPRIATE_REQUEST — Any request to take an action the system must not take:
  Action keywords: approve, reject, delete, modify, override, grant, create, update, authorise, sign off
  Examples: "Approve the loan for B-001", "Delete B-003's record", "Override the risk flag"

CUSTOMER_ID extraction: Partner IDs are 8-digit SAP BP numbers like 30100001, 30100002, 30100003. Extract exactly as stated — do not reformat or shorten them.

Respond with JSON only, no explanation:
{
  "intent": "SIMPLE_DATA_QUERY" | "RISK_ANALYSIS" | "INAPPROPRIATE_REQUEST",
  "customerId": "30100001" | null,
  "description": "one sentence describing exactly what the user wants"
}`;

async function intakeAgent(state) {
  const lfHandler = getLangchainHandler(state.traceId, 'intake-agent');
  const llm = new ChatAnthropic({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxTokens: 300,
    callbacks: lfHandler ? [lfHandler] : []
  });

  let parsed;
  try {
    const response = await llm.invoke([
      { role: 'system', content: INTAKE_SYSTEM },
      { role: 'user', content: state.query }
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // Extract JSON from response (handle markdown code blocks and trailing prose)
    parsed = extractJson(content);

    const inputTokens = response.usage_metadata?.input_tokens || 0;
    const outputTokens = response.usage_metadata?.output_tokens || 0;

    if (!parsed) throw new Error('No JSON in response');

    console.log(`  [Intake] Intent: ${parsed.intent} | Customer: ${parsed.customerId || 'none'}`);

    return {
      intent: {
        isSimpleDataQuery:      parsed.intent === 'SIMPLE_DATA_QUERY',
        isRiskAnalysis:         parsed.intent === 'RISK_ANALYSIS',
        isInappropriateRequest: parsed.intent === 'INAPPROPRIATE_REQUEST',
        customerId:             parsed.customerId,
        description:            parsed.description
      },
      customerId: parsed.customerId || state.customerId,
      totalInputTokens:  inputTokens,
      totalOutputTokens: outputTokens
    };

  } catch (err) {
    throw new Error(`Intake Agent failed: ${err.message}`);
  }
}

// Routing function — called by LangGraph conditional edge after intake node
function routeFromIntake(state) {
  if (state.intent?.isInappropriateRequest) return 'inappropriate_request';
  if (state.intent?.isSimpleDataQuery)      return 'simple_query';
  // Safety: if RISK_ANALYSIS was chosen but no customerId, treat as data query to avoid pipeline crash
  if (!state.customerId && !state.intent?.customerId) return 'simple_query';
  return 'risk_analysis';
}

module.exports = { intakeAgent, routeFromIntake };
