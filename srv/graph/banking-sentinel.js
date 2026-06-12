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
const { reflectionNode, checkConfidence } = require('../agents/reflection');

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
    // VCAP_APPLICATION is always set by CF — reject MemorySaver in any CF environment
    // regardless of NODE_ENV (which CF does not set automatically)
    if (process.env.VCAP_APPLICATION) {
      throw new Error(`PostgresSaver required on BTP CF — set POSTGRES_URL env var. ${e.message}`);
    }
    checkpointer = new MemorySaver();
    console.warn(`  [Graph] PostgresSaver unavailable (${e.message.substring(0, 60)}) — MemorySaver active (LOCAL DEV ONLY — state will not survive restarts)`);
  }

  // ── StateGraph definition ──────────────────────────────────────────────────
  const graph = new StateGraph(BankingSentinelState)

    // ── Agent nodes ──
    .addNode('intake',       intakeAgent)
    .addNode('simpleQuery',  simpleQueryNode)
    .addNode('rejection',    rejectionNode)
    .addNode('riskStart',    () => ({}))             // pass-through — triggers fan-out to pattern + relationship
    .addNode('pattern',      patternAgent)
    .addNode('relationship', relationshipAgent)
    .addNode('trajectory',   trajectoryAgent)
    .addNode('reflectionCheck', reflectionNode)
    .addNode('humanApproval',humanApprovalNode)
    .addNode('synthesis',    synthesisAgent);

  // ── Entry point ──
  graph.setEntryPoint('intake');

  // ── Conditional routing from Intake ──
  graph.addConditionalEdges('intake', routeFromIntake, {
    'simple_query':          'simpleQuery',
    'risk_analysis':         'riskStart',
    'inappropriate_request': 'rejection'
  });

  // ── Terminals ──
  graph.addEdge('simpleQuery', END);
  graph.addEdge('rejection',   END);

  // ── Risk pipeline — pattern runs first, then routes on score ──────────────
  // AI: routeAfterPattern shortcut — score < 30 skips Relationship + Trajectory + Reflection
  // Banking: Performing borrower (score 5) gets a fast synthesis; high-risk gets full pipeline
  graph.addEdge('riskStart', 'pattern');

  graph.addConditionalEdges('pattern', routeAfterPattern, {
    'low_risk':  'synthesis',    // skip directly — no connected-party graph traversal needed
    'high_risk': 'trajectory'   // full pipeline: trajectory → relationship → reflectionCheck
  });

  // ── Sequential high-risk path: trajectory → relationship → reflectionCheck ──
  // AI: Sequential instead of fan-out — relationship reads patternAssessment + trajectoryAnalysis
  // Banking: Relationship Agent uses DTI context to judge whether group exposure is material
  graph.addEdge('trajectory',   'relationship');
  graph.addEdge('relationship', 'reflectionCheck');

  // ── Reflection loop ──
  graph.addConditionalEdges('reflectionCheck', checkConfidence, {
    'requery': 'relationship',
    'proceed': 'humanApproval'
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
