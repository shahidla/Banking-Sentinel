# Banking Sentinel — Project Context (Live Working Document)
## Based on v6 — updated with actual Phase 3 + Phase 4 + Phase 4b + Phase 5 build decisions
## BACKUP: Banking-Sentinel-Context-v6.md is the original design document — DO NOT MODIFY IT
## This file (CONTEXT.md) is the single source of truth for Claude Code — it is v6 content + actual build decisions
## Differences from v6: (1) RPT-1 uses rpt.cloud.sap consumer API, not SAP AI Hub (trial limitation); (2) All three (RPT-1 + PAL + LLM) always run simultaneously — no PAL/LLM ENV switch gate; (3) Graph traversal uses BFS via CAP SELECT not GRAPH_TABLE (GRAPH_TABLE is a preview feature not yet GA in this HANA tier); (4) KGE/Triple Store not available on BTP trial
## Phase 3 complete (2026-05-24): LangGraph StateGraph + Intake + SimpleQuery + Rejection + A2A endpoint — all three routes verified
## Phase 4 complete (2026-05-24): Pattern Agent — RPT-1 (rpt.cloud.sap consumer API) + PAL Isolation Forest EXPLAIN (real HANA AFL CALL) + LLM (claude-sonnet-4-6) all running simultaneously. Combined anomaly output for Synthesis. rpt1/pal/llm sub-objects in patternAssessment for educational popup side-by-side display.
## Phase 4b complete (2026-05-24): Relationship Agent — ReAct loop (max 6 steps), hana_graph_traverse (BFS over BUT050), exposure_calculator, apra_threshold_check. Returns relationshipMap {nodes, edges, groupExposure, aps221Pct, confidence, finding}.
## Phase 5 complete (2026-05-24): Trajectory Agent + Synthesis Agent + Human-in-the-loop interrupt (interruptBefore: humanApproval). PostgresSaver checkpointer wired. Full pipeline LIVE end-to-end.
## Graph Engine decision (2026-05-24): KGE (Triple Store) NOT on BTP trial. GRAPH_TABLE SQL function NOT supported (preview feature only in this tier). Workspace BP_RELATIONSHIP_GRAPH deployed as HDI artifact — production upgrade path when GRAPH_TABLE goes GA.
## KGE equivalent (2026-05-24): GraphDB (Graphwise sandbox) — RDF triple store + SPARQL. Same SPARQL queries run on HANA KGE in production (one endpoint change). 4035 triples loaded: 1000 BusinessPartners + 12 BUT050 relationships. SPARQL traversal from 30100003 finds 7 connected parties including TrustCo Holdings (4 hops). Sandbox expires every 7 days — restore with: npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid
## Phase 6 complete (2026-05-25): Self-RAG — real LLM confidence evaluation (4 dimensions), targeted re-query loop (max 2), reQueryHint drives focused Relationship Agent re-traversal. Confidence threshold 0.70.
## Phase 7 complete (2026-05-25): SSE + Solace dual-publish per node via graph.stream(). UI fully wired — anomaly strings, relationship finding, forward position, synthesis findings all live. Admin data browser: PostgreSQL sidebar with real COUNT(*) and Clear All. Security hardening: admin IP guard, APS 221 GROUP limit fix, orphaned-approve 404, real audit latency. Relationship Agent 45s timeout + SPARQL 8s AbortSignal. Logo added.
## Phase 8 — HDI Deploy + PAL Investigation (2026-05-25): BP_RELATIONSHIP_GRAPH.hdbgraphworkspace + 3 CDS views deployed to HANA Cloud HDI via hdi-deploy v5.6.1. PAL Isolation Forest CONFIRMED NOT AVAILABLE on HANA Cloud Free Tier — ScriptServer requires 3 vCPU minimum; Free Tier has 1 vCPU. PAL code preserved in pattern-agent.js (calls PAL_RUN_ISOLATION_FOREST procedure) — non-fatal on Free Tier (warns, continues). Deploy to paid 3vCPU HANA Cloud + grant AFL__SYS_AFL_AFLPAL_EXECUTE to #OO user to enable PAL (see SAP KB 3655407). Key deploy fix: VCAP_SERVICES needs "tags": ["hana"] + "plan": "hdi-shared" for xsenv.filterServices to pick up the service. db/src/.hdiconfig added for hdbgraphworkspace + hdbprocedure plugins.
## HDI Deploy command (2026-05-25): npx cds build --for hana → Copy-Item default-env.json gen\db\default-env.json → cd gen\db; node node_modules\@sap\cds-dk\node_modules\@sap\hdi-deploy\deploy.js --exit
## Last updated: 2026-05-25

---

## CRITICAL — READ THIS ENTIRE DOCUMENT BEFORE TOUCHING ANY CODE

This document captures not just what to build but why — the reasoning, the journey, the decisions made and rejected, and the thinking behind every architectural choice. Claude Code must understand the context as deeply as the architect who designed it. Every section matters. Do not skip ahead.

---

## PART 1 — WHO I AM AND WHY THIS PROJECT EXISTS

### Who I Am

SAP Development Architect with 19 years of SAP experience, transitioning to AI Engineer/Architect. Currently working on a SAP TRBK implementation at a major Australian bank. Background: enterprise architecture, integration patterns, event-driven systems, SAP BTP, HANA, CPI, CAP, Solace.

Previously built MJ Live — a completed real-time AI cognitive pipeline on SAP BTP. MJ Live patterns carry forward. Ask for the GitHub link before starting.

I learn by building real things. I document as I build — not after. Every decision recorded: what was chosen, what was rejected, why.

**Three vocabularies rule:** Every technical term encountered during the build must be explained in three ways — AI meaning, banking meaning, SAP meaning. This applies throughout the build, not just to the 10 AI patterns in Part 8.

### Five Angles — All Equal Weight

This project exists for five reasons simultaneously. Claude Code must never prioritise one over another or discard any when making decisions. Each angle shapes every architectural choice.

**1. Skill Development**
Every component teaches a specific AI architecture pattern. The patterns are a structured curriculum embedded in a real project. Build so each pattern is visible, understandable, and explainable — not just functional.

**2. Enterprise AI Positioning**
Demonstrates that modern AI patterns — GraphRAG, multi-agent reasoning, observability, evaluation — belong inside SAP enterprise architecture, not alongside it. Every decision must be defensible to an SAP architect, an AI engineer, and a banking technologist simultaneously.

**3. Client Value**
Solves a real, measurable problem for a major Australian bank regulated by APRA. Connected party exposure, regulatory breach detection, early warning credit signals — genuine pain points. Nothing fake. Nothing generic. Every architectural decision must hold up in a client meeting.

**4. Knowledge Sharing**
Documented to serve three technical communities simultaneously — SAP architects learning AI, AI engineers learning enterprise integration, banking technologists learning both. The three-vocabulary approach and honest decision recording make the project useful beyond its immediate context.

**5. Production Readiness**
Architected from the start for delivery, not just demonstration. The transition from prototype to delivered project is a proven pattern — prototypes built this way have been paid for and delivered as real projects before. Production-grade thinking from the first line of code.

---

## PART 2 — THE JOURNEY TO THIS ARCHITECTURE

### Why We Are Here — The Full Chain of Reasoning

Claude Code must understand how the architecture evolved — not just what it is. Every step matters.

**Step 1 — Original Banking Sentinel design**
The first version was five agents doing structured queries in sequence — fetch loan data, traverse relationships, check thresholds, raise alerts. Node.js, direct Anthropic SDK calls, manual state management. Looked agentic. Was not.

**Step 2 — The ABAP challenge**
Critical question raised: "Could the same thing be done in ABAP?" Honest answer: yes. Fetch-validate-alert is exactly what ABAP does well. That realisation forced a complete rethink of what AI actually adds.

**Step 3 — What AI genuinely does that ABAP cannot**
Fundamental difference identified: ABAP fires rules. AI reasons through uncertainty.

Old school: if DTI > 6 then flag. That rule misses everything — is a DTI of 5.9 actually safer than 6.1? Not necessarily. It depends on employment stability, guarantor stress, sector trajectory, income source expiry. The hard rule cannot see this. The AI reasons through it.

The genuine AI capability is: reasoning over incomplete, ambiguous, conflicting data to produce a conclusion that a rules-based system structurally cannot reach.

**Step 4 — Five reasoning types, not five queries**
This led to redesigning the agents around five distinct types of reasoning:
- Pattern recognition across incomplete data — something feels wrong before any rule fires
- Relationship ambiguity — what kind of connection and how strong, not just that one exists
- Threshold proximity and conflicting signals — trajectory not just current state
- Confidence under uncertainty — the AI admits what it does not know and asks for more
- Synthesis across all four — holding contradictions, not resolving them prematurely

Together these produce reasoning genuinely impossible in ABAP.

**Step 5 — The SAP job posting**
A SAP Senior AI Developer role was reviewed. Required: LangGraph, A2A/MCP patterns, SAP AI Core, Joule, Python, LLMOps, MLOps, Responsible AI. This confirmed the architecture needed to check every box — not for name's sake but because they are essential for production-grade enterprise AI.

**Step 6 — SAP documentation research**
SAP Architecture Center confirmed: SAP Cloud SDK for AI supports both Python AND TypeScript/JavaScript. LangGraph is SAP's recommended agent framework. A2A is the protocol for Joule integration. CAP is the application layer. MCP is how agents connect to tools. This is SAP's own documented production stack as of 2026.

**Step 6b — SAP AI Golden Path deep read**
Three SAP AI Golden Path documents were read:
- architecture.learning.sap.com/docs/ai-golden-path
- architecture.learning.sap.com/docs/golden-path/ai-golden-path/build-and-deliver/classic-ml
- help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/what-is-sap-ai-core

Three significant findings that changed the architecture:

1. HANA Cloud now includes a Knowledge Graph Engine — AI-native, separate from the HANA Knowledge Graph Engine. More aligned with SAP AI Golden Path for relationship traversal.
2. RPT-1 is a foundation model for tabular prediction. No model training. No LLM call. Better than asking Claude to score credit risk from tabular data.
3. HANA PAL (Predictive Analytics Library) has built-in anomaly detection. Better than LLM for detecting payment anomalies in DFKKOP — statistically rigorous, no hallucination risk.

Decision made: use HANA native capabilities for what HANA does better. Use LLM for what only LLM can do.

**[ACTUAL BUILD DECISION — Phase 4]** RPT-1, PAL, and LLM all run simultaneously in the Pattern Agent — not as a PAL/LLM switch. This was the agreed architecture after seeing all three outputs side-by-side. The educational popup shows all three results. Combined anomaly list (PAL outlier texts + LLM narrative texts) is forwarded to Synthesis.

**Step 7 — The AI Core constraint**
SAP AI Core not available in BTP trial accounts. Only in free tier enterprise accounts requiring SAP BTPEA — not available to individuals. Real constraint, not a workaround situation.

**Step 8 — Three genuine workarounds**
- RPT-1 is available via a consumer API at `rpt.cloud.sap/api/predict` — personal API token, no AI Core required. Tested live: HTTP 200, prediction HIGH confidence 0.98. This is NOT the AI Hub — it is SAP's dedicated RPT consumer endpoint.
- Langfuse replaces AI Launchpad for observability. One config change to swap in production.
- Custom chat UI exposes A2A-compatible endpoint. Joule calls the same endpoint in enterprise environment. One agent, one endpoint, two callers.
- Claude API called directly via @langchain/anthropic — not through SAP Generative AI Hub (trial limitation). In production: route through CPI or AI Hub. One endpoint change.

**Step 9 — Requirements session**
Full requirements established: natural language intelligence, performance, zero code change adaptability (the second twinkle), what the system must not do, success definition, edge cases. See Part 5.

**Step 10 — The two twinkle moments and deliberate rejection**
Three specific demo moments were designed deliberately:
- Twinkle 1: AI finds a hidden connection nobody asked about through graph reasoning
- Twinkle 2: Regulatory change applied immediately by document upload with zero code change
- Deliberate rejection: System refuses to approve a loan — demonstrates Responsible AI live

---

## PART 3 — WHAT THIS PROJECT IS

### The Business Problem

Connected party risk in banking is invisible to SQL queries and ABAP programs. A borrower looks healthy alone. Their guarantor looks healthy alone. Connected — they may breach APRA's APS 221 large exposure limit. No hardcoded rule finds this. Graph traversal and AI reasoning does.

The deeper problem: when APRA changes a regulation, banks spend months rewriting code. When a borrower's risk profile changes, analysts only find out at the quarterly review. Banking Sentinel solves both — regulations live in the knowledge base as documents, the AI reads and applies them immediately. Risk state changes trigger real-time re-evaluation via Solace. Zero code change required.

### The Core Capability

The system answers any natural language question about borrower or portfolio risk using the data available in HANA. It does not have pre-programmed question types. The Intake Agent determines intent, appropriate agents activate, the answer emerges from reasoning over data.

For simple data queries ("what is the total loan amount?") — answer directly, no full pipeline.
For risk questions — full agent pipeline, reasoning, connection, explanation.

**What ABAP cannot do:**
ABAP answers the question you asked. It executes the logic you wrote. It finds what you told it to find.

Banking Sentinel understands the intent behind the question. It decides what to look for. It traverses relationships you did not specify. It reasons about what it found. It connects things across domains without being told to. It produces a narrative explaining its reasoning. It admits when it is uncertain. It stops itself when confidence is too low. It refuses to make decisions requiring human authorisation.

### The Two Twinkle Moments

**Twinkle 1 — The undiscovered connection:**
The Pattern Agent detects something is wrong even though individual metrics appear borderline acceptable. The Relationship Agent traverses to depth 6 and finds TrustCo Holdings — a parent entity connecting three borrowers nobody asked about. Group exposure is 92% of the APS 221 limit. The Synthesis Agent rejects its own confidence at 64%, re-queries, comes back at 89% with a finding connecting four borrowers, two guarantors, one family trust, and a regulatory breach nobody documented.

Nobody programmed that finding. The agent found it through reasoning. This must be REAL — not theatrical. The confidence must genuinely be below threshold and the re-query must genuinely find new information that changes the assessment.

**Twinkle 2 — The live regulatory update:**
APRA changes a regulation. The demo shows a "Sync Latest APRA Standards" button. The system connects to the official APRA website — live, in front of the audience — fetches the actual regulatory document, chunks it, embeds it, stores it in HANA Vector. Then re-runs B-001. Without a single line of code changing, the Synthesis Agent retrieves the new guideline on the next query. A borrower who was compliant yesterday is now flagged today.

Every person in a bank audience has lived through a regulatory change that took months to implement in ABAP. This takes seconds. That is the twinkle.

**The live APRA connection sequence:**
```
Button: "Sync Latest APRA Standards" clicked
        ↓
System fetches from live official APRA URLs:
  handbook.apra.gov.au/standard/aps-221
  apra.gov.au/sites/default/files/.../CPS-230-clean.pdf
  apra.gov.au/industries/1/standards
        ↓
Documents chunked, embedded via Claude embeddings
Stored in HANA Vector (RegulatoryDocuments entity)
        ↓
"APRA standards updated. Re-running B-001..."
        ↓
Synthesis Agent retrieves new content via hana_vector_search
Risk assessment changes
        ↓
New risk brief generated — different finding based on real regulation
```

**Official APRA document URLs:**
- APS 221: `https://handbook.apra.gov.au/standard/aps-221`
- CPS 230: `https://www.apra.gov.au/sites/default/files/2023-07/Prudential%20Standard%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf`
- All ADI standards: `https://www.apra.gov.au/industries/1/standards`

### The Deliberate Rejection Moment

You ask: "Approve the loan for BP233."

System responds: "I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation. Here is the risk profile for BP233 to inform your decision."

Script and rehearse this. It demonstrates Responsible AI live. It is not a failure — it is a feature. APRA's co-pilot requirement made visible.

---

## PART 4 — COMPLETE ARCHITECTURE AND DESIGN

### End-to-End Data Flow

```
USER TYPES QUERY IN HTML UI
"Analyse borrower B-001 for all risk dimensions"
        ↓
A2A Endpoint (/a2a/agent) — CAP exposes this
        ↓
LangGraph StateGraph — starts execution
        ↓
┌─────────────────────────────────────────────────────┐
│           LANGGRAPH AGENT GRAPH                     │
│                                                     │
│  [Intake Node]                                      │
│   Parse intent → identify customer → build plan     │
│   If simple query → direct HANA query → return      │
│   If risk query → route to specialist agents        │
│        ↓                                            │
│  [Pattern Node]                                     │
│   RPT-1 API → HANA PAL Isolation Forest → LLM      │
│   All three always run simultaneously               │
│   Holistic assessment → confidence score            │
│        ↓                                            │
│  [Relationship Node] ← ReAct loop here              │
│   MCP Tool: hana_graph_traverse(BUT050, depth=8)    │
│   MCP Tool: hana_graph_traverse(BCA_GUARANTOR)      │
│   Reason about connection types → weighted map      │
│        ↓                                            │
│  [Trajectory Node]                                  │
│   MCP Tool: hana_relational_query(BCA_DTI, BKKS)    │
│   MCP Tool: apra_threshold_check(exposure, limit)   │
│   Resolve conflicting signals → forward position    │
│        ↓                                            │
│  [Self-RAG Check] ← conditional edge               │
│   confidence < 0.70 → loop back to Relationship     │
│   confidence ≥ 0.70 → continue to Synthesis         │
│        ↓                                            │
│  [Human-in-the-Loop Interrupt]                      │
│   Pause execution → publish to Solace               │
│   Wait for human approval event                     │
│   On approval → continue                            │
│        ↓                                            │
│  [Synthesis Node]                                   │
│   MCP Tool: hana_vector_search(APRA standards)      │
│   Hold contradictions → confidence per finding      │
│   Generate APRA-ready risk brief                    │
└─────────────────────────────────────────────────────┘
        ↓
State persisted to PostgreSQL (thread_id keyed)
        ↓
Langfuse trace emitted (every node)
        ↓
Events published to Solace topics:
  banking/pipeline/status → Panel 2 (agent pipeline)
  banking/risk/findings → Panel 3 (risk brief)
  banking/human/approval → Panel 2 (pause indicator)
        ↓
HTML UI subscribes via Solace JS SDK WebSocket
Three panels update in real time
```

### The Full Stack — Every Component Justified

| Layer | Tool | Prototype | Production Swap | Why |
|---|---|---|---|---|
| Primary SDK | SAP Cloud SDK for AI (TypeScript) | npm install @sap-ai-sdk/ai-api | Same — add AI Core credentials | SAP's official SDK for pro-code agents on BTP. Type-safe abstractions for Generative AI Hub. |
| LLM Access | Claude API direct (@langchain/anthropic) | ANTHROPIC_API_KEY in .env | CPI → AI Core Generative AI Hub | Trial: direct API. Production: governed through CPI or AI Hub. One endpoint change. SAP and Anthropic official partners Sapphire 2026. |
| Agent Orchestration | LangGraph TypeScript (@langchain/langgraph) | npm install @langchain/langgraph | Same | SAP's recommended framework. Stateful graph, conditional routing, human-in-the-loop, 90M downloads. |
| Agent State Persistence | PostgreSQL (via LangGraph checkpointer) | Supabase session pooler | BTP PostgreSQL Hyperscaler Option | MemorySaver resets on CF restart. PostgresSaver survives restarts, deployments, sessions. Production non-negotiable. |
| Tool Protocol | MCP (Model Context Protocol) | Local MCP tool functions | MCP servers on BTP CF | Standard for agent-tool connections. SAP job requires A2A AND MCP. Tools exposed as MCP, not hardcoded functions. |
| Agent-UI Protocol | A2A (JSON-RPC 2.0) | Custom chat UI calls /a2a/agent | Joule calls same /a2a/agent endpoint | Open standard. One agent, one endpoint, two callers — custom UI now, Joule in enterprise. |
| Application Layer | SAP CAP TypeScript | cds watch local / cf push | Same | Business logic, OData, HANA connection, A2A endpoint hosting. SAP Architecture Center recommendation. |
| Graph Traversal | SAP HANA Cloud Knowledge Graph Engine | HANA Cloud trial | Same | SAP AI Golden Path recommended. AI-native graph reasoning. Multi-hop SPARQL traversal on BUT050 and BCA_GUARANTOR. |
| Semantic Search | SAP HANA Cloud Vector Engine | HANA Cloud trial | Same — native vector with CDS 10 | APRA documents embedded. Hybrid RAG with Full Text Search. |
| Tabular Risk Scoring | RPT-1 via rpt.cloud.sap consumer API | POST rpt.cloud.sap/api/predict, Bearer SAP_RPT_API_KEY | Same endpoint in production | Foundation model for tabular prediction. No training. In-context learning with [PREDICT] placeholder. Tested live: HTTP 200, HIGH confidence 0.98. Faster and cheaper than LLM for structured tabular data. |
| Anomaly Detection | HANA PAL Isolation Forest + LLM — ALL THREE RUN SIMULTANEOUSLY | PAL: _SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN via cds.run(). LLM: claude-sonnet-4-6 narrative. RPT-1: already above. | Same | All three always run. PAL: statistically rigorous, no hallucination. LLM: narrative for APRA CPS 230 human-readable justification. Educational popup shows all three side-by-side. No ENV switch gate — ANOMALY_DETECTION_MODE is UI display preference only. |
| Relational Data | SAP HANA Cloud | HANA Cloud trial | Same | TRBK synthetic data. Payment history, loan records, sector codes. |
| Integration | SAP BTP CPI | Integration Suite trial | Same — swap Claude API for AI Core | Three specific jobs. See Part 4 CPI section. |
| Events | Solace Advanced Event Mesh | Solace Cloud trial | Same | Real-time pipeline updates, risk state changes, regulatory events. |
| Observability | Langfuse (self-hosted or cloud) | Langfuse cloud free tier | SAP AI Launchpad | Every LangGraph node traced. Token usage, latency, cost per analysis. One config change to swap. |
| Evaluation | RAGAS (Python) | pip install ragas — runs as separate Python evaluation script | Same | RAG quality scored automatically. 20-question evaluation dataset. Python only. |
| Frontend | Three-panel HTML UI | Already built | Same — wire up, do not redesign | Banking-Sentinel-AustralianBank.html for client. Banking-Sentinel-Bloomberg.html for blog. |

### Exact npm Packages — Phase 0 Setup

```bash
npm install @langchain/langgraph
npm install @langchain/core
npm install @langchain/anthropic
npm install @sap-ai-sdk/ai-api
npm install @sap-ai-sdk/orchestration
npm install @langchain/langgraph-checkpoint-postgres
npm install pg
npm install langfuse
npm install langfuse-langchain
npm install @sap/cds
npm install @sap/hana-client
npm install solclientjs

# Python evaluation scripts only
pip install ragas
pip install langchain openai
pip install hana-ml   # optional — PAL also callable via SQLScript from CAP
```

### What Is Not Available on BTP Trial and Why

**SAP AI Core** — Requires SAP BTPEA enterprise agreement. Not for individuals.
Workaround: RPT-1 via rpt.cloud.sap consumer API. Claude via direct Anthropic API.
Production swap: Route LLM calls through CPI → AI Core Generative AI Hub. Change API endpoint URL.

**SAP AI Launchpad** — Requires AI Core.
Workaround: Langfuse. Identical observability capability.
Production swap: Switch LANGFUSE_HOST env var to AI Launchpad endpoint.

**SAP Joule** — Requires enterprise account.
Workaround: Custom HTML UI with A2A endpoint. Joule calls the same endpoint.
Production swap: Register agent in Joule via capability YAML. The /a2a/agent endpoint is already A2A protocol compliant.

**Python** — LangGraph TypeScript used throughout. Python used ONLY for RAGAS evaluation scripts.

**SQLite** — NOT used. HANA Cloud from Phase 0. No local SQLite fallback.

### LangGraph Graph Topology

```javascript
// srv/graph/banking-sentinel.js — CURRENT STATE (Phase 5 complete — full pipeline LIVE)
const graph = new StateGraph(BankingSentinelState)

// Nodes
.addNode('intake',       intakeAgent)      // LIVE
.addNode('simpleQuery',  simpleQueryNode)  // LIVE
.addNode('rejection',    rejectionNode)    // LIVE
.addNode('pattern',      patternAgent)     // LIVE — RPT-1 + PAL + LLM simultaneously
.addNode('relationship', relationshipAgent) // LIVE — ReAct loop, BFS graph traversal
.addNode('trajectory',   trajectoryAgent)  // LIVE — forward DTI, conflicting signals
.addNode('selfRagCheck', selfRagCheckNode) // Phase 6 stub
.addNode('humanApproval',humanApprovalNode) // LIVE — interruptBefore fires here
.addNode('synthesis',    synthesisAgent)   // LIVE — HANA Vector + APRA risk brief

// Entry point
graph.setEntryPoint('intake')

// Conditional routing from Intake
graph.addConditionalEdges('intake', routeFromIntake, {
  'simple_query':          'simpleQuery',
  'risk_analysis':         'pattern',
  'inappropriate_request': 'rejection'
})

// Terminals
graph.addEdge('simpleQuery', END)
graph.addEdge('rejection',   END)

// Conditional routing from Pattern — low risk skips graph traversal
graph.addConditionalEdges('pattern', routeAfterPattern, {
  'low_risk':  'synthesis',     // score < 30 — skip Relationship + Trajectory
  'high_risk': 'relationship'   // score >= 30 — full pipeline
})

graph.addEdge('relationship', 'trajectory')
graph.addEdge('trajectory',   'selfRagCheck')

// Self-RAG loop — max 2 re-queries
graph.addConditionalEdges('selfRagCheck', checkConfidence, {
  'requery': 'relationship',
  'proceed': 'humanApproval'
})

graph.addEdge('humanApproval', 'synthesis')
graph.addEdge('synthesis', END)

// Compiled with PostgresSaver checkpointer + interruptBefore humanApproval
graphInstance = graph.compile({
  checkpointer,
  interruptBefore: ['humanApproval']
});
```

**Routing logic:**
- `routeFromIntake`: action keywords → inappropriate_request; isSimpleDataQuery → simple_query; else → risk_analysis
- `routeAfterPattern`: score < 30 → low_risk; score >= 30 → high_risk
- `checkConfidence`: patternConf < 0.70 OR relConf < 0.70 AND requeryCount < 2 → requery; else → proceed

**Critical: Not all five agents always run:**
- **Low risk (score < 30):** Skip Relationship and Trajectory. Route directly to Synthesis. UI shows greyed-out Relationship + Trajectory nodes.
- **High risk (score >= 30):** Full pipeline — Relationship → Trajectory → Self-RAG → Human Approval → Synthesis.

### Pattern Agent — All Three Methods (Phase 4 LIVE)

```javascript
// srv/agents/pattern-agent.js

// Step 1: Fetch customer data from HANA via cds.run()
// Tables: Loans, BCA_DTI, DFKKOP, BCA_COLLATERAL

// Step 2: RPT-1 — rpt.cloud.sap/api/predict
// In-context learning: send portfolio rows with known labels + query row with [PREDICT]
// Returns: { score, category, confidence }
// Fallback: estimateScoreFromData() if RPT-1 unavailable

// Step 3: PAL Isolation Forest EXPLAIN
// Train on portfolio DFKKOP (no ID column)
// Score customer payment rows (ID as first column — P1, P2, ...)
// DO BEGIN ... _SYS_AFL.PAL_ISOLATION_FOREST → _SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN ... END
// Returns: [{ id, score, label, reasonCode }] — label -1 = outlier

// Step 4: LLM narrative anomaly detection
// claude-sonnet-4-6, JSON response { anomalies: [...] }
// APRA CPS 230 human-readable justification

// All three always run with independent try/catch — graceful fallback if any fails

// patternAssessment state shape:
// {
//   riskScore, riskLevel, confidence, signal,
//   rpt1: { score, category, confidence, success, error? },
//   pal:  { findings: [{id, score, label, reasonCode}], anomalyCount, success, error },
//   llm:  { anomalies: string[], tokensIn, tokensOut },
//   anomalies: string[]  // combined PAL outlier texts + LLM narrative — forwarded to Synthesis
// }
```

**PAL privilege requirement:** `AFL__SYS_AFL_AFLPAL_EXECUTE` on the HDI technical user. Grant via HANA Cloud Cockpit. If unavailable, PAL fails gracefully — RPT-1 + LLM still run.

**Real BP numbers:** 30100001, 30100003 etc. (8-digit SAP BP numbers). Never B-001 shorthand in code or queries.

**Primary demo customer:** 30100003 — DTI 7.2, BREACH_FLAG=true.

### The Five Agents — Detailed Description

**Agent 1 — Intake Node** (LIVE)
Reasoning: Intent understanding and routing.
Job: Parse any natural language query. Identify customer (8-digit SAP BP number). Detect inappropriate requests (approve/delete/override) → rejection node. Route simple data queries directly. Route risk questions to Pattern node.
TRBK access: None — pure intent parsing.

**Agent 2 — Pattern Node** (LIVE — Phase 4)
Reasoning: Pattern recognition across incomplete data.
Job: Look at the full customer picture holistically. RPT-1 quantifies the risk score. PAL finds statistical outliers. LLM narrates anomalies. All three run simultaneously. Something feels wrong even though no individual metric technically breaches a threshold.
TRBK access: Loans, BCA_DTI, DFKKOP, BCA_COLLATERAL via cds.run().
Output: riskScore, riskLevel, confidence, signal, rpt1/pal/llm sub-objects, combined anomalies.

**Agent 3 — Relationship Node** (LIVE — Phase 4b)
Reasoning: Relationship ambiguity.
Job: Traverse HANA Knowledge Graph Engine to find connected parties using SPARQL. Reason about NATURE and STRENGTH of each connection. Parent-subsidiary carries full exposure. Family trust requires reasoning not a rule.
TRBK access: BUT050, BCA_GUARANTOR via hana_graph_traverse MCP tool. Up to 8 hops via GraphDB SPARQL.
Output: weighted relationship map, confidence per connection type, total group exposure, aps221Pct, finding.

**Agent 4 — Trajectory Node** (LIVE — Phase 5)
Reasoning: Threshold proximity plus conflicting signals.
Job: Resolve conflicting signals — DTI 5.9 today but income contract expires in 3 months, effective future DTI 9.2. Time-to-breach estimation.
TRBK access: BCA_DTI, BCA_LOAN_SCHED, DFKKOP via hana_relational_query + apra_threshold_check.
Output: forward-looking risk position, time-to-breach in days, conflicting signals resolved.

**Agent 5 — Synthesis Node** (LIVE — Phase 5)
Reasoning: Confidence under uncertainty PLUS policy retrieval.
Job: Take outputs from all four nodes. Retrieve APRA regulatory documents via HANA Vector. Hold contradictions. Acknowledge unknowns. Generate risk brief with confidence per finding. Fires human-in-the-loop interrupt before outputting.
TRBK access: RegulatoryDocuments (HANA Vector) via hana_vector_search MCP tool.
Output: APRA-ready risk brief with score, level, findings, recommendations, evidence trail, uncertainties. Persisted to RiskAssessments HANA table.

### MCP Tool Layer

Five MCP tools:

```javascript
// Tool 1 — hana_graph_traverse: BUT050 + BCA_GUARANTOR, up to 8 hops, SPARQL
// Tool 2 — hana_vector_search: APRA regulatory docs, topK, optional HyDE
// Tool 3 — hana_relational_query: TRBK relational tables via cds.run()
// Tool 4 — apra_threshold_check: large_exposure | dti | sector_concentration
// Tool 5 — exposure_calculator: total group exposure, APS 221 utilisation
```

### Two UI Modes — Educational and Demo

**Educational Mode (toggle: ON)**
When each agent activates, a popup appears BEFORE the agent runs. The popup explains:
- What this agent does
- Why it was triggered
- What technology it uses (RPT-1, PAL, SPARQL, HANA Vector, etc.)
- What it is looking for

Pattern Agent popup shows RPT-1 output, PAL Isolation Forest output, and LLM narrative anomalies side-by-side.

**Demo Mode (toggle: OFF)**
No popups. Full pipeline runs without interruption. Clean, fast.

**Toggle button in UI header:**
```
[Educational Mode: ON] ←→ [Demo Mode: OFF]
```

### Langfuse TypeScript Setup

```javascript
const langfuseHandler = new CallbackHandler({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  host: process.env.LANGFUSE_HOST,
  sessionId: sessionId,
  userId: "banking-sentinel"
})

const config = {
  configurable: { thread_id: sessionId },
  callbacks: [langfuseHandler]
}
const result = await app.invoke(state, config)
await langfuseHandler.flushAsync()
```

### Responsible AI Implementation

**Confidence thresholds:**
- Below 40%: Refuse to generate finding. State what data is missing.
- 40-70%: Generate finding with explicit uncertainty statement.
- Above 70%: Generate finding normally.
- Self-RAG triggers at below 70% — re-queries before proceeding. Max 2 re-queries.

**Human-in-the-loop:**
LangGraph `interrupt()` fires before Synthesis executes. `banking/human/approval` event published to Solace. HTML UI shows pending findings + approval button. On approval — resume event fires, LangGraph resumes, Synthesis executes.

**Inappropriate request handling:**
Intake Agent pattern matches: approve, delete, modify, override → rejection node → standard refusal → logged to HANA.

### CPI — Three Legitimate Jobs

**Job 1** — Scheduled data ingestion pipeline (TRBK CSV → HANA).
**Job 2** — Governed AI gateway (API key management, retry, rate limiting, full audit trail).
**Job 3** — Risk and regulatory event publishing to Solace.

### Solace Topic Structure

```
banking/pipeline/status          → agent pipeline updates (Panel 2)
banking/risk/findings            → risk brief events (Panel 3)
banking/human/approval           → human-in-the-loop pause/resume
banking/trbk/payment_event       → inbound payment events from TRBK
banking/regulatory/update        → new APRA document uploaded
banking/session/reset            → reset session before new demo
```

### HANA CDS Schema Definition

```cds
namespace bankingsentinel;

entity BusinessPartners {
  key PARTNER    : String(10);
  BU_TYPE        : String(2);
  BU_SORT1       : String(50);
  SECTOR_CODE    : String(10);
  DTI_RATIO      : Decimal(5,2);
  INCOME_SOURCE  : String(100);
  INCOME_EXPIRY  : Date;
}

entity BUT050 {  // confirmed table name by bank architects
  key PARTNER1   : String(10);
  key PARTNER2   : String(10);
  RELTYP         : String(6);  // GRPAR=guarantor, TRUST_COMMON=trust
}

entity Loans {
  key LOAN_ID    : String(15);
  PARTNER        : String(10);
  AMOUNT         : Decimal(15,2);
  CURRENCY       : String(3);
  STATUS         : String(1);
  SECTOR_CODE    : String(10);
  DTI_RATIO      : Decimal(5,2);
  APPROVED_DATE  : Date;
}

entity BCA_GUARANTOR {
  key LOAN_ID    : String(15);
  key GUARANTOR  : String(10);
  COVER_AMOUNT   : Decimal(15,2);
}

entity DFKKOP {
  key OPBEL      : String(20);
  GPART          : String(10);  // SAP FI-CA field name — confirmed in schema.cds. DFKKZP uses PARTNER (different entity)
  LOAN_ID        : String(15);
  BETRW          : Decimal(15,2);
  FAEDN          : Date;
  DAYS_OVERDUE   : Integer;
}

entity DFKKZP {
  key PAYMENT_ID : String(12);
  LOAN_ID        : String(15);
  BETRW          : Decimal(15,2);
  BUDAT          : Date;
}

entity BCA_DTI {
  key PARTNER    : String(10);
  DTI_RATIO      : Decimal(5,2);
  BREACH_FLAG    : Boolean;
  TOTAL_DEBT     : Decimal(15,2);
  ANNUAL_INCOME  : Decimal(15,2);
  INCOME_EXPIRY  : Date;
}

entity BCA_COLLATERAL {
  key COLLATERAL_ID : String(15);
  LOAN_ID           : String(15);
  VALUE             : Decimal(15,2);
}

entity RegulatoryDocuments {
  key DOC_ID    : String(36);
  TITLE         : String(200);
  STANDARD      : String(20);
  CONTENT       : LargeString;
  EMBEDDING     : LargeString;
  UPLOADED_AT   : DateTime;
}

entity RiskAssessments {
  key SESSION_ID : String(36);
  PARTNER        : String(10);
  RISK_SCORE     : Integer;
  RISK_LEVEL     : String(10);
  FINDINGS       : LargeString;
  CONFIDENCE     : Decimal(3,2);
  CREATED_AT     : DateTime;
  APPROVED_BY    : String(50);
}

entity AuditLog {
  key LOG_ID    : String(36);
  SESSION_ID    : String(36);
  ACTION        : String(100);
  QUERY         : LargeString;
  RESPONSE      : LargeString;
  MODEL         : String(50);
  TOKENS        : Integer;
  LATENCY_MS    : Integer;
  COST_AUD      : Decimal(8,4);
  CREATED_AT    : DateTime;
}
```

### PostgreSQL State Persistence

```javascript
const pgPool = new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } })
const checkpointer = new PostgresSaver(pgPool)
await checkpointer.setup()
const app = graph.compile({ checkpointer })
// Phase 5 will add: interruptBefore: ['humanApproval']
```

PostgreSQL: Supabase session pooler for prototype. BTP PostgreSQL Hyperscaler Option for production.

### Cost Tracking Per Analysis

```javascript
const COST_PER_1K_INPUT_TOKENS  = 0.0025  // Claude Sonnet
const COST_PER_1K_OUTPUT_TOKENS = 0.0125

function calculateCost(inputTokens, outputTokens) {
  return (inputTokens / 1000 * COST_PER_1K_INPUT_TOKENS) +
         (outputTokens / 1000 * COST_PER_1K_OUTPUT_TOKENS)
}
```

---

## PART 5 — REQUIREMENTS

### Requirement 1 — Natural Language Risk Intelligence

The system must answer any natural language question about borrower or portfolio risk. No pre-programmed question types. Intake Agent determines intent, appropriate agents activate.

For simple data queries — answer directly. For risk questions — full agent pipeline. Reason. Connect. Explain.

### Requirement 2a — Performance and Concurrency

- Response time: under 30 seconds for full four-dimension risk analysis
- Visible progress makes latency acceptable (MJ Live proven pattern)
- Single session for prototype. PostgreSQL checkpointer architecture supports multi-session in production.

### Requirement 2b — Zero Code Change Adaptability

Two types of changes without any code modification:
- **Data changes via Solace:** Payment event fires → system re-evaluates automatically.
- **Regulatory changes via knowledge base:** APRA doc uploaded → Policy Agent applies immediately on next query.

### Requirement 3 — What the System Must NOT Do

- Must not make autonomous decisions — Human-in-the-loop pause is architectural enforcement
- Must not present findings below 70% confidence — state what data is missing
- Must not generate finding without evidence — every claim links to TRBK record or APRA document
- Must not comply with action requests — approve, delete, modify, override → reject clearly, log attempt

**Deliberate rejection script:**
Input: "Approve the loan for BP233."
Output: "I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation. Here is the risk profile for BP233 to inform your decision."

### Requirement 4 — Definition of Success

**Technical:** System runs end to end. Self-RAG re-query fires genuinely. Human approval pause works. Regulatory update applies without code change.

**Demo:** A banking professional watches and says "I understand what this does and I want it."

**Business:** The client asks "what would it take to implement this on our TRBK data?" — not "that was interesting."

### Requirement 5 — Edge Cases

- Borrower not found: clean error message, not crash
- Incomplete data: reason over what exists, state gaps, adjust confidence
- Conflicting data: surface conflict, explain both figures, flag for human review
- Inappropriate requests: reject clearly, log, continue

---

## PART 6 — SYNTHETIC TRBK DATA DESIGN

### The Four Hidden Risk Patterns

**Pattern 1 — Connected party + APS 221 breach (Twinkle 1):**
- Borrowers individually acceptable; combined group exposure 92% of APS 221 limit
- G-001 connected via BUT050 to G-002 (same family trust) — HIDDEN
- Requires 6-hop traversal: B-001 → BKKN → BCA_LOAN_HDR → BCA_GUARANTOR → G-001 → BUT050 → G-002

**Pattern 2 — DTI regulatory breach with trajectory:**
- Primary demo customer (BP 30100003): DTI ratio 7.2 — above APRA February 2026 limit of 6.0
- Income contract expiry in 3 months → effective future DTI 9.2
- Not yet reported to APRA

**Pattern 3 — Sector concentration:**
- Four borrowers in RETAIL_PROP via same guarantor network — combined 78% of sector limit

**Pattern 4 — Credit early warning:**
- BP 30100001: DFKKOP records 81/50/50 days overdue
- No corresponding DFKKZP payment record — missed repayment confirmed

### Dataset Scale

- 50 business partners: 30 individual borrowers, 10 corporate borrowers, 8 guarantors, 2 parent entities
- 60 loans
- APRA documents in HANA Vector: APS 221, APS 112, CPS 230, DTI Limit Activation Notice Feb 2026, Credit Policy §7.3

---

## PART 7 — RAGAS EVALUATION DATASET

20 questions across four dimensions: connected party risk (5), credit risk (5), sector concentration (5), regulatory (5). Run after each build phase. Target faithfulness > 0.85.

---

## PART 8 — AI DESIGN PATTERNS — 10 CONCEPTS

For every pattern: AI meaning, banking meaning, SAP meaning.

**1. GraphRAG** — Retrieval that traverses relationships. B-001's guarantor covers four other stressed borrowers. HANA Knowledge Graph Engine on BUT050 + BCA_GUARANTOR.

**2. Hybrid RAG** — Vector similarity + keyword search + reranking. HANA Vector cosine similarity + HANA Full Text Search in one query.

**3. HyDE** — Generate hypothetical ideal answer to improve retrieval signal. LangGraph node calls LLM once to enrich query before HANA Vector search.

**4. Agentic RAG** — Agent decides what to retrieve, when, in what order. LangGraph ReAct node calling hana_graph_traverse multiple times based on observations.

**5. ReAct Pattern** — Think → Act → Observe → Think → Act. LangGraph conditional edges — each observation determines next action.

**6. Multi-Agent** — Five specialised agents, one job each. LangGraph StateGraph with five nodes, state carries all findings between nodes.

**7. Self-RAG** — Agent evaluates its own retrieval quality, re-queries if confidence below threshold. LangGraph conditional edge after trajectory node — if confidence < 0.70, loop back to relationship.

**8. Temporal Memory** — State accumulates across agent steps. LangGraph typed BankingSentinelState passed through all nodes, persisted via PostgresSaver.

**9. AI Observability / LLMOps** — Every LLM call, token count, latency, cost traced. Langfuse traces every LangGraph node. APRA CPS 230 auditability requirement.

**10. RAGAS** — Automatic measurement of retrieval faithfulness, relevance, context precision. 20-question evaluation dataset run against HANA Vector queries.

---

## PART 9 — TRBK TABLE REFERENCE

| Table | Description | Role | Graph Role |
|---|---|---|---|
| BUT000 | Business Partner master | Customer/borrower node | Node |
| BUT050 | BP-to-BP Relationships — confirmed by bank architects | Connected parties, guarantors, subsidiaries | **Graph edge 1** |
| BKKF | Contract account master | Loan contract header | Node |
| BKKN | Contract-BP link | Connects borrower to contracts | Edge |
| BCA_LOAN_HDR | Loan header | Loan amount, currency, status, dates | Node |
| BCA_LOAN_SCHED | Repayment schedule | Expected payment dates/amounts | Node |
| BCA_GUARANTOR | Guarantor assignment | Who guarantees which loan | **Graph edge 2** |
| BCA_COLLATERAL | Collateral | Security value against loans | Node attribute |
| DFKKOP | Open items | Overdue payment records — primary risk signal | Risk signal |
| DFKKZP | Payment items | Actual payments — absence = missed payment | Risk signal |
| BCA_DTI | Debt to income ratio | APRA DTI limit compliance + income expiry | Risk attribute |

**HANA data layer separation:**
- HANA Knowledge Graph Engine: BUT050 + BCA_GUARANTOR — multi-hop SPARQL traversal
- HANA Vector Engine: APRA regulatory documents — semantic search
- HANA Relational: All other TRBK tables — structured queries via cds.run()

**HANA access pattern:**
- DBADMIN cannot access HDI schema directly — must use cds.run() (HDI technical user) or npx cds bind --exec for test scripts
- HDI schema: B8EC4EAB42CB46BE940B89D1209CC93D (internal — never hardcode, use CDS entity names)

---

## PART 10 — SAP JOB REQUIREMENTS MAPPING

| SAP Job Requirement | How Banking Sentinel Addresses It |
|---|---|
| Generative AI + Agentic AI on SAP BTP | LangGraph agents on BTP CF via SAP Cloud SDK for AI |
| RAG pipelines and retrieval workflows | HANA Vector + GraphRAG + Hybrid RAG + HyDE |
| Multi-agent orchestration | LangGraph supervisor with 5 specialist agents |
| A2A interaction patterns | /a2a/agent endpoint, JSON-RPC 2.0, Joule compatible |
| MCP interaction patterns | 5 MCP tools: graph, vector, relational, threshold, calculator |
| SAP HANA | HANA Cloud — all three engines |
| SAP Integration Services | CPI — three legitimate jobs |
| LLMOps/MLOps pipelines | Langfuse tracing + RAGAS evaluation + cost tracking |
| Responsible AI | Guardrails, confidence thresholds, human-in-the-loop, deliberate rejection |
| Vector databases | HANA Vector Engine |
| Knowledge graph integrations | HANA Knowledge Graph Engine |
| LangChain/LangGraph | @langchain/langgraph TypeScript |

**Extras:**
- RPT-1 tabular risk scoring (rpt.cloud.sap consumer API) — LLM not needed for tabular prediction
- HANA PAL Isolation Forest EXPLAIN — real in-database anomaly detection with feature attribution
- All three (RPT-1 + PAL + LLM) run simultaneously — demonstrated live in educational popup
- Zero code change regulatory updates (Twinkle 2)
- TRBK table names in evidence trails (immediate client recognition)

---

## PART 11 — BUILD PHASES

| Phase | What Gets Built | Status |
|---|---|---|
| 0 | Environment: LangGraph, Langfuse, PostgreSQL, Solace | ✅ COMPLETE |
| 1 | Synthetic TRBK data + HANA schema + four hidden patterns | ✅ COMPLETE |
| 2 | HANA Vector + Hybrid RAG + HyDE + RAGAS evaluation | ✅ COMPLETE |
| 3 | LangGraph StateGraph + Intake + SimpleQuery + Rejection + A2A endpoint | ✅ COMPLETE (2026-05-24) |
| 4 | Pattern Agent — RPT-1 + PAL Isolation Forest + LLM simultaneously | ✅ COMPLETE (2026-05-24) |
| 4b | Relationship Agent — ReAct loop, BFS graph traversal, exposure + APS 221 check | ✅ COMPLETE (2026-05-24) |
| 5 | Trajectory Agent + Synthesis Agent + Human-in-the-loop interrupt | ✅ COMPLETE (2026-05-24) |
| 6 | Self-RAG — real confidence evaluation + re-query loop | 🔲 NEXT |
| 7 | Solace events + risk state change + regulatory document upload (Twinkle 2) | 🔲 PENDING |
| 8 | Langfuse tracing every node + RAGAS scoring + cost per analysis + CF restart test | 🔲 PENDING |
| 9 | HTML UI wired to A2A + all five Solace topics + demo rehearsed | 🔲 PENDING |
| 10 | CF deployment + architecture diagram + demo video + blog post | 🔲 PENDING |

**Graph Engine — Final Decision (2026-05-24):**

Hierarchy followed (SAP AI Golden Path replacement rule):
1. **KGE + SPARQL** → NOT on trial (Triple Store feature not enabled in HANA Cloud Central)
2. **HANA Property Graph + GRAPH_TABLE** → NOT on trial (preview feature — "incorrect syntax near MATCH" on all variants)
3. **GraphDB + SPARQL** → **IMPLEMENTED** (open source RDF triple store, same W3C SPARQL standard as KGE)

GraphDB implementation:
- Graphwise sandbox (free, 7-day rotation): `https://t5f027c83a0e2488da5e.sandbox.graphwise.ai`
- Repository: `banking-sentinel` | 4035 RDF triples | 1000 partners | 12 BUT050 relationships
- SPARQL traversal from 30100003 finds 7 connected parties including TrustCo Holdings (4 hops)
- `hana_graph_traverse` MCP tool queries GraphDB via SPARQL property paths with accurate hop counts
- Production swap: change GRAPHDB_ENDPOINT to HANA KGE endpoint — SPARQL queries are identical

BUT050 enrichment — Pattern 1 (Twinkle 1 chain):
```
30100003 →[FAMILY_TRUST_MEMBER]→ 30910005 →[FAMILY_TRUST_MEMBER]→ 30910006
→[SUBSIDIARY]→ 30910009 (TrustCo Group) →[PARENT_COMPANY]→ 30910010 (TrustCo Holdings)
```
30100001 and 30100002 also connected to TrustCo Group → connected party group for APS 221.

Restore GraphDB after sandbox expiry (every 7 days):
`npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid`

HANA workspace (production upgrade path):
- `db/src/BP_RELATIONSHIP_GRAPH.hdbgraphworkspace` deployed via HDI
- When GRAPH_TABLE goes GA: swap SPARQL query for single GRAPH_TABLE SQL statement

Admin UI: `/admin` → tab "GraphDB (KGE)" shows repository status, triple counts, live SPARQL traversal, sample RDF triples

**Phase 5 implemented:**
- trajectoryAgent: BCA_DTI.INCOME_EXPIRY → forward DTI calculation; conflicting signal resolution
- synthesisAgent: HANA Vector search on APRA docs + APRA-ready risk brief with confidence per finding
- humanApproval: LangGraph interruptBefore(['humanApproval']) + resume via approveRiskBrief action

---

## PART 12 — WHAT ALREADY EXISTS

**Three UI files — wire one, other follows same pattern:**
- `Banking-Sentinel-AustralianBank.html` — light theme, yellow diamond — use for client presentation
- `Banking-Sentinel-Bloomberg.html` — dark navy terminal — use for blog and general audience
- `Task3-Banking-Sentinel-UI.html` — earlier version — retire

**From MJ Live — what to take forward:**
- Solace JS SDK WebSocket connection pattern — consumer.html subscription code
- HANA Cloud connection setup in CAP package.json and .env
- BTP CF manifest.yml deployment pattern for two-app deployment
- Known fix: CAP start command is `cds-serve` not `cds` on CF
- Known fix: `cds.requires.auth.kind = "dummy"` for trial without XSUAA
- Known fix: Solace SDT format vs binary format

---

## PART 13 — REGULATORY AND BANKING CONTEXT

**APRA** — Australian Prudential Regulation Authority. Regulates all ADIs in Australia.

**Official APRA document URLs:**
- APS 221: `https://handbook.apra.gov.au/standard/aps-221`
- CPS 230: `https://www.apra.gov.au/sites/default/files/2023-07/Prudential%20Standard%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf`
- All ADI standards: `https://www.apra.gov.au/industries/1/standards`

- **APS 221 — Large Exposures:** Board notification required above 90% utilisation. Breach = regulatory enforcement.
- **CPS 230 — Operational Resilience (July 2025):** AI decisions must be transparent, auditable, resilient. Human oversight required.
- **DTI Limits — February 2026:** APRA activated restrictions on new lending at DTI > 6.0. Banks must identify and document pre-existing breaches. Primary demo customer (30100003) is exactly this scenario.

**SAP and Anthropic — Sapphire 2026:**
Official partnership announced May 2026. Claude is SAP's primary AI partner for the Autonomous Enterprise stack. Using Claude through SAP's infrastructure is the strategic direction, not a workaround.

---

## PART 14 — BLOG POST STRUCTURE

**Title:** "Connected Intelligence — Agentic AI on SAP BTP with Knowledge Graph, LangGraph and Claude"

1. The Problem — why connected party risk is invisible to ABAP and SQL
2. The Idea — AI that reasons, not just rules
3. What ABAP Cannot Do — the honest comparison
4. The Architecture — full stack diagram and component justification
5. The Five Agents — one reasoning type each, three vocabularies
6. Building It — phase by phase, decisions documented
7. The Two Twinkle Moments
8. The Deliberate Rejection — Responsible AI in action
9. LLMOps — what Langfuse and RAGAS revealed
10. The Procurement Parallel — same architecture, different domain
11. What I Learned — honest assessment
12. What's Next — path from prototype to delivery

---

## PART 15 — DEMO SCENARIOS

### Scenario 1 — Full Risk Analysis (Twinkle 1)
**Input:** "Analyse borrower 30100003 for all risk dimensions"
- Pattern Agent: RPT-1 scores HIGH, PAL detects payment anomaly, LLM provides narrative
- Relationship Agent: finds TrustCo Holdings at hop 6 (nobody asked about this)
- Self-RAG fires: confidence 64% → re-queries → 89% (Twinkle 1)
- Trajectory Agent: future DTI 9.2, time-to-breach 12 days
- Human-in-the-loop interrupt → risk officer approves
- Synthesis Agent: APRA-ready risk brief

### Scenario 2 — Simple Data Query
**Input:** "What is the total loan amount?"
- Intake → simpleQuery node → HANA query → result
- No full pipeline. Offers deeper analysis.

### Scenario 3 — Live Regulatory Update (Twinkle 2)
**Input:** Click "Sync Latest APRA Standards" → "Analyse 30100003"
- System fetches live APRA docs → chunks → embeds → HANA Vector
- Synthesis retrieves new content → risk assessment changes
- Zero code change

### Scenario 4 — Deliberate Rejection
**Input:** "Approve the loan for 30100003"
- Intake detects "Approve" → rejection node
- "I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation. Here is the risk profile for 30100003 to inform your decision."

---

## PART 16 — INSTRUCTIONS FOR CLAUDE CODE

Read every word of this document.

**Never:**
- Name the bank client — say "major Australian bank" only
- Simplify the stack — every component is deliberate
- Use MemorySaver — PostgresSaver only
- Merge LangGraph and CAP roles
- Hardcode LLM tool calls — use MCP tools
- Skip human-in-the-loop — architecturally mandatory
- Generate findings without TRBK table evidence trail
- Redesign the UI — wire it
- Use SQLite — HANA Cloud from day one
- Use BP2000 — the correct table is BUT050, confirmed by bank architects
- Use B-001 shorthand — real BP numbers are 8-digit SAP BP numbers (30100001, 30100003 etc.)
- Run all five agents for low risk customers — use conditional routing
- Add Python to the main application — Python for RAGAS evaluation only
- Gate PAL/LLM with ENV switch — all three methods always run simultaneously

**Always:**
- Explain each AI pattern in three ways: AI terms, banking terms, SAP terms
- Document every decision — what chosen, what rejected, why
- Build one phase at a time — confirm phase before writing code
- Wire Langfuse from Phase 0
- Include TRBK table names in all evidence trails
- Make agent reasoning visible in the UI
- Implement both Educational Mode and Demo Mode — toggle button required
- Use SPARQL for HANA Knowledge Graph Engine queries
- Show greyed-out Relationship and Trajectory agents for low risk customers in Panel 2
- Use cds.run() for all HANA access (HDI technical user — DBADMIN cannot access HDI schema directly)
- Call RPT-1 via rpt.cloud.sap/api/predict with SAP_RPT_API_KEY (Bearer token) — not AI Hub

**On PAL:**
- PAL_ISOLATION_FOREST: 3 args — (training_data_no_id, params) → model
- PAL_ISOLATION_FOREST_EXPLAIN: 4 args — (data_with_id, model, params) → result
- Parameter table columns: PARAM_NAME, INT_VALUE, DOUBLE_VALUE, STRING_VALUE
- ID as first column in scoring data. No ID column in training data.
- Grant AFL__SYS_AFL_AFLPAL_EXECUTE to HDI technical user via HANA Cloud Cockpit

---

## PART 17 — ADDITIONAL PATTERNS FROM SAP AI GOLDEN PATH

**11. RPT-1 — Relational Foundation Model (Tabular AI)**
AI: Foundation model pretrained on tabular data. Predictions via in-context learning — no fine-tuning required. Send a feature table with [PREDICT] placeholder, get prediction back.
Banking: Credit risk scoring from borrower features (DTI, payment history, loan amount, sector) without writing model training code.
SAP: Consumer API at rpt.cloud.sap/api/predict. Personal API token (SAP_RPT_API_KEY). No AI Core required. RPT-1.5 GA in H2 2026.

**12. HANA PAL — Embedded In-Database Machine Learning**
AI: Statistical ML algorithms running natively inside the database. Train on portfolio, score one customer's rows. Isolation Forest detects anomalies by measuring how easily a point is isolated from the rest.
Banking: Payment anomaly detection on DFKKOP records. LABEL=-1 = outlier. REASON_CODE = which feature drove the anomaly (feature attribution). Statistically rigorous. No hallucination risk.
SAP: PAL Predictive Analytics Library built into HANA Cloud. Called via SQLScript anonymous DO block from CAP via cds.run(). Requires AFL__SYS_AFL_AFLPAL_EXECUTE permission on HDI technical user.

**Why both matter architecturally:**
The right question is never "can the LLM do this?" — it is "what is the best tool for this specific task?" RPT-1 and PAL are better than LLM for tabular and statistical tasks. LLM is better for reasoning, narrative, and policy interpretation. All three running simultaneously in the Pattern Agent — and being able to explain why each is there — is the definition of AI architect thinking.

---

## THE ONE RULE

Document as you build. Not after.

For every decision: what you chose, what you considered and rejected, why.

That record is what separates a prototype from a proposal, and a proposal from a contract.

---

*Five angles. Equal weight. Two genuine twinkle moments. One deliberate rejection. Three vocabularies throughout.*

*Build it like a senior AI architect who understands banking regulation, SAP enterprise architecture, and modern AI engineering simultaneously.*

*The client context is a major Australian bank. The specific name is never mentioned anywhere in code, comments, or documentation.*
