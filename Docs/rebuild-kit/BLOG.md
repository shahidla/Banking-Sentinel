# Banking Sentinel: A Multi-Agent Credit-Risk Copilot on SAP HANA Cloud — Built on a Mixed AI Stack

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
   - Agent 4: Reflection Check
   - Agent 5: Human-in-the-Loop Approval
   - Agent 6: Synthesis Agent
7. [A Real Example — Customer 30100003](#7-a-real-example)
8. [Regulatory Compliance by Design](#8-regulatory-compliance)
9. [What the Risk Officer Sees](#9-what-the-risk-officer-sees)
10. [Key Design Decisions and Lessons](#10-key-design-decisions)
11. [What Comes Next](#11-what-comes-next)

---

## 1. The Problem We Are Solving

Every Australian bank faces the same invisible risk: a customer looks safe in isolation but is quietly part of a web of connected entities — family trusts, guarantor networks, subsidiary companies — whose combined exposure is far beyond what any single credit file shows.

A borrower with a modest loan today can be the linchpin of a group with ten times the exposure. By the time a human analyst pieces it together, it may be too late.

The traditional tools are spreadsheets, batch reports, and credit scorecards that look at one dimension at a time. A scorecard says the debt-to-income ratio is 7.20 times — already a concern, already on file as a breach. Fine. But it does not tell you:

- That the same customer's income contract expires in 83 days
- That when it does, their effective DTI rockets to 31.66 times — nearly 4x the regulator's limit
- That their loan is under-collateralized by AUD 620,000
- That the connected-party graph has no relationship edge for this customer at all — a guarantor obligation only surfaces through a separate table, easy to miss if you only check the graph
- That an AI re-query can sound more confident without being more correct — and that a system needs a way to catch that difference before it reaches a board

No single analyst. No single report. No single tool catches all of this at once.

**Banking Sentinel does.**

---

## 2. Why This Matters — Four Audiences

### For Banks
Risk is not one-dimensional. A borrower's risk lives across four dimensions simultaneously: their payment patterns, their future income trajectory, their network of connected parties, and whether the evidence trail is complete enough to act on. A miss in any one dimension can become a loss event. Banking Sentinel runs all four in parallel and produces a single, auditable risk brief — ready for the risk officer's desk in under two minutes.

### For SAP Customers
Banking Sentinel is a mixed-stack system with an explicit, deliberate SAP boundary. The data and ML layer is SAP-native and proven: SAP HANA Cloud for data and vectors, SAP CAP for the service layer, SAP RPT-1 for tabular AI scoring — interchangeable with HANA PAL and HANA Knowledge Graph Engine in production (see §11). The reasoning/orchestration layer — the LLM, LangGraph, Langfuse — is *not* SAP, and that's worth being upfront about: AI Core and AI Launchpad simply aren't available on the BTP trial tier this prototype runs on, so this is an access constraint, not a finding that the SAP stack is insufficient. Knowing exactly where that boundary sits is more useful to an SAP technical evaluator than a claim that there isn't one.

### For AI Practitioners
Banking Sentinel is a production implementation of a LangGraph multi-agent pipeline. It demonstrates four critical AI patterns: ReAct tool-use loops for graph traversal, Reflection (a Reflexion-style critic) for evidence quality control, Human-in-the-Loop interrupts for CPS 230 co-pilot compliance, and a RAGAS-inspired claim-source overlap check (implemented directly via cosine similarity, not the RAGAS library) to detect hallucination. Every AI pattern has a named purpose. Nothing is added for its own sake.

### For a General Audience
Imagine a bank has thousands of customers. Each one has loans, payments, and income. Each one is also connected to other people — through guarantees, family trusts, and business relationships. Banking Sentinel is like a very thorough analyst who simultaneously checks your payment behaviour, calculates what your finances look like in a year, maps everyone you are financially connected to, double-checks its own work, and then writes a clear report — all in the time it takes to make a cup of coffee.

---

## 3. What Banking Sentinel Does

Banking Sentinel is a **multi-agent AI risk intelligence system** deployed on SAP BTP (Business Technology Platform). A risk analyst types a single sentence: *"Analyse credit risk for customer 30100003."* Within roughly 75-110 seconds (HITL off / on), seven AI agents have examined the customer across four independent risk dimensions and produced an APRA-compliant risk brief, complete with regulatory references, confidence scores, and a clear recommendation.

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

LangGraph is a graph-based agent orchestration framework. Each agent is a node. Data flows between nodes via a typed state object. Conditional edges allow the pipeline to branch: a low-risk customer skips the graph traversal and jumps straight to synthesis. A high-risk customer goes through all four specialist agents. A re-query loop allows the Reflection agent to send the Relationship Agent back for a deeper traversal if the first pass was incomplete. This is impossible to express cleanly in a simple chain — it needs a state machine.

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
                    [Reflection Check]
                    LLM evaluates evidence quality
                              │
              Confidence < 0.70 ──→ [Relationship] (re-query, max 2x)
              Confidence ≥ 0.70 OR max re-queries reached ──→ [Human Approval]
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

**State flows through the pipeline in one typed object.** Every agent reads everything every previous agent produced. The Synthesis Agent sees Pattern's anomalies, Trajectory's DTI projections, Relationship's graph findings, and Reflection's quality gaps — all at once. Nothing is lost between agents.

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

**What happens next:** If `isRiskAnalysis`, the pipeline continues to the Pattern Agent. If `isSimpleDataQuery`, the query is delegated to a published MCP server (`cds-db-nlquery-mcp`) that translates it into a real CDS query — including JOINs and aggregates where needed — directly against `db/schema.cds`, then a second Claude Haiku call turns the result into a concise written answer. If `isInappropriateRequest`, a firm refusal is returned explaining that the system does not approve or override — that is a human decision.

**A live `SIMPLE_DATA_QUERY` example:**

*Query:* `"What is the total loan amount across all customers?"`

This isn't a single-row lookup — it requires a real SQL aggregate (`SUM(AMOUNT)`) across every loan in the portfolio, with no customer ID given at all. The Intake Agent correctly classifies it as `SIMPLE_DATA_QUERY` with `customerId: null`. The MCP server plans a structured query descriptor (`{"entity": "Loans", "aggregate": [{"fn": "sum", "col": "AMOUNT", "as": "total_loan_amount"}]}`) — never raw SQL text — executes it as a real CDS query, and returns the result for Claude Haiku to phrase:

> **Total Loan Amount Across All Customers**
> Total Loan Amount: AUD 31,773,000.00
>
> Would you like a full risk analysis of any specific borrower?

Verified against live HANA: 30 loan records, AUD 31,773,000.00 — confirmed against a direct `SUM(AMOUNT)` query as ground truth. This needed two rounds of fixes in the underlying `cds-db-nlquery-mcp` package — the query-planning LLM occasionally emitted a function-call string (`"SUM(AMOUNT)"`, then a wider variant with a trailing alias) as a literal column name instead of using the structured aggregate field. Both are now rejected up front with an actionable error instead of reaching HANA as a cryptic failure or, worse, silently returning a wrong total.

---

### Agent 1: Pattern Agent

**Purpose:** Establish the baseline risk signal. "Something feels wrong" — before any specific rule fires.

**The problem it solves:** A credit scorecard tells you a number. But a number alone does not tell you whether the payment behaviour is suspicious, whether the debt structure is unusual, or whether there are statistical outliers in how this customer compares to the portfolio. Pattern Agent runs three methods simultaneously and combines their signals.

**How it works (three methods in parallel):**

**Method 1 — SAP RPT-1 (Tabular Foundation Model)**
The agent fetches up to 50 historical loan cases from `BCA_CREDIT_HISTORY` — a dedicated table of independently-labelled outcomes — to use as in-context examples. Each row has: case ID, DTI ratio, breach flag, total debt, annual income, and a known `arrears_outcome` (LOW/MEDIUM/HIGH/CRITICAL). It sends these to `rpt.cloud.sap/api/predict` alongside the target customer's current profile (from `BCA_DTI`) with `arrears_outcome` marked `[PREDICT]`. RPT-1 applies in-context learning and returns a predicted arrears-risk category with a confidence score, mapped to a 0-100 scale via fixed floors (LOW:0, MEDIUM:26, HIGH:51, CRITICAL:76).

*For 30100003 (live run, 2026-06-24):* RPT-1 returns `CRITICAL` with confidence 0.46.

**Method 2 — Isolation Forest Anomaly Detection (scikit-learn / HANA PAL)**
The agent trains an Isolation Forest model on a 2D feature vector — payment delay days and dunning level (0-3) — drawn from up to 500 rows combined from `DFKKOP` (open items) and `DFKKOPK` (cleared items), the bank's full payment-history tables. Isolation Forest detects outliers by measuring how easily a data point can be isolated from the rest — anomalies are isolated in fewer splits. The 2D feature captures *joint* escalation: a customer whose delay **and** dunning level are both drifting gets flagged even when neither alone crosses a fixed threshold. Each of the customer's payment rows is then scored: label `-1` = outlier, `1` = inlier.

*For 30100003:* 0 of 7 payment rows flagged as outliers — this customer's single loan has no statistically unusual payment behaviour on its own. (The risk signal here comes from RPT-1 and the LLM method below, not from this statistical check — a good illustration of why Pattern Agent runs three independent methods rather than relying on one.)

**Method 3 — LLM Narrative Anomaly Detection (Claude Haiku)**
The raw customer data — loans, DTI record, up to 12 months of cleared payment history per loan, and collateral — is sent to Claude Haiku. The LLM is told the current APRA DTI threshold (fetched from `RegulatoryThresholds` — not hardcoded) and asked to find two specific things a single-row statistical check can't: an **escalating trend** across a loan's payment history (delay and/or dunning level rising over recent months, described narratively — e.g. "Loan L-001 deteriorated from on-time to 81-day delay / dunning level 3 over the last 5 months"), and **under-collateralization** (a loan's amount exceeding the total value of its pledged collateral). It's explicitly told not to flag a single row's overdue days in isolation — that's Method 2's job.

*For 30100003:* 2 anomalies identified, including loan L-004 (AUD 2.1M) exceeding its pledged collateral (AUD 1.48M) by AUD 620,000 — a security deficiency.

**Tables read from HANA:**
- `bankingsentinel.BCA_CREDIT_HISTORY` — 50 labelled historical cases for RPT-1 in-context learning
- `bankingsentinel.BCA_DTI` — this customer's current DTI ratio, annual income, total debt, breach flag, income expiry — the row RPT-1 predicts against
- `bankingsentinel.Loans` — loan IDs, amounts, types
- `bankingsentinel.DFKKOP` / `bankingsentinel.DFKKOPK` — open and cleared payment transactions (delay days, dunning level)
- `bankingsentinel.BCA_COLLATERAL` — collateral against loans
- `bankingsentinel.RegulatoryThresholds` — current APRA DTI threshold

**Output (for 30100003):**
```json
{
  "riskScore": 87,
  "riskLevel": "CRITICAL",
  "confidence": 0.46,
  "signal": "unclear",
  "anomalies": [
    "Loan L-004 (AUD 2.1M) exceeds collateral (AUD 1.48M) by AUD 620,000",
    "..."
  ]
}
```

**What happens next:** If riskScore < 30, the pipeline skips directly to Synthesis — no graph traversal needed. For 30100003 with score 87, the pipeline continues to the Trajectory Agent.

---

### Agent 2: Trajectory Agent

**Purpose:** Project the customer's financial position forward in time. "Where is this heading?"

**The problem it solves:** Current DTI is 7.20 times. The customer's income is from a contract that expires in 83 days. When that contract ends, the customer has the same debt but a fraction of their current income remaining this year. What does DTI look like then? And separately — even without the income expiry, what does a standard interest-rate-rise stress test do to this customer's serviceability?

**How it works:**

**Step 1 — Fetch current DTI data from HANA**
```sql
SELECT DTI_RATIO, TOTAL_DEBT, ANNUAL_INCOME, INCOME_EXPIRY, BREACH_FLAG
FROM bankingsentinel.BCA_DTI
WHERE PARTNER = '30100003'
```
*Result: DTI_RATIO=7.20, TOTAL_DEBT=2,100,000, ANNUAL_INCOME=291,667, INCOME_EXPIRY='2026-09-15', BREACH_FLAG=true*

**Step 2 — Fetch the APRA DTI threshold dynamically**
```sql
SELECT LIMIT_PCT FROM bankingsentinel.RegulatoryThresholds
WHERE THRESHOLD_TYPE = 'DEBT_TO_INCOME'
```
This is the key: the threshold is not hardcoded. It reads from the database, which can be updated in real time — for example when the APRA Notice button is clicked in the UI, the threshold changes from 8.0 to 6.0 and the next run of the pipeline reflects the new regulatory position immediately.

**Step 3 — Calculate Forward DTI (income-expiry projection)**

The formula: when income expires in N days, only N/365 of annual income remains effective this year.

```
Formula:
  effectiveIncome = annualIncome × (daysToExpiry / 365)
  futureDti       = totalDebt / effectiveIncome

For 30100003:
  daysToExpiry    = 83
  effectiveIncome = annualIncome × (83 / 365)   ← only 23% of income remains
  futureDti       = totalDebt / effectiveIncome = 31.66x
```

*Result: Forward DTI 31.66x — 296% above the APRA 8.0x limit.*

**Step 4 — Calculate a second, independent projection: the rate-stress test**

`trajectory-agent.js` runs a second forward calculation that has nothing to do with income expiry: APRA's APG 223 serviceability buffer (a standard +3%, read dynamically from `RegulatoryThresholds.RATE_STRESS_BUFFER`) models what happens if the cost of servicing this debt rises uniformly — the debt side grows, income stays constant.

```
Formula:
  stressedDebt        = totalDebt × (1 + RATE_STRESS_BUFFER_PCT / 100)
  futureDtiRateStress = stressedDebt / annualIncome

For 30100003:
  stressedDebt        = 2,100,000 × 1.03 = 2,163,000
  futureDtiRateStress = 2,163,000 / 291,667 = 7.42x
```

This runs independently of Step 3 — a customer could pass the income-expiry check but fail the rate-stress check, or vice versa. For 30100003 the income-expiry trajectory is already the dominant signal, but the rate-stress number (7.42x) is calculated and carried in the state regardless.

**Step 5 — Check for conflicting signals**

The agent compares Pattern Agent findings against the DTI data to identify contradictions. For 30100003, four signals fired:
1. Income contract expires in 83 days — primary servicing income at risk
2. Active APRA DTI breach combined with imminent income loss — compounding risk event
3. Forward DTI of 31.7× projected — 296% above APRA limit post-expiry
4. AUD 125,400 in scheduled loan payments fall within the income expiry window

**Tables read from HANA:**
- `bankingsentinel.BCA_DTI` — DTI ratio, income, debt, expiry
- `bankingsentinel.RegulatoryThresholds` — current APRA DTI threshold and the APG 223 rate-stress buffer
- `bankingsentinel.Loans` — loan IDs for payment schedule lookup
- `bankingsentinel.LoanSchedule` — scheduled payment amounts and due dates

**Output (for 30100003):**
```json
{
  "currentDti": 7.2,
  "futureDti": 31.66,
  "futureDtiRateStress": 7.42,
  "daysToExpiry": 83,
  "forwardPosition": "DETERIORATING",
  "conflictingSignals": [
    "Income contract expires in 83 days — primary servicing income at risk",
    "Active APRA DTI breach combined with imminent income loss — compounding risk event",
    "Forward DTI of 31.7× projected — 296% above APRA limit post-expiry",
    "AUD 125,400 in scheduled payments fall within income expiry window"
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

**The ReAct loop in action — first pass:**

```
Step 1: LLM reasons → "I need to find connected parties for 30100003"
        LLM acts → calls hana_graph_traverse(startNode: "30100003", depth: 6)
        Tool returns → 1 enriched node, 0 chain edges
                       (no BUT050 relationship row exists for this customer —
                        the graph itself has no edge here)

Step 2: LLM reasons → "Graph traversal found no connected entities. Check
                       guarantor data directly."
        LLM acts → calls exposure_calculator(entityIds: ["30100003"])
        Tool returns → groupExposure: 2,100,000 AUD (the guarantor cover on
                       loan L-004, from BCA_GUARANTOR — found via the
                       guarantor table, not via a graph edge)

Step 3: LLM reasons → "Now check against APRA APS 221 threshold."
        LLM acts → calls apra_threshold_check(metricType: "aps221", value: 2100000, entityId: "30100003")
        Tool returns → aps221Pct: 28.0%, within_limit: true

Step 4: LLM reasons → "Complete. I have enough to summarise."
        LLM stops calling tools and returns the finding.
```

**First-pass output:**
```json
{
  "nodes": ["30100003"],
  "groupExposure": 2100000,
  "aps221Pct": 28.0,
  "confidence": 0.95,
  "finding": "Customer 30100003 and guarantor 30910005 (Rose Courtney) have combined APS 221 exposure of AUD 2.1M (28% of limit), with no regulatory breach."
}
```

This first pass is real and grounded — it matches `BCA_GUARANTOR` exactly (Rose Courtney's cover on L-004 is AUD 2.1M, the same as the loan amount). But notice what it *missed*: because `BUT050` has no relationship row for this customer, `hana_graph_traverse` alone returns zero edges. The only reason the guarantor showed up at all is that `exposure_calculator` separately queries `BCA_GUARANTOR` directly — a real gap between "what the graph shows" and "what the relational tables show" that becomes important one step later.

**What the BUT050 table looks like** (for a customer that *does* have graph relationships, e.g. 30100001):

| FROM_PARTNER | TO_PARTNER | RELTYP |
|---|---|---|
| 30100001 | 30910005 | CONTACT_PERSON |
| 30100001 | 30910006 | CONTACT_PERSON |
| 30910005 | 30910006 | FAMILY_TRUST_MEMBER |

**Tables / databases accessed:**
- GraphDB / HANA KGE — SPARQL traversal of BUT050 relationship graph
- `bankingsentinel.BCA_GUARANTOR` — guaranteed loan amounts
- `bankingsentinel.Loans` — direct loan exposures
- `bankingsentinel.BCA_SECTOR` — sector concentration check

**What happens next:** Reflection Check evaluates whether this evidence is complete enough to proceed — and for 30100003, it doesn't think it is.

---

### Agent 4: Reflection Check

**Purpose:** The pipeline's quality control layer. Evaluate its own work. Ask: "Do I have enough evidence to stand behind these findings?"

**The problem it solves:** The Relationship Agent found 1 node and 0 edges. But is that complete, or did the traversal stop because there was genuinely nothing more to find? Is the CRITICAL Pattern Agent score consistent with a "clean" 28% exposure reading? Are the anomalies actually linked to specific exposure items, or floating assertions without an evidence trail?

A risk brief built on incomplete evidence is worse than no risk brief — because it creates false confidence.

**How it works:**

Reflection — a Reflexion-style critic step — means the LLM evaluates the prior agents' outputs for quality rather than generating new findings. Claude Haiku is given a summary of all four agent findings and asked to assess four dimensions:

1. **Graph Completeness** — Did the traversal stop early, or is there genuinely nothing more connected?
2. **Signal Consistency** — Do Pattern and Relationship findings agree? CRITICAL risk score + clean 28% exposure = inconsistency worth questioning.
3. **Conflicting Signals** — Are the trajectory conflicts explained by the graph, or still unresolved?
4. **Evidence Trail** — Is every risk claim backed by a specific TRBK record or exposure figure?

The LLM returns a confidence score (0.0-1.0) and, if confidence is below 0.70, a specific `reQueryHint` — a targeted instruction for the Relationship Agent to go deeper.

**For 30100003 — attempt 1:**

```json
{
  "overallConfidence": 0.58,
  "gaps": [
    "Graph traversal incomplete — only 1 node with 0 edges; guarantor 30910005 relationship not materialised in the relationship graph despite being named in the finding",
    "APS 221 exposure of AUD 2.1M (28%) sits awkwardly next to a CRITICAL risk score (87) — no exposure-to-risk reconciliation provided",
    "Income expiry in 83 days drives a 31.66× forward DTI, but Relationship found no contract-level evidence supporting it",
    "Pattern confidence 0.46 ('unclear' signal) conflicts with Relationship confidence 0.95"
  ],
  "reQueryHint": "Traverse the full guarantor network to node 30910005 and any parent entities; reconcile why APS 221 headroom exists despite CRITICAL risk and imminent breach.",
  "reasoning": "Graph shows only the customer node with zero edges despite naming a guarantor; relationship confidence cannot override incomplete traversal and unresolved signal conflicts."
}
```

**Routing:** 0.58 < 0.70 threshold → re-query (attempt 1). Relationship Agent re-runs with the hint.

**Relationship Agent, re-query pass:** Re-traversal still finds no new graph edges, but this time the LLM's `exposure_calculator` reasoning asserts much larger guarantor obligations — "AUD 6.18M and AUD 3.5M" — pushing reported exposure to AUD 11.78M (157.1% of the APS 221 limit, a CRITICAL breach), with a finding claiming the first pass had "excluded guarantor network obligations... creating a false 72% headroom illusion."

**This second-pass number does not hold up.** The real `BCA_GUARANTOR` record for this loan shows exactly one guarantee — Rose Courtney, AUD 2.1M, matching the loan amount precisely. The "6.18M + 3.5M = 9.68M" figure has no corresponding row in any table queried. This is the LLM asserting a number under pressure to resolve the re-query hint, not a verified tool result.

**For 30100003 — attempt 2 (after the re-query):**

```json
{
  "overallConfidence": 0.58,
  "gaps": [
    "Graph still collapsed to 1 node despite the re-query — parent entities/guarantor network claimed but not actually traversed",
    "APS 221 breach (157.1%) has no facility-level breakdown or TRBK records to verify the AUD 11.78M composition",
    "Pattern confidence (0.46) still contradicts Relationship confidence (0.92) — no resolution",
    "Guarantor obligation source unverified — AUD 9.68M cited as 'previous analysis' but no entity nodes or TRBK references shown"
  ],
  "reasoning": "Confidence does not improve on re-query — the second pass added an assertion, not verified evidence."
}
```

**The routing decision:**
- Confidence stayed at 0.58 < 0.70 on **both** attempts
- Maximum 2 re-queries reached → the pipeline does not loop forever — it proceeds anyway to Human Approval, carrying the low confidence score forward rather than blocking
- Crucially, low confidence here doesn't get silently dropped: it flows into Synthesis, which (next section) runs its own independent check and catches the same problem a second way

**Why this matters:** Reflection is the only agent that looks at the entire pipeline's output holistically. Here it did its job correctly twice — it never let an ungrounded number talk its way past the 0.70 threshold, even when a re-query handed back a more "complete-sounding" answer. That a re-query *can* make a finding more confident-sounding without making it more true is exactly why the threshold check exists independently of the LLM's own self-assessment.

---

### Agent 5: Human-in-the-Loop Approval (HITL)

**Purpose:** Mandatory human checkpoint. No risk brief reaches the customer file without a human reviewing the evidence first.

**The problem it solves:** APRA CPS 230 (Operational Resilience) requires that AI systems used in credit risk decisions operate as co-pilots — not autopilots. The risk officer must see the evidence and approve before the final brief is sealed.

**How it works:**

When Reflection says "proceed", LangGraph halts the pipeline using `interruptBefore: ['humanApproval']`. The pipeline is paused. The state is persisted to PostgreSQL — which means the pause survives a server restart. The risk officer is notified in the UI that the pipeline is waiting for their review.

The risk officer sees:
- Pattern findings: RPT-1 score, PAL anomaly counts, LLM anomalies
- Trajectory: Current DTI, Forward DTI, Days to income expiry
- Relationship: The visual graph of connected entities with exposure amounts
- Reflection gaps: Explicitly what the AI was uncertain about

They click **Approve**. The pipeline resumes. Synthesis runs. The brief is sealed with `approvedBy: "risk.officer@bank.com.au"`.

If HITL is disabled (for demo or low-risk customers), the pipeline runs straight through to Synthesis automatically.

---

### Agent 6: Synthesis Agent

**Purpose:** Write the APRA-ready risk brief. Combine all four agents' findings into a single, structured, regulatory-compliant document.

**The problem it solves:** Four agents have run. Each produced findings in its own format. A risk officer needs one concise brief with clear findings, recommendations, regulatory citations, and an honest statement of what is uncertain. This brief must be good enough to take to a board. It must cite the actual APRA regulations that apply. It must acknowledge what is not yet known.

**How it works:**

**Step 1 — Per-signal HANA Vector Search**
Instead of one generic regulatory query, the Synthesis Agent performs up to four targeted queries against the HANA Vector Engine, one per risk signal:
- *"DTI ratio 7.2 debt-to-income limit APRA activation"* → retrieves APS 220 / DTI Notice clauses
- *"connected party group exposure APS 221 large exposure"* → retrieves APS 221 thresholds
- *"income contract expiry forward DTI trajectory deteriorating"* → retrieves forward assessment requirements
- *"CPS 230 operational resilience AI model governance audit trail"* → retrieves CPS 230 obligations

The retrieved chunks are deduplicated and capped at 7 to stay within the token budget.

**Step 2 — LLM Synthesis (Claude Haiku, maxTokens: 2500)**
All four agents' outputs, plus the retrieved APRA regulatory text, are sent to Claude Haiku with a structured system prompt. The LLM produces a JSON risk brief — findings are constrained to 20 words each (precision over prose), with one regulatory standard and one evidence source per finding.

**Step 3 — Deterministic Guardrails**
The `apraReady` flag is NOT decided by the LLM. It is calculated deterministically from four conditions: confidence ≥ 0.70, Reflection passed, regulatory docs retrieved, no regulatory context failure. This prevents the LLM from deciding its own work is ready.

**Step 4 — Claim-Source Overlap Check (RAGAS-inspired, not the RAGAS library)**
A cosine-similarity check measures how much the LLM's findings overlap with the retrieved regulatory text. Low overlap (<30%) means the LLM may be relying on training data — or, as in this run, on an unverified claim from an earlier agent — rather than the retrieved documents. This is flagged in the uncertainty section.

**Step 5 — Persist to HANA**
The risk assessment is written to `bankingsentinel.RiskAssessments`. Token counts and cost are written to `bankingsentinel.AuditLog`. Both are permanent records under CPS 230.

**For 30100003 — the produced brief (live run, 2026-06-24):**

```json
{
  "riskScore": 92,
  "riskLevel": "CRITICAL",
  "confidence": 0.58,
  "findings": [
    {
      "finding": "Group exposure AUD 11.78M exceeds APS221 limit by 157.1%; CRITICAL breach.",
      "standard": "APS221",
      "severity": "HIGH",
      "evidenceSource": "relationship",
      "confidence": 0.92
    },
    {
      "finding": "Loan L-004 AUD 2.1M exceeds collateral AUD 1.48M by AUD 620K; security deficiency.",
      "standard": "APS221",
      "severity": "HIGH",
      "evidenceSource": "pattern",
      "confidence": 0.46
    },
    {
      "finding": "Income contract expires 83 days; primary servicing income at imminent risk.",
      "standard": "DTI_NOTICE",
      "severity": "HIGH",
      "evidenceSource": "trajectory",
      "confidence": 0.85
    },
    {
      "finding": "Forward DTI 31.66x post-expiry; 296% above APRA 8x limit; severe deterioration trajectory.",
      "standard": "DTI_NOTICE",
      "severity": "HIGH",
      "evidenceSource": "trajectory",
      "confidence": 0.8
    },
    {
      "finding": "AUD 9.68M guarantor obligations unverified; graph traversal incomplete; confidence contradiction 46% vs 92%.",
      "standard": "APS221",
      "severity": "HIGH",
      "evidenceSource": "reflection",
      "confidence": 0.58
    }
  ],
  "recommendations": [
    "Expand graph traversal to capture all parent entities and guarantor network; verify AUD 9.68M obligation chain with TRBK facility records.",
    "Link APS221 breach components to specific facilities; obtain collateral valuation for L-004 and refinance options before income expiry.",
    "Implement immediate income monitoring; establish contingency servicing plan for 83-day expiry window and AUD 125.4K payment schedule overlap."
  ],
  "regulatoryRefs": ["APS221", "DTI_NOTICE"],
  "uncertainties": [
    "Graph collapsed to single node despite the re-query; parent entity and guarantor network traversal incomplete — actual exposure underestimated.",
    "APS221 breach lacks facility-level breakdown; no TRBK records attached to verify the 11.78M composition.",
    "Pattern confidence 0.46 ('unclear' signal) contradicts relationship confidence 0.92; the underlying tool data does not support it.",
    "CPS 230 guardrail: low claim-source overlap (9%) — findings warrant manual review"
  ],
  "apraReady": false
}
```

Notice that Finding 1 and Finding 5 are in direct tension — Synthesis reports the CRITICAL 157.1% breach the Relationship Agent asserted, *and* flags in its own uncertainties that the AUD 9.68M behind it is unverified, *and* a 9% claim-source overlap, *and* sets `apraReady: false`. The brief does not pretend to have resolved a contradiction it can't actually resolve — it surfaces the contradiction and stops short of certifying it. That is the deterministic guardrail (Step 3) working exactly as designed: an LLM-written brief cannot mark its own homework "done" by simply asserting confidence.

---

## 7. A Real Example — Customer 30100003

Let us trace the full pipeline from the moment the query is entered to the moment the risk brief appears on screen. This is a live run, captured 2026-06-24, with HITL off (auto-advance through human approval).

**The query:** *"Analyse credit risk for customer 30100003"*

**Who is 30100003?**
A retail customer with one business loan (L-004, AUD 2.1 million, retail property sector). Annual income AUD 291,667 from a contract expiring 2026-09-15 — 83 days from this run. Current DTI is 7.20 times, already flagged in `BCA_DTI` as an active breach (`BREACH_FLAG: true`, dated 2025-08-10). On the surface this already looks concerning. What Banking Sentinel adds is *how much worse* it gets at income expiry, and — just as important — where its own evidence trail runs out.

**The pipeline execution — phase sequence (real run, total 73.98s):**

| Phase | What happened |
|---|---|
| Intake | Classifies RISK_ANALYSIS, customerId=30100003 |
| Pattern | RPT-1 → CRITICAL, confidence 0.46, score 87. Isolation Forest (scikit) → 0/7 outliers. LLM → 2 anomalies (L-004 under-collateralized by AUD 620K). Combined: score 87, CRITICAL, routes to high_risk. |
| Trajectory | Current DTI 7.20x. Forward DTI (income-expiry projection): 31.66x — 296% above the APRA 8x limit. Rate-stress DTI (independent +3% buffer check): 7.42x. Forward position: DETERIORATING. 4 conflicting signals raised. |
| Relationship (pass 1) | Graph traversal: 1 node, 0 edges (no BUT050 relationship row exists). Exposure calculator (via `BCA_GUARANTOR` directly): AUD 2.1M, 28% of APS 221 limit — looks clean. Confidence 0.95. |
| Reflection (attempt 1) | Confidence 0.58 — below the 0.70 threshold. 4 gaps raised, most pointed: a CRITICAL Pattern score next to a "clean" 28% exposure reading doesn't add up. Routes to re-query. |
| Relationship (pass 2 — re-query) | Re-traversal still finds 0 new edges, but the LLM asserts AUD 9.68M in additional guarantor obligations, pushing exposure to AUD 11.78M — 157.1% of the limit, a claimed CRITICAL breach. Confidence 0.92. |
| Reflection (attempt 2) | Confidence 0.58 — unchanged. 4 new gaps, all pointing at the same problem: the second pass added an assertion, not verified evidence. Maximum re-queries (2) reached → proceeds to Human Approval anyway, carrying the low confidence forward. |
| Human Approval | HITL off for this run → auto-advances. |
| Synthesis | 4 HANA Vector queries fire; 7 APRA regulatory chunks retrieved. Claude Haiku writes the brief. Claim-source overlap: 9% (low). Deterministic `apraReady` check: **false**. |
| Persist | Written to `RiskAssessments` and `AuditLog` in HANA. Risk brief delivered via SSE. |

**Total pipeline time: 73.98 seconds (HITL off)**
**Total cost: AUD 0.0025**
**Tokens consumed: 2,927 input / 709 output**

**What the pipeline found that a scorecard would have missed:**
1. The income contract expires in 83 days — forward DTI rockets to 31.66x, 296% above the APRA limit
2. Loan L-004 is under-collateralized by AUD 620,000 — a security deficiency a single DTI number wouldn't surface
3. The relationship graph genuinely has no edge for this customer's guarantor relationship — it only surfaces via a separate table, not the graph traversal tool
4. A re-query *raised* confidence-sounding language (157% CRITICAL breach) without raising actual evidence — and the system caught the difference: confidence stayed at 0.58, claim-source overlap measured only 9%, and `apraReady` stayed false
5. The risk brief explicitly says what it does not know — including, here, that its own most dramatic finding (the AUD 9.68M guarantor obligation) is unverified

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

**The dashboard shows** (live values for the 30100003 run above):
- **Risk Score** — 92 / 100, CRITICAL
- **Pattern Signal** — unclear (2 anomalies)
- **RPT-1** — CRITICAL, 46% confidence
- **Anomaly Detection (scikit-learn)** — 0 / 7 payment rows flagged as outliers — note this dashboard row shows whichever engine actually ran; it's labelled "PAL" only when `ANOMALY_ENGINE=pal` is set and the HANA PAL service genuinely executed
- **Relationship Graph** — interactive canvas; first pass 1 node / 0 edges, re-query pass still 1 node but a contested AUD 9.68M obligation claim
- **Group Exposure** — AUD 2,100,000 verified (28% of APS 221 limit) vs. AUD 11,780,000 claimed-but-unverified (157.1%)
- **Trajectory** — Current DTI 7.20x → Forward DTI 31.66x (in 83 days); rate-stress DTI 7.42x
- **Reflection** — Confidence 0.58 (both attempts), 4 gaps each time, max re-queries reached
- **HITL Status** — Auto-approved (HITL off) for this run
- **Synthesis** — Full risk brief with findings, recommendations, regulatory refs, uncertainties; `apraReady: false`
- **Audit** — Cost AUD 0.0025, Latency 73.98s, Tokens 3,636 total (2,927 in / 709 out)

The report page merges all of this into a single printable brief: every View Details panel shows the same data as the report, so what the risk officer approves is exactly what goes into the permanent record.

---

## 10. Key Design Decisions and Lessons

### 1. Every AI call has a named pattern

There are no generic LLM calls. Every call is one of: intent classification (Intake), narrative anomaly detection (Pattern), quality self-evaluation (Reflection), ReAct tool-use loop (Relationship), or regulatory synthesis (Synthesis). When something breaks, you know exactly which pattern broke and why.

### 2. The APRA threshold is never hardcoded

Every agent that needs the DTI threshold reads it from `RegulatoryThresholds` at runtime. When the APRA Notice is applied in the UI, the threshold changes. The next run of the pipeline reflects it immediately — no deployment, no code change.

### 3. LangGraph state fields must be declared

LangGraph silently drops state fields that are not declared in `Annotation.Root`. This caused three bugs: `reflectionHistory`, `hitlEnabled`, and `totalLatencyMs` were all silently lost until each was explicitly declared with its reducer type.

### 4. Reflection must return one new item, not rebuild the full history

The `reflectionHistory` field uses an `append` reducer — each time the node runs, its return value is appended to the existing array. If the node returns `[...existingHistory, newItem]`, the reducer appends the full rebuilt array again — producing duplicates. The fix: return only `[newItem]` and let the reducer do the accumulation.

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
| Single demo customer (30100003) | Full portfolio: all BCA_DTI customers |

The architecture does not change. The data sources do not change. The Isolation Forest model that runs on scikit-learn is the same algorithm as HANA PAL. The upgrade path is a configuration change, not a rebuild — but it's worth being precise about what "the same queries work on both" actually means: the *traversal semantics* carry over, not literal byte-for-byte SQL. Here's a concrete example for a sample business partner `0001`, showing what's actually run today against GraphDB and the equivalent HANA KGE query it maps to:

**Today — SPARQL against GraphDB:**
```sparql
PREFIX bs: <urn:banking-sentinel:>
SELECT DISTINCT ?partnerId ?reltyp WHERE {
  <urn:banking-sentinel:partner/0001> bs:relatedTo* ?node .
  ?node bs:partnerId ?partnerId .
  OPTIONAL {
    <urn:banking-sentinel:partner/0001> ?rel ?node .
    BIND(STRAFTER(STR(?rel), "relatedTo/") AS ?reltyp)
  }
}
```

**Production target — HANA KGE, `GRAPH_TABLE` on a `BP_RELATIONSHIP_GRAPH` workspace** (BUT050 rows as edges, BusinessPartners rows as vertices — the mapping described in `relationship-agent.js`):
```sql
SELECT connected_partner_id, rel_type
FROM GRAPH_TABLE (BP_RELATIONSHIP_GRAPH
  MATCH (a:BusinessPartner)-[e:RELATED_TO*]->(b:BusinessPartner)
  WHERE a.partner_id = '0001'
  COLUMNS (
    b.partner_id AS connected_partner_id,
    e.rel_type   AS rel_type
  )
)
```

Both express the same thing — variable-depth traversal from one business partner outward, returning every connected partner and the relationship type linking them. The vertex/edge mapping (BUT050 → graph edges, BusinessPartners → graph vertices) is the same in both. **This KGE query is the documented target shape, not a verified one** — HANA KGE isn't available on the BTP trial tier this prototype runs on, so it has never actually executed against a live KGE instance. The honest claim is: the traversal logic and data model translate directly; the literal SQL above has not been run.

---

## Summary

Banking Sentinel demonstrates a production-grade, regulation-compliant, multi-agent AI risk system on a mixed stack with an explicit SAP boundary: SAP HANA Cloud, SAP CAP, and SAP RPT-1 carry the data and tabular-AI layer end to end, proven and ready to swap toward HANA PAL and HANA Knowledge Graph Engine in production; the reasoning and orchestration layer is non-SAP today because AI Core isn't available on the trial tier this runs on, not because it was found wanting. Knowing exactly where that line sits is the more credible story.

Seven agents. Four risk dimensions. Three APRA standards. One risk officer decision. Under 80 seconds.

The customer who already shows a DTI breach on a scorecard — 7.20x — is actually a CRITICAL risk customer with a forward DTI of 31.66x at income expiry in 83 days, a loan under-collateralized by AUD 620,000, a connected-party graph with no relationship edge to show for it, and a re-query that produced a more dramatic-sounding exposure figure the system itself never verified — and correctly refused to certify.

Banking Sentinel does not approve or reject. It finds. It explains. It acknowledges what it does not know. And it gives the risk officer everything they need to make a confident, documented, APRA-compliant decision.

That is the purpose. Every line of code serves it.

---

*Built on: SAP BTP Cloud Foundry · SAP HANA Cloud · SAP CAP · SAP RPT-1 · LangGraph · Claude Haiku 4.5 · GraphDB / HANA KGE · scikit-learn / HANA PAL · Langfuse*

*APRA Standards: APS 221 (Large Exposures) · CPS 230 (Operational Resilience) · DTI Notice (Debt-to-Income)*
