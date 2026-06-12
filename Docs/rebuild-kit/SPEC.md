# Banking Sentinel — Complete Rebuild Specification
### Everything an AI needs to rebuild this prototype from scratch, in any language or framework

---

## HOW TO USE THIS DOCUMENT

This folder contains three files:
1. `BLOG.md` — What the system is, why it exists, how each agent works, real worked example
2. `SPEC.md` (this file) — Complete technical specification: prompts, schemas, APIs, events, seed data
3. `LESSONS.md` — 26 mistakes already made. Read before building to avoid repeating them.

Read all three before writing a single line of code. The blog gives you the "why". This spec gives you the "what exactly". The lessons give you the "what not to do".

You do not need to copy existing code. Build in your own style. The spec defines inputs, outputs, and behaviour — not implementation.

---

## PART 1 — SYSTEM OVERVIEW

**What it is:** A multi-agent AI risk intelligence pipeline for an Australian bank. A risk analyst types one sentence. Seven agents run. An APRA-compliant risk brief is produced in under two minutes.

**What it must do:**
- Accept a natural language query
- Classify the query (risk analysis / simple data lookup / inappropriate request)
- For risk analysis: run 5 specialist agents sequentially, pause for human approval, produce a structured risk brief
- Persist all state so a server restart does not lose an in-progress pipeline
- Display agent progress in real time as each agent completes
- Refuse to approve, reject, delete, or override anything

**What it must not do:**
- Make lending decisions
- Run without human sign-off on material risk (HITL)
- Hardcode regulatory thresholds (read from database)
- Commit credentials to source control

---

## PART 2 — TECH STACK (exact packages)

### Backend
```
Runtime:          Node.js 20+
Framework:        SAP CAP (CDS) — @sap/cds
Agent framework:  LangGraph — @langchain/langgraph
LLM client:       @langchain/anthropic
State persist:    @langchain/langgraph-checkpoint-postgres + pg
Observability:    langfuse + langfuse-langchain
Embeddings:       openai (text-embedding-3-small)
UUID:             uuid
Concurrency UI:   concurrently (npm run start:local runs CAP + Flask together)
```

### Python (separate Flask service on port 5001)
```
Flask
scikit-learn      (Isolation Forest anomaly detection)
numpy
```

### External APIs
```
LLM:              Claude Haiku 4.5  (claude-haiku-4-5-20251001)  ← cheapest, use for ALL agents
Embeddings:       OpenAI text-embedding-3-small
Tabular scoring:  SAP RPT-1 (rpt.cloud.sap/api/predict)
Observability:    Langfuse (langfuse.com or self-hosted)
Graph store:      GraphDB (Graphwise sandbox) — SPARQL 1.1 endpoint
State DB:         PostgreSQL (Supabase free tier for prototype)
```

### Deployment
```
SAP BTP Cloud Foundry
SAP HANA Cloud (HDI container)
```

---

## PART 3 — COMPLETE DATABASE SCHEMA

### HANA CDS Entities (15 tables)

```cds
namespace bankingsentinel;

entity BusinessPartners {
  key PARTNER     : String(10);       -- 8-digit SAP BP number e.g. 30100001
  BU_TYPE         : String(2);        -- 1=individual, 2=corporate
  BU_SORT1        : String(50);       -- display name
  SECTOR_CODE     : String(10);       -- RETAIL_PROP, COMMERCIAL, etc.
}

entity BUT050 {                        -- BP relationship table (graph edges)
  key PARTNER1    : String(10);
  key PARTNER2    : String(10);
  RELTYP          : String(30);       -- FAMILY_TRUST_MEMBER, GUARANTOR, PARENT_SUBSIDIARY
}

entity Loans {
  key LOAN_ID     : String(15);
  PARTNER         : String(10);
  AMOUNT          : Decimal(15,2);    -- AUD
  CURRENCY        : String(3);        -- AUD
  SECTOR_CODE     : String(10);
  APPROVED_DATE   : Date;
}

entity LoanSchedule {
  key SCHEDULE_ID : String(20);
  LOAN_ID         : String(15);
  DUE_DATE        : Date;
  AMOUNT_DUE      : Decimal(15,2);
}

entity BCA_GUARANTOR {
  key LOAN_ID     : String(15);
  key GUARANTOR   : String(10);
  COVER_AMOUNT    : Decimal(15,2);
}

entity BCA_COLLATERAL {
  key COLLATERAL_ID : String(15);
  LOAN_ID           : String(15);
  VALUE             : Decimal(15,2);
}

entity BCA_DTI {                      -- Debt-to-income (one row per customer)
  key PARTNER     : String(10);
  DTI_RATIO       : Decimal(5,2);     -- e.g. 5.80
  BREACH_FLAG     : Boolean;
  BREACH_DATE     : Date;             -- date breach was recorded
  TOTAL_DEBT      : Decimal(15,2);
  ANNUAL_INCOME   : Decimal(15,2);
  INCOME_SOURCE   : String(50);       -- CONTRACT, SALARY, BUSINESS
  INCOME_EXPIRY   : Date;             -- when income contract ends
}

entity DFKKOP {                       -- Payment transactions (FI-CA)
  key OPBEL       : String(20);
  GPART           : String(10);       -- customer BP number
  LOAN_ID         : String(15);
  BETRW           : Decimal(15,2);    -- amount (negative = debit)
  FAEDN           : Date;             -- due date
  BUDAT           : Date;             -- settlement date (null = unreconciled)
  DAYS_OVERDUE    : Integer;
}

entity BCA_SECTOR {
  key SECTOR_CODE    : String(10);
  key PARTNER        : String(10);
  EXPOSURE_AMOUNT    : Decimal(15,2);
}

entity SectorExposureLimits {
  key SECTOR_CODE    : String(10);
  LIMIT_AMOUNT       : Decimal(15,2);
}

entity RegulatoryThresholds {
  key THRESHOLD_TYPE : String(50);    -- 'DEBT_TO_INCOME', 'LARGE_EXPOSURE'
  LIMIT_PCT          : Decimal(5,2);  -- e.g. 8.0 (Demo 1) or 6.0 (Demo 2)
  UPDATED_AT         : DateTime;
}

entity ExposureLimits {
  key LIMIT_TYPE     : String(50);
  LIMIT_AMOUNT       : Decimal(15,2);
}

entity RegulatoryDocuments {          -- HANA Vector store for APRA docs
  key DOC_ID         : String(36);    -- UUID
  TITLE              : String(200);
  STANDARD           : String(20);    -- APS221, CPS230, DTI_NOTICE
  CONTENT            : LargeString;   -- text chunk (300-500 tokens)
  EMBEDDING          : LargeString;   -- JSON array of floats (1536 dims)
  UPLOADED_AT        : DateTime;
}

entity RiskAssessments {
  key SESSION_ID     : String(36);
  PARTNER            : String(10);
  RISK_SCORE         : Integer;       -- 0-100
  RISK_LEVEL         : String(10);    -- LOW/MEDIUM/HIGH/CRITICAL
  FINDINGS           : LargeString;   -- JSON array
  CONFIDENCE         : Decimal(3,2);
  CREATED_AT         : DateTime;
  APPROVED_BY        : String(50);    -- email of approver, null if HITL off
}

entity AuditLog {
  key LOG_ID         : String(36);
  SESSION_ID         : String(36);
  ACTION             : String(100);   -- 'risk_analysis'
  MODEL              : String(50);    -- 'claude-haiku-4-5-20251001'
  TOKENS_IN          : Integer;
  TOKENS_OUT         : Integer;
  COST_AUD           : Decimal(8,4);
  LATENCY_MS         : Integer;
  CREATED_AT         : DateTime;      -- NOT 'TIMESTAMP' — use CREATED_AT
}
```

### HANA Vector Search — Raw SQL
The table name in raw SQL is ALL CAPS with namespace prefix:
```sql
-- Correct:
SELECT TOP :topK DOC_ID, TITLE, STANDARD, CONTENT,
  COSINE_SIMILARITY(TO_REAL_VECTOR(EMBEDDING), TO_REAL_VECTOR(?)) AS SCORE
FROM "BANKINGSENTINEL_REGULATORYDOCUMENTS"
ORDER BY SCORE DESC

-- WRONG (will fail — HANA is case-sensitive on quoted identifiers):
FROM "bankingsentinel_RegulatoryDocuments"
```

---

## PART 4 — SEED DATA FOR DEMO

### RegulatoryThresholds (2 rows)
```
DEBT_TO_INCOME   | 8.0  ← Demo 1 default (not 6.0)
LARGE_EXPOSURE   | 7500000.00
```

### ExposureLimits (1 row)
```
APS221_GROUP | 7500000.00
```

### BusinessPartners (key demo customers)
```
30100001 | 1 | Alex Morgan       | RETAIL_PROP
30910005 | 2 | Morgan Family Trust A | RETAIL_PROP
30910006 | 2 | Morgan Family Trust B | RETAIL_PROP
```

### BUT050 (relationships for 30100001)
```
30100001 → 30910005 | FAMILY_TRUST_MEMBER
30100001 → 30910006 | FAMILY_TRUST_MEMBER
30910005 → 30910006 | FAMILY_TRUST_MEMBER
```

### BCA_DTI (30100001 record)
```
PARTNER:        30100001
DTI_RATIO:      5.80
BREACH_FLAG:    false
BREACH_DATE:    null
TOTAL_DEBT:     1050000.00
ANNUAL_INCOME:  181034.00
INCOME_SOURCE:  CONTRACT
INCOME_EXPIRY:  2027-04-01    ← 299 days from 2026-06-05
```

### DFKKOP (payment records for 30100001 — minimum 3 rows)
```
P1 | 30100001 | L001 | -850.00  | 2026-04-15 | 2026-04-15 | 0
P2 | 30100001 | L001 | -850.00  | 2026-03-15 | null       | 50   ← unreconciled
P3 | 30100001 | L002 | -1200.00 | 2026-02-28 | null       | 81   ← unreconciled
```

### Loans (for 30100001 group)
```
L001 | 30100001 | 500000  | AUD | RETAIL_PROP
L002 | 30100001 | 300000  | AUD | RETAIL_PROP
L003 | 30910005 | 1200000 | AUD | RETAIL_PROP
L004 | 30910006 | 1080000 | AUD | RETAIL_PROP
```
*(Group total = 3,080,000 → 41.07% of 7,500,000 APS 221 limit)*

### RegulatoryDocuments
Seed with text chunks from three APRA PDFs:
- APS 221 Large Exposures: `https://www.apra.gov.au/sites/default/files/2025-12/Prudential%20Standard%20APS%20221%20Large%20Exposures.pdf`
- CPS 230 Operational Risk: `https://www.apra.gov.au/sites/default/files/2026-04/Prudential%20Standard%20-%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf`
- DTI Notice: `https://www.apra.gov.au/sites/default/files/2025-11/Implementation%20Details%20-%20DTI%20limit.pdf`

Chunk size: 300-500 tokens. Embed each chunk with OpenAI text-embedding-3-small (1536 dimensions). For Demo 1, modify DTI document text to reference 8.0x threshold before embedding. Store vector as JSON array string in EMBEDDING field.

### GraphDB (RDF triples — SPARQL endpoint)
Load all BUT050 relationships as RDF triples:
```
<bp:30100001> <rel:FAMILY_TRUST_MEMBER> <bp:30910005>
<bp:30100001> <rel:FAMILY_TRUST_MEMBER> <bp:30910006>
<bp:30910005> <rel:FAMILY_TRUST_MEMBER> <bp:30910006>
```
Production swap: HANA Knowledge Graph Engine — same SPARQL queries, one endpoint URL change.

---

## PART 5 — AGENT PIPELINE SPECIFICATION

### LangGraph Graph Topology
```
Nodes:  intake, simpleQuery, rejection, riskStart, pattern,
        trajectory, relationship, reflectionCheck, humanApproval, synthesis

Entry:  intake

Edges:
  intake ──(conditional)──> simpleQuery        [if SIMPLE_DATA_QUERY]
  intake ──(conditional)──> riskStart          [if RISK_ANALYSIS]
  intake ──(conditional)──> rejection          [if INAPPROPRIATE_REQUEST]
  simpleQuery ──> END
  rejection   ──> END
  riskStart   ──> pattern
  pattern ──(conditional)──> synthesis         [if riskScore < 30]
  pattern ──(conditional)──> trajectory        [if riskScore >= 30]
  trajectory  ──> relationship
  relationship ──> reflectionCheck
  reflectionCheck ──(conditional)──> relationship [if confidence < 0.70 AND requeryCount < 2]
  reflectionCheck ──(conditional)──> humanApproval [otherwise]
  humanApproval ──> synthesis
  synthesis ──> END

Compile options:
  checkpointer:    PostgresSaver (survives CF restarts — mandatory for HITL)
  interruptBefore: ['humanApproval']   ← pipeline pauses here, waits for human
```

### LangGraph State Fields
```javascript
// Every field must be declared — LangGraph silently drops undeclared fields
{
  query:               last        // original user query string
  customerId:          last        // 8-digit SAP BP number
  sessionId:           last        // UUID for this pipeline run
  intent:              last        // Intake Agent output object
  simpleQueryResult:   last        // simple query answer string
  rejectionMessage:    last        // refusal text
  patternAssessment:   last        // Pattern Agent output object
  relationshipMap:     last        // Relationship Agent output object
  trajectoryAnalysis:  last        // Trajectory Agent output object
  synthesisResult:     last        // Synthesis Agent output object
  reflectionEvaluation:   last        // most recent Reflection evaluation
  reflectionHistory:      append      // ALL Reflection iterations — one entry per run
  reQueryHint:         last        // targeted instruction for Relationship re-query
  requeryCount:        last        // how many times Reflection has re-queried
  hitlEnabled:         last        // boolean — was HITL on for this run?
  totalInputTokens:    sum         // accumulates across all agents
  totalOutputTokens:   sum         // accumulates across all agents
  totalLatencyMs:      last        // set after pipeline completes
  retrievedDocs:       last        // APRA chunks retrieved by Synthesis
  traceId:             last        // Langfuse trace ID
  messages:            append      // conversation history
}
```

---

## PART 6 — AGENT 0: INTAKE AGENT

**Purpose:** Parse intent. Route to correct pipeline.

**Model:** Claude Haiku. maxTokens: 300.

**System prompt (exact):**
```
You are the Intake Agent for Banking Sentinel, an AI risk intelligence system for a major Australian bank.

Your job: parse the user's query and classify it precisely.

CLASSIFICATION RULES:

SIMPLE_DATA_QUERY — A request for factual data that can be answered with a single database lookup:
  Examples: "What is the total loan amount?", "How many borrowers do we have?",
  "Show me all overdue payments", "What is B-001's DTI ratio?", "List all loans"

RISK_ANALYSIS — A request for risk assessment, investigation, or analysis:
  Examples: "Analyse borrower B-001", "What is the connected party exposure for G-001?",
  "Check B-001 for all risk dimensions", "Is there an APS 221 breach in the portfolio?",
  "Assess the guarantor network risk"

INAPPROPRIATE_REQUEST — Any request to take an action the system must not take:
  Action keywords: approve, reject, delete, modify, override, grant, create, update, authorise, sign off
  Examples: "Approve the loan for B-001", "Delete B-003's record", "Override the risk flag"

CUSTOMER_ID extraction: Partner IDs are 8-digit SAP BP numbers like 30100001, 30100002. Extract exactly as stated.

Respond with JSON only, no explanation:
{
  "intent": "SIMPLE_DATA_QUERY" | "RISK_ANALYSIS" | "INAPPROPRIATE_REQUEST",
  "customerId": "30100001" | null,
  "description": "one sentence describing exactly what the user wants"
}
```

**Output shape (stored as `state.intent`):**
```json
{
  "isSimpleDataQuery":      false,
  "isRiskAnalysis":         true,
  "isInappropriateRequest": false,
  "customerId":             "30100001",
  "description":            "Analyse credit risk for customer 30100001"
}
```

---

## PART 7 — AGENT 1: PATTERN AGENT

**Purpose:** Baseline risk signal via three parallel methods.

**Three methods run simultaneously (Promise.all or equivalent):**

### Method 1 — SAP RPT-1 Tabular Scoring

**Endpoint:** `POST https://rpt.cloud.sap/api/predict`
**Auth:** `Authorization: Bearer <SAP_RPT_API_KEY>`
**Timeout:** 20 seconds

**Request body:**
```json
{
  "rows": [
    { "partner_id": "30100002", "dti_ratio": 4.2, "breach_flag": 0, "total_debt": 750000, "annual_income": 178000, "risk_category": "LOW" },
    { "partner_id": "30100003", "dti_ratio": 7.2, "breach_flag": 1, "total_debt": 1300000, "annual_income": 180000, "risk_category": "HIGH" },
    // ... up to 20 context rows from BCA_DTI with known categories
    { "partner_id": "Q-30100001", "dti_ratio": 5.80, "breach_flag": 0, "total_debt": 1050000, "annual_income": 181034, "risk_category": "[PREDICT]" }
  ],
  "index_column": "partner_id"
}
```

**Risk category labelling rule for context rows:**
```
breach_flag = true → HIGH
dti_ratio >= 5.5   → MEDIUM
else               → LOW
```

**Response parsing:**
```javascript
const category   = prediction.risk_category[0].prediction   // HIGH/MEDIUM/LOW/CRITICAL
const confidence = prediction.risk_category[0].confidence   // 0.0-1.0

// Score within band (not across bands):
const scoreFloors = { LOW: 0, MEDIUM: 26, HIGH: 51, CRITICAL: 76 }
const score = Math.round(floor + 24 * confidence)
```

### Method 2 — Isolation Forest (scikit-learn Flask on port 5001)

**Endpoint:** `POST http://localhost:5001/anomaly`
**Timeout:** 15 seconds

**Request body:**
```json
{
  "portfolio": [
    { "days_overdue": 0,  "amount": 850.00 },
    { "days_overdue": 12, "amount": 1200.00 }
    // up to 500 rows from DFKKOP (whole portfolio for training)
  ],
  "payments": [
    { "id": "P1", "days_overdue": 0,  "amount": 850.00 },
    { "id": "P2", "days_overdue": 50, "amount": 850.00 },
    { "id": "P3", "days_overdue": 81, "amount": 1200.00 }
    // customer's own payment rows to score
  ]
}
```

**Response:**
```json
{
  "trained_on": 9,
  "scored": 3,
  "results": [
    { "id": "P1", "score": 1.0,     "label": 1,  "reason_code": null },
    { "id": "P2", "score": 0.503,   "label": 1,  "reason_code": null },
    { "id": "P3", "score": 0.612,   "label": -1, "reason_code": "DAYS_OVERDUE" }
  ]
}
```
`label -1 = outlier (anomaly), 1 = inlier`

**Flask service minimum implementation:**
- Train IsolationForest on `portfolio` rows (contamination=0.1)
- Score `payments` rows
- Return results with label and score
- Minimum portfolio rows to train: 5 (adjust `contamination` for small datasets)

### Method 3 — LLM Narrative Anomaly Detection

**Model:** Claude Haiku. maxTokens: 400.

**System prompt:**
```
You are a banking risk analyst. Identify specific anomalies in the customer data.
Return JSON only: { "anomalies": ["anomaly 1", "anomaly 2"] }
Each anomaly max 20 words. Empty array if nothing unusual.
IMPORTANT: The current APRA DTI threshold is {apraDtiLimit}x. Use this exact value — do not use any other threshold.
IMPORTANT: DTI is a ratio — always express as Xx (e.g. 5.80x), never as a percentage.
```

**apraDtiLimit** is fetched from `RegulatoryThresholds WHERE THRESHOLD_TYPE = 'DEBT_TO_INCOME'` — the SAME query as the trajectory agent. Never hardcode it. Never let the LLM infer it from training data.

**User message:**
```
Customer {customerId}:
{JSON of dti record, first 5 loans, first 10 payments, collateral count}
```

### Pattern Agent — Output Shape (`state.patternAssessment`)
```json
{
  "riskScore":  50,
  "riskLevel":  "MEDIUM",
  "confidence": 1.0,
  "signal":     "concerning",
  "rpt1":  { "score": 50, "category": "MEDIUM", "confidence": 1.0, "success": true },
  "pal":   { "findings": [{"id":"P1","score":1.0,"label":1,"reasonCode":null}], "anomalyCount": 0, "totalScored": 3, "success": true },
  "llm":   { "anomalies": ["DTI 5.80x approaches 8.00x limit","3 overdue payments"], "tokensIn": 770, "tokensOut": 143 },
  "anomalies": ["combined list of PAL outlier texts + LLM anomaly texts for Synthesis"]
}
```

**Signal rule:**
```
combinedAnomalies.length > 2 → "concerning"
combinedAnomalies.length > 0 → "unclear"
else                          → "stable"
```

**Routing:** riskScore < 30 → synthesis (skip graph agents). riskScore >= 30 → trajectory.

---

## PART 8 — AGENT 2: TRAJECTORY AGENT

**Purpose:** Forward DTI projection. Conflicting signal detection.

**No LLM — pure deterministic calculation.**

**HANA queries:**
```
1. SELECT DTI_RATIO, TOTAL_DEBT, ANNUAL_INCOME, INCOME_EXPIRY, BREACH_FLAG, BREACH_DATE
   FROM BCA_DTI WHERE PARTNER = {customerId}

2. SELECT LIMIT_PCT FROM RegulatoryThresholds
   WHERE THRESHOLD_TYPE = 'DEBT_TO_INCOME'

3. SELECT LOAN_ID FROM Loans WHERE PARTNER = {customerId}

4. SELECT AMOUNT_DUE FROM LoanSchedule
   WHERE LOAN_ID IN ({loanIds}) AND DUE_DATE <= {incomeExpiryDate}
```

**Forward DTI formula:**
```
daysToExpiry    = floor((incomeExpiryDate - today) / 86400000)
effectiveIncome = annualIncome × (daysToExpiry / 365)
futureDti       = totalDebt / effectiveIncome

Only calculate when: daysToExpiry > 0 AND daysToExpiry < 365 AND annualIncome > 0
```

**timeToBreach logic:**
```
if breachFlag:
  timeToBreach = -floor((today - breachDate) / 86400000)  # negative = already in breach
elif futureDti > APRA_DTI_LIMIT:
  timeToBreach = daysToExpiry   # breach projected AT income expiry
else:
  timeToBreach = null
```

**forwardPosition logic:**
```
isDeteriorating = breachFlag OR (futureDti > APRA_DTI_LIMIT) OR (daysToExpiry < 90)
isStable        = !breachFlag AND currentDti < APRA_DTI_LIMIT×0.80 AND (daysToExpiry=null OR daysToExpiry > 365)
isImproving     = !breachFlag AND currentDti < APRA_DTI_LIMIT×0.70 AND daysToExpiry=null

forwardPosition = isDeteriorating → DETERIORATING
                  isStable        → STABLE
                  isImproving     → IMPROVING
                  else            → MONITORING
```

**Output shape (`state.trajectoryAnalysis`):**
```json
{
  "currentDti":        5.8,
  "futureDti":         7.05,
  "daysToExpiry":      299,
  "timeToBreach":      null,
  "forwardPosition":   "MONITORING",
  "conflictingSignals": [
    "5 statistical anomalies flagged but no regulatory breach recorded — off-balance-sheet exposure possible",
    "AUD 46,590 in scheduled payments fall within income expiry window"
  ]
}
```

---

## PART 9 — AGENT 3: RELATIONSHIP AGENT (ReAct Loop)

**Purpose:** Find all connected parties. Calculate group exposure. Check APS 221.

**Model:** Claude Haiku. maxTokens: 1000. Max ReAct steps: 6.

**Three tools available (Claude tool use / function calling):**

### Tool 1: hana_graph_traverse
```json
{
  "name": "hana_graph_traverse",
  "description": "Traverse the graph from a start business partner. Returns connected nodes and edges.",
  "parameters": {
    "startNode": "string — BP number to start from",
    "depth": "number — max hops (1-8)"
  }
}
```

**Implementation:** SPARQL query to GraphDB (or HANA KGE):
```sparql
-- Query 1: Find all reachable nodes
SELECT DISTINCT ?partner WHERE {
  {
    <bp:{startNode}> <rel:FAMILY_TRUST_MEMBER>|<rel:GUARANTOR>|<rel:PARENT_SUBSIDIARY> ?partner
  } UNION {
    ?s <rel:FAMILY_TRUST_MEMBER>|<rel:GUARANTOR>|<rel:PARENT_SUBSIDIARY> <bp:{startNode}>.
    BIND(<bp:{startNode}> AS ?partner)
  }
}

-- Query 2: Get actual edges between discovered nodes (VALUES clause)
SELECT ?fromId ?rel ?toId WHERE {
  VALUES ?fromId { bp:30100001 bp:30910005 bp:30910006 }
  VALUES ?toId   { bp:30100001 bp:30910005 bp:30910006 }
  ?fromId ?rel ?toId .
  FILTER(?rel IN (rel:FAMILY_TRUST_MEMBER, rel:GUARANTOR, rel:PARENT_SUBSIDIARY))
}

-- Query 3: Get names from BusinessPartners table (HANA relational)
SELECT PARTNER, BU_SORT1 FROM BusinessPartners WHERE PARTNER IN (...)
```

**Return shape:**
```json
{
  "nodeDetails": [{"id":"30100001","name":"Alex Morgan","hop":0,"relType":null}],
  "edges": [{"from":"30100001","to":"30910005","type":"FAMILY_TRUST_MEMBER"}]
}
```

### Tool 2: exposure_calculator
```json
{
  "name": "exposure_calculator",
  "description": "Calculate total group exposure for APS 221 across all connected entities.",
  "parameters": {
    "entityIds": "array of BP numbers"
  }
}
```

**Implementation:**
```sql
SELECT SUM(AMOUNT) as totalExposure
FROM Loans
WHERE PARTNER IN ({entityIds})
```
*(SUM of Loans.AMOUNT — total credit facilities. NOT guarantor cover amounts.)*

**Return:** `{ "groupExposure": 3080000 }`

### Tool 3: apra_threshold_check
```json
{
  "name": "apra_threshold_check",
  "description": "Check exposure against APRA APS 221 large exposure limit.",
  "parameters": {
    "metricType": "aps221",
    "value": "number",
    "entityId": "string"
  }
}
```

**Implementation:**
```
SELECT LIMIT_AMOUNT FROM ExposureLimits WHERE LIMIT_TYPE = 'APS221_GROUP'
aps221Pct = (value / limitAmount) × 100
withinLimit = aps221Pct < 100
```

**Return:** `{ "aps221Pct": 41.07, "withinLimit": true, "limitAmount": 7500000 }`

### System prompt (first run):
```
You are a banking risk analyst performing connected party graph traversal for APS 221 compliance.
Your goal: find ALL entities connected to the start customer (direct and indirect), calculate their
total group exposure, and check it against APRA APS 221 limits.

Steps:
1. Call hana_graph_traverse with the customer ID to find connected parties
2. If new entities are found, call exposure_calculator with all entity IDs found
3. Call apra_threshold_check with the total exposure and metricType="aps221"
4. If hana_graph_traverse returns zero SPARQL connections, this is EXPECTED for some borrowers.
   Do NOT call hana_graph_traverse again from a different entity — this pulls in unrelated chains.
   The guarantor data is already included — use those IDs for exposure_calculator.
5. When you have a complete picture, stop calling tools and summarise.

Return your final summary as JSON:
{"nodes": [...], "edges": [...], "groupExposure": <AUD>, "aps221Pct": <pct>, "confidence": <0.0-1.0>, "finding": "<one sentence>"}
```

### System prompt (re-query run — when Reflection triggered):
```
You are a banking risk analyst performing a TARGETED RE-QUERY. The previous traversal was incomplete.

Reflection quality evaluation identified this gap: "{reQueryHint}"

Previous traversal found these nodes: {prevNodes}

Your goal: investigate the identified gap specifically. Do not just repeat the previous traversal.
- Start traversal from entities found in the previous pass that were not yet explored deeper
- Recalculate group exposure including any newly discovered entities
- Check APS 221 threshold with the updated total

Return your final summary as JSON:
{"nodes": [...], "edges": [...], "groupExposure": <AUD>, "aps221Pct": <pct>, "confidence": <0.0-1.0>, "finding": "<one sentence>"}
```

**Output shape (`state.relationshipMap`):**
```json
{
  "nodes":        ["30100001", "30910005", "30910006"],
  "nodeDetails":  [{"id":"30100001","name":"Alex Morgan","hop":0,"relType":null}],
  "edges":        [{"from":"30100001","to":"30910005","type":"FAMILY_TRUST_MEMBER"}],
  "groupExposure": 3080000,
  "aps221Pct":     41.07,
  "confidence":    0.95,
  "finding":       "Customer 30100001 connected group of 3 entities; APS 221 exposure AUD 3.08M (41.07% of limit), within threshold."
}
```

---

## PART 10 — AGENT 4: REFLECTION CHECK

**Purpose:** Evaluate evidence quality. Re-query if incomplete.

**Model:** Claude Haiku. maxTokens: 800. (400 is too small — JSON gets truncated.)

**System prompt:**
```
You are a banking risk quality analyst. Your job is to evaluate whether the agent findings are
complete enough to proceed to human approval, or whether a targeted re-query is needed.

Evaluate these four dimensions:
1. GRAPH COMPLETENESS — Is the relationship traversal complete? Few nodes with zero group exposure
   likely means the traversal stopped before reaching parent entities or guarantor networks.
2. SIGNAL CONSISTENCY — Are Pattern and Relationship findings consistent? HIGH risk score + zero
   APS 221 exposure = inconsistency that needs resolution.
3. CONFLICTING SIGNALS — Are the trajectory conflicts explained by the graph findings, or are they
   still unresolved?
4. EVIDENCE TRAIL — Is every risk claim backed by a specific connected entity, TRBK record,
   or exposure figure?

Return ONLY valid JSON:
{
  "overallConfidence": <0.00-1.00>,
  "gaps": ["<specific gap 1>", "<specific gap 2>"],
  "reQueryHint": "<one specific, actionable instruction for the Relationship Agent>",
  "reasoning": "<one sentence explaining the confidence level>"
}

If findings are complete and consistent, overallConfidence >= 0.75.
If graph traversal clearly stopped early or exposure is zero despite HIGH risk, overallConfidence <= 0.65.
```

**Routing:**
```
confidence < 0.70 AND requeryCount < 2  →  requery (Relationship Agent re-runs with reQueryHint)
otherwise                               →  proceed (humanApproval)
```

**CRITICAL — append reducer interaction:**
The `reflectionHistory` field uses an append reducer. Return ONLY the new entry, not the full rebuilt array:
```javascript
// CORRECT:
return { reflectionHistory: [{ iteration: reqCount + 1, ...evaluation }] }

// WRONG — causes duplicates:
return { reflectionHistory: [...prevHistory, { iteration: reqCount + 1, ...evaluation }] }
```

**Output shape (`state.reflectionHistory` gets one new entry appended):**
```json
{
  "iteration":        1,
  "overallConfidence": 0.72,
  "gaps":             ["Graph traversal incomplete — only 3 nodes with 3 edges"],
  "reQueryHint":      "Restart from 30100001 using guarantor and parent entity relationships",
  "reasoning":        "Pattern confidence is high but graph is suspiciously shallow"
}
```

---

## PART 11 — AGENT 5: HUMAN APPROVAL (HITL)

**Not an AI agent — a LangGraph interrupt point.**

**Behaviour:**
- LangGraph pauses execution BEFORE this node via `interruptBefore: ['humanApproval']`
- State is saved to PostgreSQL (survives server restart)
- UI is notified via SSE event `type: "hitl_interrupt"`
- Pipeline resumes when `POST /api/approve` is called with the sessionId
- On resume, this node runs (does nothing — returns `{}`), then Synthesis executes
- `approvedBy` field is set in state (email of approver)

**If HITL is disabled (`hitlEnabled: false`):**
- The interrupt still fires but is immediately resumed programmatically
- `approvedBy` remains null

---

## PART 12 — AGENT 6: SYNTHESIS AGENT

**Purpose:** Write the APRA-ready risk brief.

**Model:** Claude Haiku. maxTokens: 2500. (Less than 2000 causes JSON truncation.)

**Step 1 — HANA Vector Search (4 separate queries, deduplicated):**

Query 1 (if DTI risk exists):
```
"DTI ratio {currentDti} debt-to-income limit APS 220 residential mortgage APRA activation"
```

Query 2 (if group exposure > 0):
```
"connected party group exposure APS 221 large exposure single obligor board notification {exposureMillion}M"
```

Query 3 (if conflicting signals exist):
```
"income contract expiry forward DTI trajectory deteriorating risk assessment APRA"
```

Query 4 (always):
```
"CPS 230 operational resilience AI model governance audit trail evidence"
```

Fetch topK=5 per query. Deduplicate by DOC_ID. Cap at 7 total.

**System prompt:**
```
You are a banking risk officer preparing an APRA-compliant risk assessment brief.
Analyse ALL agent findings below and produce a structured JSON risk brief.

Risk score scale: LOW=0-25, MEDIUM=26-50, HIGH=51-75, CRITICAL=76-100.
riskLevel must match riskScore: score 51 = HIGH, score 76 = CRITICAL.
Reference the conflictingSignals array — each unresolved conflict reduces confidence.
Pattern confidence (rpt1Conf) is the real RPT-1 confidence — cite it in findings.
Reflection reasoning explains the evidence quality decision — cite it if relevant.

Return ONLY valid JSON. Keep each finding under 20 words. Max 5 findings, 3 recommendations, 3 uncertainties.
{
  "riskScore": <0-100 integer>,
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "confidence": <0.00-1.00>,
  "findings": [{"finding": "<max 20 words>", "standard": "<APS221|CPS230|DTI_NOTICE>", "severity": "<HIGH|MEDIUM|LOW>", "evidenceSource": "<agent name>", "confidence": <0.00-1.00>}],
  "recommendations": ["<action, max 15 words>"],
  "regulatoryRefs": ["<APS221|CPS230|DTI_NOTICE>"],
  "uncertainties": ["<data gap, max 15 words>"],
  "apraReady": <true|false>
}
Return ONLY the JSON object. No markdown, no explanation.
```

**apraReady — DETERMINISTIC override (never trust LLM for compliance flags):**
```javascript
const reflectionPassed = reflectionEvaluation.overallConfidence >= 0.70
brief.apraReady = (
  brief.confidence >= 0.70 &&
  reflectionPassed &&
  regulatoryRefs.length > 0 &&
  regulatoryContextAvailable
)
```

**Regulatory ref filter (prevent hallucination):**
```javascript
const KNOWN_STANDARDS = new Set(['APS221', 'CPS230', 'DTI_NOTICE'])
brief.regulatoryRefs = [...new Set([
  ...(brief.regulatoryRefs || []).filter(r => KNOWN_STANDARDS.has(r)),
  ...retrievedDocs.map(d => d.STANDARD).filter(Boolean)
])]
```

**RAGAS claim-source check:**
```javascript
// Simple word overlap between findings text and retrieved doc content
const claimsWords = new Set(findings.join(' ').toLowerCase().split(/\s+/))
const sourceWords = new Set(retrievedDocs.map(d => d.CONTENT).join(' ').toLowerCase().split(/\s+/))
const overlap = [...claimsWords].filter(w => sourceWords.has(w)).length / claimsWords.size
if (overlap < 0.30) {
  brief.uncertainties.push(`CPS 230 guardrail: low claim-source overlap (${Math.round(overlap*100)}%) — findings warrant manual review`)
}
```

**Output shape (`state.synthesisResult`):**
```json
{
  "riskScore":      50,
  "riskLevel":      "MEDIUM",
  "confidence":     0.72,
  "findings":       [{"finding":"...", "standard":"DTI_NOTICE", "severity":"HIGH", "evidenceSource":"pattern", "confidence":1.0}],
  "recommendations": ["..."],
  "regulatoryRefs": ["DTI_NOTICE", "APS221", "CPS230"],
  "uncertainties":  ["..."],
  "apraReady":      true
}
```

**Persist to HANA (fire-and-forget — do not await):**
```
INSERT INTO RiskAssessments: SESSION_ID, PARTNER, RISK_SCORE, RISK_LEVEL, FINDINGS(JSON), CONFIDENCE, CREATED_AT
INSERT INTO AuditLog: SESSION_ID, ACTION='risk_analysis', MODEL, TOKENS_IN, TOKENS_OUT, COST_AUD, LATENCY_MS, CREATED_AT
```

---

## PART 13 — API ENDPOINTS

### POST /api/analyse (or /a2a/agent)
**Request:**
```json
{
  "query":      "Analyse credit risk for customer 30100001",
  "sessionId":  "ui-1234567890",
  "hitl":       false
}
```
**Response:** SSE stream (text/event-stream). See Part 14 for event types.

### POST /api/approve
**Request:**
```json
{
  "sessionId":  "ui-1234567890",
  "approvedBy": "risk.officer@bank.com.au"
}
```
**Response:** `{ "status": "resumed" }`

### GET /api/report/:sessionId
**Response:** Full pipeline state object:
```json
{
  "sessionId":          "ui-1234567890",
  "generatedAt":        "2026-06-05T05:05:46Z",
  "partner":            "30100001",
  "query":              "Analyse credit risk for customer 30100001",
  "patternAssessment":  { ... },
  "trajectoryAnalysis": { ... },
  "relationshipMap":    { ... },
  "reflectionEvaluation":  { ... },
  "reflectionHistory":     [ ... ],
  "synthesisResult":    { ... },
  "hitlEnabled":        false,
  "approvedBy":         null,
  "riskScore":          50,
  "riskLevel":          "MEDIUM",
  "confidence":         0.72,
  "findings":           [ ... ],
  "recommendations":    [ ... ],
  "regulatoryRefs":     [ ... ],
  "uncertainties":      [ ... ],
  "apraReady":          true,
  "totalInputTokens":   9277,
  "totalOutputTokens":  2163,
  "totalCostAUD":       0.0022,
  "totalLatencyMs":     40655,
  "trbkTables":         ["BUT050", "BCA_GUARANTOR", "DFKKOP", "BCA_DTI", "BCA_LOAN_HDR"],
  "auditTrail":         [{"action":"risk_analysis","model":"...","tokensIn":2660,"tokensOut":627,"costAUD":"0.0022","latencyMs":40655}]
}
```

### GET /admin/api/sessions
**Response:**
```json
[{
  "sessionId":  "ui-1234567890",
  "partner":    "30100001",
  "riskScore":  50,
  "riskLevel":  "MEDIUM",
  "confidence": 0.72,
  "createdAt":  "2026-06-05T05:05:46Z",
  "costAud":    0.0022,
  "latencyMs":  40655,
  "tokensIn":   9277,
  "tokensOut":  2163
}]
```

### DELETE /admin/api/sessions/:sessionId
**Response:** `{ "deleted": true }`
Deletes from both RiskAssessments and AuditLog.

### GET /api/dti-status
**Response:**
```json
{
  "threshold": 8.0,
  "updatedAt": "2026-06-05T00:00:00Z"
}
```

---

## PART 14 — REAL-TIME SSE EVENTS

All events sent as `text/event-stream`. Each event is JSON.

### Event: agent_start
```json
{ "type": "agent_start", "agent": "pattern", "sessionId": "ui-123" }
```

### Event: pattern_progress (one per sub-method)
```json
{
  "type":       "pattern_progress",
  "source":     "rpt1",
  "score":      50,
  "category":   "MEDIUM",
  "confidence": 1.0,
  "success":    true,
  "sessionId":  "ui-123"
}
```
```json
{
  "type":         "pattern_progress",
  "source":       "pal",
  "anomalyCount": 0,
  "totalScored":  3,
  "success":      true
}
```
```json
{
  "type":         "pattern_progress",
  "source":       "llm",
  "anomalyCount": 5,
  "success":      true
}
```

### Event: agent_complete
```json
{
  "type":      "agent_complete",
  "agent":     "pattern",
  "data": {
    "riskScore":   50,
    "riskLevel":   "MEDIUM",
    "confidence":  1.0,
    "signal":      "concerning",
    "anomalies":   ["DTI 5.80x approaches 8.00x limit", "..."]
  }
}
```

### Event: trajectory_complete
```json
{
  "type": "agent_complete",
  "agent": "trajectory",
  "data": {
    "currentDti":        5.8,
    "futureDti":         7.05,
    "daysToExpiry":      299,
    "timeToBreach":      null,
    "forwardPosition":   "MONITORING",
    "conflictingSignals": ["..."]
  }
}
```

### Event: relationship_complete
```json
{
  "type": "agent_complete",
  "agent": "relationship",
  "data": {
    "nodes":          ["30100001", "30910005", "30910006"],
    "nodeDetails":    [{"id":"30100001","name":"Alex Morgan","hop":0,"relType":null}],
    "edges":          [{"from":"30100001","to":"30910005","type":"FAMILY_TRUST_MEMBER"}],
    "groupExposure":  3080000,
    "aps221Pct":      41.07,
    "confidence":     0.95,
    "relConfidence":  0.95,
    "finding":        "Customer 30100001 connected group of 3 entities..."
  }
}
```

### Event: reflection_complete
```json
{
  "type": "agent_complete",
  "agent": "reflection",
  "data": {
    "overallConfidence": 0.72,
    "gaps":              ["Graph traversal incomplete"],
    "reasoning":         "...",
    "decision":          "proceed"
  }
}
```

### Event: hitl_interrupt
```json
{
  "type":      "hitl_interrupt",
  "sessionId": "ui-123",
  "message":   "Awaiting risk officer approval"
}
```

### Event: synthesis_complete
```json
{
  "type": "agent_complete",
  "agent": "synthesis",
  "data": {
    "riskScore":          50,
    "riskLevel":          "MEDIUM",
    "confidence":         0.72,
    "findings":           [...],
    "recommendations":    [...],
    "regulatoryRefs":     ["DTI_NOTICE","APS221","CPS230"],
    "uncertainties":      [...],
    "apraReady":          true,
    "totalCostAUD":       0.0022,
    "totalLatencyMs":     40655,
    "reflectionHistory":     [...],
    "currentDti":         5.8,
    "futureDti":          7.05,
    "timeToBreach":       null,
    "relConfidence":      0.95,
    "hitlEnabled":        false,
    "trbkTables":         ["BUT050","BCA_GUARANTOR","DFKKOP","BCA_DTI","BCA_LOAN_HDR"]
  }
}
```

### Event: pipeline_error
```json
{ "type": "pipeline_error", "message": "...", "sessionId": "ui-123" }
```

---

## PART 15 — ENVIRONMENT VARIABLES

```
# LLM
ANTHROPIC_API_KEY=          Claude API key
ANTHROPIC_MODEL=            claude-haiku-4-5-20251001

# Embeddings
OPENAI_API_KEY=             OpenAI API key
OPENAI_EMBEDDING_MODEL=     text-embedding-3-small

# SAP RPT-1
SAP_RPT_API_KEY=            RPT-1 consumer API token (rpt.cloud.sap)

# Observability
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=              https://cloud.langfuse.com

# State persistence
POSTGRES_URL=               postgres://... (Supabase session pooler URL)

# Graph store
GRAPHDB_ENDPOINT=           https://...graphdb.../repositories/banking-sentinel
GRAPHDB_USERNAME=
GRAPHDB_PASSWORD=

# Anomaly detection
ANOMALY_ENGINE=             scikit   (or 'pal' if HANA PAL is available)
SCIKIT_SERVICE_URL=         http://localhost:5001

# Admin security
ADMIN_IP_WHITELIST=         disabled  (or comma-separated IPs for production)
```

**Deployment rule:** Never put these in manifest.yml or commit to git.
Use `cf set-env banking-sentinel KEY VALUE` for each one, then `cf restage`.

---

## PART 16 — COST CALCULATION

```
Claude Haiku pricing (per 1K tokens):
  Input:  USD 0.00025
  Output: USD 0.00125

AUD conversion: multiply by 1.55 (approximate)

Cost per pipeline run (typical):
  Input tokens:  ~9,000
  Output tokens: ~2,000
  Total cost:    AUD 0.002-0.003
```

---

## PART 17 — DEMO FLOW

### Demo 1 — MEDIUM Risk (default state)
1. Start fresh: `npm run start:local` (starts CAP on 4004 + scikit Flask on 5001)
2. Ensure RegulatoryThresholds has `DEBT_TO_INCOME = 8.0`
3. Type: "Analyse credit risk for customer 30100001"
4. Expected outcome: riskScore=50, MEDIUM, forwardPosition=MONITORING, timeToBreach=null
5. Reflection: confidence ~0.72, 1 iteration, no re-query
6. Synthesis: 5 findings, 3 recommendations, apraReady=true

### Demo 2 — DETERIORATING Risk (after APRA Notice)
1. Click "APRA Notice" button in UI
2. System downloads real APRA DTI Notice PDF, chunks it, embeds it
3. Updates RegulatoryThresholds SET LIMIT_PCT=6.0
4. Re-run: "Analyse credit risk for customer 30100001"
5. Expected outcome: forwardPosition=DETERIORATING, timeToBreach=299
6. Synthesis findings now cite 6.0x threshold, income expiry = projected breach

### Demo 3 — Rejection
- Type: "Approve the loan for 30100001"
- Expected: Firm refusal message, no pipeline runs

---

## PART 18 — UI LAYOUT SPECIFICATION

Three main panels:

### Panel 1 — Query Input
- Text input: "Analyse credit risk for customer..."
- HITL toggle: ON/OFF
- Submit button
- APRA Notice button (amber when threshold = 6.0x)

### Panel 2 — Agent Pipeline (live updates via SSE)
Seven agent badges in order:
```
Intake → Pattern → Trajectory → Relationship → Reflection → Human Approval → Synthesis
```
Each badge states: Waiting / ● Thinking / ↻ Re-querying / ✓ Complete

Badge shows [View Details] when complete. Each View Details popup shows:
- **Pattern:** RPT-1 score + category + confidence | PAL "X/N rows flagged" | LLM anomaly list
- **Trajectory:** currentDti | futureDti | daysToExpiry | timeToBreach | forwardPosition | conflictingSignals
- **Relationship:** connected party table (name, BP ID, hop, relType) | group exposure | aps221Pct | ReAct steps | finding sentence
- **Reflection:** one section per iteration | confidence | gaps | reQueryHint | PASSED/REQUERIED decision
- **Synthesis:** full brief — all findings with severity/standard/evidenceSource/confidence | recommendations | regulatoryRefs | uncertainties | apraReady | tokens | cost

### Panel 3 — Risk Brief (populated after synthesis)
- Risk Score (0-100) + Level badge
- Findings table: finding text | standard | severity | evidenceSource | confidence
- Recommendations list
- Regulatory refs
- Uncertainties list
- Pipeline cost + latency + tokens

### Relationship Graph Canvas
- Interactive canvas (not a library — draw with HTML Canvas API)
- Nodes: circle with name + BP ID
- Edges: directed arrows with relationship type label
- Clickable to expand to full-screen modal
- Height: 320px default

---

## PART 19 — REPORT PAGE

URL: `/report/:sessionId`

Standalone page (no pipeline UI). Shows everything from `/api/report/:sessionId`:
- All agent outputs with View Details equivalent content
- Synthesis brief (same format as Panel 3)
- Audit trail table: action | model | tokensIn | tokensOut | costAUD | latencyMs
- Print/PDF button
- Cost and latency summary

---

## PART 20 — ADMIN PAGE

URL: `/admin`

Two tabs:

**Pipelines tab:**
- Table of all RiskAssessments: sessionId | partner | riskScore | riskLevel | confidence | date | cost | latency | tokens
- "View Report ↗" link per row
- "Delete" button per row (confirm dialog → DELETE /admin/api/sessions/:id)

**Data Browser tab:**
- Shows HANA table row counts
- GraphDB triple count
- PostgreSQL checkpoint count
- Buttons to seed/reseed data

---

## WHAT CHANGES BETWEEN DEMO 1 AND DEMO 2

Only ONE value changes: `RegulatoryThresholds.LIMIT_PCT` for `DEBT_TO_INCOME`.

| Behaviour | Demo 1 (8.0x) | Demo 2 (6.0x) |
|---|---|---|
| forwardPosition | MONITORING | DETERIORATING |
| timeToBreach | null | 299 days |
| Synthesis finding | "approaches threshold" | "projected breach at income expiry" |
| Pattern LLM | "approaches 8.00x" | "approaches 6.00x" |
| apraReady | true | true |

No code changes. No deployment. One DB row update.

---

*End of specification. Read LESSONS.md before building to avoid 26 documented mistakes.*
