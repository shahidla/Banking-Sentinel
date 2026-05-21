# Banking Sentinel — Project Context
## For Claude Code / VS Code — New Conversation Handoff
## Built on SAP TRBK · GraphRAG · Multi-Agent Risk Intelligence

---

## IMPORTANT — READ FIRST

This project has two parts:

1. **MJ Live** — a completed real-time AI cognitive pipeline built on SAP BTP. Ask the user for the GitHub link and project context file for MJ Live before starting anything. The MJ Live project established the architectural patterns, SAP BTP deployment approach, Solace integration, HANA Vector RAG, and LangChain usage that this project extends.

2. **Banking Sentinel** — the new prototype described in this document. Build this second, informed by MJ Live patterns.

---

## WHY THIS PROJECT EXISTS — FIVE ANGLES, EQUAL WEIGHT

All five angles carry equal importance. Claude Code must not prioritise one over another or discard any when making architectural or implementation decisions. Each angle shapes how the project is built.

**1. Skill Development**
Each component is selected to teach a specific AI architecture pattern. The 10 AI design patterns are a structured curriculum embedded in a real project. Build in a way that makes each pattern visible, understandable, and explainable — not just functional.

**2. Enterprise AI Positioning**
Demonstrates that modern AI patterns — GraphRAG, multi-agent coordination, observability, evaluation — belong inside SAP enterprise architecture, not alongside it. Every decision must be defensible to both an SAP architect and an AI engineer. The SAP BTP stack is not a constraint. It is the differentiator.

**3. Client Value**
Solves a real, measurable problem in banking risk management. Connected party exposure, regulatory breach detection, early warning credit signals — genuine pain points for any APRA-regulated bank. The prototype must be realistic enough to present to a serious financial institution and be taken seriously. Nothing fake. Nothing generic. Every architectural decision must hold up in a client meeting.

**4. Knowledge Sharing**
Documented to serve three technical communities simultaneously — SAP architects learning AI, AI engineers learning enterprise integration, and banking technologists learning both. The three-vocabulary approach — SAP terms, AI terms, banking terms — and honest decision recording make the project useful beyond its immediate context.

**5. Production Readiness**
Architected from the start for delivery, not just demonstration. The transition from prototype to delivered project is a proven pattern. Architectural decisions made now will be lived with in production. Build accordingly — production-grade thinking from the first line of code, not retrofitted at the end.

---

## WHO I AM

SAP Development Architect transitioning to AI Engineer/Architect. 19 years SAP experience. Currently working on SAP TRBK implementation at a major Australian bank. I learn by building real things and documenting decisions. Every decision documented — what chosen, what rejected, why.

---

## WHAT THIS PROJECT IS

A multi-agent AI risk intelligence system deployed on SAP BTP that monitors SAP Transactional Banking (TRBK) data in real time. It traverses connected party relationships across the TRBK graph, retrieves regulatory context via RAG, coordinates five specialist AI agents, and generates an APRA-ready risk brief — surfacing what human analysts miss.

**The business problem it solves:**
Connected party risk in banking is invisible to SQL queries. A borrower looks healthy alone. Their guarantor looks healthy alone. Connected — they may breach APRA's APS 221 large exposure limit. GraphRAG finds this chain automatically. The AI generates a risk brief nobody programmed.

**The client context:**
A major Australian bank regulated by APRA. The specific client is not named. The problems solved — connected party risk, DTI monitoring, sector concentration, AI explainability — are common to all APRA-regulated ADIs. APRA activated DTI limits February 2026. CPS 230 Operational Resilience active July 2025.

**This prototype cements a contract. Build it properly.**

---

## THE DEMO EXPERIENCE

Three panel UI:

**Panel 1 — Query**
User types: "Analyse borrower B-4471 for all risk dimensions"
Natural language. Any customer. Any risk question.

**Panel 2 — Agent Pipeline**
Five agents light up in sequence as they execute. Graph traversal visualised. Confidence score builds. Self-RAG re-query visible. Audience watches AI thinking in real time.

**Panel 3 — Risk Brief**
APRA-ready output. Connected risk chain. Regulatory breaches identified with specific standard references. Three actionable recommendations with owners. Full evidence trail mapping to TRBK source tables.

**The twinkle moment:**
Risk Scoring Agent rejects its own output at 64% confidence. Re-queries the graph and finds TrustCo Holdings — a parent entity connecting three borrowers. Group exposure is 92% of the APS 221 limit. Nobody told the agent to look for that. It found it through graph reasoning.

---

## SAP TRBK TABLE STRUCTURE

The synthetic data is modelled on real TRBK/BCA tables. When shown to a bank client these table names are immediately recognisable.

### Core Tables Used

**Business Partner (Customer):**
- `BUT000` — Business Partner master (PARTNER, BU_TYPE)
- `BUT100` — BP Roles (PARTNER, RLTYP)
- `BP2000` — BP-to-BP Relationships (PARTNER1, PARTNER2, RELTYP) — **Graph edge table 1**

**Account Contracts:**
- `BKKF` — Contract account master (VKONT, BUKRS)
- `BKKN` — Contract-Business Partner link (VKONT, GPART)

**Loans:**
- `BCA_LOAN_HDR` — Loan header (LOAN_ID, PARTNER, AMOUNT, CURRENCY)
- `BCA_LOAN_SCHED` — Repayment schedule (LOAN_ID, DUE_DATE, AMOUNT_DUE)
- `BCA_GUARANTOR` — Guarantor assignment (LOAN_ID, GUARANTOR_PARTNER) — **Graph edge table 2**
- `BCA_COLLATERAL` — Collateral (LOAN_ID, COLLAT_TYPE, VALUE)

**Transactions and Risk:**
- `DFKKOP` — Open items / overdue payments (OPBEL, GPART, BETRW, FAEDN) — **Risk signal table**
- `DFKKZP` — Payment items (VKONT, BETRW, BUDAT)
- `BCA_SECTOR` — Industry sector (PARTNER, SECTOR_CODE)
- `BCA_DTI` — Debt to income ratio (PARTNER, DTI_RATIO, INCOME, TOTAL_DEBT)
- `BCA_RISK_CLASS` — Risk classification (LOAN_ID, RISK_CATEGORY, RATING)

**Regulatory (synthetic — realistic):**
- `RISK_THRESHOLD` — APRA regulatory limits (THRESHOLD_TYPE, LIMIT_VALUE)
- `EXPOSURE_LIMIT` — Single/group borrower exposure limits
- `SECTOR_EXPOSURE` — Sector concentration monitoring

### The Graph Model

```
(BusinessPartner) ──[BP2000]──> (BusinessPartner) [guarantor/related/subsidiary]
(BusinessPartner) ──[BKKN]──> (Contract)
(Contract) ──[BCA_LOAN_HDR]──> (Loan)
(Loan) ──[BCA_GUARANTOR]──> (BusinessPartner) [guarantor]
(Loan) ──[BCA_LOAN_SCHED]──> (RepaymentSchedule)
(RepaymentSchedule) ──[DFKKOP]──> (OpenItem) [overdue signal]
(BusinessPartner) ──[BCA_SECTOR]──> (Sector)
(Sector) ──[SECTOR_EXPOSURE]──> (RegulatoryThreshold)
```

A 6-8 hop traversal finds connected party risk chains SQL cannot.

---

## SYNTHETIC DATASET DESIGN

### Business Partners (50 records)
- 30 individual borrowers (retail)
- 10 corporate borrowers (business)
- 8 guarantors (individuals and companies)
- 2 parent entities (holding companies)

### Hidden Risk Patterns — What AI Must Find

**Pattern 1 — Connected Party + APS 221 Breach:**
Borrowers B-4471, B-4472, B-4473 share guarantor G-0091 (TrustCo Holdings). Combined exposure AUD $7.8M. APS 221 limit AUD $8.5M. Utilisation 92%.

**Pattern 2 — DTI Regulatory Breach:**
B-4471 DTI ratio 7.2. APRA February 2026 DTI limit: 6.0. Loan approved pre-activation. Not yet reported.

**Pattern 3 — Sector Concentration:**
B-4471, B-4472, B-4473, B-4474 all in SECTOR_CODE = RETAIL_PROP. Combined sector exposure 78% of internal limit.

**Pattern 4 — Credit Risk Early Warning:**
B-4471 home loan HL-8821 — DFKKOP record 61 days overdue, AUD $8,450. No DFKKZP payment record. Missed repayment.

### Loans (60 records)
- 20 home loans (AUD $400K-$2M, 25-30 year terms)
- 10 investment property loans
- 10 personal loans
- 10 business credit facilities
- 10 term deposits

---

## FULL TECHNICAL STACK

| Layer | Tool | Why |
|---|---|---|
| Data Source | SAP TRBK synthetic data (TRBK table structure) | Realistic to client, recognisable table names |
| Integration | SAP BTP CPI | Governed data pipeline, APRA audit trail, AI gateway |
| Graph | SAP HANA Cloud (relationship traversal in CAP) | Native BTP, no external graph DB needed |
| Vector | SAP HANA Cloud Vector Store | APRA standards + bank policy documents embedded |
| App Layer | SAP CAP Node.js | Business logic, OData, BTP native |
| Orchestration | LangGraph | Multi-agent coordination, ReAct loops |
| LLM | Claude API (AI Core swap path documented) | Intelligence layer — Anthropic partnership relevant to CBA |
| Events | Solace Advanced Event Mesh | Real-time agent updates to consumer UI |
| Observability | Langfuse | Every agent call traced — CPS 230 audit requirement |
| Evaluation | RAGAS | Retrieval quality scored |
| Frontend | Vanilla JS — three panel layout | Banking-grade UI (Task3-Banking-Sentinel-UI.html already built) |

---

## THE FIVE AGENTS

### Agent 1 — Intake Agent
Parses natural language query. Identifies customer. Extracts risk dimensions. Routes to specialist agents. Builds execution plan.

### Agent 2 — Graph Traversal Agent (ReAct loop)
Multi-hop traversal of TRBK graph via HANA. Finds connected parties (BP2000), guarantors (BCA_GUARANTOR), overdue items (DFKKOP). Thinks → Acts → Observes → re-queries if needed. Visualises graph on screen.

### Agent 3 — Policy Agent (Hybrid RAG + HyDE)
Searches APRA prudential standards stored in HANA Vector. APS 221, APS 112, CPS 230, DTI limits. HyDE generates hypothetical breach profile before searching — improves retrieval accuracy on regulatory language.

### Agent 4 — Risk Scoring Agent (Self-RAG)
Scores risk on four dimensions: Credit, Connected Party, Regulatory, Sector. Evaluates own confidence. If below 75% threshold — re-queries Graph Agent for more data. Outputs final score with confidence level.

### Agent 5 — Recommendation Agent
Synthesises all findings. Generates APRA-ready risk brief. Three specific recommendations with owner and timeline. Full evidence trail linking to TRBK source tables. This is the output that cements the contract.

---

## AI DESIGN PATTERNS — 10 CONCEPTS

| # | Pattern | Where | What It Does |
|---|---|---|---|
| 1 | GraphRAG | HANA + LangGraph | Multi-hop relationship traversal beyond SQL |
| 2 | Hybrid RAG | HANA Vector + Full Text | Vector + keyword for APRA policy documents |
| 3 | HyDE | Agent 3 | Hypothetical breach profile improves regulatory retrieval |
| 4 | Agentic RAG | LangGraph orchestrator | Agent decides what to retrieve and when |
| 5 | ReAct Pattern | Agent 2 | Think → Act → Observe → Think → Act |
| 6 | Multi-Agent | 5 specialist agents | Each has one job, coordinates via LangGraph |
| 7 | Self-RAG | Agent 4 | Evaluates own retrieval quality, re-queries if confidence low |
| 8 | Temporal Memory | LangChain BufferMemory | Risk context builds across agent steps |
| 9 | AI Observability | Langfuse | Every call traced — CPS 230 audit ready |
| 10 | LLM Evaluation | RAGAS | Retrieval faithfulness and relevance scored |

---

## LEARNING CONTEXT — WHAT EACH PATTERN TEACHES

This is a learning project as much as a client prototype. For each AI pattern, here is what it teaches and why an architect would choose it over simpler alternatives.

**1. GraphRAG — Why not just vector RAG?**
Standard RAG finds similar documents. GraphRAG traverses relationships. A borrower's risk profile is not in one document — it is distributed across loans, guarantors, connected parties, overdue items. You need to follow the edges, not just find the nearest vector. Choosing GraphRAG means you understand that some problems are relationship problems, not similarity problems. That distinction is architect-level thinking.

**2. Hybrid RAG — Why combine vector and keyword?**
APRA regulatory standards use precise legal language — "APS 221", "large exposure limit", "connected counterparty". Pure vector search misses exact regulatory references because they are low frequency in embedding space. Pure keyword search misses semantic intent. Hybrid combines both. Choosing hybrid means you understand when each retrieval strategy fails and design accordingly.

**3. HyDE — Why generate a hypothetical before searching?**
Regulatory queries are often sparse — "does this breach any rules?" is not enough signal for vector search. HyDE generates a hypothetical answer first — "a connected party group exposure exceeding the APS 221 threshold would be classified as..." — then searches using that richer signal. You learn that retrieval quality depends on query quality, and AI can improve its own queries before searching.

**4. Agentic RAG — Why not just one RAG call?**
One RAG call answers one question. An agent decides what questions to ask, in what order, based on what it found so far. After finding a connected guarantor, the agent decides to query again for that guarantor's other loans. That decision was not programmed — it emerged from the agent's ReAct loop. You learn the difference between retrieval as a function and retrieval as a cognitive decision.

**5. ReAct Pattern — Why think before acting?**
Chain-of-thought prompting tells the LLM to reason. ReAct tells the agent to reason, then take an action, then observe the result, then reason again. The loop is the key — the agent updates its understanding based on what it found. You learn that agentic behaviour is not about longer prompts, it is about iterative grounding in real observations.

**6. Multi-Agent — Why five agents instead of one?**
One agent handling everything conflates graph traversal, policy lookup, risk scoring, and recommendation into one prompt. The outputs interfere with each other. Five agents with one job each are testable, replaceable, and independently scalable. You learn that agent design mirrors software design — single responsibility, separation of concerns, composability.

**7. Self-RAG — Why evaluate your own outputs?**
An agent that always accepts its first answer is overconfident. Self-RAG adds a verification step — the agent asks "is this retrieval sufficient to answer the question?" If not, it retrieves again. You learn that production AI systems need internal quality gates, not just external evaluation. The agent is responsible for its own epistemic standards.

**8. Temporal Memory — Why not start fresh each agent call?**
Without memory, Agent 4 does not know what Agent 2 found. Each agent call is isolated. With LangChain BufferMemory, the risk context accumulates — the guarantor found in hop 3 is still known in hop 8. You learn that stateful AI systems reason differently from stateless ones — context changes what the model understands, not just what it outputs.

**9. AI Observability — Why instrument everything?**
You cannot improve what you cannot measure. Langfuse shows which agent calls were slow, which retrievals were irrelevant, which prompts hallucinated. For a bank client, observability is also a regulatory requirement under CPS 230 — the AI's decisions must be auditable. You learn that production AI is not just about accuracy, it is about visibility, accountability, and trust.

**10. RAGAS — Why evaluate retrieval quality automatically?**
Manually reviewing whether RAG retrieved the right documents is impossible at scale. RAGAS measures faithfulness (did the answer come from the retrieved documents?), relevance (were the documents relevant to the query?), and context precision (did we retrieve too much or too little?). You learn to think about AI quality as a measurable engineering property, not a subjective judgment.

---

## CPI ROLE — THREE LEGITIMATE JOBS

CPI is not decorative. It has three real jobs:

1. **Data ingestion pipeline** — Scheduled iFlow loads synthetic TRBK data into HANA. Governed, scheduled, auditable. Exactly what CPI was built for.

2. **Governed AI gateway** — All Claude API calls go through CPI. API key management, retry, rate limiting, APRA audit trail of every AI call.

3. **Event publishing** — When risk brief is generated, CPI publishes as formal business event to Solace. Downstream compliance systems can subscribe.

---

## AI CORE / JOULE SWAP PATH

| Prototype uses | Enterprise replaces with | Change |
|---|---|---|
| Claude API via CPI | SAP AI Core Generative AI Hub | Change endpoint URL in CPI iFlow |
| Custom chat UI | SAP Joule | Joule plugin registration |
| Langfuse | SAP AI Launchpad monitoring | Switch telemetry endpoint |

Note: CBA has an Anthropic partnership — Claude API is not just a placeholder here, it is strategically appropriate for a CBA demo.

---

## BUILD PHASES

| Phase | What Gets Built | Status |
|---|---|---|
| 0 | Synthetic TRBK data generated · HANA schema deployed · data loaded | Not started |
| 1 | CPI iFlow — data ingestion pipeline · HANA Graph relationships built | Not started |
| 2 | HANA Vector — APRA standards embedded · policy knowledge base | Not started |
| 3 | LangGraph orchestrator · Intake Agent | Not started |
| 4 | Graph Traversal Agent · ReAct loop · HANA graph queries | Not started |
| 5 | Policy Agent · Hybrid RAG · HyDE implementation | Not started |
| 6 | Risk Scoring Agent · Self-RAG · confidence evaluation | Not started |
| 7 | Recommendation Agent · risk brief generation | Not started |
| 8 | Langfuse observability · RAGAS evaluation | Not started |
| 9 | Consumer UI wired to agents · Solace events · three panel layout | Not started |
| 10 | Deploy to BTP CF · architecture diagram · client demo | Not started |

---

## WHAT ALREADY EXISTS

**Task3-Banking-Sentinel-UI.html** — Full three-panel banking UI already built. Drop it into the project. It shows the complete demo experience with all five agents, CBA-specific borrower data, APRA regulatory breach identification, and the procurement note at the bottom. Open in Chrome and click RUN to see the demo flow.

---

## REGULATORY CONTEXT — WHAT TO KNOW

**APRA** — Australian Prudential Regulation Authority. Regulates CBA. Key standards:
- APS 221 — Large Exposures (connected party group limits)
- APS 112 / APS 113 — Credit Risk Capital
- CPS 230 — Operational Resilience (July 2025, requires explainable AI)
- DTI Limits — Activated February 2026 (restrict high DTI lending)

**The Hayne Royal Commission** — 2019 inquiry found CBA's risk governance failed because data existed but wasn't connected or acted upon. This prototype directly addresses that failure mode.

**APRA message on AI** — "AI can be a valuable co-pilot but should never be your autopilot." Every AI decision must be explainable, auditable, and have human oversight. Langfuse and the evidence trail in the risk brief address this directly.

---

## THE ONE RULE

Document as you build. Not after.

For every decision: what you chose, what you considered and rejected, why.

That documentation is what separates a prototype from a proposal — and a proposal from a contract.

---

## INSTRUCTIONS FOR CLAUDE CODE

- Read this entire file completely before touching any code
- Ask the user for the MJ Live GitHub link before starting — MJ Live patterns, deployment approach, and known fixes carry forward
- All five angles in "Why This Project Exists" carry equal weight — do not prioritise or discard any of them
- Never name the bank client in any code, comment, README, or documentation — say "major Australian bank" or "banking client" only
- Do not simplify the stack — every component is deliberate and defensible across SAP, AI, and banking audiences
- TRBK table names must appear in the synthetic data schema — the client will recognise them
- Every AI component must map to a named pattern from the 10 patterns table
- When implementing each AI pattern — explain it in three ways: what it means in AI terms, what it means in banking terms, what it means in SAP terms
- LangGraph is the orchestration layer — CAP is the application layer — never merge these roles
- CPI has three specific jobs — do not expand or remove its role
- Build one phase at a time — confirm which phase before writing any code
- The UI (Task3-Banking-Sentinel-UI.html) is already built — wire it up, do not redesign it
- The risk brief must always include an evidence trail referencing TRBK source tables
- Document every decision — what was chosen, what was rejected, why — this documentation is as important as the code

---

*Five angles. Equal weight. Build it like a senior AI architect who understands banking regulation, SAP enterprise architecture, and modern AI engineering simultaneously.*
