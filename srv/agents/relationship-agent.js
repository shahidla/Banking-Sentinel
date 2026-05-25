// Banking Sentinel — Relationship Agent (Agent 3, Phase 4b)
// AI: ReAct loop — agent reasons about graph findings and calls tools iteratively
//     Reasoning: "Found TrustCo Holdings connected via BUT050, need to traverse its connections"
//     Acting: calls hana_graph_traverse again with new start node
// Banking: APS 221 connected party exposure — parent-subsidiary = full consolidation,
//          family trust = reasoning required, guarantor network = multi-hop exposure chain
// SAP: HANA Knowledge Graph Engine GRAPH_TABLE on BP_RELATIONSHIP_GRAPH workspace
//      BUT050 (edges) ↔ BANKINGSENTINEL_BUSINESSPARTNERS (vertices), up to 8 hops

'use strict';
const { ChatAnthropic } = require('@langchain/anthropic');
const { hana_graph_traverse, exposure_calculator, apra_threshold_check } = require('../tools/mcp-tools');
const { getLangchainHandler } = require('../observability/langfuse-client');

const MAX_REACT_STEPS = 6;

// ── Tool definitions for Claude tool calling ──────────────────────────────────
const TOOLS = [
  {
    name:        'hana_graph_traverse',
    description: 'Traverse the HANA Knowledge Graph from a start business partner. Returns connected nodes, edges, and group exposure. Call this for each new entity found to go deeper.',
    input_schema: {
      type: 'object',
      properties: {
        startNode: { type: 'string', description: 'Business partner number to start traversal from (e.g. "30100003")' },
        depth:     { type: 'number', description: 'Max hops to traverse (1-8). Start with 6.' }
      },
      required: ['startNode']
    }
  },
  {
    name:        'exposure_calculator',
    description: 'Calculate total APS 221 group exposure (guaranteed loan amounts) across a set of connected entity IDs.',
    input_schema: {
      type: 'object',
      properties: {
        entityIds:         { type: 'array', items: { type: 'string' }, description: 'All partner IDs in the connected group' },
        includeGuarantors: { type: 'boolean', description: 'Include guaranteed loan amounts (default true)' }
      },
      required: ['entityIds']
    }
  },
  {
    name:        'apra_threshold_check',
    description: 'Check a calculated exposure or DTI value against APRA regulatory thresholds (APS 221, DTI limit).',
    input_schema: {
      type: 'object',
      properties: {
        metricType: { type: 'string', enum: ['large_exposure', 'aps221', 'dti', 'sector_concentration'] },
        value:      { type: 'number', description: 'The value to check against the threshold' },
        entityId:   { type: 'string', description: 'The borrower or group entity ID' }
      },
      required: ['metricType', 'value', 'entityId']
    }
  }
];

// ── Tool dispatcher ────────────────────────────────────────────────────────────
async function dispatchTool(name, args) {
  switch (name) {
    case 'hana_graph_traverse':   return hana_graph_traverse(args);
    case 'exposure_calculator':   return exposure_calculator(args);
    case 'apra_threshold_check':  return apra_threshold_check(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Relationship Agent — ReAct loop ──────────────────────────────────────────
async function relationshipAgent(state) {
  const customerId = state.intent?.customerId || state.customerId;
  console.log(`  [Relationship] ReAct traversal starting: ${customerId}`);

  // Hard timeout — if the ReAct loop or any LLM/tool call hangs, return an error
  // instead of freezing the entire pipeline
  const TIMEOUT_MS = 45000;
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Relationship Agent timed out after ${TIMEOUT_MS / 1000}s — GraphDB or LLM unresponsive`)), TIMEOUT_MS)
  );
  try {
    return await Promise.race([runRelationshipAgent(state, customerId), timeout]);
  } catch (e) {
    console.error(`  [Relationship] FAILED: ${e.message}`);
    return {
      relationshipMap: {
        nodes: [customerId], edges: [], groupExposure: 0, aps221Pct: 0, confidence: 0,
        finding: `Relationship traversal failed: ${e.message}`
      }
    };
  }
}

async function runRelationshipAgent(state, customerId) {

  if (!customerId) {
    return {
      relationshipMap: {
        nodes: [], edges: [], groupExposure: 0, aps221Pct: 0, confidence: 0.30,
        note: 'No customerId — relationship traversal skipped'
      }
    };
  }

  const isRequery   = (state.requeryCount ?? 0) > 0;
  const reQueryHint = state.reQueryHint || null;
  const prevNodes   = state.relationshipMap?.nodes || [];

  const lfHandler = getLangchainHandler(state.traceId, 'relationship-agent');
  const llm = new ChatAnthropic({
    model:     process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    apiKey:    process.env.ANTHROPIC_API_KEY,
    maxTokens: 1000,
    callbacks: lfHandler ? [lfHandler] : []
  }).bindTools(TOOLS);

  // ── System prompt: first run vs targeted re-query ─────────────────────────
  // AI: Re-query prompt is more specific — Self-RAG identified what was missing
  // Banking: First pass = broad sweep. Re-query = targeted investigation of identified gap.
  // SAP: reQueryHint from selfRagCheckNode guides where to traverse and what to recalculate
  const systemPrompt = isRequery && reQueryHint
    ? `You are a banking risk analyst performing a TARGETED RE-QUERY. The previous traversal was incomplete.

Self-RAG quality evaluation identified this gap: "${reQueryHint}"

Previous traversal found these nodes: ${prevNodes.join(', ') || 'none'}

Your goal: investigate the identified gap specifically. Do not just repeat the previous traversal.
- Start traversal from entities found in the previous pass that were not yet explored deeper
- Recalculate group exposure including any newly discovered entities
- Check APS 221 threshold with the updated total

Return your final summary as JSON:
{"nodes": [...], "edges": [...], "groupExposure": <AUD>, "aps221Pct": <pct>, "confidence": <0.0-1.0>, "finding": "<one sentence>"}`
    : `You are a banking risk analyst performing connected party graph traversal for APS 221 compliance.
Your goal: find ALL entities connected to the start customer (direct and indirect), calculate their total group exposure, and check it against APRA APS 221 limits.

Steps:
1. Call hana_graph_traverse with the customer ID to find connected parties
2. If new entities are found, call exposure_calculator with all entity IDs found
3. Call apra_threshold_check with the total exposure and metricType="aps221"
4. If the graph seems incomplete (few connections found), traverse again from a connected entity
5. When you have a complete picture, stop calling tools and summarise

Return your final summary as JSON:
{"nodes": [...], "edges": [...], "groupExposure": <AUD>, "aps221Pct": <pct>, "confidence": <0.0-1.0>, "finding": "<one sentence>"}`;

  const userPrompt = isRequery && reQueryHint
    ? `Re-query for customer ${customerId}. Focus: ${reQueryHint}. Previous nodes: ${prevNodes.join(', ') || 'none'}. Find what was missed and recalculate APS 221 group exposure.`
    : `Perform connected party traversal for customer ${customerId}. Find all connected entities via BUT050 relationship table and BCA_GUARANTOR table. Calculate total APS 221 group exposure.`;

  if (isRequery) {
    console.log(`  [Relationship] RE-QUERY run — hint: "${(reQueryHint || '').substring(0, 80)}..."`);
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt   }
  ];

  let steps    = 0;
  let tokensIn = 0, tokensOut = 0;

  // ── ReAct loop ────────────────────────────────────────────────────────────
  while (steps < MAX_REACT_STEPS) {
    const response = await llm.invoke(messages);
    tokensIn  += response.usage_metadata?.input_tokens  || 0;
    tokensOut += response.usage_metadata?.output_tokens || 0;
    messages.push(response);

    const toolCalls = response.tool_calls || [];
    if (toolCalls.length === 0) break; // LLM decided it has enough information

    console.log(`  [Relationship] ReAct step ${steps + 1} — tools: ${toolCalls.map(t => t.name).join(', ')}`);

    for (const tc of toolCalls) {
      let result;
      try {
        result = await dispatchTool(tc.name, tc.args);
      } catch (e) {
        result = { error: e.message };
        console.warn(`  [Relationship] Tool ${tc.name} failed:`, e.message);
      }
      messages.push({
        role:        'tool',
        content:     JSON.stringify(result),
        tool_call_id: tc.id
      });
    }
    steps++;
  }

  // ── Extract final relationship map from LLM summary ───────────────────────
  const lastTextMsg = [...messages].reverse().find(m => {
    const content = typeof m.content === 'string' ? m.content : '';
    return content.includes('{') && !m.tool_call_id;
  });

  let relationshipMap = {
    nodes: [customerId], edges: [], groupExposure: 0, aps221Pct: 0, confidence: 0.50,
    finding: `Connected party traversal completed for ${customerId}`
  };

  if (lastTextMsg) {
    const text  = typeof lastTextMsg.content === 'string' ? lastTextMsg.content : JSON.stringify(lastTextMsg.content);
    const match = text.match(/\{[\s\S]*\}/);
    try {
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.nodes)) relationshipMap = { ...relationshipMap, ...parsed };
      }
    } catch (e) { /* keep defaults */ }
  }

  console.log(`  [Relationship] Done — nodes:${relationshipMap.nodes?.length} edges:${relationshipMap.edges?.length} groupExposure:${relationshipMap.groupExposure} aps221Pct:${relationshipMap.aps221Pct} steps:${steps}`);

  return {
    relationshipMap: {
      nodes:         relationshipMap.nodes         || [customerId],
      edges:         relationshipMap.edges         || [],
      groupExposure: relationshipMap.groupExposure || 0,
      aps221Pct:     relationshipMap.aps221Pct     || 0,
      confidence:    relationshipMap.confidence    || 0.70,
      finding:       relationshipMap.finding       || ''
    },
    totalInputTokens:  tokensIn,
    totalOutputTokens: tokensOut
  };
}

module.exports = { relationshipAgent };
