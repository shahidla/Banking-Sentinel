# Banking Sentinel: A Multi-Agent AI Risk Intelligence System Built on SAP BTP

### How Seven AI Agents Work Together to Protect an Australian Bank From Credit Risk — In Real Time

---

## Table of Contents

1. [The Problem We Are Solving](#1-the-problem-we-are-solving)
2. [Why This Matters — Four Audiences](#2-why-this-matters)
3. [What Banking Sentinel Does](#3-what-banking-sentinel-does)
4. [The Technology Stack](#4-the-technology-stack)
5. [The Architecture — How It All Connects](#5-the-architecture)
6. [The Seven Agents — A Full Walkthrough](#6-the-seven-agents)
   - Agent 0: Intake Agent
   - Agent 1: Pattern Agent
   - Agent 2: Trajectory Agent
   - Agent 3: Relationship Agent
   - Agent 4: Self-RAG Check
   - Agent 5: Human-in-the-Loop Approval
   - Agent 6: Synthesis Agent
7. [A Real Example — Customer 30100001](#7-a-real-example)
8. [Regulatory Compliance by Design](#8-regulatory-compliance)
9. [What the Risk Officer Sees](#9-what-the-risk-officer-sees)
10. [Key Design Decisions and Lessons](#10-key-design-decisions)
11. [What Comes Next](#11-what-comes-next)

---

## 1. The Problem We Are Solving

Every Australian bank faces the same invisible risk: a customer looks safe in isolation but is quietly part of a web of connected entities — family trusts, guarantor networks, subsidiary companies — whose combined exposure is far beyond what any single credit file shows.

A borrower with a modest loan today can be the linchpin of a group with ten times the exposure. By the time a human analyst pieces it together, it may be too late.

The traditional tools are spreadsheets, batch reports, and credit scorecards that look at one dimension at a time. A scorecard says the debt-to-income ratio is 5.80 times. Fine. But it does not tell you:

- That the same customer's income contract expires in 299 days
- That when it does, their effective DTI jumps to 7.05 times — well above the regulator's limit
- That they are a member of two family trusts whose combined loan exposure is AUD 3.08 million
- That three of their recent payment records are unreconciled
- That five statistical anomalies have been detected in their payment behaviour

No single analyst. No single report. No single tool catches all of this at once.

**Banking Sentinel does.**

---

## 2. Why This Matters — Four Audiences

### For Banks
Risk is not one-dimensional. A borrower's risk lives across four dimensions simultaneously: their payment patterns, their future income trajectory, their network of connected parties, and whether the evidence trail is complete enough to act on. A miss in any one dimension can become a loss event. Banking Sentinel runs all four in parallel and produces a single, auditable risk brief — ready for the risk officer's desk in under two minutes.

### For SAP Customers
Banking Sentinel runs entirely on SAP BTP — SAP HANA Cloud for data and vectors, SAP CAP for the service layer, SAP RPT-1 for tabular AI scoring, and SAP's graph engine for connected-party traversal. It proves that SAP's native AI stack can power production-grade, regulation-compliant risk intelligence — without leaving the SAP ecosystem.

### For AI Practitioners
Banking Sentinel is a production implementation of a LangGraph multi-agent pipeline. It demonstrates four critical AI patterns: ReAct tool-use loops for graph traversal, Self-RAG (Retrieval-Augmented Generation with self-evaluation) for evidence quality control, Human-in-the-Loop interrupts for CPS 230 co-pilot compliance, and RAGAS-style claim-source faithfulness checking to detect hallucination. Every AI pattern has a named purpose. Nothing is added for its own sake.

### For a General Audience
Imagine a bank has thousands of customers. Each one has loans, payments, and income. Each one is also connected to other people — through guarantees, family trusts, and business relationships. Banking Sentinel is like a very thorough analyst who simultaneously checks your payment behaviour, calculates what your finances look like in a year, maps everyone you are financially connected to, double-checks its own work, and then writes a clear report — all in the time it takes to make a cup of coffee.

---

## 3. What Banking Sentinel Does

Banking Sentinel is a **multi-agent AI risk intelligence system** deployed on SAP BTP (Business Technology Platform). A risk analyst types a single sentence: *"Analyse credit risk for customer 30100001."* Within 40-106 seconds, seven AI agents have examined the customer across four independent risk dimensions and produced an APRA-compliant risk brief, complete with regulatory references, confidence scores, and a clear recommendation.

**The system produces:**
- A risk score (0-100) with level: LOW / MEDIUM / HIGH / CRITICAL
- Five specific findings with regulatory standard, severity, evidence source, and confidence score
- Three actionable recommendations
- Identified data gaps and uncertainties — not hidden, explicitly surfaced
- A regulatory audit trail under APRA CPS 230 and APS 221
- A flag: APRA-Ready (true/false) — whether the evidence is strong enough to take to a board

**The system refuses to:**
- Approve or reject a loan (it is a co-pilot, not a decision-maker)
- Delete records
- Override risk flags
- Operate without a human sign-off when the risk is material

---

## 4. The Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Runtime Platform | SAP BTP Cloud Foundry | Deployment, scaling, service bindings |
| Application Framework | SAP CAP (CDS + Node.js) | OData APIs, HANA binding, CDS models |
| Primary Database | SAP HANA Cloud | All SAP TRBK/BCA banking tables |
| Vector Store | SAP HANA Cloud Vector Engine | APRA regulatory document embeddings |
| Graph Engine | GraphDB (RDF/SPARQL) → HANA KGE in production | Connected-party traversal |
| Tabular AI Model | SAP RPT-1 (rpt.cloud.sap) | Tabular risk scoring without AI Core |
| Anomaly Detection | scikit-learn Isolation Forest (→ HANA PAL) | Statistical payment anomaly detection |
| LLM | Claude Haiku 4.5 (Anthropic) | All natural language reasoning |
| Agent Orchestration | LangGraph (StateGraph) | Multi-agent pipeline with conditional routing |
| State Persistence | PostgreSQL / Supabase | LangGraph checkpoint — survives CF restarts |
| Embeddings | OpenAI text-embedding-3-small | APRA document vectorisation |
| Observability | Langfuse | Per-agent token usage, latency, traces |
| Real-time UI | Server-Sent Events (SSE) | Live agent progress in browser |
| Frontend | Vanilla HTML/CSS/JS | Bank-grade UI — no framework dependencies |

### Why SAP RPT-1?

RPT-1 is SAP's tabular foundation model — available via a public consumer API at rpt.cloud.sap without requiring AI Core or SAP AI Launchpad. It uses in-context learning: you send it example rows from your portfolio with known risk categories, then ask it to classify your target customer. No training. No fine-tuning. Immediate results. Banking Sentinel uses it as the foundational risk score before any LLM reasoning begins.

### Why LangGraph?

LangGraph is a graph-based agent orchestration framework. Each agent is a node. Data flows between nodes via a typed state object. Conditional edges allow the pipeline to branch: a low-risk customer skips the graph traversal and jumps straight to synthesis. A high-risk customer goes through all four specialist agents. A re-query loop allows the Self-RAG agent to send the Relationship Agent back for a deeper traversal if the first pass was incomplete. This is impossible to express cleanly in a simple chain — it needs a state machine.

### Why HANA Vector Engine?

APRA regulatory documents (APS 221, CPS 230, DTI Notices) are embedded into HANA Cloud's native vector engine. When the Synthesis Agent writes the risk brief, it retrieves the most relevant regulatory clauses by semantic similarity — not keyword matching. This means the risk brief cites the actual paragraph of the actual regulation that applies to the specific risk being assessed.

---

## 5. The Architecture

```
User query → [Intake Agent]
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
    Simple Query   Risk    Rejection
     (direct     Analysis  (refuses
    DB lookup)  pipeline)  approvals)
                    │
              [Pattern Agent]
              RPT-1 + PAL + LLM
                    │
          Score < 30 ──→ [Synthesis]
          Score ≥ 30 ──→ [Trajectory Agent]
                              │
                    [Relationship Agent]
                    ReAct loop: traverse graph,
                    calculate exposure, check APRA
                              │
                    [Self-RAG Check]
                    LLM evaluates evidence quality
                              │
              Confidence < 0.70 ──→ [Relationship] (re-query)
              Confidence ≥ 0.70 ──→ [Human Approval]
                                          │
                                     ← interrupt ←
                                    Risk officer reviews
                                    and approves
                                          │
                                    [Synthesis Agent]
                                    HANA Vector + APRA brief
                                          │
                                        [END]
                                    Report persisted
                                    to HANA + AuditLog
```

**State flows through the pipeline in one typed object.** Every agent reads everything every previous agent produced. The Synthesis Agent sees Pattern's anomalies, Trajectory's DTI projections, Relationship's graph findings, and Self-RAG's quality gaps — all at once. Nothing is lost between agents.

---

## 6. The Seven Agents — A Full Walkthrough

---

### Agent 0: Intake Agent

**Purpose:** Parse the user's query. Decide what kind of request this is. Route accordingly.

**The problem it solves:** A risk officer might type "Analyse 30100001" or "What is the DTI for 30100001?" or "Approve the loan for 30100001." These are three completely different requests. The first triggers a full seven-agent pipeline. The second is a simple database lookup. The third must be refused — Banking Sentinel is a co-pilot, not a decision-maker.

**How it works:** Claude Haiku reads the user's query against a system prompt that defines three intent categories:
- `RISK_ANALYSIS` — triggers the full agent pipeline
- `SIMPLE_DATA_QUERY` — answered directly from HANA, no pipeline
- `INAPPROPRIATE_REQUEST` — any attempt to approve, reject, delete, modify, or override

The agent also extracts the customer ID. SAP Business Partner numbers are 8-digit codes (e.g. 30100001). The agent is instructed to extract them exactly — no reformatting.

**Output (stored in pipeline state):**
```json
{
  "isRiskAnalysis": true,
  "isSimpleDataQuery": false,
  "isInappropriateRequest": false,
  "customerId": "30100001",
  "description": "Analyse credit risk for customer 30100001"
}
```

**What happens next:** If `isRiskAnalysis`, the pipeline continues to the Pattern Agent. If `isSimpleDataQuery`, a direct HANA CDS query runs and the result is returned immediately. If `isInappropriateRequest`, a firm refusal is returned explaining that the system does not approve or override — that is a human decision.

---

### Agent 1: Pattern Agent

**Purpose:** Establish the baseline risk signal. "Something feels wrong" — before any specific rule fires.

**The problem it solves:** A credit scorecard tells you a number. But a number alone does not tell you whether the payment behaviour is suspicious, whether the debt structure is unusual, or whether there are statistical outliers in how this customer compares to the portfolio. Pattern Agent runs three methods simultaneously and combines their signals.

**How it works (three methods in parallel):**

**Method 1 — SAP RPT-1 (Tabular Foundation Model)**
The agent fetches the last 20 customers from `BCA_DTI` to use as labelled examples. Each row has: DTI ratio, breach flag, total debt, annual income, risk category. It sends these to `rpt.cloud.sap/api/predict` with the target customer's row marked `[PREDICT]`. RPT-1 applies in-context learning and returns a predicted risk category with a confidence score.

*For 30100001:* RPT-1 returns `MEDIUM` with confidence 1.0. Score computed: 50 out of 100.

**Method 2 — Isolation Forest Anomaly Detection (scikit-learn / HANA PAL)**
The agent trains an Isolation Forest model on up to 500 rows from `DFKKOP` (the bank's payment transaction table). Isolation Forest detects outliers by measuring how easily a data point can be isolated from the rest — anomalies are isolated in fewer splits. Each of the customer's payment rows is then scored: label `-1` = outlier, `1` = inlier.

*For 30100001:* 3 payment rows scored, 0 flagged as outliers. The payment amounts and overdue days fall within the portfolio's normal range statistically.

**Method 3 — LLM Narrative Anomaly Detection (Claude Haiku)**
The raw customer data — loans, DTI record, recent payments, collateral — is sent to Claude Haiku. The LLM is told the current APRA DTI threshold (fetched from `RegulatoryThresholds` — not hardcoded) and asked to identify anomalies a human analyst would flag.

*For 30100001:* Five anomalies identified:
1. DTI 5.80x approaches the APRA limit — minimal buffer
2. Multiple overdue payments: 81 days, 50 days, 50 days across accounts
3. Contract income expires 2027-04-01 — affects serviceability
4. Term deposit loan (AUD 250,000) — unusual classification for debt service
5. Three payment records with no settlement date (BUDAT) — unreconciled

**Tables read from HANA:**
- `bankingsentinel.BCA_DTI` — DTI ratio, annual income, total debt, breach flag, income expiry
- `bankingsentinel.Loans` — loan IDs, amounts, types
- `bankingsentinel.DFKKOP` — payment transactions (days overdue, amounts)
- `bankingsentinel.BCA_COLLATERAL` — collateral against loans
- `bankingsentinel.RegulatoryThresholds` — current APRA DTI threshold

**Output:**
```json
{
  "riskScore": 50,
  "riskLevel": "MEDIUM",
  "confidence": 1.0,
  "signal": "concerning",
  "anomalies": [
    "DTI 5.80x approaches APRA limit; minimal buffer",
    "Multiple overdue payments: 81, 50, 50 days",
    "Contract income expires 2027-04-01",
    "Term deposit loan (AUD 250k) unusual classification",
    "Three open payment records with no settlement date"
  ]
}
```

**What happens next:** If riskScore < 30, the pipeline skips directly to Synthesis — no graph traversal needed. For 30100001 with score 50, the pipeline continues to the Trajectory Agent.

---

### Agent 2: Trajectory Agent

**Purpose:** Project the customer's financial position forward in time. "Where is this heading?"

**The problem it solves:** Current DTI is 5.80 times. That looks manageable. But the customer's income is from a contract that expires in 299 days. When that contract ends, the customer has the same debt but a fraction of their current income remaining this year. What does DTI look like then?

**How it works:**

**Step 1 — Fetch current DTI data from HANA**
```sql
SELECT DTI_RATIO, TOTAL_DEBT, ANNUAL_INCOME, INCOME_EXPIRY, BREACH_FLAG
FROM bankingsentinel.BCA_DTI
WHERE PARTNER = '30100001'
```
*Result: DTI_RATIO=5.80, TOTAL_DEBT=1,050,000, ANNUAL_INCOME=181,034, INCOME_EXPIRY='2027-04-01'*

**Step 2 — Fetch the APRA DTI threshold dynamically**
```sql
SELECT LIMIT_PCT FROM bankingsentinel.RegulatoryThresholds
WHERE THRESHOLD_TYPE = 'DEBT_TO_INCOME'
```
This is the key: the threshold is not hardcoded. It reads from the database, which can be updated in real time — for example when the APRA Notice button is clicked in the UI, the threshold changes from 8.0 to 6.0 and the next run of the pipeline reflects the new regulatory position immediately.

**Step 3 — Calculate Forward DTI**

The formula: when income expires in N days, only N/365 of annual income remains effective this year.

```
Formula:
  effectiveIncome = annualIncome × (daysToExpiry / 365)
  futureDti       = totalDebt / effectiveIncome

For 30100001:
  daysToExpiry    = 299
  effectiveIncome = annualIncome × (299 / 365)   ← only 82% of income remains
  futureDti       = totalDebt / effectiveIncome  = 7.05x
```

*Result: Forward DTI 7.05x — a jump from 5.80x today.*

**Step 4 — Check for conflicting signals**

The agent compares Pattern Agent findings against the DTI data to identify contradictions:
- Pattern flagged 5 anomalies but no formal breach recorded → possible off-balance-sheet exposure
- AUD 46,590 in scheduled loan payments fall within the income expiry window

**Step 5 — Calculate Time to Breach**

If the APRA threshold is 8.0x (default): futureDti 7.05 < 8.0 → no breach projected → `timeToBreach = null`
If the APRA threshold is 6.0x (after APRA Notice): futureDti 7.05 > 6.0 → breach projected at income expiry → `timeToBreach = 299 days`

**Tables read from HANA:**
- `bankingsentinel.BCA_DTI` — DTI ratio, income, debt, expiry
- `bankingsentinel.RegulatoryThresholds` — current APRA threshold
- `bankingsentinel.Loans` — loan IDs for payment schedule lookup
- `bankingsentinel.LoanSchedule` — scheduled payment amounts and due dates

**Output:**
```json
{
  "currentDti": 5.8,
  "futureDti": 7.05,
  "daysToExpiry": 299,
  "timeToBreach": null,
  "forwardPosition": "MONITORING",
  "conflictingSignals": [
    "5 statistical anomalies flagged but no regulatory breach recorded",
    "AUD 46,590 in scheduled payments fall within income expiry window"
  ]
}
```

**What happens next:** Relationship Agent runs, receiving Pattern's anomalies and Trajectory's DTI context in its state.

---

### Agent 3: Relationship Agent

**Purpose:** Find every entity connected to this customer. Calculate their combined group exposure against APRA's large exposure limit (APS 221).

**The problem it solves:** Australian borrowers often operate within networks — family trusts, corporate groups, guarantor chains. APRA's APS 221 standard requires banks to aggregate exposure across connected parties. A customer with a AUD 500,000 loan who is a member of a trust with AUD 2.5 million in loans is part of a AUD 3 million exposure group. The bank must know this.

**How it works — ReAct (Reasoning + Acting) Loop:**

The agent uses Claude Haiku with three tools it can call iteratively:

**Tool 1: `hana_graph_traverse`**
Traverses the graph database starting from the customer's business partner ID. Returns all connected nodes (entities) and edges (relationship types) up to 8 hops deep. The underlying technology is GraphDB (an RDF triple store using SPARQL 1.1) in the demo environment, replacing with HANA Knowledge Graph Engine in production — the same SPARQL queries work on both.

The data comes from `BUT050`, SAP's Business Partner Relationship table, which stores every relationship between business partners: parent-subsidiary, guarantor, family trust member, director, etc.

**Tool 2: `exposure_calculator`**
Takes a list of all connected entity IDs and queries `BCA_GUARANTOR` and `Loans` to calculate total guaranteed and direct loan exposure across the group.

**Tool 3: `apra_threshold_check`**
Checks the calculated exposure against APRA's APS 221 large exposure limit (AUD 7.5 million for this demo). Returns the utilisation percentage.

**The ReAct loop in action:**

```
Step 1: LLM reasons → "I need to find connected parties for 30100001"
        LLM acts → calls hana_graph_traverse(startNode: "30100001", depth: 6)
        Tool returns → nodes: [30100001, 30910005, 30910006]
                       edges: [30100001→30910005 FAMILY_TRUST_MEMBER,
                               30100001→30910006 FAMILY_TRUST_MEMBER,
                               30910005→30910006 FAMILY_TRUST_MEMBER]

Step 2: LLM reasons → "Found 3 nodes. Now calculate group exposure."
        LLM acts → calls exposure_calculator(entityIds: ["30100001","30910005","30910006"])
        Tool returns → groupExposure: 3,080,000 AUD

Step 3: LLM reasons → "Now check against APRA APS 221 threshold."
        LLM acts → calls apra_threshold_check(metricType: "aps221", value: 3080000, entityId: "30100001")
        Tool returns → aps221Pct: 41.07%, within_limit: true

Step 4: LLM reasons → "Complete. I have enough to summarise."
        LLM stops calling tools and returns the finding.
```

**What the BUT050 table looks like:**

| FROM_PARTNER | TO_PARTNER | RELTYP |
|---|---|---|
| 30100001 | 30910005 | FAMILY_TRUST_MEMBER |
| 30100001 | 30910006 | FAMILY_TRUST_MEMBER |
| 30910005 | 30910006 | FAMILY_TRUST_MEMBER |

**Tables / databases accessed:**
- GraphDB / HANA KGE — SPARQL traversal of BUT050 relationship graph
- `bankingsentinel.BCA_GUARANTOR` — guaranteed loan amounts
- `bankingsentinel.Loans` — direct loan exposures
- `bankingsentinel.BCA_SECTOR` — sector concentration check

**Output:**
```json
{
  "nodes": ["30100001", "30910005", "30910006"],
  "edges": [
    {"from": "30100001", "to": "30910005", "type": "FAMILY_TRUST_MEMBER"},
    {"from": "30100001", "to": "30910006", "type": "FAMILY_TRUST_MEMBER"},
    {"from": "30910005", "to": "30910006", "type": "FAMILY_TRUST_MEMBER"}
  ],
  "groupExposure": 3080000,
  "aps221Pct": 41.07,
  "confidence": 0.95,
  "finding": "Customer 30100001 connected group of 3 entities; total APS 221 exposure AUD 3.08M (41.07% of limit), within compliance threshold."
}
```

**What happens next:** Self-RAG Check evaluates whether this evidence is complete enough to proceed.

---

### Agent 4: Self-RAG Check

**Purpose:** The pipeline's quality control layer. Evaluate its own work. Ask: "Do I have enough evidence to stand behind these findings?"

**The problem it solves:** The Relationship Agent found 3 nodes. But is that complete? In a realistic banking network, 3 nodes with 3 edges looks suspiciously shallow. Did the traversal stop early? Are there parent entities not yet discovered? Are the 5 statistical anomalies from Pattern Agent actually linked to specific exposure items? Or are they floating assertions without an evidence trail?

A risk brief built on incomplete evidence is worse than no risk brief — because it creates false confidence.

**How it works:**

Self-RAG (Self-Retrieval Augmented Generation) means the LLM evaluates its own outputs for quality. Claude Haiku is given a summary of all four agent findings and asked to assess four dimensions:

1. **Graph Completeness** — Is the 3-node traversal complete, or did it stop early?
2. **Signal Consistency** — Do Pattern and Relationship findings agree? High risk score + zero APS 221 exposure = inconsistency.
3. **Conflicting Signals** — Are the trajectory conflicts explained by the graph, or still unresolved?
4. **Evidence Trail** — Is every risk claim backed by a specific TRBK record or exposure figure?

The LLM returns a confidence score (0.0-1.0) and, if confidence is below 0.70, a specific `reQueryHint` — a targeted instruction for the Relationship Agent to go deeper.

**For 30100001:**

```json
{
  "overallConfidence": 0.72,
  "gaps": [
    "Graph traversal appears incomplete — only 3 nodes with 3 edges; no parent entities or guarantor networks detected",
    "Off-balance-sheet exposure flagged as 'possible' but not quantified",
    "5 anomalies exist but none anchored to specific TRBK records"
  ],
  "reQueryHint": "Restart from 30100001 using guarantor and parent entity relationships; explicitly query off-balance-sheet exposures for all 3 nodes.",
  "reasoning": "Pattern confidence is high but graph is suspiciously shallow; trajectory conflicts remain unresolved."
}
```

**The routing decision:**
- Confidence 0.72 ≥ 0.70 threshold → **proceed** to Human Approval
- If confidence had been 0.65 → **requery** → Relationship Agent re-runs with the specific hint, goes deeper, returns an improved graph
- Maximum 2 re-queries to prevent infinite loops

**Why this matters:** Self-RAG is the only agent that looks at the entire pipeline's output holistically. It catches cases where each individual agent did its job correctly, but the combined picture is still incomplete. It is the AI equivalent of a senior analyst reviewing a junior analyst's work before it goes to the risk committee.

---

### Agent 5: Human-in-the-Loop Approval (HITL)

**Purpose:** Mandatory human checkpoint. No risk brief reaches the customer file without a human reviewing the evidence first.

**The problem it solves:** APRA CPS 230 (Operational Resilience) requires that AI systems used in credit risk decisions operate as co-pilots — not autopilots. The risk officer must see the evidence and approve before the final brief is sealed.

**How it works:**

When Self-RAG says "proceed", LangGraph halts the pipeline using `interruptBefore: ['humanApproval']`. The pipeline is paused. The state is persisted to PostgreSQL — which means the pause survives a server restart. The risk officer is notified in the UI that the pipeline is waiting for their review.

The risk officer sees:
- Pattern findings: RPT-1 score, PAL anomaly counts, LLM anomalies
- Trajectory: Current DTI, Forward DTI, Days to income expiry
- Relationship: The visual graph of connected entities with exposure amounts
- Self-RAG gaps: Explicitly what the AI was uncertain about

They click **Approve**. The pipeline resumes. Synthesis runs. The brief is sealed with `approvedBy: "risk.officer@bank.com.au"`.

If HITL is disabled (for demo or low-risk customers), the pipeline runs straight through to Synthesis automatically.

---

### Agent 6: Synthesis Agent

**Purpose:** Write the APRA-ready risk brief. Combine all four agents' findings into a single, structured, regulatory-compliant document.

**The problem it solves:** Four agents have run. Each produced findings in its own format. A risk officer needs one concise brief with clear findings, recommendations, regulatory citations, and an honest statement of what is uncertain. This brief must be good enough to take to a board. It must cite the actual APRA regulations that apply. It must acknowledge what is not yet known.

**How it works:**

**Step 1 — Per-signal HANA Vector Search**
Instead of one generic regulatory query, the Synthesis Agent performs up to four targeted queries against the HANA Vector Engine, one per risk signal:
- *"DTI ratio 5.8 debt-to-income limit APRA activation"* → retrieves APS 220 / DTI Notice clauses
- *"connected party group exposure APS 221 large exposure 3.1M"* → retrieves APS 221 thresholds
- *"income contract expiry forward DTI trajectory deteriorating"* → retrieves forward assessment requirements
- *"CPS 230 operational resilience AI model governance audit trail"* → retrieves CPS 230 obligations

The retrieved chunks are deduplicated and capped at 7 to stay within the token budget.

**Step 2 — LLM Synthesis (Claude Haiku, maxTokens: 2500)**
All four agents' outputs, plus the retrieved APRA regulatory text, are sent to Claude Haiku with a structured system prompt. The LLM produces a JSON risk brief — findings are constrained to 20 words each (precision over prose), with one regulatory standard and one evidence source per finding.

**Step 3 — Deterministic Guardrails**
The `apraReady` flag is NOT decided by the LLM. It is calculated deterministically from four conditions: confidence ≥ 0.70, Self-RAG passed, regulatory docs retrieved, no regulatory context failure. This prevents the LLM from deciding its own work is ready.

**Step 4 — RAGAS Claim-Source Overlap Check**
A cosine-similarity check measures how much the LLM's findings overlap with the retrieved regulatory text. Low overlap (<30%) means the LLM may be relying on training data rather than the retrieved documents. This is flagged in the uncertainty section.

**Step 5 — Persist to HANA**
The risk assessment is written to `bankingsentinel.RiskAssessments`. Token counts and cost are written to `bankingsentinel.AuditLog`. Both are permanent records under CPS 230.

**For 30100001 — the produced brief:**

```json
{
  "riskScore": 50,
  "riskLevel": "MEDIUM",
  "confidence": 0.72,
  "findings": [
    {
      "finding": "DTI 5.80x approaches APRA 6.00x limit; minimal buffer for income volatility.",
      "standard": "DTI_NOTICE",
      "severity": "HIGH",
      "evidenceSource": "pattern",
      "confidence": 1.0
    },
    {
      "finding": "Contract income expires 2027-04-01; only 12 months remaining affects serviceability.",
      "standard": "APS221",
      "severity": "HIGH",
      "evidenceSource": "pattern",
      "confidence": 1.0
    },
    {
      "finding": "Multiple overdue payments: 81, 50, 50 days across accounts flagged.",
      "standard": "CPS230",
      "severity": "HIGH",
      "evidenceSource": "pattern",
      "confidence": 1.0
    },
    {
      "finding": "5 statistical anomalies flagged but graph traversal incomplete; only 3 nodes detected.",
      "standard": "APS221",
      "severity": "MEDIUM",
      "evidenceSource": "selfRag",
      "confidence": 0.72
    },
    {
      "finding": "AUD 46,590 scheduled payments fall within income expiry window; repayment risk.",
      "standard": "DTI_NOTICE",
      "severity": "HIGH",
      "evidenceSource": "trajectory",
      "confidence": 0.95
    }
  ],
  "recommendations": [
    "Conduct forensic income verification; obtain employment contract renewal evidence before 2027-04-01.",
    "Reconcile 3 open payment records lacking settlement date; clarify processing status and arrears timeline.",
    "Expand relationship graph beyond 3-node chain; trace parent entities, guarantors, off-balance-sheet exposures."
  ],
  "regulatoryRefs": ["DTI_NOTICE", "APS221", "CPS230"],
  "uncertainties": [
    "Off-balance-sheet exposure flagged possible but not quantified or linked to specific entities.",
    "Graph structure suspiciously shallow (3 nodes); parent entities and guarantor networks undetected.",
    "Term deposit loan (AUD 250k) unusual classification; impact on debt service calculation unclear."
  ],
  "apraReady": true
}
```

---

## 7. A Real Example — Customer 30100001

Let us trace the full pipeline from the moment the query is entered to the moment the risk brief appears on screen.

**The query:** *"Analyse credit risk for customer 30100001"*

**Who is 30100001?**
A retail customer at an Australian bank. They have loans totalling AUD 1.05 million. Their annual income is AUD 181,034 from a fixed-term contract. Their current DTI is 5.80 times — below the APRA limit. On the surface, they look manageable. But the surface is exactly where Banking Sentinel does not stop.

**The pipeline execution — timeline:**

| Time | Event |
|---|---|
| 0s | Query received. Intake Agent classifies: RISK_ANALYSIS, customerId=30100001 |
| 2s | Pattern Agent starts. RPT-1, PAL, and LLM run in parallel. |
| 8s | RPT-1 returns: MEDIUM, score 50, confidence 1.0 |
| 10s | scikit-learn Isolation Forest: 3 payments scored, 0 outliers |
| 12s | LLM anomaly detection: 5 anomalies flagged |
| 12s | Pattern complete. Score 50 → high_risk route. Trajectory Agent starts. |
| 18s | Trajectory reads BCA_DTI: income expiry 2027-04-01, 299 days away |
| 20s | Forward DTI calculated: 7.05x (up from 5.80x today) |
| 20s | LoanSchedule queried: AUD 46,590 in payments fall within expiry window |
| 22s | Trajectory complete. Relationship Agent starts. |
| 25s | Graph traversal: 30100001 → 30910005 → 30910006 (FAMILY_TRUST_MEMBER) |
| 28s | Exposure calculator: group total AUD 3,080,000 |
| 30s | APS 221 check: 41.07% of limit — within threshold |
| 32s | Relationship complete. Self-RAG Check starts. |
| 35s | Self-RAG evaluates: confidence 0.72 (≥ 0.70) — gaps identified, evidence trail incomplete but sufficient |
| 36s | Routes to Human Approval → pipeline pauses |
| 38s | Risk officer clicks Approve. Pipeline resumes. |
| 38s | Synthesis Agent starts. Four HANA Vector queries fire. |
| 40s | 7 APRA regulatory chunks retrieved (APS 221, CPS 230, DTI Notice) |
| 42s | Claude Haiku generates risk brief (2,500 token budget) |
| 44s | Deterministic apraReady check: TRUE |
| 44s | Results written to RiskAssessments and AuditLog in HANA |
| 44s | Risk brief delivered to risk officer's screen via SSE |

**Total pipeline time: ~40 seconds (HITL off) / ~106 seconds (HITL on)**
**Total cost: AUD 0.0022 (Claude Haiku pricing)**
**Tokens consumed: 9,277 input / 2,163 output**

**What the pipeline found that a scorecard would have missed:**
1. The income contract expires in 299 days — DTI will jump to 7.05x when it does
2. Two family trust entities (30910005, 30910006) are co-exposed — AUD 3.08M combined
3. Three payment records have no settlement date — unreconciled
4. The graph traversal is suspiciously shallow — Self-RAG flagged parent entities may be missing
5. The risk brief explicitly says what it does not know — not just what it found

---

## 8. Regulatory Compliance by Design

Banking Sentinel is built to comply with three APRA standards. Every design decision traces back to a specific regulatory requirement.

### APRA APS 221 — Large Exposures

APS 221 requires banks to aggregate exposure across connected parties and report when the total exceeds defined thresholds. The Relationship Agent exists solely to implement APS 221. Every graph traversal, every exposure calculation, every threshold check is an APS 221 obligation expressed in code.

### APRA CPS 230 — Operational Resilience

CPS 230 requires that AI systems used in risk decisions include human oversight, maintain audit trails, and survive operational disruptions. Three system design decisions implement this directly:

1. **Human-in-the-Loop interrupt** — every material risk analysis pauses for human approval before the final brief is sealed
2. **PostgreSQL state persistence** — the pipeline state survives CF restarts; an approval given before a deployment is not lost
3. **AuditLog** — every pipeline run writes token counts, latency, model used, and cost to a permanent HANA table. The risk officer can reconstruct exactly what the AI did and why, months later.

### APRA DTI Notice — Debt-to-Income Ratio

The DTI Notice sets the threshold above which high-DTI lending requires additional oversight. Banking Sentinel reads this threshold dynamically from `RegulatoryThresholds`. When APRA changes its guidance, the threshold changes in the database — no code deployment required. The next pipeline run immediately reflects the new position.

---

## 9. What the Risk Officer Sees

The Banking Sentinel UI displays the pipeline running in real time via Server-Sent Events (SSE). As each agent completes, its output appears on screen — bolded and populated.

**The dashboard shows:**
- **Risk Score** — 50 / 100, MEDIUM
- **Pattern Signal** — concerning (5 anomalies)
- **RPT-1** — MEDIUM, 100% confidence
- **PAL** — 0 / 3 payment rows flagged as outliers
- **Relationship Graph** — interactive canvas with 3 nodes, edges labelled by relationship type
- **Group Exposure** — AUD 3,080,000 (41.07% of APS 221 limit)
- **Trajectory** — Current DTI 5.80x → Forward DTI 7.05x (in 299 days)
- **Self-RAG** — Confidence 0.72, 4 gaps identified
- **HITL Status** — Approved by risk officer / Pending / Auto-approved (HITL off)
- **Synthesis** — Full risk brief with findings, recommendations, regulatory refs, uncertainties
- **Audit** — Cost AUD 0.0022, Latency 40.6s, Tokens 11,440

The report page merges all of this into a single printable brief: every View Details panel shows the same data as the report, so what the risk officer approves is exactly what goes into the permanent record.

---

## 10. Key Design Decisions and Lessons

### 1. Every AI call has a named pattern

There are no generic LLM calls. Every call is one of: intent classification (Intake), narrative anomaly detection (Pattern), quality self-evaluation (Self-RAG), ReAct tool-use loop (Relationship), or regulatory synthesis (Synthesis). When something breaks, you know exactly which pattern broke and why.

### 2. The APRA threshold is never hardcoded

Every agent that needs the DTI threshold reads it from `RegulatoryThresholds` at runtime. When the APRA Notice is applied in the UI, the threshold changes. The next run of the pipeline reflects it immediately — no deployment, no code change.

### 3. LangGraph state fields must be declared

LangGraph silently drops state fields that are not declared in `Annotation.Root`. This caused three bugs: `selfRagHistory`, `hitlEnabled`, and `totalLatencyMs` were all silently lost until each was explicitly declared with its reducer type.

### 4. Self-RAG must return one new item, not rebuild the full history

The `selfRagHistory` field uses an `append` reducer — each time the node runs, its return value is appended to the existing array. If the node returns `[...existingHistory, newItem]`, the reducer appends the full rebuilt array again — producing duplicates. The fix: return only `[newItem]` and let the reducer do the accumulation.

### 5. The Relationship Agent must not re-traverse from arbitrary nodes

Early iterations of the Relationship Agent would, on finding 0 connections for the primary customer, attempt traversals from random other entities. This pulled in completely unrelated connected-party chains and inflated group exposure. The system prompt now explicitly instructs: if SPARQL returns 0 connections, that is expected — use the guarantor data already returned.

### 6. AuditLog and state persistence are separate concerns

The `graph.updateState()` call persists data to the LangGraph checkpoint (PostgreSQL). The `logToAuditLog()` call writes to HANA. They are independent. If `graph.updateState()` throws and `logToAuditLog()` depends on it completing, the audit record is lost. The fix: wrap `graph.updateState()` in try-catch so `logToAuditLog()` always runs.

---

## 11. What Comes Next

Banking Sentinel is a working prototype built on SAP BTP trial account. The path to production involves four upgrades, each with a direct SAP equivalent:

| Prototype Component | Production Replacement |
|---|---|
| GraphDB sandbox (expires 7 days) | SAP HANA Knowledge Graph Engine |
| scikit-learn Flask service | SAP HANA PAL Isolation Forest (requires 3 vCPU) |
| Supabase free tier (pauses) | SAP BTP PostgreSQL Hyperscaler Option |
| Single demo customer (30100001) | Full portfolio: all BCA_DTI customers |

The architecture does not change. The data sources do not change. The SPARQL queries that work on GraphDB work identically on HANA KGE. The Isolation Forest model that runs on scikit-learn is the same algorithm as HANA PAL. The upgrade path is a configuration change, not a rebuild.

---

## Summary

Banking Sentinel demonstrates that a production-grade, regulation-compliant, multi-agent AI risk system can be built entirely on SAP BTP using SAP-native technologies — without leaving the ecosystem, without AI Core, and without compromising on the quality of risk analysis.

Seven agents. Four risk dimensions. Three APRA standards. One risk officer decision. Forty seconds.

The customer who looks fine on a scorecard — DTI 5.80x, no breach flag — is actually a MEDIUM risk customer with a forward DTI of 7.05x, connected to two family trust entities, with AUD 46,590 in payments at risk during an income expiry window, and a graph traversal that may not have captured the full picture yet.

Banking Sentinel does not approve or reject. It finds. It explains. It acknowledges what it does not know. And it gives the risk officer everything they need to make a confident, documented, APRA-compliant decision.

That is the purpose. Every line of code serves it.

---

*Built on: SAP BTP Cloud Foundry · SAP HANA Cloud · SAP CAP · SAP RPT-1 · LangGraph · Claude Haiku 4.5 · GraphDB / HANA KGE · scikit-learn / HANA PAL · Langfuse*

*APRA Standards: APS 221 (Large Exposures) · CPS 230 (Operational Resilience) · DTI Notice (Debt-to-Income)*
