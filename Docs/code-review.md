# Banking Sentinel — Code Review
## Last updated: 2026-05-26

---

## SECTION 1 — BUGS

### Bug 1 — Graph canvas always renders star topology (HIGH — demo blocker)

**File:** `v0-source-files/Banking-Sentinel-AustralianBank.html` line 860

**What's wrong:**
`drawGraph()` normalises edges with this check:
```js
if (!Array.isArray(e) || e.length < 2) return;
```
It expects each edge to be a two-element array `["30910005", "30100001"]`.

But the Relationship Agent's LLM prompt asks for edges as objects `{from, to, type, hop}`. The LLM returns objects. Every edge object fails the `Array.isArray` check and is silently skipped. `edgePairs` is always empty. The fallback at line 867 kicks in — a star from node 0 to all others. The visual graph never shows the real connected party structure regardless of what the traversal found.

**Verify before fixing:**
Log `e.graphEdges` in `handleEvent` when `e.agent === 'relationship'` is received. Confirm whether you're getting arrays or objects from the server.

**Fix:**
Change `drawGraph` to accept both formats:
```js
rawEdges.forEach(e => {
  let a, b;
  if (Array.isArray(e) && e.length >= 2) { a = e[0]; b = e[1]; }
  else if (e && typeof e === 'object' && e.from != null && e.to != null) { a = e.from; b = e.to; }
  else return;
  // ... rest of index resolution unchanged
});
```
No server-side changes needed.

---

### Bug 2 — Low-risk shortcut is dead code (MEDIUM)

**File:** `srv/graph/banking-sentinel.js` line 19 and 87–88

**What's wrong:**
`routeAfterPattern` is exported from `pattern-agent.js` and imported in `banking-sentinel.js`:
```js
const { patternAgent, routeAfterPattern } = require('../agents/pattern-agent');
```
The function exists and is correct — score < 30 → `'low_risk'`, else → `'high_risk'`. But it is never passed to `addConditionalEdges`. The graph wires a fixed edge instead:
```js
graph.addEdge('riskStart', 'pattern');
graph.addEdge('pattern', 'trajectory'); // fixed — no conditional routing
```
Result: every analysis runs the full pipeline regardless of risk score. A BP with score 5 still runs Relationship Agent, Trajectory Agent, Self-RAG, and Human Approval — wasting tokens and latency.

**Verify:**
Run an analysis on a performing borrower (e.g. BP 30100006 — no overdue, no DTI breach, no guarantor exposure). Confirm all 5 agents still run even though the risk is low.

**Fix:**
Replace the fixed `pattern → trajectory` edge with a conditional:
```js
graph.addConditionalEdges('pattern', routeAfterPattern, {
  'low_risk':  'synthesis',  // skip relationship + trajectory
  'high_risk': 'trajectory'
});
```
Also gate the `riskStart → relationship` fan-out — it should only run on high_risk. One approach: move relationship into the high_risk branch so it only fans out after the pattern score is known. Small design decision to confirm before touching the graph topology.

---

### Bug 3 — `forwardPosition` defaults to `'IMPROVING'` for ambiguous state (LOW)

**File:** `srv/agents/trajectory-agent.js` lines 105–112

**What's wrong:**
The logic has three branches:
1. `isDeteriograting` — clear decline → `'DETERIORATING'`
2. `isStable` — clearly safe → `'STABLE'`
3. else → `'IMPROVING'`

The else branch catches every ambiguous case — a borrower at 95% of DTI limit with income expiry in 90 days is labelled `IMPROVING`. This is factually wrong and could mislead a risk officer reading the brief.

Also: the variable is named `isDeteriograting` (extra 'g'). Does not break anything but looks wrong in logs.

**Fix:**
Change the else branch to `'MONITORING'` or `'WATCH'`. Reserve `'IMPROVING'` for cases where the data actively supports improvement (e.g. overdue payments clearing, DTI ratio decreasing). A simple rule: only return `'IMPROVING'` if `overdueDays === 0 && currentDti < dtiLimit * 0.7`.

---

### Bug 4 — LoanSchedule window not filtered to income expiry (MEDIUM)

**File:** `srv/agents/trajectory-agent.js` lines 83–89

**What's wrong:**
The query fetches the next 20 scheduled payments with no date filter:
```js
SELECT.from('bankingsentinel.LoanSchedule').where({ LOAN_ID: { in: loanIds } }).limit(20)
```
`totalDue` is summed across all of them. The conflict detection text says "within income expiry window" but the number includes payments well beyond that date. On a 25-year mortgage, this could be hundreds of thousands of AUD over-stated.

**Fix:**
Add a `DUE_DATE` filter using the computed `incomeExpiry` date from `BCA_DTI.INCOME_EXPIRY`:
```js
SELECT.from('bankingsentinel.LoanSchedule')
  .where({ LOAN_ID: { in: loanIds }, STATUS: { '!=': 'PAID' } })
  .where('DUE_DATE <=', incomeExpiryDate)
  .limit(20)
```
`incomeExpiryDate` is already computed earlier in the same function — just pass it into the query.

---

## SECTION 2 — INCOMPLETE WIRING

### Incomplete 1 — `validate.js` is built but never connected (HIGH)

**File:** `srv/guardrails/validate.js`

**What's wrong:**
`validateAgentOutput()` and `crossCheckClaimsAgainstSources()` are never imported by any agent, graph node, or server file. The module exists and is complete — confidence floor (refuse below 0.40), missing evidence source flagging, cross-claim faithfulness check — but none of it fires. Every agent output passes to the next node with zero structural validation.

**This matters for APRA CPS 230:** The architecture spec says validation is a mandatory layer between every agent. Without it, a hallucinated finding with confidence 0.1 reaches the synthesis brief unchallenged.

**Fix options:**
1. **Add a validation node to the graph** — insert `validateOutput` as a node between `synthesis` and `END`. Call `validateAgentOutput(state.synthesisResult)` there. Cleanest architecturally — one node, one responsibility, visible in the graph topology.
2. **Call inline at each agent** — each agent calls `validateAgentOutput(result)` before returning state. Simpler but scattered.

Option 1 is preferred for the demo story (shows up in the pipeline diagram).

---

### Incomplete 2 — `BCA_COLLATERAL` is queried but never seeded (MEDIUM)

**File:** `scripts/seed.js` (missing section) + `srv/agents/pattern-agent.js` line 28

**What's wrong:**
Pattern Agent queries `bankingsentinel.BCA_COLLATERAL` and passes `collateralCount` to both the RPT-1 prompt and the LLM anomaly prompt. The entity is in `db/schema.cds`. But `seed.js` has no collateral seeding — the table is always empty. The LLM always receives `collateralCount: 0` for every borrower, removing a key risk signal (under-collateralised loans are a major credit risk indicator).

**Fix:**
Add collateral records to `Data/processed/` and seed them. Suggested data: L-001 and L-002 have LVR > 80% (under water). L-004 (DTI breach) has no registered collateral. Performing loans have standard collateral. Even 5–8 records is enough for the demo.

---

### Incomplete 3 — RAGAS and AuditLog not called on approve path (LOW)

**File:** `srv/server.js` — `/a2a/approve` handler (line 340)

**What's wrong:**
When a risk analysis pauses for human approval and resumes via `POST /a2a/approve`, synthesis runs again with full token cost. Two things are missing:
1. `runRagasEvaluation()` is never called — no faithfulness or relevance scores for approved briefs
2. `logToAuditLog()` is never called — tokens, cost, and latency from the resumed synthesis are not persisted to HANA AuditLog

The handler does compute `approveCost` and pushes it to SSE (line 399), so cost is not completely lost. But it never hits the HANA AuditLog table.

**Fix:**
After the resume `graph.stream()` loop completes in the approve handler, add:
```js
await logToAuditLog(sessionId, 'APPROVAL_RESUME', synthesis, finalState, latencyMs);
runRagasEvaluation(traceId, state.query, synthesis, finalState.retrievedDocs)
  .then(r => { if (r) pushSSE(sessionId, 'ragas_scores', r); })
  .catch(() => {});
```
Confirm whether `state.query` (the original NL query) is stored in `BankingSentinelState` — if not, add it as a field in `state.js`.

---

### Incomplete 4 — Self-RAG re-query loop skips Trajectory Agent (MEDIUM)

**File:** `srv/graph/banking-sentinel.js` lines 98–100

**What's wrong:**
When `checkConfidence` returns `'requery'`, the graph routes back to `relationship` only. Trajectory Agent never re-runs. If the Self-RAG evaluation identifies the gap in trajectory data (income timeline, forward DTI), re-querying the relationship graph cannot fix it — trajectory always contributes the same stale output.

**Verify:**
In a low-confidence run, log `selfRagEvaluation.reQueryHint`. If the hint mentions DTI, income expiry, or payment schedule — the re-query is routing to the wrong agent.

**Fix options:**
1. **Route-aware re-query** — `checkConfidence` returns `'requery_relationship'` or `'requery_trajectory'`. Graph routes to the appropriate agent. Most correct.
2. **Re-run both** — route `'requery'` back to `riskStart` so the full fan-out repeats. Higher token cost but simpler graph topology.
3. **Accept the limitation for prototype** — document it as a known gap. Trajectory re-query is not in scope for the demo.

Option 3 is fine for now. Option 1 is the right production answer.

---

## SECTION 3 — PHASE 8 GAPS

### Phase 8a — Pattern Agent's LLM sub-call has no Langfuse child span (LOW)

**File:** `srv/agents/pattern-agent.js`

**What's wrong:**
`runLlmAnomalyDetection()` calls Claude via `ChatAnthropic` but does not pass a `callbacks: [lfHandler]` argument. The LLM call's tokens, latency, and prompt are not captured as a child span under the pattern agent trace. The `startSpan`/`endSpan` wrapper captures the overall node, but the internal LLM call is invisible in Langfuse.

**Fix:**
Pass `getLangchainHandler(state.traceId, 'pattern-llm')` into `runLlmAnomalyDetection` and add it to the `ChatAnthropic` callbacks array. One-line change.

---

### Phase 8b — `simple-query` and `rejection` paths have zero Langfuse tracing (MEDIUM)

**Files:** `srv/agents/simple-query.js`, `srv/agents/rejection.js`

**What's wrong:**
These two paths are reached by a significant proportion of queries — simple data questions and inappropriate requests. Neither imports or calls any Langfuse function. Their LLM calls, token counts, and latency are invisible in the Langfuse dashboard. From a CPS 230 audit perspective, these are untracked AI calls.

**Fix:**
Add `getLangchainHandler(state.traceId, 'simple-query')` to the `ChatAnthropic` call in `simple-query.js`. For `rejection.js` (no LLM call, just a fixed string), add a `startSpan`/`endSpan` wrapper around the node so the refusal event appears in the trace timeline.

---

### Phase 8c — Cost pricing hardcoded to Haiku rates (LOW)

**File:** `srv/server.js` lines 59–61

**What's wrong:**
```js
const INPUT_PER_1K  = 0.0025; // Claude Sonnet AUD approximate
const OUTPUT_PER_1K = 0.0125;
```
The comment says "Sonnet" but the values are Haiku pricing. If `ANTHROPIC_MODEL` is set to `claude-sonnet-4-6` or `claude-opus-4-7`, the AUD cost shown in the UI and stored in AuditLog will be significantly understated (Opus is ~15x more expensive per token than Haiku).

**Fix:**
Add a model-to-price lookup:
```js
const PRICING = {
  'claude-haiku-4-5-20251001': { in: 0.00025, out: 0.00125 },
  'claude-sonnet-4-6':         { in: 0.003,   out: 0.015   },
  'claude-opus-4-7':           { in: 0.015,   out: 0.075   }
};
const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const rates = PRICING[model] || PRICING['claude-haiku-4-5-20251001'];
```
Use AUD equivalent of USD prices (multiply by ~1.55).

---

### Phase 8d — Dual Langfuse instances, top-level trace may not flush (HIGH)

**File:** `srv/server.js` line 43 vs `srv/observability/langfuse-client.js` line 11

**What's wrong:**
Two separate Langfuse client instances are created — one in `server.js` (`langfuse`) for creating top-level traces, and one in `langfuse-client.js` (`_langfuse`) for spans and scores. `langfuseFlush()` (imported from `langfuse-client.js`) only flushes `_langfuse`. The server's `langfuse` instance is never flushed. Top-level trace metadata (latency, cost, response type set via `trace.update()`) may not reach the Langfuse dashboard before the response is sent.

**Fix:**
Consolidate to a single Langfuse instance. Export the instance from `langfuse-client.js` and import it in `server.js` instead of creating a second one. Then `langfuseFlush()` flushes everything.

---

## SECTION 4 — ARCHITECTURE RISKS

### Arch 1 — Solace creates a new TCP session per message (HIGH — production blocker)

**File:** `srv/events/solace-publisher.js`

**What's wrong:**
Every call to `publish()` runs: connect → send one message → disconnect. A full risk analysis emits ~8 events (one per node). That is 8 Solace TCP handshakes per analysis run. Under concurrent load (e.g. 5 analysts running queries simultaneously), this is 40 simultaneous Solace connect attempts. Solace has a hard connection limit per VPN. This will hit that limit and start dropping events with zero error surfaced to the UI.

**Fix:**
Refactor to a persistent session — connect once at server startup, keep the session alive, send on the existing session. Pattern:
```js
let _solaceSession = null;
async function getSession() {
  if (_solaceSession) return _solaceSession;
  _solaceSession = await connectSolace();
  return _solaceSession;
}
```
Add reconnect logic on disconnect event. This is the standard pattern for any message broker client.

---

### Arch 2 — HANA Vector search runs in a Node.js loop (MEDIUM — scale risk)

**File:** `srv/tools/mcp-tools.js` — `hana_vector_search`

**What's wrong:**
The function fetches ALL rows from `RegulatoryDocuments`, parses every `EMBEDDING` field (a JSON string of 1536 floats), and scores them in a JS loop. With ~30 chunks seeded today this takes milliseconds. In production after repeated APRA sync events, the table could grow to thousands of chunks. At that point:
- Megabytes of embedding JSON transferred from HANA per query
- Node.js CPU saturated for seconds, blocking the event loop
- Every other concurrent request stalls

**Fix:**
Use HANA's native `COSINE_SIMILARITY(TO_REAL_VECTOR(...), TO_REAL_VECTOR(?))` in a raw SQL query so HANA does the scoring server-side and only returns the top-K rows. This is already noted in `MEMORY.md` as a future upgrade when CDS 10 ships. For now: add a `LIMIT 500` cap to the SELECT as a safety valve, and track document count in `/a2a/config` so you can see when it's growing.

---

### Arch 3 — MemorySaver fallback can silently activate in CF (HIGH — data loss risk)

**File:** `srv/graph/banking-sentinel.js` line 48

**What's wrong:**
The guard for refusing MemorySaver in production checks `process.env.NODE_ENV === 'production'`. CF deployments do not automatically set `NODE_ENV`. If `POSTGRES_URL` is missing or Supabase is paused when the CF app starts, the server boots with MemorySaver, logs a warning, and serves requests normally. Any human-approval interrupt will be lost on the next CF instance restart (CF restarts apps frequently). The analyst approves a brief that no longer exists in state — silent data loss.

**Fix:**
Change the guard to check CF environment instead of `NODE_ENV`:
```js
const isCloudFoundry = !!process.env.VCAP_APPLICATION;
if (isCloudFoundry) throw new Error('PostgresSaver required on CF — set POSTGRES_URL');
```
`VCAP_APPLICATION` is always set by CF. This correctly blocks the fallback in all CF environments regardless of `NODE_ENV`.

---

### Arch 4 — OpenAI embedding is a hard dependency with silent fallback (HIGH — demo risk)

**File:** `srv/tools/mcp-tools.js` — `hana_vector_search`, `srv/agents/synthesis-agent.js`

**What's wrong:**
Vector search calls OpenAI directly via `fetch()`. If `OPENAI_API_KEY` is not set, or if BTP CF has no outbound internet (common in enterprise CF environments), the embedding call fails. The `try/catch` logs a warning and continues — synthesis receives zero regulatory documents. The risk brief is generated with no APRA regulatory context and no indication to the user that this happened. The brief will look complete but contains no grounded regulatory citations.

**Fix:**
If the embedding call fails, return an explicit error state and surface it in the UI:
```js
catch (e) {
  console.error('[VectorSearch] OpenAI embedding failed:', e.message);
  return { error: 'regulatory_context_unavailable', docs: [] };
}
```
In synthesis, if `retrievedDocs` is empty, include a visible warning in the brief: "⚠ Regulatory context unavailable — APRA citations may be incomplete."

---

## SECTION 5 — PHASE 9 AND DEMO READINESS

### Phase 9a — Educational drawer not built (CRITICAL — Phase 9 is incomplete)

**What's missing:**
The MEMORY.md Phase 9 requirement: "Educational slide-in drawer per agent (ON/OFF toggle)". There is no drawer, modal, sidebar, or toggle in the HTML. The agent rows have static description text (`<div class="ao">`) but nothing that expands, slides in, or toggles between demo mode and educational mode.

**What it should do:**
Each agent row in Panel 2 should have a small info button (ⓘ). Clicking it slides open a panel below the agent row showing:
- What AI pattern this agent uses (e.g. "ReAct Loop — the agent iterates: observe → think → act until it decides to stop")
- What SAP technology it uses (e.g. "HANA Knowledge Graph Engine + SPARQL")
- Why it matters for banking (e.g. "Traverses connected party chains to find APS 221 group exposure breaches")

**Implementation approach:**
Each agent `div` gets a hidden `<div class="edu-drawer">` below it. Toggle class `open` on click. CSS transition handles the slide. Content is hardcoded per agent — no server call needed. Five agents × one drawer each = five static HTML blocks. Roughly 80 lines of HTML + 20 lines of CSS + 10 lines of JS.

---

### Phase 9b — Anomaly engine label (DONE)

`GET /a2a/config` returns `anomalyEngineLabel` based on `ANOMALY_ENGINE` env var. The UI fetches it on load and updates the Pattern Agent description. Works correctly for both `pal` and `scikit` modes. No action needed.

---

### Phase 9c — Demo readiness gaps

**Gap 1 — Graph always shows star topology (links to Bug 1)**
For the demo scenario "Rose Courtney is connected to Eric Miller via family trust — group exposure AUD 9.68M", the graph canvas should show the actual connected party chain. Currently it shows a star from node 0 to all others. Fix Bug 1 first, then verify the graph renders the real edges from the Relationship Agent output.

**Gap 2 — Sector concentration threshold uses wrong limit for non-RETAIL_PROP sectors**
`apra_threshold_check` in `mcp-tools.js` always uses the first row of `SectorExposureLimits`. For the demo this is fine because the demo scenarios all involve RETAIL_PROP. But if a demo attendee asks about a different sector, the wrong limit will be cited. Low risk for a scripted demo.

**Gap 3 — No empty-result error message for unknown BP**
If a user types a BP that doesn't exist in HANA (or a typo), all downstream queries return empty arrays. The LLM receives empty data and produces a generic or confused response. There is no early-exit check that says "BP 99999999 not found in system." Add a check in the intake agent or simple-query node: if no loans found for customerId, return a clear "Customer not found" message before hitting the full pipeline.

---

## SECTION 6 — PRIORITY ORDER FOR FIXING

| # | Item | Effort | Priority |
|---|---|---|---|
| 1 | Bug 1 — drawGraph edge objects | 10 min | Fix now — demo blocker |
| 2 | Incomplete 2 — seed BCA_COLLATERAL | 30 min | Fix now — missing risk signal |
| 3 | Phase 8d — dual Langfuse instances | 20 min | Fix before Phase 8 sign-off |
| 4 | Arch 4 — OpenAI silent failure | 15 min | Fix before demo |
| 5 | Phase 9a — educational drawer | 2–3 hrs | Build to complete Phase 9 |
| 6 | Bug 2 — routeAfterPattern | 30 min | Fix before production |
| 7 | Bug 4 — LoanSchedule window | 20 min | Fix before production |
| 8 | Incomplete 1 — validate.js connect | 45 min | Fix before production |
| 9 | Arch 1 — Solace persistent session | 1 hr | Fix before BTP CF deploy |
| 10 | Arch 3 — MemorySaver CF guard | 10 min | Fix before BTP CF deploy |
| 11 | Phase 8b — trace simple-query/rejection | 20 min | Nice to have |
| 12 | Phase 8c — cost pricing per model | 20 min | Nice to have |
| 13 | Incomplete 4 — self-RAG trajectory loop | 1 hr | Post-demo roadmap |

---
