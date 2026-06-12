// Banking Sentinel — LangGraph State Definition
// AI: Typed state annotation — every node reads previous findings and adds its own
// Banking: Carries all four risk dimensions through the agent pipeline simultaneously
// SAP: Persisted via PostgresSaver across CF restarts (CPS 230 operational resilience)

'use strict';
const { Annotation } = require('@langchain/langgraph');

// last-write-wins reducer — most nodes replace, not accumulate
const last = (x, y) => (y !== undefined ? y : x);
// sum reducer — token counts accumulate across all nodes
const sum = (x, y) => (x ?? 0) + (y ?? 0);
// append reducer — messages list grows across nodes
const append = (x, y) => [...(x ?? []), ...(y ?? [])];

const BankingSentinelState = Annotation.Root({

  // ── Query context ──────────────────────────────────────────────────────────
  query:      Annotation({ reducer: last, default: () => '' }),
  customerId: Annotation({ reducer: last }),
  sessionId:  Annotation({ reducer: last, default: () => '' }),

  // ── Intake Agent output ────────────────────────────────────────────────────
  // AI: Intent classification — determines which agents activate
  // Banking: "Analyse B-001 risk" vs "What is total loan amount?" vs "Approve the loan"
  // SAP: Routes between simpleQuery node, full risk pipeline, and rejection node
  intent: Annotation({ reducer: last }),
  /*
    intent shape:
    {
      isSimpleDataQuery:      boolean  — direct HANA lookup, no full pipeline
      isRiskAnalysis:         boolean  — full five-agent sequential pipeline
      isInappropriateRequest: boolean  — approve/delete/modify/override → rejection node
      customerId:             string | null
      description:            string   — what the user wants, for downstream agents
    }
  */

  // ── Agent outputs ──────────────────────────────────────────────────────────
  simpleQueryResult:  Annotation({ reducer: last }),  // simple data query answer
  rejectionMessage:   Annotation({ reducer: last }),  // refusal text for inappropriate requests

  // AI: Pattern Agent — holistic signal before any rule fires
  // Banking: "Something feels wrong" even without a threshold breach
  // SAP: RPT-1 tabular score + HANA PAL anomaly detection inputs
  patternAssessment: Annotation({ reducer: last }),
  /*
    patternAssessment shape:
    {
      riskScore:   number      — 0-100 from RPT-1 tabular scoring
      riskLevel:   string      — LOW / MEDIUM / HIGH / CRITICAL
      confidence:  number      — 0.0-1.0
      signal:      string      — concerning / stable / unclear
      anomalies:   string[]    — combined PAL + LLM anomaly texts for Synthesis

      rpt1: { score, category, confidence, success, error? }
        — SAP tabular foundation model output (rpt.cloud.sap consumer API)

      pal: { findings: [{ id, score, label, reasonCode }], anomalyCount, success, error }
        — HANA PAL Isolation Forest: label -1=outlier, 1=inlier, reasonCode=feature attribution

      llm: { anomalies: string[], tokensIn, tokensOut }
        — Claude narrative anomaly detection (APRA CPS 230 human-readable justification)
    }
  */

  // AI: Relationship Agent — graph traversal, multi-hop connected parties
  // Banking: G-001 guarantees B-001, G-001 connected to G-002 via BUT050 → full APS 221 group exposure
  // SAP: HANA Knowledge Graph Engine SPARQL traversal on BUT050 + BCA_GUARANTOR up to 8 hops
  relationshipMap: Annotation({ reducer: last }),
  /*
    relationshipMap shape:
    {
      nodes:          string[]           — all entity IDs found in the traversal
      edges:          object[]           — from/to/type/hop for each connection
      groupExposure:  number             — total AUD exposure across the connected group
      aps221Pct:      number             — utilisation % of the applicable limit
      confidence:     number             — 0.0-1.0 per connection type
    }
  */

  // AI: Trajectory Agent — conflicting signals + forward position
  // Banking: DTI 7.2 today + income contract expires in 3 months = effective DTI 9.2 imminently
  // SAP: BCA_DTI INCOME_EXPIRY field drives the forward calculation; BCA_LOAN_SCHED confirms payment trajectory
  trajectoryAnalysis: Annotation({ reducer: last }),
  /*
    trajectoryAnalysis shape:
    {
      currentDti:     number
      futureDti:      number | null      — post income-expiry effective DTI
      daysToExpiry:   number | null      — income contract expiry countdown
      timeToBreach:   number | null      — days until limit breached
      conflictingSignals: string[]       — list of contradictions found
      forwardPosition:    string         — DETERIORATING / STABLE / IMPROVING
    }
  */

  // AI: Synthesis Agent — APRA-ready risk brief with explicit confidence per finding
  // Banking: What the risk officer reads before approving the human-in-the-loop interrupt
  // SAP: Retrieved from HANA Vector (APRA regulatory documents) via hana_vector_search MCP tool
  synthesisResult: Annotation({ reducer: last }),
  /*
    synthesisResult shape:
    {
      riskScore:      number
      riskLevel:      string
      confidence:     number             — overall confidence (below 0.70 triggers Reflection)
      findings:       object[]           — each finding with evidenceSource + confidence
      recommendations: string[]
      regulatoryRefs:  string[]          — APS 221, CPS 230, DTI Notice etc.
      uncertainties:   string[]          — explicit acknowledgement of data gaps
      apraReady:       boolean           — true if evidence trail is complete
    }
  */

  // ── Reflection loop control ──────────────────────────────────────────────────
  // AI: Reflexion-style re-query — a critic evaluates agent confidence and loops if below threshold
  // Banking: Risk officer double-checks before signing off. Below 0.70 = get more data first.
  // SAP: LangGraph conditional edge after reflectionCheck node; max 2 re-queries to avoid infinite loop
  requeryCount: Annotation({ reducer: (x, y) => (y !== undefined ? y : (x ?? 0)), default: () => 0 }),

  // AI: Reflection evaluation output — real LLM quality assessment of all agent outputs
  // Banking: "Graph traversal found 3 nodes but zero exposure — traversal stopped early"
  // SAP: Written by reflection.js reflectionNode; read by checkConfidence routing function
  reflectionEvaluation: Annotation({ reducer: last }),
  /*
    reflectionEvaluation shape:
    {
      overallConfidence: number      — LLM-evaluated confidence (0.0-1.0), authoritative for routing
      gaps:              string[]    — specific evidence gaps identified
      reQueryHint:       string      — targeted instruction for Relationship Agent re-query
      reasoning:         string      — one sentence explaining the confidence level
    }
  */

  // AI: Targeted re-query instruction — Reflection tells Relationship Agent what to look for deeper
  // Banking: "Start from TrustCo Group (30910009) — previous traversal didn't reach parent entities"
  // SAP: Written by reflectionNode; read by relationshipAgent on re-query runs
  reQueryHint: Annotation({ reducer: last }),

  // AI: Full iteration log — one entry per Reflection evaluation, preserved across re-queries
  // Banking: Audit trail showing how confidence evolved — iteration 1: 0.65 → re-query → iteration 2: 0.82
  // SAP: Appended by reflectionNode; read by Synthesis agentContext and report page
  reflectionHistory: Annotation({ reducer: append, default: () => [] }),

  // ── Pipeline config ────────────────────────────────────────────────────────
  // AI: HITL toggle — persisted so /explain can read the mode for a given session
  // Banking: CPS 230 co-pilot — report must show whether human approved or auto-approved
  // SAP: Set in initialState from params.hitl; read by the merged /explain report
  hitlEnabled: Annotation({ reducer: last, default: () => true }),

  // ── Observability ──────────────────────────────────────────────────────────
  // AI: LLMOps — token usage accumulates across all agent nodes
  // Banking: Cost per analysis — stored in AuditLog, visible in Langfuse
  // SAP: calculateCost(inputTokens, outputTokens) → AUD stored in AuditLog entity
  totalInputTokens:  Annotation({ reducer: sum,  default: () => 0 }),
  totalOutputTokens: Annotation({ reducer: sum,  default: () => 0 }),
  totalLatencyMs:    Annotation({ reducer: last, default: () => 0 }),

  // AI: Retrieved APRA regulatory chunks — set by Synthesis Agent, read by its own guardrail
  // Banking: Faithfulness check: does the risk brief cite regulations that were actually retrieved?
  // SAP: Stored without EMBEDDING field (too large) — STANDARD + CONTENT only
  retrievedDocs: Annotation({ reducer: last }),

  // AI: Langfuse traceId — set by server.js on trace creation, read by all agents to attach child spans
  // Banking: Every agent span links back to the same trace → one unified view per risk analysis run
  // SAP: String (UUID) — safe to checkpoint in PostgresSaver; agents require langfuse-client to use it
  traceId: Annotation({ reducer: last }),

  // Message history — carries conversation context
  messages: Annotation({ reducer: append, default: () => [] }),

});

module.exports = { BankingSentinelState };
