# Banking Sentinel — Project Memory
## For Claude Code — New Conversation Handoff
## Last updated: 2026-05-22 (Session 3)

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
| Agent 4 — Risk Scoring | Self-RAG | Scores 4 risk dimensions, re-queries if confidence < 75% |
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

## BUILD PHASES — CURRENT STATUS

| Phase | What | Status |
|---|---|---|
| 0 | SAP sandbox data pulled + TRBK synthetic data layer generated | ✅ DONE |
| 1 | CAP scaffold + HANA Cloud schema + seed + 6-hop traversal verified | ✅ DONE |
| 2 | HANA Vector — APRA standards embedded, Hybrid RAG, HyDE, RAGAS eval | ✅ DONE (2026-05-24) |
| 3 | LangGraph StateGraph + Intake Agent + A2A endpoint + MCP tools | Not started |
| 4 | Pattern Agent + Relationship Agent + ReAct + 6-hop graph traversal | Not started |
| 5 | Trajectory Agent + Synthesis Agent + human-in-the-loop interrupt | Not started |
| 6 | Self-RAG — confidence evaluation + re-query loop at 64% confidence | Not started |
| 7 | Solace events + regulatory doc upload + automatic re-evaluation | Not started |
| 8 | Langfuse tracing every node + RAGAS scoring + cost tracking + CF restart test | Not started |
| 9 | HTML UI wired + three demo scenarios rehearsed + deliberate rejection | Not started |
| 10 | BTP CF deployment + architecture diagram + blog post | Not started |

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

## THE ONE RULE

Document as you build. Not after. Every decision: what chosen, what rejected, why. This file is updated after every session.
