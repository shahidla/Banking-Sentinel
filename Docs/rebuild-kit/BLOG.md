# Banking Sentinel: A Multi-Agent Credit-Risk Copilot on SAP HANA Cloud, Built on a Mixed AI Stack

### How Seven AI Agents Work Together to Protect a Bank From Credit Risk in Real Time

---

## Table of Contents

1. [The Problem We Are Solving](#1-the-problem-we-are-solving)
2. [Why This Matters](#2-why-this-matters)
3. [What Banking Sentinel Does](#3-what-banking-sentinel-does)
4. [The Technology Stack](#4-the-technology-stack)
5. [The Architecture: How It All Connects](#5-the-architecture)
6. [The Seven Agents: A Full Walkthrough](#6-the-seven-agents)
   - Agent 0: Intake Agent
   - Agent 1: Pattern Agent
   - Agent 2: Trajectory Agent
   - Agent 3: Relationship Agent
   - Agent 4: Reflection Check
   - Agent 5: Human-in-the-Loop Approval
   - Agent 6: Synthesis Agent
7. [A Real Example: Customer 30100003](#7-a-real-example)
8. [Regulatory Compliance by Design](#8-regulatory-compliance)
9. [What the Risk Officer Sees](#9-what-the-risk-officer-sees)
10. [Key Design Decisions and Lessons](#10-key-design-decisions)
11. [What Comes Next](#11-what-comes-next)

---

## 1. The Problem We Are Solving

Every bank faces the same invisible risk: a customer looks safe in isolation but is quietly part of a web of connected entities (family trusts, guarantor networks, subsidiary companies) whose combined exposure is far beyond what any single credit file shows.

A borrower with a modest loan today can be the linchpin of a group with ten times the exposure. By the time a human analyst pieces it together, it may be too late.

The traditional tools are spreadsheets, batch reports, and credit scorecards that look at one dimension at a time. A scorecard says the debt-to-income ratio is 7.20 times, already a concern, already on file as a breach. Fine. But it does not tell you:

- That the same customer's income contract expires in 82 days
- That when it does, their effective DTI rockets to 32.05 times, over 4x the regulator's limit
- That their loan is under-collateralized by AUD 620,000
- That the connected-party graph has no relationship edge for this customer at all. A guarantor obligation only surfaces through a separate table, easy to miss if you only check the graph
- That a shared guarantor connects this customer to a family trust, and that correctly scoping group exposure to only the loans within that group (not a guarantor's unrelated obligations elsewhere in the portfolio) is its own real engineering problem, not just a data-fetching one

No single analyst. No single report. No single tool catches all of this at once.

**Banking Sentinel does.**

---

## 2. Why This Matters

A borrower's risk doesn't live in one place. It's spread across payment behaviour, where their finances are heading, who they're financially connected to, and whether there's enough evidence to act on any of it. Miss one of those and a loss event can slip through a credit file that otherwise looks fine. Banking Sentinel checks all four, each step building on what the last one found, and turns the result into a single risk brief a human can review in under two minutes.

On the SAP side: this is a mixed-stack system with a deliberate boundary, not a claim that everything is SAP-native. The data and ML layer is SAP and proven (HANA Cloud, CAP, RPT-1, interchangeable with HANA PAL and Knowledge Graph Engine in production, see §11). The reasoning layer (the LLM, LangGraph, Langfuse) is not SAP, because AI Core isn't available on the BTP trial tier this runs on. That's an access constraint, not a verdict on SAP's capability.

On the AI side: four patterns do real work here, not added for show. A ReAct loop drives graph traversal. A Reflexion-style critic (Reflection) checks evidence quality before anything is finalized. Human-in-the-Loop interrupts enforce compliance sign-off. A RAGAS-inspired claim-source check (cosine similarity, not the RAGAS library) catches an LLM asserting something the evidence doesn't support, exactly what happens in §6 and §7.

---

## 3. What Banking Sentinel Does

Banking Sentinel is a **multi-agent AI risk intelligence system** deployed on SAP BTP (Business Technology Platform). A risk analyst types a single sentence: *"Analyse credit risk for customer 30100003."* Within roughly 75 to 110 seconds (HITL off or on), seven AI agents have examined the customer across four independent risk dimensions and produced an APRA-compliant risk brief, complete with regulatory references, confidence scores, and a clear recommendation.

**The system produces:**
- A risk score (0-100) with level: LOW / MEDIUM / HIGH / CRITICAL
- Five specific findings with regulatory standard, severity, evidence source, and confidence score
- Three actionable recommendations
- Identified data gaps and uncertainties, not hidden, explicitly surfaced
- A regulatory audit trail under APRA CPS 230 and APS 221
- A flag: APRA-Ready (true/false), whether the evidence is strong enough to take to a board

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
| Graph Engine | GraphDB (RDF/SPARQL), HANA KGE in production | Connected-party traversal |
| Tabular AI Model | SAP RPT-1 (rpt.cloud.sap) | Tabular risk scoring without AI Core |
| Anomaly Detection | scikit-learn Isolation Forest (HANA PAL in production) | Statistical payment anomaly detection |
| LLM | Claude Haiku 4.5 (Anthropic) | All natural language reasoning |
| Agent Orchestration | LangGraph (StateGraph) | Multi-agent pipeline with conditional routing |
| State Persistence | PostgreSQL / Supabase | LangGraph checkpoint, survives CF restarts |
| Embeddings | OpenAI text-embedding-3-small | APRA document vectorisation |
| Observability | Langfuse | Per-agent token usage, latency, traces |
| Real-time UI | Server-Sent Events (SSE) | Live agent progress in browser |
| Event Mesh | Solace (Advanced Event Mesh) | Publishes pipeline events to `banking/*` topics. A real, persistent broker connection, genuinely sending messages, but no consumer is wired up within this demo; the UI's live updates come via SSE, not Solace |
| Frontend | Vanilla HTML/CSS/JS | Bank-grade UI, no framework dependencies |

### Why SAP RPT-1?

RPT-1 is SAP's tabular foundation model, available via a public consumer API at rpt.cloud.sap without requiring AI Core or SAP AI Launchpad. It uses in-context learning: send it example rows from your portfolio with known risk categories, then ask it to classify your target customer. No training. No fine-tuning. Immediate results. Banking Sentinel uses it as the foundational risk score before any LLM reasoning begins.

### Why LangGraph?

LangGraph is a graph-based agent orchestration framework. Each agent is a node. Data flows between nodes via a typed state object. Conditional edges allow the pipeline to branch: a low-risk customer skips the graph traversal and jumps straight to synthesis, while a high-risk customer goes through all four specialist agents. A re-query loop allows the Reflection agent to send the Relationship Agent back for a deeper traversal if the first pass was incomplete. This is impossible to express cleanly in a simple chain. It needs a state machine.

### Why HANA Vector Engine?

APRA regulatory documents (APS 221, CPS 230, DTI Notices) are embedded into HANA Cloud's native vector engine. When the Synthesis Agent writes the risk brief, it retrieves the most relevant regulatory clauses by semantic similarity, not keyword matching. This means the risk brief cites the actual paragraph of the actual regulation that applies to the specific risk being assessed.

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

**State flows through the pipeline in one typed object.** Every agent reads everything every previous agent produced. The Synthesis Agent sees Pattern's anomalies, Trajectory's DTI projections, Relationship's graph findings, and Reflection's quality gaps, all at once. Nothing is lost between agents.

---

## 6. The Seven Agents: A Full Walkthrough

---

### Agent 0: Intake Agent

**Purpose:** Parse the user's query. Decide what kind of request this is. Route accordingly.

**The problem it solves:** A risk officer might type "Analyse 30100001" or "What is the DTI for 30100001?" or "Approve the loan for 30100001." These are three completely different requests. The first triggers a full seven-agent pipeline. The second is a simple database lookup. The third must be refused. Banking Sentinel is a co-pilot, not a decision-maker.

**How it works:** Claude Haiku reads the user's query against a system prompt that defines three intent categories:
- `RISK_ANALYSIS`: triggers the full agent pipeline
- `SIMPLE_DATA_QUERY`: answered directly from HANA, no pipeline
- `INAPPROPRIATE_REQUEST`: any attempt to approve, reject, delete, modify, or override

The agent also extracts the customer ID. SAP Business Partner numbers are 8-digit codes (e.g. 30100001). The agent is instructed to extract them exactly, no reformatting.

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

**What happens next:** If `isRiskAnalysis`, the pipeline continues to the Pattern Agent. If `isSimpleDataQuery`, the query is delegated to a published MCP server (`cds-db-nlquery-mcp`) that translates it into a real CDS query, including JOINs and aggregates where needed, directly against `db/schema.cds`. A second Claude Haiku call then turns the result into a concise written answer. If `isInappropriateRequest`, a firm refusal is returned explaining that the system does not approve or override. That is a human decision.

**A live `SIMPLE_DATA_QUERY` example:**

*Query:* `"What is the total loan amount across all customers?"`

This isn't a single-row lookup. It requires a real SQL aggregate (`SUM(AMOUNT)`) across every loan in the portfolio, with no customer ID given at all. The Intake Agent correctly classifies it as `SIMPLE_DATA_QUERY` with `customerId: null`. The MCP server plans a structured query descriptor (`{"entity": "Loans", "aggregate": [{"fn": "sum", "col": "AMOUNT", "as": "total_loan_amount"}]}`), never raw SQL text, executes it as a real CDS query, and returns the result for Claude Haiku to phrase:

> **Total Loan Amount Across All Customers**
> Total Loan Amount: AUD 31,773,000.00
>
> Would you like a full risk analysis of any specific borrower?

Verified against live HANA: 30 loan records, AUD 31,773,000.00, confirmed against a direct `SUM(AMOUNT)` query as ground truth. This needed two rounds of fixes in the underlying `cds-db-nlquery-mcp` package: the query-planning LLM occasionally emitted a function-call string (`"SUM(AMOUNT)"`, then a wider variant with a trailing alias) as a literal column name instead of using the structured aggregate field. Both are now rejected up front with an actionable error instead of reaching HANA as a cryptic failure or, worse, silently returning a wrong total.

---

### Agent 1: Pattern Agent

**Purpose:** Establish the baseline risk signal. "Something feels wrong," before any specific rule fires.

**The problem it solves:** A credit scorecard tells you a number. But a number alone does not tell you whether the payment behaviour is suspicious, whether the debt structure is unusual, or whether there are statistical outliers in how this customer compares to the portfolio. Pattern Agent runs three methods and combines their signals.

**How it works:** RPT-1 (Method 1) runs alone first. We diagnosed empirically that it was prone to BTP-only timeouts when racing the other two methods inside the same single-threaded event loop. Isolation Forest (Method 2) and the LLM narrative pass (Method 3) then run in parallel with each other, but not with RPT-1.

**Method 1: SAP RPT-1 (Tabular Foundation Model)**
The agent fetches up to 50 historical loan cases from `BCA_CREDIT_HISTORY`, a dedicated table of independently-labelled outcomes, to use as in-context examples. Each row has: case ID, DTI ratio, breach flag, total debt, annual income, and a known `arrears_outcome` (LOW/MEDIUM/HIGH/CRITICAL). It sends these to `rpt.cloud.sap/api/predict` alongside the target customer's current profile (from `BCA_DTI`) with `arrears_outcome` marked `[PREDICT]`. RPT-1 applies in-context learning and returns a predicted arrears-risk category with a confidence score, mapped to a 0-100 scale via fixed floors (LOW:0, MEDIUM:26, HIGH:51, CRITICAL:76).

*For 30100003 (live run, 2026-06-24):* RPT-1 returns `CRITICAL` with confidence 0.46.

**Method 2: Isolation Forest Anomaly Detection (scikit-learn / HANA PAL)**
The agent trains an Isolation Forest model on a 2D feature vector, payment delay days and dunning level (0-3), drawn from up to 500 rows combined from `DFKKOP` (open items) and `DFKKOPK` (cleared items), the bank's full payment-history tables. Isolation Forest detects outliers by measuring how easily a data point can be isolated from the rest: anomalies are isolated in fewer splits. The 2D feature captures *joint* escalation: a customer whose delay **and** dunning level are both drifting gets flagged even when neither alone crosses a fixed threshold. Each of the customer's payment rows is then scored: label `-1` for outlier, `1` for inlier.

*For 30100003:* 0 of 7 payment rows flagged as outliers. This customer's single loan has no statistically unusual payment behaviour on its own. (The risk signal here comes from RPT-1 and the LLM method below, not from this statistical check, a good illustration of why Pattern Agent runs three independent methods rather than relying on one.)

**Method 3: LLM Narrative Anomaly Detection (Claude Haiku)**
The raw customer data (loans, DTI record, up to 12 months of cleared payment history per loan, and collateral) is sent to Claude Haiku. The LLM is told the current APRA DTI threshold (fetched from `RegulatoryThresholds`, not hardcoded) and asked to find two specific things a single-row statistical check can't: an **escalating trend** across a loan's payment history (delay and/or dunning level rising over recent months, described narratively, e.g. "Loan L-001 deteriorated from on-time to 81-day delay / dunning level 3 over the last 5 months"), and **under-collateralization** (a loan's amount exceeding the total value of its pledged collateral). It's explicitly told not to flag a single row's overdue days in isolation. That's Method 2's job.

*For 30100003:* 2 anomalies identified, including loan L-004 (AUD 2.1M) exceeding its pledged collateral (AUD 1.48M) by AUD 620,000, a security deficiency.

**Tables read from HANA:**
- `bankingsentinel.BCA_CREDIT_HISTORY`: 50 labelled historical cases for RPT-1 in-context learning
- `bankingsentinel.BCA_DTI`: this customer's current DTI ratio, annual income, total debt, breach flag, income expiry. The row RPT-1 predicts against
- `bankingsentinel.Loans`: loan IDs, amounts, types
- `bankingsentinel.DFKKOP` / `bankingsentinel.DFKKOPK`: open and cleared payment transactions (delay days, dunning level)
- `bankingsentinel.BCA_COLLATERAL`: collateral against loans
- `bankingsentinel.RegulatoryThresholds`: current APRA DTI threshold

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

**What happens next:** If riskScore is below 30, the pipeline skips directly to Synthesis. No graph traversal needed. For 30100003 with score 87, the pipeline continues to the Trajectory Agent.

---

### Agent 2: Trajectory Agent

**Purpose:** Project the customer's financial position forward in time. "Where is this heading?"

**The problem it solves:** Current DTI is 7.20 times. The customer's income is from a contract that expires in 82 days. When that contract ends, the customer has the same debt but a fraction of their current income remaining this year. What does DTI look like then? And separately, even without the income expiry, what does a standard interest-rate-rise stress test do to this customer's serviceability?

**How it works:**

**Step 1: Fetch current DTI data from HANA**
```sql
SELECT DTI_RATIO, TOTAL_DEBT, ANNUAL_INCOME, INCOME_EXPIRY, BREACH_FLAG
FROM bankingsentinel.BCA_DTI
WHERE PARTNER = '30100003'
```
*Result: DTI_RATIO=7.20, TOTAL_DEBT=2,100,000, ANNUAL_INCOME=291,667, INCOME_EXPIRY='2026-09-15', BREACH_FLAG=true*

**Step 2: Fetch the APRA DTI threshold dynamically**
```sql
SELECT LIMIT_PCT FROM bankingsentinel.RegulatoryThresholds
WHERE THRESHOLD_TYPE = 'DEBT_TO_INCOME'
```
This is the key: the threshold is not hardcoded. It reads from the database, which can be updated in real time. For example, when the APRA Notice button is clicked in the UI, the threshold changes from 8.0 to 6.0 and the next run of the pipeline reflects the new regulatory position immediately.

**Step 3: Calculate Forward DTI (income-expiry projection)**

The formula: when income expires in N days, only N/365 of annual income remains effective this year.

```
Formula:
  effectiveIncome = annualIncome × (daysToExpiry / 365)
  futureDti       = totalDebt / effectiveIncome

For 30100003:
  daysToExpiry    = 83
  effectiveIncome = annualIncome × (83 / 365)   ← only 23% of income remains
  futureDti       = totalDebt / effectiveIncome = 32.05x
```

*Result: Forward DTI 32.05x, 301% above the APRA 8.0x limit.*

**Step 4: Calculate a second, independent projection, the rate-stress test**

`trajectory-agent.js` runs a second forward calculation that has nothing to do with income expiry: APRA's APG 223 serviceability buffer (a standard +3%, read dynamically from `RegulatoryThresholds.RATE_STRESS_BUFFER`) models what happens if the cost of servicing this debt rises uniformly. The debt side grows, income stays constant.

```
Formula:
  stressedDebt        = totalDebt × (1 + RATE_STRESS_BUFFER_PCT / 100)
  futureDtiRateStress = stressedDebt / annualIncome

For 30100003:
  stressedDebt        = 2,100,000 × 1.03 = 2,163,000
  futureDtiRateStress = 2,163,000 / 291,667 = 7.42x
```

This runs independently of Step 3. A customer could pass the income-expiry check but fail the rate-stress check, or vice versa. For 30100003 the income-expiry trajectory is already the dominant signal, but the rate-stress number (7.42x) is calculated and carried in the state regardless.

**Step 5: Check for conflicting signals**

The agent compares Pattern Agent findings against the DTI data to identify contradictions. For 30100003, four signals fired:
1. Income contract expires in 82 days. Primary servicing income at risk.
2. Active APRA DTI breach combined with imminent income loss. Compounding risk event.
3. Forward DTI of 32.0× projected. 301% above APRA limit post-expiry.
4. AUD 125,400 in scheduled loan payments fall within the income expiry window.

**Tables read from HANA:**
- `bankingsentinel.BCA_DTI`: DTI ratio, income, debt, expiry
- `bankingsentinel.RegulatoryThresholds`: current APRA DTI threshold and the APG 223 rate-stress buffer
- `bankingsentinel.Loans`: loan IDs for payment schedule lookup
- `bankingsentinel.LoanSchedule`: scheduled payment amounts and due dates

**Output (for 30100003):**
```json
{
  "currentDti": 7.2,
  "futureDti": 32.05,
  "futureDtiRateStress": 7.42,
  "daysToExpiry": 83,
  "forwardPosition": "DETERIORATING",
  "conflictingSignals": [
    "Income contract expires in 82 days — primary servicing income at risk",
    "Active APRA DTI breach combined with imminent income loss — compounding risk event",
    "Forward DTI of 32.0× projected — 301% above APRA limit post-expiry",
    "AUD 125,400 in scheduled payments fall within income expiry window"
  ]
}
```

**What happens next:** Relationship Agent runs, receiving Pattern's anomalies and Trajectory's DTI context in its state.

---

### Agent 3: Relationship Agent

**Purpose:** Find every entity connected to this customer. Calculate their combined group exposure against APRA's large exposure limit (APS 221).

**The problem it solves:** Borrowers often operate within networks: family trusts, corporate groups, guarantor chains. APRA's APS 221 standard requires banks to aggregate exposure across connected parties. A customer with a AUD 500,000 loan who is a member of a trust with AUD 2.5 million in loans is part of a AUD 3 million exposure group. The bank must know this.

**How it works, a ReAct (Reasoning + Acting) Loop:**

The agent uses Claude Haiku with three tools it can call iteratively:

**Tool 1: `hana_graph_traverse`**
Traverses the graph database starting from the customer's business partner ID. Returns all connected nodes (entities) and edges (relationship types) up to 8 hops deep. The underlying technology is GraphDB (an RDF triple store using SPARQL 1.1) in the demo environment, with HANA Knowledge Graph Engine as the production replacement. The same SPARQL queries work on both.

The data comes from `BUT050`, SAP's Business Partner Relationship table, which stores every relationship between business partners: parent-subsidiary, guarantor, family trust member, director, and so on.

**Tool 2: `exposure_calculator`**
Takes a list of all connected entity IDs and queries `BCA_GUARANTOR` and `Loans` to calculate total guaranteed and direct loan exposure across the group.

**Tool 3: `apra_threshold_check`**
Checks the calculated exposure against APRA's APS 221 large exposure limit (AUD 7.5 million for this demo). Returns the utilisation percentage.

**The ReAct loop in action, first pass:**

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

This first pass is real and grounded. It matches `BCA_GUARANTOR` exactly (Rose Courtney's cover on L-004 is AUD 2.1M, the same as the loan amount). Notice what it *missed*: because `BUT050` has no relationship row for this customer, `hana_graph_traverse` alone returns zero edges. The only reason the guarantor showed up at all is that `exposure_calculator` separately queries `BCA_GUARANTOR` directly, a real gap between "what the graph shows" and "what the relational tables show."

**A real bug we found and fixed while building this exact example.** `exposure_calculator` originally summed a connected guarantor's *entire* guarantee book, every loan they back anywhere in the portfolio, not just the loans within this customer's group. Rose Courtney also guarantees loans for three other, unrelated customers elsewhere in the bank. Pulling those in inflated reported group exposure from a correct AUD 2.1M to a false AUD 11.78M (157% of the APS 221 limit) on a re-query, and it happened with two different starting customers who happen to share a guarantor, which is exactly the kind of bug that looks like a one-off coincidence until you check the data twice. The fix scopes guarantee cover to only loans already held by an entity in the connected group. The walkthrough below reflects the corrected behaviour, verified against live HANA after the fix.

**What the BUT050 table looks like** (for a customer that *does* have graph relationships, e.g. 30100001):

| FROM_PARTNER | TO_PARTNER | RELTYP |
|---|---|---|
| 30100001 | 30910005 | CONTACT_PERSON |
| 30100001 | 30910006 | CONTACT_PERSON |
| 30910005 | 30910006 | FAMILY_TRUST_MEMBER |

**Tables / databases accessed:**
- GraphDB / HANA KGE: SPARQL traversal of BUT050 relationship graph
- `bankingsentinel.BCA_GUARANTOR`: guaranteed loan amounts
- `bankingsentinel.Loans`: direct loan exposures
- `bankingsentinel.BCA_SECTOR`: sector concentration check

**What happens next:** Reflection Check evaluates whether this evidence is complete enough to proceed, and for 30100003, it doesn't think it is.

---

### Agent 4: Reflection Check

**Purpose:** The pipeline's quality control layer. Evaluate its own work. Ask: "Do I have enough evidence to stand behind these findings?"

**The problem it solves:** The Relationship Agent found 1 node and 0 edges. But is that complete, or did the traversal stop because there was genuinely nothing more to find? Is the CRITICAL Pattern Agent score consistent with a "clean" 28% exposure reading? Are the anomalies actually linked to specific exposure items, or floating assertions without an evidence trail?

A risk brief built on incomplete evidence is worse than no risk brief, because it creates false confidence.

**How it works:**

Reflection, a Reflexion-style critic step, means the LLM evaluates the prior agents' outputs for quality rather than generating new findings. Claude Haiku is given a summary of all four agent findings and asked to assess four dimensions:

1. **Graph Completeness**: Did the traversal stop early, or is there genuinely nothing more connected?
2. **Signal Consistency**: Do Pattern and Relationship findings agree? CRITICAL risk score plus clean 28% exposure is an inconsistency worth questioning.
3. **Conflicting Signals**: Are the trajectory conflicts explained by the graph, or still unresolved?
4. **Evidence Trail**: Is every risk claim backed by a specific TRBK record or exposure figure?

The LLM returns a confidence score (0.0-1.0) and, if confidence is below 0.70, a specific `reQueryHint`, a targeted instruction for the Relationship Agent to go deeper.

**For 30100003, attempt 1 (live run, post-fix):**

```json
{
  "overallConfidence": 0.58,
  "gaps": [
    "Graph traversal incomplete — only 1 node despite CRITICAL risk and a guarantor relationship claimed; guarantor 30910005 not traversed for counter-guarantees, parent entities, or cross-collateral exposure",
    "Pattern confidence (0.46) contradicts Relationship confidence (0.95) — unclear signal plus low pattern confidence suggests risk drivers not yet identified in the graph structure",
    "APS 221 exposure (28%) appears manageable, but CRITICAL risk score (87) and deteriorating DTI (7.2 → 32.05) lack corresponding graph-based evidence; missing connection between income expiry and liability cascade",
    "No TRBK defaults, arrears, or covenant breaches documented despite CRITICAL classification and imminent income loss",
    "Scheduled payment window (AUD 125,400 in 82 days) not mapped to specific loan tranches, guarantees, or maturity dates in the relationship graph"
  ],
  "reQueryHint": "From customer 30100003, traverse all loan tranches and follow guarantor 30910005 for parent guarantees, cross-default clauses, and counter-guarantee relationships. Flag any loans with maturity at or under 82 days.",
  "reasoning": "High trajectory risk is plausible but unmoored from relationship evidence; the single-node graph and low pattern confidence suggest the risk story exists operationally but hasn't been validated through full entity traversal."
}
```

**Routing:** 0.58 is below the 0.70 threshold, so it re-queries (attempt 1). Relationship Agent re-runs with the hint.

**Relationship Agent, re-query pass:** This is where the bug above used to inflate the number. After the fix, the re-traversal genuinely adds one real fact, Rose Courtney's family-trust connection to 30910006, without changing the exposure figure at all:

```json
{
  "nodes": ["30100003"],
  "groupExposure": 2100000,
  "aps221Pct": 28.0,
  "confidence": 0.72,
  "finding": "Guarantor 30910005 (Rose Courtney) connected to family trust member 30910006; group exposure AUD 2.1M (28% of APS 221 limit) remains non-breaching. Loan tranche expiry, payment schedule, and cross-default clause details were not returned by traversal."
}
```

Same AUD 2.1M. Same 28%. The only thing that changed is an honest new fact (the family-trust link) and an honest new gap (loan-level facility details aren't in the graph at all). No fabricated crisis, because there's no longer a code path that can produce one.

**For 30100003, attempt 2 (after the re-query):**

```json
{
  "overallConfidence": 0.58,
  "gaps": [
    "Graph traversal halted at 1 node despite CRITICAL risk — no parent entities, upstream guarantors, or trust beneficiaries mapped beyond 30910005/30910006",
    "APS 221 exposure at 28% (non-breaching) contradicts the CRITICAL risk score and 32x forward DTI — the exposure calculation may not reflect contingent liabilities or cross-default cascade",
    "Loan-level details (tranche expiry, payment schedule, cross-default triggers) explicitly noted as absent — Trajectory's 82-day income expiry and AUD 125,400 scheduled payments lack corresponding TRBK facility records",
    "Signal quality mismatch: rpt1Success and palSuccess both true with pattern confidence 0.46, but 'signal: unclear' prevents attributing CRITICAL to a specific driver"
  ],
  "reasoning": "CRITICAL risk and a deteriorating forward DTI are unmoored from graph findings (1 node, non-breaching exposure); absent loan facility records and an incomplete guarantor/trust network prevent validating whether exposure cascade or cross-default mechanics justify the severity classification."
}
```

**The routing decision:**
- Confidence stayed at 0.58, below 0.70, on **both** attempts, and the exposure figure stayed at the same correct AUD 2.1M on both attempts too
- Maximum 2 re-queries reached. The pipeline does not loop forever. It proceeds anyway to Human Approval, carrying the gaps forward rather than blocking
- The honest gap here isn't "the LLM made something up." It's that this customer's CRITICAL classification is genuinely driven by Pattern and Trajectory (the under-collateralized loan, the income-expiry DTI spike), not by the relationship graph, and the relationship graph's own evidence (a clean, real 28%) can't explain that on its own. Reflection correctly refuses to paper over that mismatch.

**Why this matters:** Reflection is the only agent that looks at the entire pipeline's output holistically. Here, it correctly distinguishes "this signal is genuinely clean" from "this signal explains the whole risk picture," and won't let a re-query manufacture false agreement between the two just to clear the confidence threshold.

---

### Agent 5: Human-in-the-Loop Approval (HITL)

**Purpose:** Mandatory human checkpoint. No risk brief reaches the customer file without a human reviewing the evidence first.

**The problem it solves:** APRA CPS 230 (Operational Resilience) requires that AI systems used in credit risk decisions operate as co-pilots, not autopilots. The risk officer must see the evidence and approve before the final brief is sealed.

**How it works:**

When Reflection says "proceed," LangGraph halts the pipeline using `interruptBefore: ['humanApproval']`. The pipeline is paused. The state is persisted to PostgreSQL, which means the pause survives a server restart. The risk officer is notified in the UI that the pipeline is waiting for their review.

The risk officer sees:
- Pattern findings: RPT-1 score, PAL anomaly counts, LLM anomalies
- Trajectory: current DTI, forward DTI, days to income expiry
- Relationship: the visual graph of connected entities with exposure amounts
- Reflection gaps: explicitly what the AI was uncertain about

They click **Approve**. The pipeline resumes. Synthesis runs. The brief is sealed with `approvedBy: "risk.officer@bank.com.au"`.

If HITL is disabled (for demo or low-risk customers), the pipeline runs straight through to Synthesis automatically.

---

### Agent 6: Synthesis Agent

**Purpose:** Write the APRA-ready risk brief. Combine all four agents' findings into a single, structured, regulatory-compliant document.

**The problem it solves:** Four agents have run. Each produced findings in its own format. A risk officer needs one concise brief with clear findings, recommendations, regulatory citations, and an honest statement of what is uncertain. This brief must be good enough to take to a board. It must cite the actual APRA regulations that apply. It must acknowledge what is not yet known.

**How it works:**

**Step 1: Per-signal HANA Vector Search**
Instead of one generic regulatory query, the Synthesis Agent performs up to four targeted queries against the HANA Vector Engine, one per risk signal:
- *"DTI ratio 7.2 debt-to-income limit APRA activation"* → retrieves APS 220 / DTI Notice clauses
- *"connected party group exposure APS 221 large exposure"* → retrieves APS 221 thresholds
- *"income contract expiry forward DTI trajectory deteriorating"* → retrieves forward assessment requirements
- *"CPS 230 operational resilience AI model governance audit trail"* → retrieves CPS 230 obligations

The retrieved chunks are deduplicated and capped at 7 to stay within the token budget.

**Step 2: LLM Synthesis (Claude Haiku, maxTokens: 2500)**
All four agents' outputs, plus the retrieved APRA regulatory text, are sent to Claude Haiku with a structured system prompt. The LLM produces a JSON risk brief. Findings are constrained to 20 words each (precision over prose), with one regulatory standard and one evidence source per finding.

**Step 3: Deterministic Guardrails**
The `apraReady` flag is NOT decided by the LLM. It is calculated deterministically from four conditions: confidence at or above 0.70, Reflection passed, regulatory docs retrieved, no regulatory context failure. This prevents the LLM from deciding its own work is ready.

**Step 4: Claim-Source Overlap Check (RAGAS-inspired, not the RAGAS library)**
A cosine-similarity check measures how much the LLM's findings overlap with the retrieved regulatory text. Low overlap (below 30%) means the LLM may be relying on training data, or, as in this run, on an unverified claim from an earlier agent, rather than the retrieved documents. This is flagged in the uncertainty section.

**Step 5: Persist to HANA**
The risk assessment is written to `bankingsentinel.RiskAssessments`. Token counts and cost are written to `bankingsentinel.AuditLog`. Both are permanent records under CPS 230.

**For 30100003, the produced brief (live run, post-fix):**

```json
{
  "riskScore": 87,
  "riskLevel": "CRITICAL",
  "confidence": 0.46,
  "findings": [
    {
      "finding": "Forward DTI 32.05x projected post-income expiry in 82 days; 301% above APRA limit.",
      "standard": "DTI_NOTICE",
      "severity": "HIGH",
      "evidenceSource": "trajectory",
      "confidence": 0.46
    },
    {
      "finding": "Loan L-004 AUD 2.1M exceeds collateral value AUD 1.48M by AUD 620K (LVR breach).",
      "standard": "APS221",
      "severity": "HIGH",
      "evidenceSource": "pattern",
      "confidence": 0.72
    },
    {
      "finding": "Income contract expires in 82 days; primary servicing income at imminent risk.",
      "standard": "DTI_NOTICE",
      "severity": "HIGH",
      "evidenceSource": "trajectory",
      "confidence": 0.46
    },
    {
      "finding": "APS 221 exposure 28% non-breaching contradicts CRITICAL risk score; signal driver unclear.",
      "standard": "APS221",
      "severity": "MEDIUM",
      "evidenceSource": "reflection",
      "confidence": 0.46
    },
    {
      "finding": "Graph traversal incomplete; guarantor network, cross-default triggers, loan facility records absent.",
      "standard": "APS221",
      "severity": "MEDIUM",
      "evidenceSource": "reflection",
      "confidence": 0.58
    }
  ],
  "recommendations": [
    "Urgent loan-level facility query to validate tranche expiry, cross-default mechanics, and payment schedule alignment with the income expiry window.",
    "Expand guarantor/trust network traversal to map contingent liabilities and cascade risk beyond the current 1-node graph.",
    "Require customer income renewal evidence or alternative servicing capacity documentation before the 82-day expiry."
  ],
  "regulatoryRefs": ["DTI_NOTICE", "APS221"],
  "uncertainties": [
    "Loan facility records missing; cannot validate the 82-day income expiry or AUD 125,400 scheduled payment timing.",
    "Cross-default clause details absent; exposure cascade risk to guarantor 30910005 and family trust member 30910006 unquantified.",
    "Signal driver unresolved: rpt1Conf 0.46 with a CRITICAL classification is unmoored from APS 221 non-breach (28%) and 0/7 PAL anomalies.",
    "CPS 230 guardrail: low claim-source overlap (10%) — findings warrant manual review"
  ],
  "apraReady": false
}
```

Notice what Finding 4 is actually saying: the APS 221 exposure genuinely doesn't breach (28%, correct, verified), and that genuinely *does* sit next to a CRITICAL score, because the CRITICAL classification is driven by Trajectory and Pattern (the income-expiry DTI spike, the under-collateralized loan), not by group exposure at all. The brief doesn't force these into false agreement. It states the real mismatch plainly, flags a 10% claim-source overlap, and sets `apraReady: false`. That's the deterministic guardrail (Step 3) working as designed: a brief that's honest about which of its own findings disagree, rather than one that resolves the disagreement by inventing a number nobody asked for.

---

## 7. A Real Example: Customer 30100003

Let us trace the full pipeline from the moment the query is entered to the moment the risk brief appears on screen. This is a live run against the corrected `exposure_calculator` (see Agent 3), with HITL off (auto-advance through human approval).

**The query:** *"Analyse credit risk for customer 30100003"*

**Who is 30100003?**
A retail customer with one business loan (L-004, AUD 2.1 million, retail property sector). Annual income AUD 291,667 from a contract expiring 2026-09-15, 82 days from this run. Current DTI is 7.20 times, already flagged in `BCA_DTI` as an active breach (`BREACH_FLAG: true`, dated 2025-08-10). On the surface this already looks concerning. What Banking Sentinel adds is *how much worse* it gets at income expiry, and, just as important, an honest account of which of its own signals do and don't agree.

**The pipeline execution, phase sequence (real run, total 67.0s):**

| Phase | What happened |
|---|---|
| Intake | Classifies RISK_ANALYSIS, customerId=30100003 |
| Pattern | RPT-1 → CRITICAL, confidence 0.46, score 87. Isolation Forest (scikit) → 0/7 outliers. LLM → 2 anomalies (L-004 under-collateralized by AUD 620K). Combined: score 87, CRITICAL, routes to high_risk. |
| Trajectory | Current DTI 7.20x. Forward DTI (income-expiry projection): 32.05x, 301% above the APRA 8x limit. Rate-stress DTI (independent +3% buffer check): 7.42x. Forward position: DETERIORATING. 4 conflicting signals raised. |
| Relationship (pass 1) | Graph traversal: 1 node, 0 edges (no BUT050 relationship row exists). Exposure calculator (via `BCA_GUARANTOR`, correctly scoped to this group): AUD 2.1M, 28% of APS 221 limit. Confidence 0.95. |
| Reflection (attempt 1) | Confidence 0.58, below the 0.70 threshold. 5 gaps raised, most pointed: a CRITICAL Pattern score next to a clean 28% exposure reading isn't explained by the graph yet. Routes to re-query. |
| Relationship (pass 2, re-query) | Re-traversal still finds 0 new edges, but adds a real fact: guarantor 30910005 (Rose Courtney) is connected to family trust member 30910006. Exposure stays the same, correct AUD 2.1M, 28%. Confidence 0.72. |
| Reflection (attempt 2) | Confidence 0.58, unchanged. 4 gaps, all converging on the same honest point: the CRITICAL classification comes from Pattern and Trajectory, not from group exposure, and the relationship graph can't be made to explain it. Maximum re-queries (2) reached, proceeds to Human Approval anyway, carrying the gaps forward. |
| Human Approval | HITL off for this run, auto-advances. |
| Synthesis | 4 HANA Vector queries fire; 7 APRA regulatory chunks retrieved. Claude Haiku writes the brief. Claim-source overlap: 10% (low). Deterministic `apraReady` check: **false**. |
| Persist | Written to `RiskAssessments` and `AuditLog` in HANA. Risk brief delivered via SSE. |

**Total pipeline time: 67.0 seconds (HITL off)**
**Total cost: AUD 0.0025**
**Tokens consumed: 2,919 input / 694 output**

**What the pipeline found that a scorecard would have missed:**
1. The income contract expires in 82 days. Forward DTI rockets to 32.05x, 301% above the APRA limit.
2. Loan L-004 is under-collateralized by AUD 620,000, a security deficiency a single DTI number wouldn't surface.
3. The relationship graph genuinely has no edge for this customer's guarantor relationship. It only surfaces via a separate table, not the graph traversal tool.
4. The CRITICAL classification doesn't come from group exposure at all, it comes from income expiry and under-collateralization, and the brief says so plainly rather than forcing every signal to agree with the headline score.
5. The risk brief explicitly says what it does not know: loan-level facility records, cross-default exposure to the guarantor and trust member, and why a CRITICAL score sits next to a clean exposure reading.

---

## 8. Regulatory Compliance by Design

Banking Sentinel is built to comply with three APRA standards. Every design decision traces back to a specific regulatory requirement.

### APRA APS 221: Large Exposures

APS 221 requires banks to aggregate exposure across connected parties and report when the total exceeds defined thresholds. The Relationship Agent exists solely to implement APS 221. Every graph traversal, every exposure calculation, every threshold check is an APS 221 obligation expressed in code.

### APRA CPS 230: Operational Resilience

CPS 230 requires that AI systems used in risk decisions include human oversight, maintain audit trails, and survive operational disruptions. Three system design decisions implement this directly:

1. **Human-in-the-Loop interrupt**: every material risk analysis pauses for human approval before the final brief is sealed
2. **PostgreSQL state persistence**: the pipeline state survives CF restarts; an approval given before a deployment is not lost
3. **AuditLog**: every pipeline run writes token counts, latency, model used, and cost to a permanent HANA table. The risk officer can reconstruct exactly what the AI did and why, months later.

### APRA DTI Notice: Debt-to-Income Ratio

The DTI Notice sets the threshold above which high-DTI lending requires additional oversight. Banking Sentinel reads this threshold dynamically from `RegulatoryThresholds`. When APRA changes its guidance, the threshold changes in the database. No code deployment required. The next pipeline run immediately reflects the new position.

**How the threshold actually changes: a real PDF upload, not a config flag.** `POST /a2a/sync-apra` accepts a real APRA PDF (by URL or base64) and runs it through a genuine RAG ingestion pipeline:

1. **Extract**: `pdf-parse` pulls the raw text out of the document.
2. **Chunk**: an 800-character sliding window with 100-character overlap, so a sentence that spans a chunk boundary (e.g. "APS 221 requires...") doesn't lose its meaning at the seam.
3. **Embed**: each chunk goes through OpenAI's `text-embedding-3-small` (the same model Synthesis uses for retrieval, so the cosine-similarity comparison is apples-to-apples) and is stored in `bankingsentinel.RegulatoryDocuments`, a real HANA Vector Engine table, not an in-memory cache.
4. **Parse the actual new limit out of the text.** For a `DTI_NOTICE` upload specifically, a small set of regex patterns (`DTI ≥ 6`, "DTI ratio greater than or equal to six times", "debt-to-income ... 6 times", "DTI limit of 6", and so on) extracts the real numeric threshold from the document's own wording. It isn't told the number in advance. If a number is found, `RegulatoryThresholds.LIMIT_PCT` is updated to that exact value; if parsing fails, it says so explicitly and leaves the threshold untouched rather than guessing.
5. **Replace, don't accumulate**: uploading a new `DTI_NOTICE` deletes the previous notice's chunks first, so Synthesis's vector search always retrieves the *current* regulatory position, not a mix of old and new guidance.

The risk officer's experience: upload the new APRA notice once. The system reads its own new threshold out of the document, updates the live regulatory position, and replaces its own knowledge base. The very next `analyseRisk` call sees the new limit and the new source text, with zero deployment in between.

---

## 9. What the Risk Officer Sees

The Banking Sentinel UI displays the pipeline running in real time via Server-Sent Events (SSE). As each agent completes, its output appears on screen, bolded and populated.

**The dashboard shows** (live values for the 30100003 run above):
- **Risk Score**: 87 / 100, CRITICAL
- **Pattern Signal**: unclear (2 anomalies)
- **RPT-1**: CRITICAL, 46% confidence
- **Anomaly Detection (scikit-learn)**: 0 / 7 payment rows flagged as outliers. This dashboard row shows whichever engine actually ran; it's labelled "PAL" only when `ANOMALY_ENGINE=pal` is set and the HANA PAL service genuinely executed
- **Relationship Graph**: interactive canvas; first pass 1 node / 0 edges, re-query pass still 1 node, adds the family-trust link to 30910006 without changing the exposure figure
- **Group Exposure**: AUD 2,100,000, 28% of the APS 221 limit, consistent across both passes
- **Trajectory**: current DTI 7.20x → forward DTI 32.05x (in 82 days); rate-stress DTI 7.42x
- **Reflection**: confidence 0.58 (both attempts), 5 then 4 gaps, max re-queries reached
- **HITL Status**: auto-approved (HITL off) for this run
- **Synthesis**: full risk brief with findings, recommendations, regulatory refs, uncertainties; `apraReady: false`
- **Audit**: cost AUD 0.0025, latency 67.0s, tokens 3,613 total (2,919 in / 694 out)

The report page merges all of this into a single printable brief. Every View Details panel shows the same data as the report, so what the risk officer approves is exactly what goes into the permanent record.

---

## 10. Key Design Decisions and Lessons

### 1. Every AI call has a named pattern

There are no generic LLM calls. Every call is one of: intent classification (Intake), narrative anomaly detection (Pattern), quality self-evaluation (Reflection), ReAct tool-use loop (Relationship), or regulatory synthesis (Synthesis). When something breaks, you know exactly which pattern broke and why.

### 2. The APRA threshold is never hardcoded

Every agent that needs the DTI threshold reads it from `RegulatoryThresholds` at runtime. When the APRA Notice is applied in the UI, the threshold changes. The next run of the pipeline reflects it immediately. No deployment, no code change.

### 3. LangGraph state fields must be declared

LangGraph silently drops state fields that are not declared in `Annotation.Root`. This caused three bugs: `reflectionHistory`, `hitlEnabled`, and `totalLatencyMs` were all silently lost until each was explicitly declared with its reducer type.

### 4. Reflection must return one new item, not rebuild the full history

The `reflectionHistory` field uses an `append` reducer. Each time the node runs, its return value is appended to the existing array. If the node returns `[...existingHistory, newItem]`, the reducer appends the full rebuilt array again, producing duplicates. The fix: return only `[newItem]` and let the reducer do the accumulation.

### 5. The Relationship Agent must not re-traverse from arbitrary nodes

Early iterations of the Relationship Agent would, on finding 0 connections for the primary customer, attempt traversals from random other entities. This pulled in completely unrelated connected-party chains and inflated group exposure. The system prompt now explicitly instructs: if SPARQL returns 0 connections, that is expected. Use the guarantor data already returned.

### 6. AuditLog and state persistence are separate concerns

The `graph.updateState()` call persists data to the LangGraph checkpoint (PostgreSQL). The `logToAuditLog()` call writes to HANA. They are independent. If `graph.updateState()` throws and `logToAuditLog()` depends on it completing, the audit record is lost. The fix: wrap `graph.updateState()` in try-catch so `logToAuditLog()` always runs.

### 7. A connected entity's own unrelated obligations are not this group's exposure

`exposure_calculator` queried `BCA_GUARANTOR` filtered only on `GUARANTOR_PARTNER`, with no check on whose loan was actually being guaranteed. A guarantor connected to one customer's group can also guarantee loans for entirely unrelated customers elsewhere in the portfolio, and that filter pulled in their *entire* guarantee book. This inflated reported APS 221 group exposure from a correct AUD 2.1M (28% of the limit) to a false AUD 11.78M (157%) on re-query, and it reproduced identically across two different starting customers who happened to share a guarantor, which is exactly the kind of bug that looks like a coincidence until you check the underlying data twice. The fix: a guarantee only counts toward this group's exposure when the loan it covers is held by an entity already in the group, not merely guaranteed by one. Being connected to a customer's group doesn't mean every other loan that connection backs belongs to that group.

---

## 11. What Comes Next

Banking Sentinel is a working prototype built on a SAP BTP trial account. The path to production involves four upgrades, each with a direct SAP equivalent:

| Prototype Component | Production Replacement |
|---|---|
| GraphDB sandbox (expires 7 days) | SAP HANA Knowledge Graph Engine |
| scikit-learn Flask service | SAP HANA PAL Isolation Forest (requires 3 vCPU) |
| Supabase free tier (pauses) | SAP BTP PostgreSQL Hyperscaler Option |
| Single demo customer (30100003) | Full portfolio: all BCA_DTI customers |

The architecture does not change. The data sources do not change. The Isolation Forest model that runs on scikit-learn is the same algorithm as HANA PAL. The upgrade path is a configuration change, not a rebuild, but it's worth being precise about what "the same queries work on both" actually means: the *traversal semantics* carry over, not literal byte-for-byte SQL. Here's a concrete example for a sample business partner `0001`, showing what's actually run today against GraphDB and the equivalent HANA KGE query it maps to:

**Today, SPARQL against GraphDB:**
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

**Production target, HANA KGE, `GRAPH_TABLE` on a `BP_RELATIONSHIP_GRAPH` workspace** (BUT050 rows as edges, BusinessPartners rows as vertices, the mapping described in `relationship-agent.js`):
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

Both express the same thing: variable-depth traversal from one business partner outward, returning every connected partner and the relationship type linking them. The vertex/edge mapping (BUT050 to graph edges, BusinessPartners to graph vertices) is the same in both. **This KGE query is the documented target shape, not a verified one.** HANA KGE isn't available on the BTP trial tier this prototype runs on, so it has never actually executed against a live KGE instance. The honest claim is: the traversal logic and data model translate directly; the literal SQL above has not been run.

---

## Summary

Banking Sentinel is a complete, regulation-compliant, multi-agent AI risk system on a mixed stack with an explicit SAP boundary. SAP HANA Cloud, SAP CAP, and SAP RPT-1 carry the data and tabular-AI layer end to end, proven and ready to swap toward HANA PAL and HANA Knowledge Graph Engine in production. The reasoning and orchestration layer is non-SAP today because AI Core isn't available on the trial tier this runs on, not because it was found wanting. Knowing exactly where that line sits is the more credible story.

Seven agents. Four risk dimensions. Three APRA standards. One risk officer decision. Under 80 seconds.

The customer who already shows a DTI breach on a scorecard, 7.20x, is actually a CRITICAL risk customer with a forward DTI of 32.05x at income expiry in 82 days, a loan under-collateralized by AUD 620,000, a connected-party graph with no relationship edge to show for it, and a CRITICAL classification that the brief is honest doesn't come from group exposure at all, because group exposure (AUD 2.1M, 28%, stable across a re-query) genuinely doesn't explain it.

Banking Sentinel does not approve or reject. It finds. It explains. It acknowledges what it does not know. And it gives the risk officer everything they need to make a confident, documented, APRA-compliant decision.

That is the purpose. Every line of code serves it.

---

*Built on: SAP BTP Cloud Foundry, SAP HANA Cloud, SAP CAP, SAP RPT-1, LangGraph, Claude Haiku 4.5, GraphDB / HANA KGE, scikit-learn / HANA PAL, Langfuse, Solace*

*APRA Standards: APS 221 (Large Exposures), CPS 230 (Operational Resilience), DTI Notice (Debt-to-Income)*
