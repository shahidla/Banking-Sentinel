# Banking Sentinel — Code Review
**Date:** 2026-05-27
**Review scope:** Full codebase post-pull (18 files, 1,227 insertions)
**Reviewer:** Claude Code (Sonnet 4.6)

---

## Section 1 — Fixed Items (from Previous Review)

Items from the prior review that were confirmed fixed in the pull.

| # | Item | File | Status |
|---|------|------|--------|
| 1 | `isDeteriorating` typo | `trajectory-agent.js` | ✅ Fixed |
| 2 | `isImproving` overly broad condition | `trajectory-agent.js` | ✅ Fixed — requires `!breachFlag && currentDti < APRA_DTI_LIMIT * 0.70 && daysToExpiry === null` |
| 3 | LoanSchedule query fetched all rows unfiltered | `trajectory-agent.js` | ✅ Fixed — `.where('DUE_DATE <=', incomeExpiryIso).limit(20)` |
| 4 | `routeAfterPattern` wired incorrectly | `banking-sentinel.js` | ✅ Fixed — `pattern → trajectory` for high-risk, `pattern → synthesis` for low-risk |
| 5 | `riskStart` node missing | `banking-sentinel.js` | ✅ Fixed — pass-through `.addNode('riskStart', () => ({}))` added |
| 6 | VCAP_APPLICATION guard missing | `banking-sentinel.js` | ✅ Fixed — throws if `VCAP_APPLICATION` set and no PostgresSaver |
| 7 | Langfuse double-instance | `server.js` | ✅ Fixed — `langfuse = getLangfuse()` singleton pattern from `langfuse-client.js` |
| 8 | Self-RAG parse failure silent proceed | `self-rag.js` | ✅ Fixed — defaults to confidence 0.60 (triggers requery) |
| 9 | OpenAI embedding silent failure in synthesis | `synthesis-agent.js` | ✅ Fixed — `regulatoryContextUnavailable` flag + adds to uncertainties |
| 10 | Solace session not persistent | `solace-publisher.js` | ✅ Fixed — persistent session with module-level state, queue buffering, reconnect |
| 11 | Star-graph bug (all edges from startNode) | `mcp-tools.js` | ✅ Fixed — second SPARQL (VALUES clause) returns real A→B chain edges |
| 12 | BCA_COLLATERAL not seeded | `scripts/seed.js` | ✅ Fixed — `mapBCA_COLLATERAL` function seeding 28 records |
| 13 | Graph canvas static placeholder | `Banking-Sentinel-AustralianBank.html` | ✅ Fixed — `drawGraph()` fully rewritten with BFS layout, arrowheads, edge labels |

**2 items from the prior review remain open** — see Section 2 (NB-2, validate.js).

---

## Section 2 — New Bugs and Regressions

Issues found in this review that were not present before the pull.

### NB-1 — WCAG Contrast Failure: `--light` CSS variable
- **File:** `Banking-Sentinel-AustralianBank.html`
- **Line:** CSS `:root` block
- **Issue:** `--light: #A0A0A0` gives a contrast ratio of 2.85:1 against white. WCAG AA requires 4.5:1 for normal text.
- **Fix:** Change to `--light: #767676` (4.54:1 ratio — meets AA).
- **Impact:** Accessibility. Affects all secondary text, labels, and agent status badges using `--light`.

### NB-2 — SPARQL Multi-hop `relType` Returns Null Beyond Hop 1
- **File:** `srv/tools/mcp-tools.js`
- **Lines:** 127–145 (reachability SPARQL)
- **Issue:** The `OPTIONAL` clause in the reachability query only matches *direct* edges from `startNode`. Nodes at hop 2+ return `relType: null` because the `OPTIONAL { <startUri> ?rel ?node }` pattern only walks one step.
- **Fix:** Correlate `relType` from the edge SPARQL (query 2) rather than the reachability SPARQL (query 1). Build a `Map<partnerId, relType>` from `chainEdges` and use it to enrich `traversalRows`.
- **Impact:** Relationship Agent shows correct partner IDs and hop counts, but the relationship type label (e.g. `FAMILY_TRUST_MEMBER`) is null for all partners discovered beyond the first hop.

### NB-3 — Self-RAG Re-query Cap Allows One Extra Iteration
- **File:** `srv/agents/self-rag.js`
- **Issue:** `if (confidence < 0.70 && reqCount < 3)` allows up to 3 re-queries before falling through. The design intent (per MEMORY.md and agent comments) is a maximum of 2 re-queries (3 total attempts).
- **Fix:** Change `reqCount < 3` to `reqCount < 2`.
- **Impact:** Low-confidence responses may trigger one extra LLM + HANA Vector call, adding ~2–4s latency and token cost.

### NB-4 — RAGAS Faithfulness Null on Approve Path
- **File:** `srv/server.js`
- **Lines:** 417–424
- **Issue:** `runRagasEvaluation(finalState)` is called on the approve path, but `finalState.retrievedDocs` is not populated during the resume flow — it was only set in the original run. `faithfulness` will be `null` for all approved interactions.
- **Fix:** Persist `retrievedDocs` in the LangGraph checkpoint state (add to `channels` in `banking-sentinel.js`) so it is available when the graph resumes.
- **Impact:** RAGAS dashboard shows `faithfulness: null` for approved (human-in-the-loop) runs, making the quality scores incomplete for the most important interactions.

### REG-1 — Relationship Agent 45s Timeout Regression
- **File:** `srv/agents/relationship-agent.js`
- **Issue:** The `Promise.race([agentCall, timeout(45000)])` guard added in Phase 7 is absent in the current file. A hung GraphDB call or slow LLM will freeze the entire LangGraph pipeline indefinitely.
- **Fix:** Re-add the `Promise.race` with a 45s timeout and reject with a structured error that the relationship agent catches and returns as a `TIMEOUT` status.
- **Impact:** In production (BTP CF), a single unresponsive GraphDB request blocks the worker thread and eventually hits the CF request timeout (60s default), surfacing as a 503 to the UI with no agent state preserved.

---

## Section 3 — Functional Review (Per Agent)

### Intake Agent
- Routes by keyword matching on the prompt string (partner ID regex, "dti", "sector").
- Correctly sets `analysisType` and passes `partnerId` downstream.
- No issues found.

### Pattern Agent (a2)
- Runs RPT-1 anomaly detection (PAL stub / scikit fallback) against `DFKKOP` payment records.
- LLM call (Claude Haiku) generates a narrative pattern summary.
- `routeAfterPattern` correctly gates: `risk_score >= 0.7` → high-risk path, otherwise low-risk → synthesis.
- **Note:** PAL stub always returns the scikit path in dev — confirmed by design (PAL requires HANA PAL license).

### Trajectory Agent (a4 — runs before Relationship Agent)
- Calculates DTI from `BCA_DTI` and `BCA_INCOME`.
- `isImproving` now correctly restricted — no false positives on improving trend.
- `isDeteriorating` correctly flags when both `breachFlag` is set and `daysToExpiry !== null`.
- Ambiguous state resolves to `'MONITORING'` — correct.
- LoanSchedule query scoped by income expiry date and limited to 20 rows — correct.
- APRA DTI limit hardcoded to `6.0` (Feb 2026 activation) — this is correct for the prototype but should be read from `RegulatoryThresholds` table for production.

### Relationship Agent (a3 — runs after Trajectory)
- ReAct loop with up to 5 tool calls.
- Receives `trajectoryContext` (DTI status) from prior agent — used in exposure reasoning.
- 3-SPARQL pattern correctly identifies connected party groups.
- `toolGraphData` captures first successful `hana_graph_traverse` result — UI receives `nodeDetails` and `edges`.
- **Regression REG-1:** No timeout guard — see Section 2.
- **Bug NB-2:** Multi-hop `relType` is null — see Section 2.

### Self-RAG Agent
- LLM-as-judge (Claude Haiku) scores its own output on coherence, evidence, regulatory alignment.
- Parse failure now defaults to 0.60 — triggers requery rather than proceeding silently.
- **Bug NB-3:** Re-query cap is 3 iterations, should be 2 — see Section 2.
- RAGAS scores (faithfulness + answer relevance) computed here and emitted via SSE.

### Synthesis Agent
- Retrieves APRA regulatory context via HANA Vector (OpenAI embeddings).
- `regulatoryContextUnavailable` flag correctly degrades gracefully if OpenAI fails.
- Still using `claude-haiku-4-5-20251001` — upgrade to `claude-opus-4-7` planned for demo (see CONTEXT.md).
- Output includes `apraReady` flag, `uncertainties[]`, and structured risk brief.

### validate.js — DISCONNECTED (CPS 230 Risk)
- `validateAgentOutput()` and `crossCheckClaimsAgainstSources()` exist in `srv/guardrails/validate.js` but are not imported by any agent, graph node, or server file.
- Under CPS 230, AI-generated outputs used in credit decisions must be validated against source data.
- **Required fix:** Import and call `validateAgentOutput()` in `synthesis-agent.js` before returning the final risk brief, and `crossCheckClaimsAgainstSources()` in `self-rag.js` after the confidence check.

---

## Section 4 — Architecture Review

### LangGraph Execution Order

The backend execution order is **intake → riskStart → pattern → trajectory (a4) → relationship (a3) → selfRagCheck → humanApproval → synthesis**. The UI labels a3/a4 do not match execution order by design — relationship agent (a3 in UI) runs after trajectory (a4 in UI) so it can consume the DTI context. This is intentional and must not be changed.

### Three HANA Engines

All three HANA engines are exercised correctly:

- **Relational** (`hana_relational_query`): `DFKKOP`, `BCA_DTI`, `BCA_INCOME`, `Loans`, `BCA_GUARANTOR`, `ExposureLimits`
- **Vector** (`hana_vector_search`): `RegulatoryDocuments` with cosine similarity scoring (Node.js loop — see Arch 2 below)
- **Graph** (`hana_graph_traverse`): GraphDB (Graphwise sandbox) via SPARQL — production equivalent is HANA KGE

### Known Architecture Gaps

**Arch 1 (Fixed):** Solace persistent session now uses module-level state with queue buffering and reconnect.

**Arch 2 (Open):** HANA Vector cosine similarity computed in Node.js (`cosineSimilarity()` loop over all documents). This is a full table scan + in-process computation. At scale (thousands of regulatory chunks), this will be slow. Production upgrade: use `COSINE_SIMILARITY(TO_REAL_VECTOR(EMBEDDING), TO_REAL_VECTOR(?))` natively in HANA SQL with a LIMIT clause.

**Arch 3 (Open):** PostgresSaver is used for LangGraph checkpointing in local dev. On BTP CF, the VCAP_APPLICATION guard throws if PostgresSaver is not configured. The CF deployment path (Phase 10) requires a bound PostgreSQL service and the `initPostgresSaver()` call to succeed before the server accepts traffic.

### RAGAS Evaluation

RAGAS faithfulness + answer relevance are computed after selfRagCheck. Scores are emitted via SSE to the UI and pushed to Langfuse. Faithfulness measures whether agent claims are grounded in retrieved documents — currently scoring ~0.25 (target: >0.85). Root cause: synthesis agent constructs the answer before retrieval in some paths, so `retrievedDocs` does not cover the full answer. Fix requires reordering retrieval before answer generation in synthesis.

### Observability

Langfuse singleton (`langfuse-client.js`) traces all LLM calls, tool calls, and agent spans. `MODEL_PRICING_AUD` map in `server.js` converts token costs to AUD for the cost display in the UI. Trace IDs are surfaced in SSE events.

---

## Section 5 — UI Review

### Graph Rendering (`drawGraph()`)

- BFS layout algorithm places nodes in concentric rings by hop distance — correct.
- Directed edges with arrowheads rendered on canvas.
- Edge type labels (e.g. `FAMILY_TRUST_MEMBER`, `GUARANTOR`) displayed on edges.
- Two-line node labels: name on line 1, BP number on line 2.
- Canvas height: 240px — sufficient for 6-hop graphs, may clip for larger groups.

### Educational Drawer

- CSS `.edu-drawer` slides in from the right on toggle.
- `addEduSection()` fires per agent completion, populating from `EDU_META` map.
- `EDU_META` covers all agents with titles and subtitles.
- **Gap:** The drawer currently shows structural metadata (agent name, pattern type) but lacks the narrative content explaining *what AI pattern is used*, *what SAP technology it maps to*, and *why this approach matters for banking compliance*. This content needs to be written per agent and wired into `EDU_META.description`.

### Agent Status Badges

- `'● Thinking'`, `'↻ Re-querying'`, `'✓ Complete'`, `'○ Waiting'` — all rendering correctly.
- Low-risk path correctly greys out a3/a4 when synthesis arrives directly from pattern.
- `data-counted` flag prevents double-count on a4 (both trajectory and selfRagCheck fire `complete` events).

### SSE Event Handling

- `nextMap = { intake: 'a2', trajectory: 'a3' }` routes UI state machine correctly.
- Approve/reject buttons wire to `POST /api/approve` and `POST /api/reject` correctly.
- RAGAS scores displayed in UI after selfRagCheck completes.

### Bug NB-1

- `--light: #A0A0A0` fails WCAG AA (2.85:1). Fix: `#767676`.

---

## Section 6 — Pending Items (from CONTEXT.md)

Items tracked in CONTEXT.md as pending that are confirmed not yet implemented:

| Item | Status | Notes |
|------|--------|-------|
| Twinkle 2 button | Pending | UI button to trigger a second analysis pass |
| Education popup narrative content | Partial | Drawer structure exists, content not written |
| Explainability / Investigation Report | Pending | `GET /api/report/:sessionId` — not implemented |
| RAGAS faithfulness fix (0.25 → >0.85) | Pending | Requires retrieval-before-generation reorder in synthesis |
| validate.js connection | Pending | CPS 230 compliance — guardrails disconnected |
| Synthesis model upgrade (Haiku → Opus 4.7) | Pending | For demo quality |
| Relationship Agent timeout re-add (REG-1) | Pending | Regression from pull |
| HANA Vector native SQL (Arch 2) | Open | Scale risk, not urgent for dev |
| Phase 10: CF deployment | Pending | PostgresSaver, env vars, manifest.yml |
| Architecture diagram | Pending | For blog post / resume |
| Blog post | Pending | Phase 10 deliverable |

---

## Section 7 — Priority Table

Ranked by risk and demo impact.

| Priority | ID | Item | File | Effort |
|----------|----|------|------|--------|
| P0 | REG-1 | Relationship Agent timeout regression | `relationship-agent.js` | 15 min |
| P0 | validate.js | Connect guardrails (CPS 230) | `synthesis-agent.js`, `self-rag.js` | 30 min |
| P1 | NB-4 | RAGAS faithfulness null on approve path | `server.js`, `banking-sentinel.js` | 1 hr |
| P1 | NB-3 | Self-RAG re-query cap 3 → 2 | `self-rag.js` | 5 min |
| P1 | RAGAS | Faithfulness score 0.25 → >0.85 | `synthesis-agent.js` | 2 hr |
| P2 | NB-2 | SPARQL multi-hop relType null | `mcp-tools.js` | 30 min |
| P2 | NB-1 | WCAG `--light` contrast fix | HTML CSS | 2 min |
| P2 | Edu | Education drawer narrative content | HTML `EDU_META` | 2 hr |
| P2 | Model | Synthesis upgrade Haiku → Opus 4.7 | `synthesis-agent.js` | 5 min |
| P3 | Report | Explainability/Investigation Report | `server.js` + new file | 3 hr |
| P3 | Twinkle2 | Twinkle 2 button | HTML | 30 min |
| P4 | Arch 2 | HANA Vector native SQL | `mcp-tools.js` | 1 hr |

---

*Review generated by Claude Code (Sonnet 4.6) on 2026-05-27. Based on pull diff of 18 files, 1,227 insertions.*
