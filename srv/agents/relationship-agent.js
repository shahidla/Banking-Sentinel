// Banking Sentinel — Relationship Agent (Agent 3, Phase 4b)
// AI: ReAct loop — agent reasons about graph findings and calls tools iteratively
//     Reasoning: "Found TrustCo Holdings connected via BUT050, need to traverse its connections"
//     Acting: calls hana_graph_traverse again with new start node
// Banking: APS 221 connected party exposure — parent-subsidiary = full consolidation,
//          family trust = reasoning required, guarantor network = multi-hop exposure chain
// SAP: target state is HANA Knowledge Graph Engine (GRAPH_TABLE on a
//      BP_RELATIONSHIP_GRAPH workspace, BUT050 edges ↔ BusinessPartners vertices,
//      up to 8 hops) — not available on BTP trial, so this demo runs the same
//      traversal as SPARQL against GraphDB (scripts/seed-graphdb.js). Swap the
//      query layer in mcp-tools.js when HANA Graph is available, same pattern
//      as ANOMALY_ENGINE=scikit vs HANA PAL.

'use strict';
const { ChatAnthropic } = require('@langchain/anthropic');
const { hana_graph_traverse, exposure_calculator, apra_threshold_check } = require('../tools/mcp-tools');
const { getLangchainHandler } = require('../observability/langfuse-client');
const { extractJson } = require('../utils/llm-json');

const MAX_REACT_STEPS = 6;

// ── Tool definitions for Claude tool calling ──────────────────────────────────
const TOOLS = [
  {
    name:        'hana_graph_traverse',
    description: 'Traverse the connected-party relationship graph (GraphDB; HANA Knowledge Graph in production) from a start business partner. Returns connected nodes, edges, and group exposure. Call this for each new entity found to go deeper.',
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
  return runRelationshipAgent(state, customerId);
}

async function runRelationshipAgent(state, customerId) {

  if (!customerId) throw new Error('Relationship Agent: no customerId in state');

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
4. If hana_graph_traverse returns zero SPARQL connections, this is EXPECTED — many borrowers are not in BUT050 directly. Do NOT call hana_graph_traverse again from a different entity; doing so pulls in unrelated connected-party chains. The guarantor data is already included in the tool result — use those IDs for exposure_calculator.
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
  let toolGraphData = null; // captures enriched node/edge data from first successful graph traverse

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
        // Capture enriched graph structure from the first successful traversal.
        // The LLM summary loses node names and real edge topology — preserve it here.
        if (tc.name === 'hana_graph_traverse' && result.nodeDetails?.length > 0 && !toolGraphData) {
          toolGraphData = { nodeDetails: result.nodeDetails, edges: result.edges };
          console.log(`  [Relationship] Graph data captured — ${result.nodeDetails.length} enriched nodes, ${result.edges.length} chain edges`);
        }
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
  // LangChain AIMessage.content can be a string OR an array of content blocks
  function extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(b => (typeof b === 'string' ? b : b.text || '')).join('');
    return String(content);
  }

  const lastTextMsg = [...messages].reverse().find(m => {
    if (m.tool_call_id) return false;
    return extractText(m.content).includes('{');
  });

  let parsed = null;
  if (lastTextMsg) {
    const rawText = extractText(lastTextMsg.content);
    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    parsed = extractJson(clean);
    if (!parsed) console.warn('  [Relationship] JSON parse failed — using fallback');
  }

  if (!parsed || !Array.isArray(parsed.nodes)) {
    console.warn('  [Relationship] LLM response missing nodes — using empty relationship map fallback');
    parsed = { nodes: [], edges: [], groupExposure: 0, aps221Pct: 0, confidence: 0.40, finding: 'Graph traversal result unavailable — manual review required' };
  }

  const relationshipMap = { ...parsed };

  // If graph returned only the source node with zero edges, the traversal succeeded but found
  // no connected parties — this is a data fact (solo borrower), not an infrastructure failure.
  // Override any LLM-generated "infrastructure unavailability" interpretation.
  const edgeCount = (toolGraphData?.edges?.length ?? 0) || (relationshipMap.edges?.length ?? 0);
  if ((relationshipMap.nodes?.length ?? 0) <= 1 && edgeCount === 0 && relationshipMap.groupExposure > 0) {
    const aud   = (relationshipMap.groupExposure / 1e6).toFixed(1);
    const pct21 = relationshipMap.aps221Pct ?? 0;
    relationshipMap.finding    = `No connected parties found via graph traversal — customer is a solo borrower with no BUT050 or guarantor relationships on record. Solo exposure AUD ${aud}M (${pct21}% APS 221 utilisation).`;
    relationshipMap.confidence = Math.max(relationshipMap.confidence ?? 0, 0.80);
  }

  // Use tool's enriched node list if available — LLM summary only has flat IDs
  const finalNodes = toolGraphData?.nodeDetails?.length > 0
    ? toolGraphData.nodeDetails.map(n => n.id)
    : (relationshipMap.nodes || []);

  console.log(`  [Relationship] Done — nodes:${finalNodes.length} chainEdges:${toolGraphData?.edges?.length ?? 0} groupExposure:${relationshipMap.groupExposure} aps221Pct:${relationshipMap.aps221Pct} steps:${steps}`);
  console.log(`  [Relationship] Nodes: ${finalNodes.join(', ') || 'none'}`);
  console.log(`  [Relationship] Finding: ${relationshipMap.finding || '(none)'}`);
  console.log(`  [Relationship] Confidence: ${relationshipMap.confidence}`);

  return {
    relationshipMap: {
      nodes:         finalNodes,
      nodeDetails:   toolGraphData?.nodeDetails  || [],   // enriched — for UI graph canvas
      edges:         toolGraphData?.edges?.length > 0 ? toolGraphData.edges : (relationshipMap.edges || []),
      groupExposure: relationshipMap.groupExposure || 0,
      aps221Pct:     relationshipMap.aps221Pct     || 0,
      confidence:    relationshipMap.confidence,
      finding:       relationshipMap.finding       || ''
    },
    totalInputTokens:  tokensIn,
    totalOutputTokens: tokensOut
  };
}

module.exports = { relationshipAgent };
