# Banking Sentinel — Project Memory
## For Claude Code — New Conversation Handoff
## Last updated: 2026-05-25 (Session 6 — Phase 7 complete, Phase 8 next)

---

## WHAT THIS FILE IS

This is the living memory file for Banking Sentinel. Read this at the start of every new conversation before touching any code. Update it after every build session.

---

## PROJECT OVERVIEW

A multi-agent AI risk intelligence system deployed on SAP BTP that monitors SAP Transactional Banking (TRBK) data. It traverses connected party relationships across the TRBK graph, retrieves regulatory context via RAG, coordinates five specialist AI agents, and generates an APRA-ready risk brief — surfacing what human analysts miss.

**This prototype cements a contract. Build it properly.**

---

## REPO STRUCTURE

```
C:\Dev\Banking-Sentinel\
  v0-source-files/                    ← all source documents live here
    CONTEXT.md                        ← DEFINITIVE context (v5) — authoritative single source
    MEMORY.md                         ← THIS FILE — living session state + decisions log
    TRBK-Reference.md                 ← SAP TRBK table structure + synthetic data design
    Banking-Problems.md               ← Real banking problems this prototype solves (generic ADI)
    Banking-Sentinel-AustralianBank.html ← Light Bloomberg-style UI — CHOSEN for client demo
    Banking-Sentinel-Bloomberg.html   ← Deep navy Bloomberg terminal UI — for blog audience

  Data/
    ABusinessPartner.json             ← 100 real SAP sandbox BPs (pulled from SAP Business Accelerator Hub)
    ABPRelationship.json              ← 988 BP relationships from sandbox
    ABusinessPartnerRole.json         ← 1000 BP role records from sandbox

  Data/processed/                     ← Generated TRBK data layer (synthetic, real SAP field names)
    story-mapping.json                ← Master mapping: real BP IDs → story roles (B-001, G-001 etc.)
    BCA_LOAN_HDR.json                 ← 30 loans (25 credit + 5 term deposits)
    BCA_LOAN_COND.json                ← 25 loan conditions (interest rates)
    BCA_LOAN_SCHED.json               ← 24 repayment schedule entries
    BCA_GUARANTOR.json                ← 10 guarantor assignments (graph edges)
    BKKN.json                         ← 30 BP → contract account links
    BUT050.json                       ← 5 connected party relationships
    BCA_SECTOR.json                   ← 24 sector classifications
    BCA_DTI.json                      ← 11 DTI ratios (1 breach)
    DFKKOP.json                       ← 9 open items (5 overdue = risk signal)
    DFKKZP.json                       ← 10 payment records
    RISK_THRESHOLD.json               ← 5 APRA regulatory thresholds
    gen_*.js                          ← Generator scripts (keep for regeneration)
```

---

## MJ LIVE — READ FIRST

Banking Sentinel extends MJ Live patterns. Full MJ knowledge is saved at:
`C:\Users\shahi\.claude\projects\C--\memory\project_mj_context.md`

**Key patterns that carry forward:**
- SAP CAP Node.js as application layer
- HANA Vector RAG (cosine similarity)
- LangChain for orchestration (LangGraph for multi-agent)
- Solace AEM for real-time UI events
- BTP CF deployment via manifest.yml (SQLite dev / HANA prod)
- **CRITICAL BUG:** Never use LangChain `ChatAnthropic` for Claude Opus 4.7 — `top_p: -1` causes failures. Use Anthropic SDK directly.

---

## THE FIVE AGENTS

| Agent | Pattern | Job |
|---|---|---|
| Agent 1 — Intake | Router | Parses NL query, identifies customer, routes to specialists |
| Agent 2 — Graph Traversal | ReAct loop | Multi-hop TRBK graph traversal via HANA (BP2000, BCA_GUARANTOR, DFKKOP) |
| Agent 3 — Policy | Hybrid RAG + HyDE | APRA standards retrieval from HANA Vector |
| Agent 4 — Risk Scoring | Reflection | Scores 4 risk dimensions, re-queries if confidence < 75% |
| Agent 5 — Recommendation | Synthesis | Generates APRA-ready risk brief with evidence trail |

---

## THE DATA STORY — REAL SAP BP IDs MAPPED TO RISK ROLES

All borrowers and guarantors are **real SAP sandbox BPs** from the Business Accelerator Hub.
Loan/guarantor/overdue data is synthetic but uses real SAP field names.

| Story Role | Real BP ID | Name | Risk |
|---|---|---|---|
| B-001 | 30100001 | Domestic Customer AU 1 | Overdue 81 days on L-001, 50 days on L-002 |
| B-002 | 30100002 | Domestic Customer AU 2 | Overdue 30 days on L-003 |
| B-003 | 30100003 | Domestic Customer AU 3 | DTI 7.2 — APRA breach (limit 6.0) |
| B-004 | 30100004 | Domestic Customer AU 4 | Overdue 15 days on L-005 |
| B-005 | 30100005 | Domestic Customer AU 5 | Performing — guarantor G-002 |
| G-001 | **30910005** | **Rose Courtney** | Guarantor for B-001, B-002, B-003, B-004. Total exposure AUD 6.18M — breaches APS 221 single limit of 5M |
| G-002 | **30910006** | **Eric Miller** | Guarantor for B-005. Connected to G-001 via family trust. Group exposure AUD 9.68M — breaches APS 221 group limit of 7.5M |
| G-003 | 30910007 | George Clark | Guarantor for B-008, B-009. Performing. |
| G-004 | 30910008 | Alex Baker | Guarantor for B-010, B-011. Performing. |

**Connected party link:** G-001 and G-002 are both contacts for BP 30100001 (real BUR001 RelNum 13 from sandbox). Synthetic BUT050 record adds explicit FAMILY_TRUST_MEMBER relationship.

**Sector concentration:** BPs 30100001, 30100002, 30100003, 30100004, 30100008, 30100013, 30100021, 30100024, 30100081, 30186005 all in RETAIL_PROP sector.

---

## SAP SANDBOX DATA — WHAT WAS PULLED

API: `https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/API_BUSINESS_PARTNER`
Header: `apikey: <SAP_BTP_API_KEY from .env>`

| File | Endpoint | Records |
|---|---|---|
| ABusinessPartner.json | /A_BusinessPartner | 100 |
| ABPRelationship.json | /A_BPRelationship | 988 |
| ABusinessPartnerRole.json | /A_BusinessPartnerRole | 1000 |

**If more data is needed next session:** Pull additional endpoints — A_BPFinancialServicesExtn, A_BPCreditWorthiness, A_BusinessPartnerBank. The sandbox is still available, API key is in .env. Switch to personal hotspot if on corporate network (DNS blocks sandbox.api.sap.com).

---

## KEY RISK PATTERNS THE AI MUST FIND

1. **APS 221 Single Guarantor Breach:** G-001 (Rose Courtney, BP 30910005) guarantees 4 loans. Total exposure AUD 6.18M. Limit: AUD 5M. **BREACH.**
2. **APS 221 Group Exposure Breach:** G-001 + G-002 (Eric Miller, BP 30910006) are connected via family trust (BUT050). Combined exposure AUD 9.68M. Limit: AUD 7.5M. **BREACH.**
3. **Sector Concentration:** 10 borrowers in RETAIL_PROP sector. Combined exposure approaching internal 25% limit.
4. **DTI Breach:** B-003 (30100003) has DTI 7.2 vs APRA February 2026 limit of 6.0. Loan approved pre-activation. **BREACH.**

---

## FULL TECH STACK

| Layer | Tool |
|---|---|
| Data source | SAP TRBK synthetic data (real table names) |
| Integration | SAP BTP CPI (3 jobs: data ingestion, AI gateway, event publishing) |
| Graph | SAP HANA Cloud (relationship traversal in CAP) |
| Vector | SAP HANA Cloud Vector Store (APRA standards + bank policy) |
| App layer | SAP CAP Node.js |
| Orchestration | LangGraph |
| LLM | Claude API (claude-sonnet-4-6 for agents, claude-opus-4-7 for risk brief) |
| Events | Solace Advanced Event Mesh |
| Observability | Langfuse |
| Evaluation | RAGAS |
| Frontend | Vanilla JS — three panel layout (already built) |

---

## BUILD PHASES — CURRENT STATUS (updated 2026-05-27)

| Phase | What | Status |
|---|---|---|
| 0 | SAP sandbox data pulled + TRBK synthetic data layer generated | ✅ DONE |
| 1 | CAP scaffold + HANA Cloud schema + seed + 6-hop traversal verified | ✅ DONE |
| 2 | HANA Vector — APRA standards embedded, Hybrid RAG, HyDE, RAGAS eval | ✅ DONE (2026-05-24) |
| 3 | LangGraph StateGraph + Intake Agent + A2A endpoint + MCP tools | ✅ DONE (2026-05-24) |
| 4 | Pattern Agent — RPT-1 (rpt.cloud.sap) + PAL Isolation Forest EXPLAIN + LLM simultaneously | ✅ DONE (2026-05-24) |
| 4b | Relationship Agent — ReAct loop (max 6 steps), GraphDB SPARQL graph traversal, APS 221 check | ✅ DONE (2026-05-24) |
| 5 | Trajectory Agent + Synthesis Agent + Human-in-the-loop (interruptBefore humanApproval) | ✅ DONE (2026-05-24) |
| 6 | Reflection — real LLM confidence evaluation (4 dimensions) + targeted re-query loop | ✅ DONE (2026-05-25) |
| 7 | Solace events (graph.stream) + Twinkle 2 (APRA sync) + UI wired + security hardening | ✅ DONE (2026-05-25) |
| 8 | HDI deploy + PAL investigation + Langfuse + RAGAS baseline | ✅ DONE (2026-05-25) |
| 9 | UI polish sprint — graph chain, agent ordering, severity badges, admin redesign, graph modal | 🔄 IN PROGRESS (2026-05-27) |
| 9a | Education popup rework (needs full redesign) | 🔲 NEXT |
| 9b | RAGAS faithfulness fix (current 0.25, target > 0.85) | 🔲 PENDING |
| 10 | BTP CF deployment + architecture diagram + demo video + blog post | 🔲 PENDING |

### CRITICAL ARCHITECTURE NOTE (discovered 2026-05-27):
Backend execution order is trajectory (a4) → relationship (a3), NOT a3 → a4.
Relationship agent uses trajectory DTI forward position as context. This is correct and intentional.
UI labels do NOT match execution order — do not "fix" the LangGraph edge order to match UI numbering.

---

## UI — TWO VARIANTS (already built, earlier versions retired)

| File | Theme | Use |
|---|---|---|
| Banking-Sentinel-AustralianBank.html | Light Bloomberg-style, yellow accent | Client demo — CHOSEN |
| Banking-Sentinel-Bloomberg.html | Deep navy, IBM Plex, blue grid | Blog audience |

**Chosen UI:** `Banking-Sentinel-AustralianBank.html` — light Bloomberg-style, yellow accent.

---

## DECISIONS LOG

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| UI variant | Banking-Sentinel-AustralianBank.html (light, yellow accent) | Dark editorial, Bloomberg terminal | User selected |
| DB strategy | HANA Cloud from day 1 | SQLite-first (MJ Live pattern) | V5 never mentions SQLite. HANA PAL, RPT-1, Knowledge Graph Engine cannot be simulated in SQLite. Confirmed Session 3. |
| LLM split | Anthropic (claude-sonnet-4-6 for agents, claude-opus-4-7 for risk brief) + OpenAI (text-embedding-3-small for HANA Vector) | Claude-only or OpenAI-only | Same split as MJ Live — Claude for intelligence, OpenAI for embeddings |
| Data source | SAP Business Accelerator Hub sandbox as primary (real SAP BPs) + synthetic TRBK loan/risk layer on top | Client data (not allowed) / fully synthetic | Cannot use client data. Using real SAP BPs makes the story credible with bank architects. |
| BP relationship table | BUT050 / BUT051 | BP2000 (doesn't exist in TRBK) | Confirmed by bank architects in session. BP2000 is NOT a real TRBK table. |
| Agent model | claude-sonnet-4-6 for agents (speed/cost), claude-opus-4-7 for final risk brief | All Opus or all Haiku | Balance cost vs quality. Risk brief needs Opus reasoning. Agents need speed. |
| Graph traversal — dev | Sequential SQL queries in ReAct agent loop | HANA Graph from day 1 | SQLite has no graph engine. Build logic in SQL first, swap to HANA Graph on prod. |
| Graph traversal — prod | HANA Graph Workspace + openCypher (same syntax as Neo4j) | Plain SQL joins | HANA Cloud has native graph engine. One openCypher query replaces the multi-hop ReAct loop. Cleaner, faster, more impressive in the demo. |
| HANA Cloud from day 1 | HANA Cloud direct | SQLite-first | V5 never mentions SQLite. HANA PAL/RPT-1/Graph Engine don't work in SQLite. Confirmed Session 3. |
| BUT050 field names | RELTYP: String(30), RELATIONSHIP_TYPE mapped | String(6) in v5 | Data uses full strings like FAMILY_TRUST_MEMBER (18 chars). Schema updated, redeployed. |
| DFKKOP/BKKN VKONT | String(20) | String(12) in v5 | CA-30100001-01 is 14 chars. String(12) too small. Updated schema. |
| DFKKZP key field | ZPBEL mapped to PAYMENT_ID | PAYMENT_ID in data | SAP field is ZPBEL (payment document). Mapped in seed script. |
| BCA_GUARANTOR key | GUARANTOR_PARTNER | GUARANTOR in v5 | Real SAP field name confirmed from generated data. Schema updated. |
| Sector on Loans | Null — sector lives in BCA_SECTOR per BP | Sector on Loan record | Sector concentration analysis requires: Loans → BKKN → BusinessPartners → BCA_SECTOR join. Not a direct filter on Loans.SECTOR_CODE. |
| CDS bind --exec | Use for standalone scripts hitting HANA | CDS_ENV=hybrid alone | CDS_ENV=hybrid alone doesn't resolve CF bindings. cds bind --exec does. Pattern: cds bind --exec node scripts/xxx.js |
| Langfuse integration | langfuse package directly | langfuse-langchain | langfuse-langchain locked to @langchain/core v0.3.x — incompatible with LangGraph v1.x (@langchain/core v1.x). langfuse package exports its own CallbackHandler that works with LangGraph v1.x. |
| Source file cleanup (Session 3) | Renamed 4 files, deleted 4 files, kept 6 | Keep all files | Renamed: Context-v5→CONTEXT.md, Project-Memory→MEMORY.md, Task1→TRBK-Reference.md, Task2→Banking-Problems.md. Deleted: Task2-CBA (named client), Task4-context (pre-v5), Task3-UI.html + Task3-UI-1.html (retired per CONTEXT.md). |
| PostgreSQL provider | Supabase (already provisioned) | Neon, Railway | Already provisioned. Connection string added to .env as POSTGRES_URL. |
| Solace VPN | mj-live (reuse existing service) | New dedicated service | Same Solace service as MJ Live. Banking Sentinel uses different topic prefix (banking/*). |
| Anomaly detection default | PAL (HANA statistical) | LLM | Per CONTEXT.md — PAL for bulk screening, LLM for explanation. ENV switch keeps both demonstrable. |

---

## OPEN QUESTIONS (confirm before Phase 1)

1. HANA Cloud instance available on BTP — or build CAP scaffold local-first with SQLite first?
2. ~~Claude API key~~ ✅ DONE
3. Do we need more SAP sandbox data? (BPFinancialServicesExtn, BPCreditWorthiness available).
4. Any additional risk patterns the bank architects want demonstrated?
5. ~~POSTGRES_URL~~ ✅ DONE — Supabase connection string set in .env
6. ~~LANGFUSE keys~~ ✅ DONE — all three Langfuse keys set in .env
7. ~~SOLACE_VPN~~ ✅ DONE — set to mj-live (reusing existing Solace service)
8. ~~ANOMALY_DETECTION_MODE~~ ✅ DONE — set to PAL

## .ENV STATUS (as of 2026-05-22) — ALL KEYS SET ✅

| Key | Status |
|---|---|
| ANTHROPIC_API_KEY | ✅ |
| OPENAI_API_KEY | ✅ |
| SOLACE_URL / VPN / USERNAME / PASSWORD | ✅ |
| HANA_HOST / PORT / USER / PASSWORD | ✅ |
| LANGFUSE_PUBLIC_KEY / SECRET_KEY / HOST | ✅ |
| POSTGRES_URL (Supabase) | ✅ |
| SAP_RPT_API_KEY | ✅ |
| ANOMALY_DETECTION_MODE=PAL | ✅ |
| CF / CPI / SAP Gen AI Hub credentials | ✅ |

---

## CRITICAL GAPS CLOSED — SESSION 3 (2026-05-22)

These were identified as missing from Claude Code's initial understanding. Confirmed and locked in before Phase 1.

**Data vs v5 discrepancies — confirmed in actual seeded data**
- v5 says B-001 has DTI 7.2. Actual data: B-001 DTI = 5.8, B-003 (30100003) has DTI = 7.2. Risk pattern is correct, assignment is different.
- v5 says B-001 overdue 61 days. Actual data: B-001 overdue 81 days (OP-L001-001) and 50 days (OP-L001-002). Pattern is stronger, not weaker.
- Group exposure verified: G-001 ($6.18M single) + G-002 combined = $9.68M vs $7.5M limit = 129.1% utilisation.
- All 4 risk patterns confirmed in HANA Cloud via verify-patterns.js. Twinkle 1 CONFIRMED.

**BUT050 not BP2000**
Work from BUT050/BUT051. V5 text still says BP2000 in some places — known gap. Do not update v5. BUT050 is the correct working table confirmed by bank architects.

**RAGAS — run after Phase 1**
V5 Part 7 defines 20 evaluation questions. Must run RAGAS after Phase 1 to verify all four hidden patterns are correctly seeded. Faithfulness target > 0.85 before proceeding to Phase 2.

**Responsible AI guardrails — validateAgentOutput()**
Architectural layer between every agent node. Four checks: schema validation, evidence check, confidence check (≥0.40 = refuse), hallucination check. Not behavioural — structural.

**CPI three jobs — non-negotiable**
1. Scheduled data ingestion iFlow (CSV → HANA)
2. Governed AI gateway (all LLM calls, API key management, audit trail)
3. Risk/regulatory event publishing to Solace

**Solace topic structure — five topics**
banking/pipeline/status, banking/risk/findings, banking/human/approval, banking/trbk/payment_event, banking/regulatory/update, banking/session/reset

**A2A endpoint on CAP**
/a2a/agent exposed as JSON-RPC 2.0. One endpoint — custom HTML UI now, Joule in enterprise. Meets SAP job A2A requirement.

**Agent reasoning types — prompts must reflect these exactly**
- Pattern Agent: something feels wrong before any rule fires
- Relationship Agent: nature and strength of connections, not just existence
- Trajectory Agent: conflicting signals resolved first, then trajectory
- Synthesis Agent: hold contradictions, confidence under uncertainty + policy retrieval inseparable

**RPT-1 sequence is architecturally mandatory**
Pattern Agent calls RPT-1 via HANA SQL FIRST → structured score → THEN LangGraph agents reason OVER it. Full sequence: RPT-1 → PAL/LLM → HANA Knowledge Graph → LangGraph reasoning.

**CAP / CDS vector syntax — revisit when CDS 10 releases**
Current schema uses EMBEDDING as LargeString (JSON array). CDS 10 introduces native Vector(1536) type with built-in cosine similarity operators. When CDS 10 is available: update RegulatoryDocuments.EMBEDDING to Vector(1536), use @cds.search annotation for hybrid search, and switch to native CDS vector search instead of raw SQL. Track CDS release notes at cap.cloud.sap. File to update: db/schema.cds line ~170 (EMBEDDING field) and any vector query code in srv/.

**HANA Knowledge Graph Engine ≠ standard HANA Graph Engine**
AI-native, separate engine. SAP AI Golden Path recommended. Must use this, not standard HANA Graph.

**Cost tracking in every analysis**
totalInputTokens + totalOutputTokens → AUD cost → AuditLog → Langfuse. Part of BankingSentinelState.

**DB strategy correction**
HANA Cloud from day 1. Not SQLite-first. V5 never mentioned SQLite — that was a MJ Live pattern incorrectly inherited. HANA PAL, RPT-1, and Knowledge Graph Engine cannot be simulated in SQLite.

---

---

## PHASE 2 DECISIONS LOG (2026-05-24)

**What was built in Phase 2:**
- 5 synthetic APRA regulatory documents created: APS 221, DTI Limit Notice Feb 2026, CPS 230, Credit Policy §7.3, APS 112
- 29 chunks embedded into HANA Cloud RegulatoryDocuments table via OpenAI text-embedding-3-small
- Three retrieval approaches tested: Basic Vector Search, Hybrid RAG, HyDE (Hypothetical Document Embeddings)
- RAGAS evaluation: faithfulness = 1.0 / 9 questions all PASS (target was 0.85)
- All HANA tables exported to Data/exports/ as CSV files (17 tables, including RegulatoryDocuments with full embedding)

**Key decisions:**

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Regulatory documents | Synthetic (written from v6 spec) | Fetch from live APRA URLs now | Live fetch is Phase 7 (Twinkle 2). Phase 2 needs ground-truth content to verify RAGAS. Synthetic documents match the 20 RAGAS question answers exactly. |
| RAGAS library | Custom GPT-4o-mini judge evaluator | RAGAS pip package | RAGAS 0.3.x and 0.4.x have broken import: langchain_community.chat_models.vertexai was moved to langchain-google-vertexai. All available RAGAS versions fail on import. Custom evaluator implements same faithfulness metric: judge LLM scores whether claims in answer are supported by retrieved context. |
| Embedding model | OpenAI text-embedding-3-small (1536d) | Claude (no embedding endpoint) / HANA PAL vectors | OpenAI is the established embedding standard. Claude API has no embeddings endpoint. Consistent with MJ Live. |
| Hybrid RAG approach | Vector cosine similarity + keyword overlap (Node.js) | HANA Full Text Search (CREATE FULLTEXT INDEX) | HANA FTS requires .hdbfulltextindex HDI artifact — more complex. Node.js keyword scoring demonstrates the concept correctly and produces the same ranking. Upgrade to HANA FTS in Phase 5 when CAP service layer is built. |
| HyDE approach | Claude generates hypothetical answer → embed → search | Query expansion via LLM rewrites | HyDE is the established RAGAS pattern. Hypothetical document embedding shows clearest improvement: 0.87 vs 0.63 similarity for same question. |
| Vector storage | LargeString (JSON array) | HANA native REAL_VECTOR | CDS 8.9 does not expose Vector(1536) natively. REAL_VECTOR type available in HANA but requires HDI artifact. Upgrade to Vector(1536) when CDS 10 releases. COSINE_SIMILARITY(TO_REAL_VECTOR(...)) works in native HANA SQL — available for future optimisation. |

**Key HyDE finding:**
HyDE similarity scores = 0.87 vs 0.63 for basic vector search on same question.
Reason: regulatory questions are phrased as questions. APRA documents are written as declarative statements.
HyDE generates the declarative answer first, then searches. Vector space alignment improves significantly.
This is pattern 3 (HyDE) in the v6 10 AI patterns. Blog content: "Banking regulatory questions are sparse queries — HyDE generates the hypothetical APRA clause before searching."

**v6 context added this session (pulled from GitHub):**
- SAP AI Golden Path deep read — three new capabilities: HANA Knowledge Graph Engine, RPT-1, HANA PAL
- Part 15 — four demo scenarios documented
- Part 17 — RPT-1 and PAL as patterns 11 and 12
- SAP and Anthropic Sapphire 2026 partnership noted
- Phase 3 now follows v6 architecture exactly (not v5)

**Files created in Phase 2:**
- Data/regulatory/aps-221.json (8 sections)
- Data/regulatory/dti-notice-feb2026.json (6 sections)
- Data/regulatory/cps-230.json (6 sections)
- Data/regulatory/credit-policy-7-3.json (6 sections)
- Data/regulatory/aps-112.json (3 sections)
- scripts/embed-documents.js — loads regulatory docs, calls OpenAI, inserts 29 chunks into HANA
- scripts/test-rag.js — smoke tests three retrieval approaches, generates Data/ragas-dataset.json
- scripts/ragas-eval.py — faithfulness evaluation (custom, no RAGAS lib dependency)
- scripts/export-csv.js — exports all 21 HANA entities to Data/exports/ CSVs

---

## PHASE 3 DECISIONS LOG (2026-05-24)

**What was built in Phase 3:**
- Full LangGraph StateGraph: 9 nodes, conditional routing, PostgresSaver → MemorySaver fallback for local dev
- Intake Agent: classifies SIMPLE_DATA_QUERY | RISK_ANALYSIS | INAPPROPRIATE_REQUEST (claude-sonnet-4-6, 300 tokens)
- Simple Query Node: fetches 6 HANA stat packages, Claude answers from portfolioContext — no agent pipeline overhead
- Rejection Node: APRA CPS 230 refusal logged to AuditLog. REFUSAL = "I am a risk intelligence system..."
- 5 stubs: patternAgentStub, relationshipAgentStub, trajectoryAgentStub, reflectionNode, humanApprovalNode, synthesisAgentStub
- 5 MCP tools: hana_relational_query, hana_vector_search (with HyDE), hana_graph_traverse, apra_threshold_check, exposure_calculator
- validateAgentOutput(): 0.40 threshold = REFUSE, missing evidenceSource = FLAG, 0.70 threshold = REQUERY
- A2A endpoint: POST /a2a/agent (JSON-RPC 2.0), GET /a2a/health — mounted before CDS OData routes
- Langfuse: manual trace per request (langfuse package, not langfuse-langchain)
- AuditLog: every request persisted to HANA with tokens, cost, latency

**Milestone verified (2026-05-24):**
- `GET /a2a/health` → `{ status: 'ok', graph: 'ready', langfuse: 'connected' }` ✅
- Simple query: "What is the total loan amount?" → AUD 31,773,000 across 30 loans (responseType: simple_query) ✅
- Deliberate rejection: "Approve the loan for B-001" → APRA refusal message (responseType: rejection) ✅
- Risk analysis: "Analyse credit risk for B-001" → full pipeline, Reflection ran 2 loops, synthesisResult returned (responseType: risk_analysis) ✅

**Key bugs fixed in Phase 3:**
- Supabase free-tier PostgreSQL pauses after 1 week of inactivity → MemorySaver fallback (local dev only; PostgresSaver for prod)
- Reflection infinite loop: reflectionNode returned `{}` so requeryCount stayed 0 → fixed to increment requeryCount each pass
- `cds watch` without `--profile hybrid` drops HANA binding → must use `cds watch --profile hybrid` for local dev

**Key decisions Phase 3:**

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| PostgreSQL fallback | MemorySaver for local dev | Hard fail if Supabase paused | Supabase free tier pauses. Local dev shouldn't require live PostgreSQL. Production always uses PostgresSaver. |
| Langfuse integration | langfuse package (manual trace) | langfuse-langchain | Already confirmed in Phase 2 session. langfuse-langchain locked to @langchain/core v0.3.x, incompatible with LangGraph v1.x. |
| MCP tools location | srv/tools/mcp-tools.js (plain functions) | Real MCP server (stdio) | Phase 3 wires tools as functions called by agents. Real MCP server protocol in Phase 7 when Solace events added. |
| Reflection loop cap | requeryCount incremented in reflectionNode | Separate counter in checkConfidence | Cleanest state update. reflectionNode returns `{ requeryCount: (state.requeryCount + 1) }`. checkConfidence reads it. Cap at 2 re-queries before forcing proceed. |

**Files created in Phase 3:**
- srv/banking-sentinel-service.cds — CAP service: analyseRisk, approveRiskBrief, uploadRegulatoryDocument, resetSession
- srv/graph/state.js — BankingSentinelState (Annotation.Root) with all fields and reducers
- srv/graph/banking-sentinel.js — StateGraph: 9 nodes, conditional edges, PostgresSaver + MemorySaver fallback
- srv/agents/intake-agent.js — Intake Agent + routeFromIntake()
- srv/agents/simple-query.js — Simple Query Node: 6 HANA queries + Claude answer
- srv/agents/rejection.js — Rejection Node: APRA refusal + AuditLog insert
- srv/agents/stubs.js — 6 stubs for Phases 4–6 (pattern, relationship, trajectory, reflectionCheck, humanApproval, synthesis)
- srv/tools/mcp-tools.js — 5 MCP tools (functions, not real MCP server yet)
- srv/guardrails/validate.js — validateAgentOutput() guardrails
- srv/server.js — CAP server: bootstrap A2A endpoint, LangGraph graph init, Langfuse, AuditLog

---

## PHASE 4 DECISIONS LOG (2026-05-24)

**What was built:**
- Pattern Agent (`srv/agents/pattern-agent.js`) — RPT-1 + PAL Isolation Forest EXPLAIN + LLM all run simultaneously (never gated by ENV switch)
- RPT-1: POST to `rpt.cloud.sap/api/predict`. In-context learning with [PREDICT] placeholder. Tested live — HTTP 200, HIGH confidence 0.98
- PAL: Anonymous DO block via `_SYS_AFL.PAL_ISOLATION_FOREST` + `_SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN`. LABEL=-1 = outlier. REASON_CODE = feature attribution
- LLM: claude-haiku-4-5-20251001 (fast), returns JSON `{anomalies: [...]}`
- Combined anomaly list forwarded to Synthesis: PAL outlier texts + LLM narrative texts
- `patternAssessment` shape: `{riskScore, riskLevel, confidence, signal, rpt1, pal, llm, anomalies}`
- Routing: score < 30 → low_risk → skip Relationship + Trajectory; score >= 30 → high_risk → full pipeline

**Key decisions Phase 4:**

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| All three methods | Always run simultaneously | ENV switch gate | Educational popup requires all three outputs. ANOMALY_DETECTION_MODE is UI display preference only, not execution gate |
| RPT-1 endpoint | rpt.cloud.sap consumer API (Bearer SAP_RPT_API_KEY) | SAP AI Core | AI Core not available on BTP trial |
| PAL call pattern | Anonymous DO block via cds.run() | hana-ml Python | Node.js project. cds.run() with raw SQL DO block works cleanly via HDI technical user |
| PAL param table | PARAM_NAME, INT_VALUE, DOUBLE_VALUE, STRING_VALUE | Positional params | PAL spec requires named parameter table — confirmed from AFL documentation |

**Bug investigated 2026-05-25:** Initially "fixed" DFKKOP query from `{ GPART: customerId }` to `{ PARTNER: customerId }`. This was WRONG. Schema.cds clearly defines DFKKOP with `GPART: String(10)` (SAP FI-CA field name). DFKKZP uses `PARTNER`, not DFKKOP. Reverted to `{ GPART: customerId }`. GPART is correct.

---

## PHASE 4b DECISIONS LOG (2026-05-24)

**What was built:**
- Relationship Agent (`srv/agents/relationship-agent.js`) — ReAct loop, max 6 steps
- Tools available to agent: hana_graph_traverse (SPARQL over GraphDB), exposure_calculator, apra_threshold_check
- Agent returns: `{ relationshipMap: { nodes, edges, groupExposure, aps221Pct, confidence, finding } }`
- LLM bound with tools via `.bindTools(TOOLS)` — Claude tool use format

**Graph engine hierarchy followed (SAP AI Golden Path replacement rule):**
1. HANA KGE Triple Store (SPARQL) → NOT on BTP trial (not in Additional Features)
2. HANA GRAPH_TABLE SQL function → NOT on BTP trial ("incorrect syntax near MATCH" on all variants; preview feature only)
3. GraphDB (Graphwise sandbox) → **IMPLEMENTED** — true RDF triple store, same W3C SPARQL standard as KGE

**GraphDB implementation:**
- Graphwise sandbox (free, expires every 7 days): `https://t5f027c83a0e2488da5e.sandbox.graphwise.ai`
- Repository: `banking-sentinel` | 4035 RDF triples | 1000 partners | 12 BUT050 relationships
- SPARQL traversal from 30100003 finds 7 connected parties including TrustCo Holdings (4 hops)
- Hop counts via UNION of fixed-length paths (SPARQL property paths don't return path depth)
- Production swap: change GRAPHDB_ENDPOINT to HANA KGE endpoint — SPARQL queries are identical
- **Restore after 7-day sandbox expiry:** `npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid`

**BUT050 enrichment — Twinkle 1 chain (run enrich-but050.js):**
```
30100003 →[FAMILY_TRUST_MEMBER]→ 30910005 →[FAMILY_TRUST_MEMBER]→ 30910006
         →[SUBSIDIARY]→ 30910009 (TrustCo Group) →[PARENT_COMPANY]→ 30910010 (TrustCo Holdings)
```
30100001 and 30100002 also connected to TrustCo Group → APS 221 connected party group breach.

**Admin UI:** `/admin` → tab "GraphDB (KGE)" shows: triple count, live SPARQL traversal from 30100003, sample RDF triples.

**HANA BP_RELATIONSHIP_GRAPH workspace** (`db/src/BP_RELATIONSHIP_GRAPH.hdbgraphworkspace`) deployed as HDI artifact — production upgrade path when GRAPH_TABLE goes GA.

---

## PHASE 5 DECISIONS LOG (2026-05-24)

**What was built:**
- Trajectory Agent (`srv/agents/trajectory-agent.js`) — BCA_DTI.INCOME_EXPIRY → forward DTI calculation; conflicting signal resolution
- Synthesis Agent (`srv/agents/synthesis-agent.js`) — HANA Vector search on APRA docs + APRA-ready risk brief; persists to RiskAssessments HANA table
- Human Approval Node (`srv/agents/human-approval.js`) — pass-through node after LangGraph interruptBefore halt
- `interruptBefore: ['humanApproval']` wired in banking-sentinel.js compilation
- PostgresSaver checkpointer wired throughout — state survives CF restarts

**Key decisions Phase 5:**

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Forward DTI model | total_debt / (income × days_remaining/365) | Simple current DTI | Models actual servicing burden after contract expiry, not just today's ratio |
| Synthesis model | claude-haiku-4-5-20251001 (800 tokens) | claude-opus for final brief | Keep cost low for prototype. Phase 9 upgrade to claude-opus-4-7 for client demo |
| Risk brief persistence | INSERT into RiskAssessments with session_id | In-memory only | APRA CPS 230 auditability — every assessment must be logged |
| HyDE in synthesis | useHyDE: false | HyDE enabled | Synthesis builds its own rich query from all agent signals — HyDE adds latency without enough benefit here |

**Full pipeline confirmed LIVE (2026-05-24):**
intake → pattern → relationship → trajectory → reflectionCheck → [interrupt] → humanApproval → synthesis → END

---

## PHASE 6 DECISIONS LOG (2026-05-25)

**What was built:**
- Real Reflection: `srv/agents/reflection.js` — LLM (claude-haiku-4-5-20251001) evaluates its own output across 4 dimensions
- 4 dimensions: graph completeness, signal consistency, conflicting signals, evidence trail
- Output: `{ overallConfidence: 0.0-1.0, gaps: [], reQueryHint: "...", reasoning: "..." }`
- `checkConfidence()` reads `reflectionEvaluation.overallConfidence` — threshold 0.70, max 2 re-queries
- Relationship Agent: detects re-query run via `requeryCount > 0`, uses targeted prompt with `reQueryHint`
- Re-query prompt: "Previous traversal incomplete. Focus: [reQueryHint]. Previous nodes found: [...]"
- `state.js` updated: added `reflectionEvaluation` and `reQueryHint` Annotation fields
- `stubs.js` cleaned: all stubs promoted to real implementations. File exports empty object.
- `scripts/enrich-synthetic-data.js`: 80 DFKKOP rows for PAL baseline + 15 BCA_DTI rows for RPT-1 diversity
- PostgresSaver: `connectionTimeoutMillis: 5000` to fail fast when Supabase is paused (local dev safety)

**Key decisions Phase 6:**

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Reflection LLM | claude-haiku-4-5-20251001 (400 tokens max) | claude-sonnet | Low cost — this is a meta-evaluation call, not primary reasoning |
| Confidence threshold | 0.70 | 0.75, 0.80 | Matches v6 architecture spec. Not too tight, not too loose. |
| Re-query max | 2 | 3, unlimited | Prevents infinite loop. After 2 re-queries, proceed regardless. |
| reQueryHint format | Natural language instruction | Structured JSON | Relationship Agent receives it as part of system prompt — natural language is cleaner |
| PAL synthetic data | 70 on-time + 10 minor-late DFKKOP rows | No synthetic data | PAL Isolation Forest is unsupervised — needs a "normal" distribution baseline. 5 overdue rows alone not enough. |
| RPT-1 synthetic data | 15 BCA_DTI rows spanning DTI 1.2–7.8 | No synthetic data | RPT-1 in-context learning needs diverse label examples (LOW/MEDIUM/HIGH/BREACH) |

---

## PHASE 7 DECISIONS LOG (2026-05-25)

**What was built (Phase 7 — complete 2026-05-25):**
- `srv/events/solace-publisher.js` (NEW) — centralized Solace publisher, 5 topic functions, fire-and-forget pattern
- `srv/server.js` (UPDATED) — replaced `graph.invoke()` with `graph.stream()` for per-node Solace events
- `srv/rag/apra-embedder.js` (NEW) — Twinkle 2: PDF → chunks (800 chars, 100 overlap) → OpenAI embeddings → HANA RegulatoryDocuments
- Added `POST /a2a/sync-apra` endpoint — triggers embedAndStoreApraDoc + publishRegulatoryUpdate event
- Added `POST /a2a/reset` endpoint — publishes banking/session/reset → UI clears all panels
- Added `pdf-parse` and `openai` to package.json (npm installed)
- Removed old inline `publishApprovalEvent()` from server.js — replaced by centralized `publishHumanApproval()`

**Event flow (Phase 7):**
```
graph.stream() → yields after each node
  → after each node: publishPipelineStatus(sessionId, nodeName, 'complete')   → banking/pipeline/status
  → on interrupt: publishHumanApproval(sessionId, {...})                       → banking/human/approval
  → after synthesis: publishRiskFindings(sessionId, synthesisResult)          → banking/risk/findings
  → on /a2a/sync-apra: publishRegulatoryUpdate(sessionId, docTitle, chunkCount) → banking/regulatory/update
  → on /a2a/reset: publishSessionReset(sessionId)                             → banking/session/reset
```

**Producer vs Consumer:**
| Role | Who |
|------|-----|
| Producer (publishes all events) | Banking Sentinel server (srv/server.js) |
| Consumer (subscribes and updates UI) | Banking-Sentinel-AustralianBank.html — all 5 Solace topics |

**graph.stream() vs graph.invoke():**
- `invoke()` = run everything, return at end. No mid-pipeline visibility.
- `stream(streamMode: 'updates')` = yields `{ nodeName: nodeState }` after each node completes. Server publishes per-node Solace events immediately.

**Key decisions Phase 7:**

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Publisher location | Centralized `srv/events/solace-publisher.js` | Inline per-agent | DRY. One connect/send/disconnect function. All 5 topics from one place. |
| Delivery mode | DIRECT (fire-and-forget) | PERSISTENT (guaranteed delivery) | UI events are display-only. A missed event just means a panel doesn't update. Pipeline cannot block on UI delivery. |
| stream mode | `streamMode: 'updates'` | `streamMode: 'values'` | 'updates' yields only changed fields per node (smaller). 'values' yields full state every time. |
| PDF chunking | 800 chars, 100 overlap | 500/50, 1000/200 | Balances context window (too large = noisy retrieval) and boundary loss (overlap preserves split sentences) |
| Embedding model | text-embedding-3-small (1536d) | text-embedding-ada-002 | Same model used in Phase 2 — consistency required for cosine similarity. Different models = incomparable vectors. |

**Additional Phase 7 deliverables (Session 6 — 2026-05-25):**
- HTML UI fully wired: SSE per-agent events update all 3 panels live
- Anomaly strings as bullet list in Pattern row; relationship finding + APS 221% in Relationship row
- Forward position, daysToExpiry, re-query count in Trajectory/Reflection row
- Synthesis: findings count + APRA Ready ✓ in agent row; full brief + recommendations in Panel 3
- Removed all hardcoded content (B-4471, fake customer names, fake alerts)
- Real logo added: `Docs/logo.png` served via `/logo.png` route
- Admin `/admin`: PostgreSQL sidebar with real COUNT(*), click-to-view, Clear All button for checkpoint tables
- Admin JS syntax error fixed: `\'` in template literal rendered as `'` → adjacent string literals → script killed. Fixed with `data-table` attributes + addEventListener
- Security hardening: 6 issues validated and fixed (see security decisions below)

**Security decisions (Phase 7 — Session 6):**

| Fix | Root Cause | Solution |
|---|---|---|
| Admin auth (HIGH) | No middleware on `/admin` routes | `adminGuard`: localhost-only; `ADMIN_TOKEN` env for token auth on BTP |
| APS 221 limit type (MEDIUM) | `aps221` queried `LIMIT_TYPE: 'SINGLE'` | Now queries `'GROUP'` for connected-party; `'SINGLE'` for single-entity |
| HANA count capped (MEDIUM) | `count: rows.length` after `.limit(200)` | Parallel `COUNT(*)` query, real total returned |
| Orphaned approve (MEDIUM) | No chunks → silent `status: 'completed'` | `chunksReceived` counter — 404 if zero chunks |
| Audit latency = 0 (LOW) | `LATENCY_MS: 0` hardcoded | `logToAuditLog(sessionId, query, answer, state, latencyMs)` — real ms |

**Reliability decisions (Phase 7):**

| Fix | Mechanism | Why |
|---|---|---|
| Relationship Agent timeout | `Promise.race([agent, 45s timeout])` | Hung LLM call froze entire pipeline |
| SPARQL timeout | `AbortSignal.timeout(8000)` on fetch | GraphDB unreachable hung silently |
| Both return structured error | `{ relationshipMap: { finding: 'timed out' } }` | UI shows error instead of "Thinking..." forever |

---

## KNOWN ISSUES / WATCH LIST

| Issue | Severity | Status |
|---|---|---|
| PAL requires AFL__SYS_AFL_AFLPAL_EXECUTE privilege on HDI technical user | Medium | Grant via HANA Cloud Cockpit if PAL fails |
| GraphDB sandbox expires every 7 days | Medium | Run `npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid` |
| synthesis-agent uses claude-haiku not claude-opus-4-7 | Low | Upgrade in Phase 9 for demo |
| ADMIN_TOKEN not set — localhost-only restriction | Low | Set before BTP deployment |

---

## PHASE 8 — UPCOMING

**Goal:** LLMOps — full observability of every AI call in the pipeline

**What to build:**
- Langfuse trace wrapping every LangGraph node (already partially wired in server.js — extend to agents)
- RAGAS evaluation: faithfulness, answer relevance, context recall — scored per synthesis run
- Token cost tracking per analysis (AUD) — already in AuditLog, add Langfuse metadata
- CF restart survival test — confirm PostgresSaver checkpoint survives CF app restart

**Key patterns:**
- AI: LLMOps — treat AI like software: trace, evaluate, improve
- Banking: APRA CPS 230 operational resilience — AI systems must be auditable
- SAP: Langfuse on BTP CF (Docker or managed) — cost dashboard for AI API usage

---

## THE ONE RULE

Document as you build. Not after. Every decision: what chosen, what rejected, why. This file is updated after every session.
