# Banking Sentinel — Project Context v5
## SUPERSEDED — See Banking-Sentinel-Context-v6.md for the current definitive document
## v6 added: SAP AI Golden Path (RPT-1, HANA PAL, Knowledge Graph Engine), Part 15 demo scenarios, Part 17 patterns 11+12, Sapphire 2026 SAP+Anthropic partnership
## Last updated: May 2026

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

**Step 6b — SAP AI Golden Path deep read (added after v5)**
Three SAP AI Golden Path documents were read: the overview, Classic ML Scenarios, and the AI Core service guide. Three significant findings that changed the architecture:

1. HANA Cloud now includes a Knowledge Graph Engine — AI-native, separate from the standard HANA Graph engine. More aligned with SAP AI Golden Path for relationship traversal.
2. RPT-1 is a foundation model for tabular prediction available natively in HANA Cloud via SQL stored procedure. No model training. No LLM call. Better than asking Claude to score credit risk from tabular data.
3. HANA PAL (Predictive Analytics Library) has built-in anomaly detection. Better than LLM for detecting payment anomalies in DFKKOP — statistically rigorous, no hallucination risk.

Decision made: use HANA native capabilities for what HANA does better. Use LLM for what only LLM can do. A/.env switch controls which approach runs for anomaly detection — both approaches demonstrable live.

**Step 7 — The AI Core constraint**
SAP AI Core not available in BTP trial accounts. Only in free tier enterprise accounts requiring SAP BTPEA — not available to individuals. Real constraint, not a workaround situation.

**Step 8 — Three genuine workarounds**
- SAP Generative AI Hub has its own trial giving access to Claude Sonnet 4, GPT-5, Gemini 2.5 Pro through SAP's infrastructure. SAP and Anthropic announced official partnership at SAP Sapphire 2026 — Claude is now SAP's primary AI partner. Using Claude through SAP is not a workaround, it is the strategic direction.
- Langfuse replaces AI Launchpad for observability. One config change to swap in production.
- Custom chat UI exposes A2A-compatible endpoint. Joule calls the same endpoint in enterprise environment. One agent, one endpoint, two callers.

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

**Twinkle 2 — The regulatory update:**
APRA changes a regulation. You upload the new document to HANA Vector. Without a single line of code changing, the Policy Agent immediately applies the new guideline on the next query. A borrower who was safe yesterday is flagged today. Every person in a bank audience has lived through a regulatory change that took months to implement in ABAP. This moment lands harder than any slide deck.

This must also be REAL — the architecture must genuinely support zero code change document uploads that immediately affect assessments.

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
│   MCP Tool: hana_relational_query(BUT000, DFKKOP)   │
│   Holistic assessment → confidence score            │
│        ↓                                            │
│  [Relationship Node] ← ReAct loop here              │
│   MCP Tool: hana_graph_traverse(BP2000, depth=8)    │
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

**Regulatory update flow (Twinkle 2):**
```
New APRA document uploaded to HANA Vector
        ↓
CPI publishes regulatory_update event to Solace
        ↓
Banking Sentinel receives event
Marks all cached assessments as stale
        ↓
Next query — Policy Agent retrieves new document
New guideline applied immediately
Zero code change
```

**Risk state change flow (Twinkle 2 variant):**
```
Payment event fires in TRBK (borrower misses repayment)
        ↓
Solace receives banking/trbk/payment_event
        ↓
Banking Sentinel receives event
Identifies affected borrower
Triggers automatic re-evaluation via LangGraph
        ↓
Updated risk assessment published to Solace
HTML UI reflects new risk state
No human triggered this. No code changed.
```

### The Full Stack — Every Component Justified

| Layer | Tool | Prototype | Production Swap | Why |
|---|---|---|---|---|
| Primary SDK | SAP Cloud SDK for AI (TypeScript) | npm install @sap-ai-sdk/ai-api | Same — add AI Core credentials | SAP's official SDK for pro-code agents on BTP. Type-safe abstractions for Generative AI Hub. |
| LLM Access | SAP Generative AI Hub trial + Claude API | Generative AI Hub trial account | AI Core Generative AI Hub | SAP's governed model access. Anthropic official SAP partner Sapphire 2026. One endpoint change. |
| Agent Orchestration | LangGraph TypeScript (@langchain/langgraph) | npm install @langchain/langgraph | Same — Python version for production | SAP's recommended framework. Stateful graph, conditional routing, human-in-the-loop, 90M downloads. |
| Agent State Persistence | PostgreSQL (via LangGraph checkpointer) | PostgreSQL on BTP | Same | MemorySaver resets on CF restart. PostgresSaver survives restarts, deployments, sessions. Production non-negotiable. |
| Tool Protocol | MCP (Model Context Protocol) | Local MCP tool functions | MCP servers on BTP CF | Standard for agent-tool connections. SAP job requires A2A AND MCP. Tools exposed as MCP, not hardcoded functions. |
| Agent-UI Protocol | A2A (JSON-RPC 2.0) | Custom chat UI calls /a2a/agent | Joule calls same /a2a/agent endpoint | Open standard. One agent, one endpoint, two callers — custom UI now, Joule in enterprise. |
| Application Layer | SAP CAP TypeScript | cds watch local / cf push | Same | Business logic, OData, HANA connection, A2A endpoint hosting. SAP Architecture Center recommendation. |
| Graph Traversal | SAP HANA Cloud Knowledge Graph Engine | HANA Cloud trial | Same | SAP AI Golden Path recommended. AI-native graph reasoning. Multi-hop traversal BP2000 and BCA_GUARANTOR edges. Supersedes standard HANA Graph Engine. |
| Semantic Search | SAP HANA Cloud Vector Engine | HANA Cloud trial | Same — native vector with CDS 10 | APRA documents embedded. Hybrid RAG with Full Text Search. |
| Tabular Risk Scoring | RPT-1 (HANA Cloud SQL stored procedure) | HANA Cloud trial — RPT-1 available via AI Core and HANA SQL | Same | Foundation model for tabular prediction. No training. No LLM call. Score borrower risk from features table via SQL. Faster and cheaper than LLM for structured data. |
| Anomaly Detection | HANA PAL (Predictive Analytics Library) OR Claude LLM — controlled by ENV switch | HANA Cloud trial — PAL enabled | Same | PAL: statistically rigorous, no hallucination, SQL-based. LLM: narrative explanation of anomalies. Switch between them via ANOMALY_DETECTION_MODE env var. |
| Relational Data | SAP HANA Cloud | HANA Cloud trial | Same | TRBK synthetic data. Payment history, loan records, sector codes. |
| Integration | SAP BTP CPI | Integration Suite trial | Same — swap Claude API for AI Core | Three specific jobs. See Part 4 CPI section. |
| Events | Solace Advanced Event Mesh | Solace Cloud trial | Same | Real-time pipeline updates, risk state changes, regulatory events. |
| Observability | Langfuse (self-hosted or cloud) | Langfuse cloud free tier | SAP AI Launchpad | Every LangGraph node traced. Token usage, latency, cost per analysis. One config change to swap. |
| Evaluation | RAGAS | pip install ragas | Same | RAG quality scored automatically. 20-question evaluation dataset. |
| Frontend | Three-panel HTML UI | Already built | Same — wire up, do not redesign | Banking-Sentinel-AustralianBank.html for client. Banking-Sentinel-Bloomberg.html for blog. |

### Exact npm Packages — Phase 0 Setup

```bash
# Core agent framework
npm install @langchain/langgraph
npm install @langchain/core
npm install @langchain/anthropic

# SAP Cloud SDK for AI
npm install @sap-ai-sdk/ai-api
npm install @sap-ai-sdk/orchestration

# PostgreSQL checkpointer
npm install @langchain/langgraph-checkpoint-postgres
npm install pg

# Langfuse observability
npm install langfuse
npm install langfuse-langchain

# HANA connection (via CAP)
npm install @sap/cds
npm install @sap/hana-client

# Solace messaging
npm install solclientjs

# Evaluation
pip install ragas  # Python — run evaluation scripts separately
pip install langchain openai  # RAGAS dependencies
pip install hana-ml  # HANA PAL Python client for anomaly detection scripts
```

### What Is Not Available on BTP Trial and Why

**SAP AI Core** — Requires SAP BTPEA enterprise agreement. Not for individuals.
Workaround: SAP Generative AI Hub trial (separate signup at sap.com/products/artificial-intelligence/generative-ai-hub-trial.html). Same governed model access.
Production swap: Change CPI iFlow HTTP endpoint URL. One line.

**SAP AI Launchpad** — Requires AI Core.
Workaround: Langfuse. Identical observability capability.
Production swap: Switch LANGFUSE_HOST env var to AI Launchpad endpoint.

**SAP Joule** — Requires enterprise account.
Workaround: Custom HTML UI with A2A endpoint. Joule calls the same endpoint.
Production swap: Register agent in Joule via capability YAML. The /a2a/agent endpoint is already A2A protocol compliant.

**Python** — LangGraph TypeScript used. SAP Cloud SDK for AI officially supports TypeScript.
Production recommendation: Python with LangGraph Python for the SAP job market. TypeScript keeps stack consistent with MJ Live and is fully supported by SAP.

### LangGraph Graph Topology

```typescript
// Graph structure
const graph = new StateGraph(BankingSentinelState)

// Nodes
graph.addNode("intake", intakeAgent)
graph.addNode("pattern", patternAgent)
graph.addNode("relationship", relationshipAgent)
graph.addNode("trajectory", trajectoryAgent)
graph.addNode("selfRagCheck", selfRagCheckNode)
graph.addNode("humanApproval", humanApprovalNode)  // interrupt() here
graph.addNode("synthesis", synthesisAgent)
graph.addNode("simpleQuery", simpleQueryNode)

// Entry point
graph.setEntryPoint("intake")

// Conditional routing from Intake
graph.addConditionalEdges("intake", routeFromIntake, {
  "simple_query": "simpleQuery",
  "risk_analysis": "pattern",
  "inappropriate_request": "rejection"  // approve/delete/override requests
})

// Sequential risk analysis
graph.addEdge("pattern", "relationship")
graph.addEdge("relationship", "trajectory")
graph.addEdge("trajectory", "selfRagCheck")

// Self-RAG conditional — the first twinkle
graph.addConditionalEdges("selfRagCheck", checkConfidence, {
  "requery": "relationship",   // loop back if confidence < 0.70
  "proceed": "humanApproval"  // continue if confidence >= 0.70
})

// Human-in-the-loop — APRA co-pilot requirement
graph.addEdge("humanApproval", "synthesis")  // interrupt() blocks here

// Rejection node for inappropriate requests
graph.addNode("rejection", rejectionNode)

// Terminals
graph.addEdge("synthesis", END)
graph.addEdge("simpleQuery", END)
graph.addEdge("rejection", END)

// Checkpointer — PostgreSQL for production
const checkpointer = new PostgresSaver(pgPool)
const app = graph.compile({ checkpointer, interruptBefore: ["humanApproval"] })
```

**Routing logic:**
- `routeFromIntake`: 
  - if action keywords detected (approve/delete/modify/override) → "inappropriate_request"
  - if `state.intent.isSimpleDataQuery` → "simple_query"
  - else → "risk_analysis"
- `checkConfidence`: if `state.patternAssessment.confidence < 0.70 || state.relationshipMap.confidence < 0.70` AND `state.requeryCount < 2` → "requery", else → "proceed"

### The Five Agents — Detailed Description

There is no separate "Policy Agent" node. Five nodes, five reasoning types. The Synthesis Node handles both policy retrieval and synthesis. This is deliberate — policy retrieval and synthesis are inseparable at the point of generating the risk brief.

**Agent 1 — Intake Node**
Reasoning: Intent understanding and routing.
Job: Parse any natural language query. Identify customer, risk dimensions, graph depth needed. Build execution plan. Detect inappropriate requests (approve/delete/override) and route to rejection node. Route simple data queries directly. Route risk questions to Pattern node.
TRBK access: None — pure intent parsing.

**Agent 2 — Pattern Node**
Reasoning: Pattern recognition across incomplete data.
Job: Look at the full customer picture holistically before any rules fire. Something feels wrong even though no individual metric technically breaches a threshold. Detect early warning signals from payment behaviour, income stability, employment patterns.
TRBK access: BUT000, DFKKOP, DFKKZP, BCA_DTI via hana_relational_query MCP tool.
Output: holistic signal (concerning / stable / unclear) with confidence score.

**Agent 3 — Relationship Node** (ReAct loop)
Reasoning: Relationship ambiguity.
Job: Traverse HANA Graph to find connected parties. Reason about the NATURE and STRENGTH of each connection — not just that one exists. Parent-subsidiary carries full exposure consolidation. Common shareholding carries partial. Family trust requires reasoning not a rule.
TRBK access: BP2000, BCA_GUARANTOR via hana_graph_traverse MCP tool. Up to 8 hops.
Output: weighted relationship map with confidence per connection type and total group exposure.

**Agent 4 — Trajectory Node**
Reasoning: Threshold proximity plus conflicting signals (inseparable).
Job: Resolve conflicting signals first — DTI looks fine at 5.9 today but income contract expires in 3 months, making effective future DTI 9.2. Then assess trajectory — not where are we today but where are we going. Time-to-breach estimation.
TRBK access: BCA_DTI, BCA_LOAN_SCHED, DFKKOP via hana_relational_query + apra_threshold_check MCP tools.
Output: forward-looking risk position with time-to-breach in days and conflicting signals resolved.

**Agent 5 — Synthesis Node**
Reasoning: Confidence under uncertainty PLUS policy retrieval.
Job: Take outputs from all four nodes. Retrieve relevant APRA regulatory documents via HANA Vector semantic search. Hold contradictions — do not resolve them prematurely. Acknowledge what is unknown. Generate risk brief with explicit confidence per finding. Fires human-in-the-loop interrupt before outputting.
TRBK access: RegulatoryDocuments (HANA Vector) via hana_vector_search MCP tool.
Output: APRA-ready risk brief with score, level, findings, recommendations, evidence trail, uncertainties.

### MCP Tool Layer

MCP (Model Context Protocol) is how agents connect to external tools. Not hardcoded function calls — standardised tool discovery and invocation. SAP job requires this explicitly.

Five MCP tools for Banking Sentinel:

```typescript
// Tool 1 — HANA Graph traversal
const hanaGraphTool = {
  name: "hana_graph_traverse",
  description: "Traverse TRBK entity relationships via HANA Graph engine",
  inputSchema: {
    startNode: string,      // e.g. "B-001"
    nodeType: string,       // "BusinessPartner" | "Loan" | "Guarantor"
    depth: number,          // max 8 hops
    filters: object         // optional relationship type filters
  }
  // Returns: array of connected nodes with relationship types and weights
}

// Tool 2 — HANA Vector semantic search
const hanaVectorTool = {
  name: "hana_vector_search",
  description: "Semantic search over APRA regulatory documents in HANA Vector",
  inputSchema: {
    query: string,          // natural language query
    topK: number,           // number of results
    useHyDE: boolean        // generate hypothetical document first
  }
  // Returns: ranked regulatory document excerpts with similarity scores
}

// Tool 3 — HANA relational query
const hanaRelationalTool = {
  name: "hana_relational_query",
  description: "Query TRBK relational tables in HANA",
  inputSchema: {
    tables: string[],       // e.g. ["DFKKOP", "BCA_LOAN_HDR"]
    filters: object,        // PARTNER, LOAN_ID etc
    fields: string[]        // specific fields to return
  }
  // Returns: structured TRBK data
}

// Tool 4 — APRA threshold checker
const apraThresholdTool = {
  name: "apra_threshold_check",
  description: "Check a value against APRA regulatory thresholds",
  inputSchema: {
    metricType: string,     // "large_exposure" | "dti" | "sector_concentration"
    value: number,
    entityId: string
  }
  // Returns: breach status, threshold value, utilisation %, regulatory reference
}

// Tool 5 — Exposure calculator
const exposureCalcTool = {
  name: "exposure_calculator",
  description: "Calculate total group exposure across connected entities",
  inputSchema: {
    entityIds: string[],    // borrower IDs in the group
    includeGuarantors: boolean
  }
  // Returns: total exposure, breakdown by entity, APS 221 utilisation
}
```

### Langfuse TypeScript Setup

Langfuse traces every LangGraph node automatically. Setup in Phase 0.

```typescript
// Install: npm install langfuse langfuse-langchain
import { CallbackHandler } from "langfuse-langchain"

// Environment variables (set in .env and CF env vars)
// LANGFUSE_PUBLIC_KEY=pk-lf-xxx
// LANGFUSE_SECRET_KEY=sk-lf-xxx  
// LANGFUSE_HOST=https://cloud.langfuse.com

const langfuseHandler = new CallbackHandler({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  host: process.env.LANGFUSE_HOST,
  sessionId: sessionId,
  userId: "banking-sentinel"
})

// Pass to every LangGraph invocation
const config = {
  configurable: { thread_id: sessionId },
  callbacks: [langfuseHandler]
}

const result = await app.invoke(state, config)
await langfuseHandler.flushAsync()  // ensure all traces sent before response
```

In production — swap LANGFUSE_HOST to SAP AI Launchpad endpoint. Same code. One env var change.

### Responsible AI Implementation

This is not just behavioural description. It is an architectural layer.

**Guardrails — where they live:**
Every agent output passes through a validation function before being added to state. Implemented as a LangGraph node between each specialist agent and the next.

```typescript
function validateAgentOutput(output: AgentOutput): ValidationResult {
  // 1. Schema validation — is the output the correct shape?
  const schemaValid = validatePydanticSchema(output)

  // 2. Evidence check — does every finding have a source?
  const evidenceValid = output.findings.every(f => f.evidenceSource !== null)

  // 3. Confidence check — is confidence above minimum threshold?
  const confidenceValid = output.confidence >= 0.40  // below 40% = refuse to output

  // 4. Hallucination check — are claims supported by retrieved data?
  const hallucinationScore = crossCheckClaimsAgainstSources(output)

  return { valid: schemaValid && evidenceValid && confidenceValid,
           hallucinationScore, issues: [...] }
}
```

**Confidence thresholds:**
- Below 40%: Refuse to generate finding. State what data is missing.
- 40-70%: Generate finding with explicit uncertainty statement.
- Above 70%: Generate finding normally.
- Self-RAG triggers at below 70% — re-queries before proceeding.

**Human-in-the-loop:**
LangGraph `interrupt()` fires before the Synthesis node executes. Execution halts. A `banking/human/approval` event is published to Solace. The HTML UI shows the pending findings and an approval button. When the risk officer clicks approve — a resume event fires on Solace, LangGraph resumes, Synthesis executes.

This is APRA's co-pilot requirement implemented architecturally — not just described.

**Bias detection:**
The Synthesis Agent prompt explicitly instructs: "Ensure all findings are grounded in numerical data from TRBK records. Do not make assumptions about borrower behaviour based on sector, geography, or demographic patterns. Every finding must cite a specific TRBK record."

**Inappropriate request handling:**
The Intake Agent pattern matches for action requests — approve, delete, modify, override. These are routed to a dedicated rejection node that returns the standard refusal message and logs the attempt to HANA.

### CPI — Three Legitimate Jobs

**Job 1 — Data ingestion pipeline**
Scheduled iFlow. Fetches synthetic TRBK data from source CSV files (or later from SAP Business Accelerator Hub). Transforms to HANA schema. Loads to HANA relational tables. Daily refresh. Governed, scheduled, auditable.

**Job 2 — Governed AI gateway**
All LLM calls route through CPI. API key management (never in browser or agent code). Retry logic. Rate limiting. Full audit trail of every AI call — timestamp, model, token count, response time. In production: swap endpoint URL from Claude API to AI Core Generative AI Hub. One configuration change.

**Job 3 — Risk and regulatory event publishing**
When a significant event occurs — new regulatory breach detected, APRA document uploaded, payment event received — CPI publishes as a formal business event to Solace. Downstream compliance systems can subscribe. This is the Twinkle 2 architecture made real.

### Solace Topic Structure

```
banking/pipeline/status          → agent pipeline updates (Panel 2)
banking/risk/findings            → risk brief events (Panel 3)
banking/human/approval           → human-in-the-loop pause/resume
banking/trbk/payment_event       → inbound payment events from TRBK
banking/regulatory/update        → new APRA document uploaded
banking/session/reset            → reset session before new demo
```

Consumer UI subscribes to all topics via Solace JS SDK WebSocket. The three panels update independently:
- Panel 1 (Query): user input, intent parse result
- Panel 2 (Agent Pipeline): pipeline/status events light up each agent node
- Panel 3 (Risk Brief): risk/findings events populate the brief in real time

LangGraph agents publish to these topics via CAP service after each node completion.

### HANA CDS Schema Definition

```cds
// db/schema.cds
namespace bankingsentinel;

entity BusinessPartners {
  key PARTNER    : String(10);
  BU_TYPE        : String(2);    // 1=person, 2=organisation
  BU_SORT1       : String(50);   // name
  SECTOR_CODE    : String(10);   // RETAIL_PROP etc
  DTI_RATIO      : Decimal(5,2);
  INCOME_SOURCE  : String(100);  // contract employer name
  INCOME_EXPIRY  : Date;         // contract end date
}

entity BP2000 {  // Business Partner Relationships
  key PARTNER1   : String(10);
  key PARTNER2   : String(10);
  RELTYP         : String(6);    // GRPAR=guarantor, TRUST_COMMON=trust
}

entity Loans {
  key LOAN_ID    : String(15);
  PARTNER        : String(10);
  AMOUNT         : Decimal(15,2);
  CURRENCY       : String(3);    // AUD
  STATUS         : String(1);    // A=active
  SECTOR_CODE    : String(10);
  DTI_RATIO      : Decimal(5,2);
  APPROVED_DATE  : Date;
}

entity BCA_GUARANTOR {
  key LOAN_ID    : String(15);
  key GUARANTOR  : String(10);
  COVER_AMOUNT   : Decimal(15,2);
}

entity DFKKOP {  // Open items — primary risk signal
  key OPBEL      : String(12);
  PARTNER        : String(10);
  LOAN_ID        : String(15);
  BETRW          : Decimal(15,2);  // amount
  FAEDN          : Date;            // due date
  DAYS_OVERDUE   : Integer;         // computed
}

entity DFKKZP {  // Payment records
  key PAYMENT_ID : String(12);
  LOAN_ID        : String(15);
  BETRW          : Decimal(15,2);
  BUDAT          : Date;            // posting date
}

entity RegulatoryThresholds {
  key THRESHOLD_TYPE : String(30);  // APS221_LARGE_EXPOSURE, DTI_LIMIT
  LIMIT_VALUE        : Decimal(15,2);
  REGULATOR          : String(10);  // APRA
  EFFECTIVE_DATE     : Date;
}

entity RiskAssessments {
  key SESSION_ID  : String(36);    // UUID
  PARTNER         : String(10);
  RISK_SCORE      : Integer;
  RISK_LEVEL      : String(10);    // LOW/MEDIUM/HIGH/CRITICAL
  FINDINGS        : LargeString;   // JSON
  CONFIDENCE      : Decimal(3,2);
  CREATED_AT      : DateTime;
  APPROVED_BY     : String(50);
}

entity RegulatoryDocuments {
  key DOC_ID      : String(36);
  TITLE           : String(200);
  STANDARD        : String(20);    // APS221, CPS230 etc
  CONTENT         : LargeString;
  EMBEDDING       : LargeString;   // JSON array — switch to Vector(1536) with CDS 10
  UPLOADED_AT     : DateTime;
}

entity AuditLog {
  key LOG_ID      : String(36);
  SESSION_ID      : String(36);
  ACTION          : String(100);
  QUERY           : LargeString;
  RESPONSE        : LargeString;
  MODEL           : String(50);
  TOKENS          : Integer;
  LATENCY_MS      : Integer;
  COST_AUD        : Decimal(8,4);
  CREATED_AT      : DateTime;
}
```

### CAP Service Structure

```typescript
// srv/banking-sentinel-service.cds
service BankingSentinelService {
  // A2A entry point — called by HTML UI and Joule
  action analyseRisk(query: String, customerId: String) returns RiskBriefResult;

  // Human-in-the-loop resume
  action approveRiskBrief(sessionId: String) returns Boolean;

  // Regulatory document upload (Twinkle 2)
  action uploadRegulatoryDocument(content: String, metadata: DocumentMetadata) returns Boolean;

  // Session management
  action resetSession(sessionId: String) returns Boolean;

  // Simple data queries routed here
  action simpleQuery(query: String) returns QueryResult;

  // Entities for OData
  entity RiskAssessments as projection on db.RiskAssessments;
  entity RegulatoryDocuments as projection on db.RegulatoryDocuments;
  entity AuditLog as projection on db.AuditLog;
}
```

### Cost Tracking Per Analysis

Every analysis run tracks cost. Visible in Langfuse and stored in AuditLog.

```typescript
// Cost per token (approximate, verify with current pricing)
const COST_PER_1K_INPUT_TOKENS = 0.0025   // Claude Sonnet
const COST_PER_1K_OUTPUT_TOKENS = 0.0125  // Claude Sonnet

function calculateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000 * COST_PER_1K_INPUT_TOKENS) +
         (outputTokens / 1000 * COST_PER_1K_OUTPUT_TOKENS)
}

// After each LangGraph invocation
async function logAnalysisCost(sessionId: string, state: BankingSentinelState) {
  const totalTokens = state.totalInputTokens + state.totalOutputTokens
  const cost = calculateCost(state.totalInputTokens, state.totalOutputTokens)

  await INSERT.into(AuditLog).entries({
    LOG_ID: uuid(),
    SESSION_ID: sessionId,
    ACTION: 'risk_analysis',
    QUERY: state.query,
    MODEL: 'claude-sonnet-4-5',
    TOKENS: totalTokens,
    COST_AUD: cost,
    CREATED_AT: new Date()
  })
}
```

Add token tracking to BankingSentinelState:
```typescript
totalInputTokens: number   // accumulated across all agent calls
totalOutputTokens: number  // accumulated across all agent calls
```

This enables: cost per borrower analysis, cost per session, cost trend over time — all visible in Langfuse dashboard.

### PostgreSQL State Persistence

Critical for production. MemorySaver (LangGraph default) resets when CF app restarts. PostgresSaver persists complete agent state across restarts, deployments, and sessions.

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"

const pgPool = new Pool({
  connectionString: process.env.POSTGRES_URL  // CF service binding
})

const checkpointer = new PostgresSaver(pgPool)
await checkpointer.setup()  // creates required tables

const app = graph.compile({
  checkpointer,
  interruptBefore: ["humanApproval"]
})

// Each analysis run gets a thread_id
const config = { configurable: { thread_id: sessionId } }
const result = await app.invoke(state, config)
```

For demo: PostgreSQL free tier — use Neon (neon.tech), Supabase, or Railway. All free, all provide a connection string. ElephantSQL shut down in 2024.
For production: BTP PostgreSQL Hyperscaler Option.

### SAP AI Golden Path — Native HANA ML Components

Three capabilities from the SAP AI Golden Path that reduce LLM dependency and improve accuracy on structured data tasks.

#### RPT-1 — Tabular Risk Scoring

RPT-1 is SAP's foundation model for tabular prediction. Available natively in HANA Cloud via SQL stored procedure. No model training required.

**What goes in:**
```sql
-- Feature table per borrower
PARTNER | DTI_RATIO | DAYS_OVERDUE | LOAN_AMOUNT | GUARANTOR_COUNT | SECTOR_CODE | PAYMENT_HISTORY_SCORE
B-001   | 7.2       | 61           | 1245000     | 2               | RETAIL_PROP | 0.72
```

**What comes out:**
```sql
PARTNER | RISK_SCORE | RISK_LEVEL | CONFIDENCE
B-001   | 74         | HIGH       | 0.89
```

**Where it fits:** Pattern Agent calls RPT-1 first via HANA SQL. Gets a statistically grounded risk score. Passes this to LangGraph state. LLM agents reason OVER this score — they do not replace it.

**Why better than LLM for this task:** LLM hallucination risk on numerical tabular data. RPT-1 trained on tabular patterns. Faster, cheaper, more consistent.

---

#### HANA PAL — Anomaly Detection with ENV Switch

HANA PAL detects payment anomalies in DFKKOP statistically. An .env switch controls whether PAL or Claude LLM performs this task. Both approaches are demonstrable live during the demo.

**ENV switch:**
```bash
ANOMALY_DETECTION_MODE=PAL   # use HANA PAL — statistical, no LLM call
# ANOMALY_DETECTION_MODE=LLM # use Claude LLM — narrative explanation
```

**What goes in (both modes):**
```
DFKKOP payment records for a borrower:
DATE       | AMOUNT_DUE | AMOUNT_PAID | DAYS_LATE
2025-01-15 | 4500       | 4500        | 0
2025-02-15 | 4500       | 4500        | 0
2025-03-15 | 4500       | 0           | 61
```

**What comes out — PAL mode:**
```json
{
  "anomalyScore": 0.94,
  "anomalyType": "PAYMENT_GAP",
  "confidence": 0.91,
  "method": "HANA_PAL_ISOLATION_FOREST"
}
```

**What comes out — LLM mode:**
```json
{
  "anomalyScore": 0.87,
  "anomalyType": "PAYMENT_GAP",
  "narrative": "B-001 shows a sudden payment cessation after 14 months of consistent on-time payments. The abrupt gap of 61 days with no partial payment suggests a sudden income disruption rather than a gradual deterioration.",
  "confidence": 0.87,
  "method": "CLAUDE_LLM_ANALYSIS"
}
```

**Demo value of the switch:** Toggle live during the demo. Show both outputs side by side. PAL: faster, cheaper, statistically rigorous. LLM: narrative, explainable, APRA CPS 230 requires human-readable justification. The architect conversation: "PAL for bulk portfolio screening, LLM for individual case review requiring explanation."

---

#### HANA Knowledge Graph Engine

Supersedes the standard HANA Graph Engine. AI-native. SAP AI Golden Path recommended.

**What goes in:**
```
Start: B-001, Tables: BP2000 + BCA_GUARANTOR, Depth: 8 hops
Filters: GRPAR, TRUST_COMMON, SUBSIDIARY relationship types
```

**What comes out:**
```json
{
  "nodes": ["B-001","G-001","B-002","B-003","G-002","B-004","B-005"],
  "edges": [
    {"from":"B-001","to":"G-001","type":"GUARANTEED_BY","hop":1},
    {"from":"G-001","to":"G-002","type":"TRUST_COMMON","hop":2},
    {"from":"G-002","to":"B-004","type":"GUARANTEES","hop":3}
  ],
  "groupExposure": 7800000,
  "aps221Utilisation": 0.92
}
```

---

### Updated End-to-End Flow With Native ML Components

```
User query: "Analyse B-001"
        |
        v
RPT-1 via HANA SQL
--> Risk score: 74 / HIGH / confidence 0.89
        |
        v
HANA PAL or LLM (ANOMALY_DETECTION_MODE env switch)
--> Payment anomaly: 61-day gap flagged, score 0.94
        |
        v
HANA Knowledge Graph Engine
--> Connected parties: B-001 to G-001 to G-002, 92% APS 221 utilisation
        |
        v
LangGraph agents REASON over these three structured outputs
Pattern Agent:      "PAL + RPT-1 confirm concern — something wrong"
Relationship Agent: "Knowledge Graph found TrustCo Holdings — 6 hops"
Trajectory Agent:   "DTI 7.2 + income expiry = 9.2 imminent"
Synthesis Agent:    "92% APS 221, DTI breach unreported, sector 78%"
        |
        v
Claude Sonnet: narrative risk brief with evidence trail
        |
        v
Human-in-the-loop: risk officer approves
        |
        v
Final APRA-ready brief published to Solace --> HTML UI
```

LLM does what only LLM can do. HANA does what HANA does better. Each tool in its right lane.

---

## PART 5 — REQUIREMENTS

### Requirement 1 — Natural Language Risk Intelligence

The system must answer any natural language question about borrower or portfolio risk using the data available in HANA. No pre-programmed question types. The Intake Agent determines intent, appropriate agents activate, answer emerges from reasoning.

The system must produce answers that go beyond the literal question — surfacing relevant risk context the user did not know to ask about.

For simple data queries ("what is the total loan amount?") — answer directly. No full pipeline. Return data plus offer of deeper analysis.

For risk questions — full agent pipeline. Reason. Connect. Explain.

**This is the requirement that separates Banking Sentinel from ABAP.**
ABAP answers the question you asked. Banking Sentinel answers the question you should have asked.

### Requirement 2a — Performance and Concurrency

- Response time: under 30 seconds for full four-dimension risk analysis
- Acceptable because the pipeline is visible — users see each agent activating, graph traversing, confidence building. Visible progress feels fast. Silence feels slow. This was proven in MJ Live.
- Concurrent users: single session for prototype. PostgreSQL checkpointer architecture supports multi-session in production.
- Data: static synthetic TRBK data for prototype. Solace event architecture supports real-time refresh.

### Requirement 2b — Zero Code Change Adaptability

The system must respond to two types of changes without any code modification:

**Data changes via Solace:**
Payment event fires — borrower misses repayment — system re-evaluates automatically. Borrower who was safe becomes flagged. No developer intervention. No code change.

**Regulatory changes via knowledge base:**
APRA activates new guideline — upload document to HANA Vector — Policy Agent retrieves and applies immediately on next query. Borrower compliant yesterday may be flagged today.

This is the clearest demonstration of AI over rules-based systems. ABAP requires code change, testing, transport, deployment — weeks. Banking Sentinel — upload a document.

### Requirement 3 — What the System Must NOT Do

**Must not make autonomous decisions:**
System recommends. Human decides. Human-in-the-loop pause is architectural enforcement. APRA requires it. Demo shows it.

**Must not present findings below confidence threshold:**
Below 70% — state explicitly "I need more data. Here is what I found and what is missing." Never guess. Never fabricate.

**Must not generate finding without evidence:**
Every claim links to a specific TRBK table record or APRA document. No assertion without source.

**Must not comply with action requests:**
Approve, delete, modify, override — reject clearly, log attempt, continue operating.

**The deliberate rejection demo — script it exactly:**
Input: "Approve the loan for BP233."
Output: "I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation. Here is the risk profile for BP233 to inform your decision."
Then display BP233's risk profile below.

### Requirement 4 — Definition of Success

**Technical:** System runs end to end. All agents complete. Self-RAG re-query fires genuinely. Human approval pause works. Regulatory update applies without code change. Deliberate rejection works cleanly.

**Demo:** A banking professional watches and says "I understand what this does and I want it."

**Business:** The client asks "what would it take to implement this on our TRBK data?" — not "that was interesting."

The third definition is the real target. The prototype must start a delivery conversation.

### Requirement 5 — Edge Cases

**Borrower not found:** "No record found for BP999. Please verify the borrower ID." Not an error. Not a crash.

**Incomplete data:** Reason over what exists. State gaps explicitly. Adjust confidence. Do not refuse.

**Conflicting data:** Surface the conflict. Explain both figures. Flag for human review. Do not silently choose one.

**Low confidence with consistent signals:** "Findings are consistent but data coverage is limited. Confidence 58%. These additional data sources would improve reliability: [list]."

**Inappropriate requests:** Reject clearly, log, continue. Do not comply. Do not crash.

**Question outside data domain:** "I found no records matching that query in the available TRBK data. In a live environment with your full TRBK data, this query would return [expected result type]."

---

## PART 6 — SYNTHETIC TRBK DATA DESIGN

### The Four Hidden Risk Patterns

Deliberately designed so these patterns exist but require AI reasoning to surface. No SQL query finds all four. No ABAP report connects them. The demo works because the data was designed to prove a specific thesis.

**Pattern 1 — Connected party + APS 221 breach (primary demo pattern, Twinkle 1):**
- Borrowers B-001, B-002, B-003 individually look acceptable
- Individual exposures: $2.1M, $1.8M, $1.4M — each within individual limits
- All guaranteed by G-001 (TrustCo Holdings Pty Ltd)
- Combined group via G-001: $5.3M against $5.8M individual limit — 91%
- G-001 connected via BP2000 to G-002 (same family trust structure) — HIDDEN
- G-002 guarantees B-004 and B-005
- Full group exposure including G-002 network: $7.8M against $8.5M group limit — 92%
- Requires 6-hop graph traversal: B-001 → BKKN → BCA_LOAN_HDR → BCA_GUARANTOR → G-001 → BP2000 → G-002
- SQL cannot traverse this. LangGraph ReAct loop with hana_graph_traverse can.

**Pattern 2 — DTI regulatory breach with trajectory:**
- B-001 DTI ratio 7.2 — above APRA February 2026 limit of 6.0
- Loan approved October 2025 — pre-activation
- Income from single contract employer expiring 3 months from demo date — HIDDEN in BCA_DTI
- Effective future DTI post-contract: 9.2
- Not yet reported to APRA
- Hard rule: 7.2 > 6.0, flag. AI: income expiry trajectory means 9.2 imminent, deeper breach coming.

**Pattern 3 — Sector concentration:**
- B-001, B-002, B-003, B-007 all in SECTOR_CODE: RETAIL_PROP
- Combined: $12.4M against $16M sector limit — 78%
- Four connected borrowers in same sector via same guarantor network
- Concentration + connection = systemic risk invisible to individual loan analysis

**Pattern 4 — Credit early warning:**
- B-001 home loan: DFKKOP record 61 days overdue, $8,450
- No corresponding DFKKZP payment record — missed repayment confirmed
- First signal — links to all other patterns as compounding risk

### Dataset Scale

- 50 business partners: 30 individual borrowers, 10 corporate borrowers, 8 guarantors, 2 parent entities
- 60 loans: 20 home loans ($400K-$2M), 10 investment property, 10 personal, 10 business facilities, 10 term deposits
- Payment history: performing loans all on time, risk loans with deliberate DFKKOP gaps and no DFKKZP matches
- APRA documents in HANA Vector: APS 221 (2024 revision), APS 112, CPS 230, DTI Limit Activation Notice Feb 2026, Credit Policy §7.3

---

## PART 7 — RAGAS EVALUATION DATASET

20 questions across four dimensions. Run automatically after each build phase to measure RAG quality.

**Connected party risk (5):**
1. Is B-001 part of a connected borrower group? → Yes — G-001 group, 3 borrowers
2. What is the total group exposure for B-001's guarantor network? → AUD $7.8M
3. Does the B-001 connected group breach APS 221? → 92% utilisation, board notification required
4. Who are all connected parties of G-001 including indirect connections? → B-001, B-002, B-003 (direct), B-004, B-005 via G-002 (indirect)
5. What is the nature of the relationship between G-001 and G-002? → Common family trust structure — BP2000 RELTYP = TRUST_COMMON

**Credit risk (5):**
6. Does B-001 have overdue payments? → 61 days, $8,450 — DFKKOP record, no DFKKZP match
7. What is B-001's current DTI ratio? → 7.2 — BCA_DTI record
8. Does B-001 breach the APRA February 2026 DTI limit? → Yes — 7.2 exceeds 6.0
9. What is B-001's effective future DTI? → 9.2 — post single-contract income expiry in 3 months
10. Has B-001's DTI breach been reported to APRA? → No

**Sector concentration (5):**
11. Which borrowers share B-001's sector classification? → B-002, B-003, B-007
12. What is the combined RETAIL_PROP sector exposure? → $12.4M
13. What percentage of the sector limit is utilised? → 78%
14. Does sector concentration require escalation under credit policy? → Yes — credit policy §7.3
15. How many borrowers connected to B-001 through the guarantor network are in RETAIL_PROP? → 4

**Regulatory (5):**
16. Which APRA standards are relevant to B-001's complete risk profile? → APS 221, DTI limits, CPS 230
17. What action does APS 221 require at 92% large exposure utilisation? → Board notification required
18. What is the required remediation timeline for the unreported DTI breach? → Document within 5 days per APRA DTI Activation Notice
19. Does B-001's risk profile require human approval before recommendations are finalised? → Yes — CPS 230 requires human oversight of AI risk decisions
20. What additional data would increase confidence in B-001's risk assessment from 64% to above 70%? → TrustCo Holdings full entity structure, B-004 and B-005 loan details, G-002 guarantor register

---

## PART 8 — AI DESIGN PATTERNS — 10 CONCEPTS

For every pattern: AI meaning, banking meaning, SAP meaning. Use all three vocabularies throughout the build.

**1. GraphRAG**
AI: Retrieval that traverses relationships between entities rather than finding similar documents.
Banking: Finding that B-001's guarantor also covers four other stressed borrowers — invisible to flat queries.
SAP: HANA Graph engine traversal across BP2000 and BCA_GUARANTOR edges using CDS queries with relationship joins.

**2. Hybrid RAG**
AI: Combining vector similarity search with keyword search and reranking for better coverage.
Banking: Finding APS 221 by exact regulatory reference AND by semantic meaning of "large exposure limit" simultaneously.
SAP: HANA Vector cosine similarity combined with HANA Full Text Search — both in one HANA query via CAP.

**3. HyDE — Hypothetical Document Embeddings**
AI: Generate a hypothetical ideal answer to improve retrieval signal for sparse or vague queries.
Banking: "Does this breach any rules?" is too vague for vector search. Generate "a connected party group exposure exceeding APS 221 threshold would be classified as a large exposure requiring board notification..." first, then search.
SAP: Pre-processing step before HANA Vector query — a LangGraph node that calls the LLM once to enrich the query before retrieval.

**4. Agentic RAG**
AI: An agent that decides what to retrieve, when, and in what order — not a single retrieval call per query.
Banking: After finding a stressed guarantor, the agent decides on its own to look for all other loans that guarantor covers. That decision was not programmed.
SAP: LangGraph ReAct node calling hana_graph_traverse MCP tool multiple times based on what it observed in previous calls.

**5. ReAct Pattern**
AI: Think → Act → Observe → Think → Act. The agent updates its understanding based on real observations before acting again.
Banking: Agent thinks "something is wrong with B-001," queries DFKKOP, observes 61 days overdue, thinks "check guarantor," queries BP2000, observes TrustCo Holdings, thinks "calculate group exposure."
SAP: LangGraph conditional edges — each observation determines the next action in the graph.

**6. Multi-Agent**
AI: Multiple specialised agents with one job each, coordinated by a supervisor or sequential graph.
Banking: Pattern analyst, relationship analyst, trajectory analyst, and synthesis officer — each doing their specific job rather than one person doing everything.
SAP: LangGraph StateGraph with five nodes, each a CAP service function, state object carries all findings between nodes.

**7. Self-RAG**
AI: The agent evaluates its own retrieval quality and re-queries if confidence is below threshold — not theatrical, genuinely epistemic.
Banking: Risk officer double-checks their own calculation before signing off. If unsure — gets more data before presenting to the board.
SAP: LangGraph conditional edge after trajectory node — if confidence < 0.70, loop back to relationship node for additional graph traversal.

**8. Temporal Memory**
AI: State accumulates across agent steps — later agents know everything earlier agents found.
Banking: The recommendation does not start from scratch — it inherits the pattern assessment, relationship map, and trajectory analysis already completed.
SAP: LangGraph typed BankingSentinelState object passed through all nodes. Each node reads previous findings and adds its own. Persisted via PostgresSaver.

**9. AI Observability — LLMOps**
AI: Every LLM call, token count, latency, cost, and decision traced and queryable.
Banking: Every AI decision auditable — who asked what, what the AI reasoned, what it recommended, when. APRA CPS 230 requirement.
SAP: Langfuse traces every LangGraph node automatically when LANGFUSE_* env vars are set. In production — swap to SAP AI Launchpad. One config change.

**10. RAGAS — RAG Evaluation**
AI: Automatic measurement of retrieval faithfulness (did the answer come from retrieved docs?), relevance (were docs relevant?), context precision (too much or too little context?).
Banking: Proof that the APRA regulatory documents retrieved actually support the findings claimed.
SAP: 20-question evaluation dataset run against HANA Vector queries after each build phase. Scores visible in Langfuse dashboard.

---

## PART 9 — TRBK TABLE REFERENCE

Real SAP Transactional Banking table names. When shown to a bank client these are immediately recognisable. Use exact table names everywhere — code, comments, evidence trails, UI.

| Table | Description | Role in Banking Sentinel | Graph Role |
|---|---|---|---|
| BUT000 | Business Partner master | Customer/borrower node | Node |
| BUT100 | BP Roles | Customer classification | Node attribute |
| BP2000 | BP-to-BP Relationships | Connected parties, guarantors, subsidiaries | **Graph edge 1** |
| BKKF | Contract account master | Loan contract header | Node |
| BKKN | Contract-BP link | Connects borrower to their contracts | Edge |
| BCA_LOAN_HDR | Loan header | Loan amount, currency, status, dates | Node |
| BCA_LOAN_SCHED | Repayment schedule | Expected payment dates and amounts | Node |
| BCA_GUARANTOR | Guarantor assignment | Who guarantees which loan | **Graph edge 2** |
| BCA_COLLATERAL | Collateral | Security value against loans | Node attribute |
| DFKKOP | Open items | Overdue payment records — primary risk signal | Risk signal |
| DFKKZP | Payment items | Actual payments made — absence = missed payment | Risk signal |
| BCA_SECTOR | Industry sector | Sector concentration monitoring | Node attribute |
| BCA_DTI | Debt to income ratio | APRA DTI limit compliance + income source | Risk attribute |
| BCA_RISK_CLASS | Risk classification | Current risk rating | Node attribute |
| RISK_THRESHOLD | Regulatory limits (synthetic) | APRA thresholds for automated checking | Reference |
| EXPOSURE_LIMIT | Exposure limits (synthetic) | APS 221 single and group limits | Reference |
| SECTOR_EXPOSURE | Sector concentration (synthetic) | Internal sector limits | Reference |

**HANA data layer separation:**
- HANA Graph Engine: BP2000 edges + BCA_GUARANTOR edges — for multi-hop traversal
- HANA Vector Engine: APRA regulatory documents embedded — for semantic search
- HANA Relational: All other TRBK tables — for structured queries

---

## PART 10 — SAP JOB REQUIREMENTS MAPPING

The SAP Senior AI Developer job explicitly requires these. Banking Sentinel addresses each.

| SAP Job Requirement | How Banking Sentinel Addresses It |
|---|---|
| Generative AI + Agentic AI on SAP BTP | LangGraph agents on BTP CF via SAP Cloud SDK for AI |
| RAG pipelines and retrieval workflows | HANA Vector + GraphRAG + Hybrid RAG + HyDE |
| Multi-agent orchestration | LangGraph supervisor with 5 specialist agents |
| A2A interaction patterns | /a2a/agent endpoint, JSON-RPC 2.0, Joule compatible |
| MCP interaction patterns | 5 MCP tools: graph, vector, relational, threshold, calculator |
| SAP BTP | Deployed on BTP CF |
| SAP AI Core | Generative AI Hub trial (swap path to AI Core documented) |
| SAP Joule | A2A endpoint Joule-compatible (swap path documented) |
| SAP HANA | HANA Cloud — all three engines |
| SAP Integration Services | CPI — three legitimate jobs |
| LLMOps/MLOps pipelines | Langfuse tracing + RAGAS evaluation + cost tracking |
| Responsible AI | Guardrails, confidence thresholds, human-in-the-loop, deliberate rejection |
| Python | TypeScript used (SAP officially supports both). Python recommended for production — document explicitly. |
| Vector databases | HANA Vector Engine |
| Knowledge graph integrations | HANA Graph Engine |
| LangChain/LangGraph | @langchain/langgraph TypeScript |
| Scalability, reliability | PostgreSQL state persistence, error recovery, CF deployment |

**Extras beyond the job requirements:**
- Human-in-the-loop interrupt (APRA co-pilot requirement)
- Pydantic-style typed state (production-grade outputs)
- Zero code change regulatory updates (Twinkle 2 — unique value)
- Real-time risk state changes via Solace (Twinkle 2 variant)
- Deliberate rejection demo (Responsible AI in action)
- TRBK table names in evidence trails (client recognition)
- RPT-1 tabular risk scoring via HANA SQL — LLM not needed for tabular prediction
- HANA PAL anomaly detection with ENV switch — demonstrates both approaches live
- HANA Knowledge Graph Engine — AI-native relationship traversal per SAP AI Golden Path
- ENV-controlled A/B switch (ANOMALY_DETECTION_MODE) — architect-level design decision made visible

---

## PART 11 — BUILD PHASES

One prototype. One blog post. Build one phase at a time. Confirm current phase before writing any code.

| Phase | What Gets Built | Key Learning | Milestone |
|---|---|---|---|
| 0 | SAP Generative AI Hub trial setup · SAP Cloud SDK for AI installed · LangGraph TypeScript (@langchain/langgraph) installed · BTP CF confirmed · Langfuse connected · PostgreSQL provisioned · Hello World LangGraph agent runs and traces in Langfuse. Key .env vars set: ANTHROPIC_API_KEY, SAP_AI_HUB_API_KEY, SAP_AI_HUB_BASE_URL, POSTGRES_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST, SOLACE_URL, SOLACE_VPN, SOLACE_USERNAME, SOLACE_PASSWORD, ANOMALY_DETECTION_MODE=PAL | Environment. SAP Cloud SDK. LangGraph basics. Observability. | First traced agent call visible in Langfuse dashboard |
| 1 | Synthetic TRBK data CSV files generated · HANA Cloud schema deployed (all tables in Part 9) · Four hidden patterns seeded · Graph relationships loaded in BP2000 and BCA_GUARANTOR · HANA Graph engine verified | Data foundation. HANA Graph topology. | 6-hop traversal finds TrustCo Holdings |
| 2 | APRA regulatory documents embedded in HANA Vector · Hybrid RAG tested · HyDE implementation tested · RAGAS evaluation dataset created and first scores generated | Knowledge base. Hybrid RAG. RAGAS. | RAGAS faithfulness > 0.85 |
| 3 | LangGraph StateGraph defined with full BankingSentinelState · Intake Agent built · Simple data query routing works · A2A endpoint exposed on CAP · MCP tools defined | Agent foundation. A2A. MCP. | Simple query returns correct data via A2A |
| 4 | Pattern Agent built · Relationship Agent with graph traversal ReAct loop · 6-hop traversal finds TrustCo Holdings · Confidence scoring working | Graph reasoning. ReAct. | TrustCo Holdings found without being asked |
| 5 | Trajectory Agent built · Conflicting signals resolved · Future DTI calculated · Synthesis Agent built · Human-in-the-loop interrupt working | Forward-looking reasoning. Human oversight. | Human approval pause fires and resumes correctly |
| 6 | Self-RAG implemented · Confidence evaluation · Re-query loop at 64% confidence · Final confidence 89% after re-query | Epistemic reasoning. Self-RAG. | Self-RAG genuinely finds new information on re-query |
| 7 | Solace events wired for all five topics · Risk state change event triggers automatic re-evaluation · Regulatory document upload triggers immediate policy update | Real-time adaptability. Twinkle 2. | APRA document upload immediately changes risk assessment |
| 8 | Langfuse tracing every LangGraph node · RAGAS scoring every RAG call · Cost per analysis visible · PostgreSQL persistence tested across CF restart | LLMOps. Observability. Cost tracking. | Analysis survives CF restart with full state |
| 9 | HTML UI wired to A2A endpoint · All five Solace topics updating correct panels · Three demo scenarios rehearsed · Deliberate rejection scripted and tested | Experience layer. Demo rehearsal. | Full end-to-end demo runs under 30 seconds |
| 10 | BTP CF deployment confirmed for both bridge and CAP · Architecture diagram created · Demo video recorded · Blog post written | Production. Publishing. | Blog published, demo video live |

---

## PART 12 — WHAT ALREADY EXISTS

**Three UI files — functionally identical, different visual themes. Wire one, other follows same pattern.**
- `Banking-Sentinel-AustralianBank.html` — light theme, yellow diamond — use for client presentation
- `Banking-Sentinel-Bloomberg.html` — dark navy terminal — use for blog and general audience
- `Task3-Banking-Sentinel-UI.html` — earlier version — retire, use one of the above

**From MJ Live — what to take forward:**
Ask for the MJ Live GitHub link. Specifically inherit:
- Solace JS SDK WebSocket connection pattern — consumer.html subscription code
- HANA Cloud connection setup in CAP package.json and .env
- BTP CF manifest.yml deployment pattern for two-app deployment
- Known fix: CAP start command is `cds-serve` not `cds` on CF
- Known fix: `cds.requires.auth.kind = "dummy"` for trial without XSUAA
- Known fix: Solace SDT format vs binary format — bridge publishes in SDK format
- ElevenLabs STT patterns not needed — Banking Sentinel has no audio

---

## PART 13 — REGULATORY AND BANKING CONTEXT

**APRA** — Australian Prudential Regulation Authority. Regulates all ADIs in Australia.

- **APS 221 — Large Exposures:** Limits exposure to single counterparty or connected group. Board notification required above 90% utilisation. Breach = regulatory enforcement action.
- **APS 112/113 — Credit Risk Capital:** IRB approach for larger banks. Every classification, every connected party assessment subject to APRA review.
- **CPS 230 — Operational Resilience (July 2025):** AI decisions must be transparent, auditable, resilient. Human oversight required. This is why human-in-the-loop is not optional.
- **DTI Limits — February 2026:** APRA activated restrictions on new lending at DTI > 6.0. Banks must identify and document pre-existing breaches in their portfolio. B-001 is an example of this exact scenario.

**The Hayne Royal Commission (2019):**
Australian inquiry into financial services misconduct. Core finding: bank risk governance failed not because data did not exist but because it was not connected, interpreted, or acted upon in time. Banking Sentinel is a direct architectural response to this finding.

**APRA on AI:**
"AI can be a valuable co-pilot — but it should never be your autopilot." Every AI decision must be explainable, auditable, and have human oversight. This is why CPS 230 requires it and why the human-in-the-loop interrupt is architecturally mandatory.

**SAP and Anthropic — Sapphire 2026:**
Official partnership announced May 2026. Claude is SAP's primary AI partner for the Autonomous Enterprise stack. Claude embedded across Joule and Joule agents. Using Claude through SAP's infrastructure is not a workaround — it is the strategic direction. This makes the prototype even more timely.

**The Procurement Parallel:**
The same architecture applies to SAP procurement. Borrowers become Suppliers. Loans become Purchase Orders. Repayments become Invoices. DTI limits become procurement policy thresholds. APS 221 becomes single-source dependency limits. The blog should mention this — demonstrating the architecture is domain-agnostic.

---

## PART 14 — BLOG POST STRUCTURE

One blog post. Sections correspond to build phases. Publish after Phase 10.

1. The Problem — why connected party risk is invisible to ABAP and SQL
2. The Idea — AI that reasons, not just rules
3. What ABAP Cannot Do — the honest comparison
4. The Architecture — full stack diagram and component justification
5. The Five Agents — one reasoning type each, with banking and SAP vocabulary
6. Building It — phase by phase, decisions documented
7. The Two Twinkle Moments — what happened that nobody programmed
8. The Deliberate Rejection — Responsible AI in action
9. LLMOps — what Langfuse and RAGAS revealed
10. The Procurement Parallel — same architecture, different domain
11. What I Learned — honest assessment of skills developed
12. What's Next — path from prototype to delivery

---

## PART 15 — INSTRUCTIONS FOR CLAUDE CODE

Read every word of this document. The context is as important as the requirements.

**Before writing any code:**
- Ask for the MJ Live GitHub link — inherit the patterns listed in Part 12
- Confirm which phase we are starting
- State which AI pattern each component implements

**Never:**
- Name the bank client — say "major Australian bank" or "banking client" only
- Simplify the stack — every component is deliberate and defensible
- Use MemorySaver — PostgresSaver only from Phase 0
- Merge LangGraph and CAP roles
- Hardcode LLM tool calls — use MCP tools
- Skip human-in-the-loop — it is architecturally mandatory
- Generate findings without TRBK table evidence trail
- Redesign the UI — wire it

**Always:**
- Explain each AI pattern in three ways: AI terms, banking terms, SAP terms
- Document every decision — what chosen, what rejected, why
- Build one phase at a time — confirm phase before writing code
- Wire Langfuse from Phase 0 — observability from the first agent call
- Include TRBK table names in all evidence trails
- Make agent reasoning visible in the UI — not just the output
- Keep all five angles in equal consideration

**On the two twinkle moments:**
Both must be REAL not theatrical.
Twinkle 1: Self-RAG re-query must genuinely find new information that changes the confidence from 64% to 89%. The system must be designed so this can only happen if there is genuinely new data to retrieve.
Twinkle 2: Regulatory document upload must genuinely result in zero code change. The architecture must support this — not simulate it.

**On the deliberate rejection:**
Script the exact query and expected response. Test it. Make it work cleanly. It is a feature, not a failure.

**On the three vocabularies:**
When implementing any component — write a comment explaining it in AI terms, banking terms, and SAP terms. This discipline makes the code self-documenting for three audiences.

---

## PART 16 — ADDITIONAL PATTERNS FROM SAP AI GOLDEN PATH

Two additional AI/ML patterns added after reading the SAP AI Golden Path documentation. These complement the 10 patterns in Part 8.

**11. RPT-1 — Relational Foundation Model (Tabular AI)**
AI: A foundation model pretrained on tabular data that makes predictions via in-context learning — no fine-tuning or training required. Send a feature table, get predictions back.
Banking: Credit risk scoring from borrower features — DTI, payment history, loan amount, sector — without writing any model training code.
SAP: Call via HANA Cloud SQL stored procedure or via AI Core Generative AI Hub. Available in HANA Cloud trial.

**12. HANA PAL — Embedded In-Database Machine Learning**
AI: Statistical ML algorithms running natively inside the database. No data movement, no external service call. Algorithms include isolation forest, time series anomaly detection, clustering.
Banking: Payment anomaly detection on DFKKOP records — identify borrowers whose payment pattern has suddenly changed. Statistically rigorous. No hallucination risk.
SAP: PAL (Predictive Analytics Library) built into HANA Cloud. Called via SQL. Enabled by AFL__SYS_AFL_AFLPAL_EXECUTE permission on the HDI container.

**Why these matter architecturally:**
The right question is never "can the LLM do this?" — it is "what is the best tool for this specific task?" RPT-1 and PAL are better than LLM for tabular and statistical tasks. LLM is better than RPT-1 and PAL for reasoning, narrative, and policy interpretation. Using both in the same pipeline — and being able to explain why — is the definition of AI architect thinking.

---

## THE ONE RULE

Document as you build. Not after.

For every decision: what you chose, what you considered and rejected, why.

That record is what separates a prototype from a proposal, and a proposal from a contract.

---

*Five angles. Equal weight. Two genuine twinkle moments. One deliberate rejection. Three vocabularies throughout.*

*Build it like a senior AI architect who understands banking regulation, SAP enterprise architecture, and modern AI engineering simultaneously.*

*The client context is a major Australian bank. The specific name is never mentioned anywhere in code, comments, or documentation.*
