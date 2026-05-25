// Banking Sentinel — Intake Agent (Agent 1)
// AI: Intent understanding and routing — determines which agents activate and in what order
// Banking: "Analyse B-001 risk" ≠ "What is total loan amount?" ≠ "Approve the loan"
//          Three very different actions requiring three very different responses
// SAP: First LangGraph node. Sets state.intent which drives all conditional edges downstream.

'use strict';
const { ChatAnthropic } = require('@langchain/anthropic');
const { getLangchainHandler } = require('../observability/langfuse-client');

const INTAKE_SYSTEM = `You are the Intake Agent for Banking Sentinel, an AI risk intelligence system for a major Australian bank.

Your job: parse the user's query and classify it precisely.

CLASSIFICATION RULES:

SIMPLE_DATA_QUERY — A request for factual data that can be answered with a single database lookup:
  Examples: "What is the total loan amount?", "How many borrowers do we have?",
  "Show me all overdue payments", "What is B-001's DTI ratio?", "List all loans"

RISK_ANALYSIS — A request for risk assessment, investigation, or analysis:
  Examples: "Analyse borrower B-001", "What is the connected party exposure for G-001?",
  "Check B-001 for all risk dimensions", "Is there an APS 221 breach in the portfolio?",
  "Assess the guarantor network risk"

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

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

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
  return 'risk_analysis';
}

module.exports = { intakeAgent, routeFromIntake };
