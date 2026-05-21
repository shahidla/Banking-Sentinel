# Banking Sentinel — Project Memory
## For Claude Code — New Conversation Handoff
## Last updated: 2026-05-21 (Session 2)

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
    Task1-TRBK-Table-Structure.md     ← SAP TRBK table structure + synthetic data design
    Task2-Banking-Problems.md         ← Real banking problems this prototype solves
    Task3-Banking-Sentinel-UI-1.html  ← Dark editorial UI (original)
    Banking-Sentinel-AustralianBank.html ← Light Bloomberg-style UI (CHOSEN)
    Banking-Sentinel-Bloomberg.html   ← Deep navy Bloomberg terminal UI
    Task4-Banking-Sentinel-Project-Context.md ← Full project context (canonical reference)
    Banking-Sentinel-Project-Memory.md ← THIS FILE

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
`C:\Users\syedsm\.claude\projects\C--\memory\project_mj_context.md`

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
| 1 | CAP project scaffold + SQLite schema + seed from JSON files | Not started |
| 2 | HANA Vector — APRA standards embedded | Not started |
| 3 | LangGraph orchestrator + Intake Agent | Not started |
| 4 | Graph Traversal Agent + ReAct + HANA graph queries | Not started |
| 5 | Policy Agent + Hybrid RAG + HyDE | Not started |
| 6 | Risk Scoring Agent + Self-RAG + confidence evaluation | Not started |
| 7 | Recommendation Agent + risk brief generation | Not started |
| 8 | Langfuse observability + RAGAS evaluation | Not started |
| 9 | Consumer UI wired + Solace events + three panel | Not started |
| 10 | Deploy to BTP CF + architecture diagram + client demo | Not started |

---

## UI — THREE VARIANTS (already built)

| File | Theme | Use |
|---|---|---|
| Task3-Banking-Sentinel-UI-1.html | Dark editorial (DM Mono / Fraunces) | Original |
| Banking-Sentinel-AustralianBank.html | Light Bloomberg-style, yellow accent | Australian Bank demo |
| Banking-Sentinel-Bloomberg.html | Deep navy, IBM Plex, blue grid | Bloomberg terminal style |

**Chosen UI:** `Banking-Sentinel-AustralianBank.html` — light Bloomberg-style, yellow accent.

---

## DECISIONS LOG

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| UI variant | Banking-Sentinel-AustralianBank.html (light, yellow accent) | Dark editorial, Bloomberg terminal | User selected |
| DB strategy | SQLite locally for dev/test, HANA Cloud on BTP for prod | HANA-only from start | BTP deployment takes time; same pattern as MJ Live |
| LLM split | Anthropic (claude-sonnet-4-6 for agents, claude-opus-4-7 for risk brief) + OpenAI (text-embedding-3-small for HANA Vector) | Claude-only or OpenAI-only | Same split as MJ Live — Claude for intelligence, OpenAI for embeddings |
| Data source | SAP Business Accelerator Hub sandbox as primary (real SAP BPs) + synthetic TRBK loan/risk layer on top | Client data (not allowed) / fully synthetic | Cannot use client data. Using real SAP BPs makes the story credible with bank architects. |
| BP relationship table | BUT050 / BUT051 | BP2000 (doesn't exist in TRBK) | Confirmed by bank architects in session. BP2000 is NOT a real TRBK table. |
| Agent model | claude-sonnet-4-6 for agents (speed/cost), claude-opus-4-7 for final risk brief | All Opus or all Haiku | Balance cost vs quality. Risk brief needs Opus reasoning. Agents need speed. |

---

## OPEN QUESTIONS (confirm before Phase 1)

1. HANA Cloud instance available on BTP — or build CAP scaffold local-first with SQLite first?
2. Claude API key — fill in .env before Phase 1
3. Do we need more SAP sandbox data? (BPFinancialServicesExtn, BPCreditWorthiness available). User may pull more on next session if time allows.
4. Any additional risk patterns the bank architects want demonstrated?

---

## THE ONE RULE

Document as you build. Not after. Every decision: what chosen, what rejected, why. This file is updated after every session.
