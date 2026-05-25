// Banking Sentinel — LangGraph StateGraph
// AI: StateGraph orchestrates five specialist agents. Conditional edges = dynamic routing.
//     Each node reads ALL previous findings from state, adds its own, passes forward.
// Banking: Sequential risk analysis: Intake → Pattern → Relationship → Trajectory → Synthesis
//          With conditional shortcuts: simple queries skip the pipeline entirely
// SAP: LangGraph on BTP CF. PostgresSaver = CPS 230 operational resilience requirement.
//      MemorySaver resets on CF restart — not acceptable for production.

'use strict';
require('dotenv').config();
const { StateGraph, END }       = require('@langchain/langgraph');
const { PostgresSaver }         = require('@langchain/langgraph-checkpoint-postgres');
const { MemorySaver }           = require('@langchain/langgraph');
const { Pool }                  = require('pg');
const { BankingSentinelState }  = require('./state');
const { intakeAgent, routeFromIntake } = require('../agents/intake-agent');
const { simpleQueryNode }       = require('../agents/simple-query');
const { rejectionNode }         = require('../agents/rejection');
const { patternAgent, routeAfterPattern } = require('../agents/pattern-agent');
const { relationshipAgent } = require('../agents/relationship-agent');
const { trajectoryAgent }   = require('../agents/trajectory-agent');
const { synthesisAgent }    = require('../agents/synthesis-agent');
const { humanApprovalNode } = require('../agents/human-approval');
const { selfRagCheckNode, checkConfidence } = require('../agents/self-rag');

let graphInstance = null;

async function createBankingSentinelGraph() {
  if (graphInstance) return graphInstance;

  // ── PostgreSQL state persistence ───────────────────────────────────────────
  // AI: Temporal Memory pattern — state survives CF restarts and deployments
  // Banking: Human-in-the-loop approvals must survive server restarts (CPS 230)
  // SAP: BTP PostgreSQL Hyperscaler Option in production. Supabase free tier pauses after
  //      inactivity — MemorySaver fallback for local dev only. Never use MemorySaver on CF.
  let checkpointer;
  try {
    const pgPool = new Pool({
      connectionString:        process.env.POSTGRES_URL,
      ssl:                     { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000   // fail fast if Supabase is paused
    });
    const pgCheckpointer = new PostgresSaver(pgPool);
    await pgCheckpointer.setup();
    checkpointer = pgCheckpointer;
    console.log('  [Graph] PostgresSaver initialised — agent state will survive CF restarts');
  } catch (e) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`PostgresSaver required in production — cannot fall back to MemorySaver. ${e.message}`);
    }
    checkpointer = new MemorySaver();
    console.warn(`  [Graph] PostgresSaver unavailable (${e.message.substring(0, 60)}) — MemorySaver active (LOCAL DEV ONLY — state will not survive restarts)`);
  }

  // ── StateGraph definition ──────────────────────────────────────────────────
  const graph = new StateGraph(BankingSentinelState)

    // ── Agent nodes ──
    .addNode('intake',       intakeAgent)           // Phase 3: LIVE
    .addNode('simpleQuery',  simpleQueryNode)        // Phase 3: LIVE
    .addNode('rejection',    rejectionNode)          // Phase 3: LIVE
    .addNode('pattern',      patternAgent)            // Phase 4: LIVE
    .addNode('relationship', relationshipAgent)        // Phase 4b: LIVE — ReAct loop + HANA Graph
    .addNode('trajectory',   trajectoryAgent)         // Phase 5: LIVE
    .addNode('selfRagCheck', selfRagCheckNode)        // Phase 6: LIVE — real LLM confidence evaluation
    .addNode('humanApproval',humanApprovalNode)       // Phase 5: LIVE (interruptBefore fires before this node)
    .addNode('synthesis',    synthesisAgent);         // Phase 5: LIVE

  // ── Entry point ──
  graph.setEntryPoint('intake');

  // ── Conditional routing from Intake ──
  // AI: Dynamic routing — not hardcoded. Agent decides which path to take.
  // Banking: Same query interface handles risk analysis, data lookup, and refusal
  graph.addConditionalEdges('intake', routeFromIntake, {
    'simple_query':          'simpleQuery',
    'risk_analysis':         'pattern',
    'inappropriate_request': 'rejection'
  });

  // ── Terminals for Phase 3 ──
  graph.addEdge('simpleQuery', END);   // simple queries end immediately
  graph.addEdge('rejection',   END);   // refusals end immediately

  // ── Full risk pipeline (Phases 4–6) ──
  // AI: Conditional edge after Pattern — low risk skips graph traversal (cost saving)
  // Banking: Low risk borrowers don't need 6-hop graph traversal. Only HIGH risk gets full treatment.
  // SAP: UI shows greyed-out Relationship + Trajectory nodes for low risk customers in Panel 2
  graph.addConditionalEdges('pattern', routeAfterPattern, {
    'low_risk':  'synthesis',     // skip Relationship + Trajectory for score < 30
    'high_risk': 'relationship'   // full pipeline for score >= 30
  });

  graph.addEdge('relationship', 'trajectory');
  graph.addEdge('trajectory',   'selfRagCheck');

  // AI: Self-RAG loop — re-query if confidence below 0.70 (max 2 attempts)
  // Banking: Risk officer goes back for more data if unsure. Epistemic humility.
  graph.addConditionalEdges('selfRagCheck', checkConfidence, {
    'requery': 'relationship',   // loop back for additional graph traversal
    'proceed': 'humanApproval'   // confidence sufficient — move to human review
  });

  // AI: Human-in-the-loop interrupt() — execution halts here until resume event
  // Banking: APRA co-pilot requirement. Risk brief not finalised without human approval.
  graph.addEdge('humanApproval', 'synthesis');
  graph.addEdge('synthesis', END);

  graphInstance = graph.compile({
    checkpointer,
    interruptBefore: ['humanApproval']  // Phase 5: halt before human approval node; resume via POST /a2a/approve
  });

  console.log('  [Graph] Banking Sentinel StateGraph compiled — all nodes and edges registered');
  return graphInstance;
}

module.exports = { createBankingSentinelGraph };
