# Banking Sentinel — Production-Grade Review

> Reviewed: 2026-06-12 | Reviewer: Antigravity | Scope: Full codebase (C:\Dev\Banking-Sentinel)

---

## Executive Summary

Banking Sentinel is a well-architected, technically sophisticated multi-agent AI risk system built on SAP CAP + LangGraph + HANA Cloud. The **core AI pipeline** (agent orchestration, LangGraph state, observability, RAG) is **production-quality code** — clearly reasoned, well-commented, and defensively written. However, several **critical security and operational gaps** must be resolved before this can be considered production-safe.

**Overall rating: 7.5 / 10** — impressive demo quality, needs targeted hardening for production.

---

## 🔴 CRITICAL Issues (Block Production Deployment)

### C-1 — Live credentials committed to `.cdsrc.json` (SEVERITY: CRITICAL)

[.cdsrc.json](file:///C:/Dev/Banking-Sentinel/.cdsrc.json) L16–22 contains a **plaintext HANA Cloud username and 120-character password** for the production HANA host.

```json
"user": "B8EC4EAB42CB46BE940B89D1209CC93D_...",
"password": "f|[hBRE[-1(uI=+LU&~vI..."
```

**This file is NOT in `.gitignore`** — only `.cdsrc-private.json` is excluded. Any `git push` will expose the production database password.

**Fix:** Move credentials to `.cdsrc-private.json` (already gitignored), which already uses the `[hybrid]` binding pattern. Delete the inlined `credentials` block from `.cdsrc.json` immediately and rotate the password.

---

### C-2 — All API keys and passwords exposed in `.env` (SEVERITY: CRITICAL)

[`.env`](file:///C:/Dev/Banking-Sentinel/.env) contains 15+ live production secrets:
- `OPENAI_API_KEY` — live OpenAI billing key
- `ANTHROPIC_API_KEY` — live Anthropic key
- `HANA_PASSWORD`, `CF_PASSWORD`, `CPI_PASSWORD` — all `Saplabs12#Saplabs12#`
- `POSTGRES_URL` — Supabase connection string with embedded password
- `GRAPHDB_PASSWORD`, `LANGFUSE_SECRET_KEY`, `SOLACE_PASSWORD`, `SAP_RPT_API_KEY`

The identical password `Saplabs12#Saplabs12#` used across HANA, CF, and CPI is a serious credential-hygiene failure.

**Fix:**
1. Rotate all shared/reused passwords to unique values immediately.
2. For CF production: inject secrets via `cf set-env` or BTP credential store — never in `.env` or `manifest.yml`.
3. Add a `pre-commit` hook or `gitleaks` scan to prevent future exposure.

---

### C-3 — Admin UI (`/admin`) has no authentication (SEVERITY: CRITICAL)

[`srv/admin.js`](file:///C:/Dev/Banking-Sentinel/srv/admin.js) mounts a full data browser at `/admin` that can:
- Browse every HANA table (AuditLog, RiskAssessments, full loan book, BCA_DTI)
- Delete records from `RiskAssessments` and `AuditLog`
- Clear all LangGraph PostgreSQL checkpoints
- Execute arbitrary SPARQL queries against GraphDB
- Read raw PostgreSQL LangGraph state

The manifest template has `ADMIN_IP_WHITELIST: disabled` — the IP-whitelist guard is **explicitly disabled**. There is no auth middleware, no session check, no token requirement.

**Fix:** Add `express-basic-auth` or integrate SAP BTP XSUAA before the `mountAdminUI(app)` call. At minimum, require a Bearer token header.

---

### C-4 — `/a2a/agent` endpoint has no authentication (SEVERITY: HIGH)

The main A2A endpoint ([`server.js`](file:///C:/Dev/Banking-Sentinel/srv/server.js) L140) accepts unauthenticated POST requests. Any internet user who discovers the CF URL can trigger full LangGraph pipelines incurring Anthropic/OpenAI costs and querying the HANA customer portfolio.

**Fix:** For production, add XSUAA JWT validation middleware. For demo, add a shared secret header check (`X-API-Key`).

---

### C-5 — `/a2a/approve` has no role check (SEVERITY: HIGH)

[`server.js`](file:///C:/Dev/Banking-Sentinel/srv/server.js) L385: The HITL approval endpoint accepts any `approvedBy` string from the request body with no authentication or role assertion. Anyone who knows a `sessionId` can approve a risk assessment.

```js
const { sessionId, approvedBy = 'risk_officer' } = req.body || {};
```

**Fix:** Validate `approvedBy` against an authenticated user identity (XSUAA JWT claim). Approval must trace to a real authenticated risk officer.

---

## 🟠 HIGH Issues (Must Fix Before Go-Live)

### H-1 — `auth: dummy` in production CDS config

[`package.json`](file:///C:/Dev/Banking-Sentinel/package.json) L51–53 and [`.cdsrc.json`](file:///C:/Dev/Banking-Sentinel/.cdsrc.json) L7–9 set `"auth": { "kind": "dummy" }` as the **default** non-profile configuration. This disables CAP's built-in XSUAA authentication for all OData endpoints.

**Fix:** `auth: dummy` must only appear in `[development]` or `[local]` profile. Production profile must use `"kind": "xsuaa"`.

---

### H-2 — SSE endpoint has unbounded client registry

[`server.js`](file:///C:/Dev/Banking-Sentinel/srv/server.js) L30: `const sseClients = new Map()` grows indefinitely if browsers reconnect without closing (e.g. stale proxy). The `req.on('close')` handler correctly cleans up, but there is no cap on concurrent clients — DoS surface.

**Fix:** Add a max concurrent SSE client cap and a periodic sweep to remove entries where `res.writableEnded === true`.

---

### H-3 — SCIKIT_SERVICE_URL hardcoded to localhost in CF manifest template

[`manifest.yml.template`](file:///C:/Dev/Banking-Sentinel/manifest.yml.template) L34 sets `SCIKIT_SERVICE_URL: http://localhost:5001`, but `ml/` is excluded from `.cfignore` (L14). **Anomaly detection silently fails on CF** — the pattern agent falls through to PAL (also unavailable on trial HANA), causing the agent to throw.

**Fix:** Either deploy `anomaly-service.py` as a separate CF app and update `SCIKIT_SERVICE_URL`, or document that CF production requires `ANOMALY_ENGINE=pal` with paid HANA Cloud. Update the pattern agent to degrade gracefully when both methods fail.

---

### H-4 — RPT-1 and embedding token costs are untracked

The `sum` reducers in [`state.js`](file:///C:/Dev/Banking-Sentinel/srv/graph/state.js) correctly accumulate Claude tokens. However, RPT-1 calls via raw `fetch()` to `rpt.cloud.sap` and OpenAI embedding calls have no usage metadata returned — the `calculateCostAUD()` function in `server.js` therefore **understates actual cost**.

**Fix:** Document the gap, or add token estimation for RPT-1 based on payload size.

---

### H-5 — No rate limiting or request body size limits

`express.json()` is mounted without a size limit. The `/a2a/sync-apra` endpoint accepts `pdfBase64` which could be many megabytes. No rate limiter exists anywhere.

**Fix:**
```js
app.use(express.json({ limit: '10mb' }));
const rateLimit = require('express-rate-limit');
app.use('/a2a/', rateLimit({ windowMs: 60_000, max: 20 }));
```

---

### H-6 — CORS wildcard `*` on SSE and explain-stream endpoints

[`server.js`](file:///C:/Dev/Banking-Sentinel/srv/server.js) L117 sets `Access-Control-Allow-Origin: *` on the SSE endpoint. For a banking risk system, this should be locked to known frontend origins.

**Fix:** Replace `*` with `process.env.ALLOWED_ORIGINS` or the specific CF app route.

---

### H-7 — `RATE_STRESS_BUFFER_PCT` forward DTI calculation is mathematically incorrect

In [`trajectory-agent.js`](file:///C:/Dev/Banking-Sentinel/srv/agents/trajectory-agent.js) L70–73:

```js
const additionalAnnualCost = totalDebt * (RATE_STRESS_BUFFER_PCT / 100);
const stressedIncome = annualIncome - additionalAnnualCost;  // ← wrong
futureDtiRateStress = totalDebt / stressedIncome;
```

This subtracts additional debt cost from income, which is conceptually wrong. APG 223 serviceability assessment increases the **required repayment** (debt-side), not reduces income. At high debt levels this produces significantly inaccurate stress-test results.

**Fix:** Recalculate annual repayment obligation at `current_rate + RATE_STRESS_BUFFER_PCT`, then `DTI = stressed_annual_repayment / annual_income`.

---

## 🟡 MEDIUM Issues (Fix Before Production Hardening)

### M-1 — `intake-agent.js` uses greedy regex for JSON parsing (known, unfixed)

[`intake-agent.js`](file:///C:/Dev/Banking-Sentinel/srv/agents/intake-agent.js) L60: `content.match(/\{[\s\S]*\}/)` — acknowledged in `CLAUDE.md` but not yet fixed. If Claude returns trailing prose with braces, parsing breaks.

**Fix:** Replace with `extractJson()` from `srv/utils/llm-json.js`. One-line change:
```js
parsed = extractJson(content);
```

---

### M-2 — `simple-query.js` has hardcoded partner ID alias map

[`simple-query.js`](file:///C:/Dev/Banking-Sentinel/srv/agents/simple-query.js) L34–35: Hardcoded `'B-001' → '30100001'` map is demo scaffolding. In production, the intake agent must always return the canonical SAP BP number.

**Fix:** Remove the alias map from `simpleQueryNode`.

---

### M-3 — No retry logic for external API calls

All `fetch()` calls to `rpt.cloud.sap`, `api.openai.com`, and the scikit service use `AbortSignal.timeout()` but have no retry. A single transient 20s RPT-1 timeout fails the entire pipeline.

**Fix:** Wrap external fetches in a 2–3 attempt exponential-backoff retry for transient errors (429, 503).

---

### M-4 — Vector search SQL injection via `topK` parameter

[`mcp-tools.js`](file:///C:/Dev/Banking-Sentinel/srv/tools/mcp-tools.js) L72: `SELECT TOP ${topK}` directly interpolates the `topK` argument into SQL:

```js
`SELECT TOP ${topK} DOC_ID, ...`
```

**Fix:** `const safeTopK = Math.min(Math.max(1, Math.floor(Number(topK))), 50);`

---

### M-5 — SSRF vulnerability in `apra-embedder.js`

[`apra-embedder.js`](file:///C:/Dev/Banking-Sentinel/srv/rag/apra-embedder.js) L41–44: `pdfUrl` is passed directly to `https.get()` with no validation. An attacker can POST `pdfUrl: "http://169.254.169.254/latest/meta-data/"` to reach cloud metadata endpoints.

**Fix:**
```js
const url = new URL(pdfUrl);
const ALLOWED_HOSTS = ['www.apra.gov.au', 'download.asic.gov.au'];
if (!ALLOWED_HOSTS.includes(url.hostname)) throw new Error('PDF URL host not allowed');
```

---

### M-6 — No pagination on admin API data endpoints

[`srv/admin.js`](file:///C:/Dev/Banking-Sentinel/srv/admin.js) returns entire tables without pagination. `AuditLog` and `RiskAssessments` will grow to millions of rows in production.

**Fix:** Add `limit`/`offset` query params with a default page size of 100.

---

### M-7 — `SCHEDULE_TODAY` hardcoded reference date in `explain-agent.js`

Per `CLAUDE.md` L37: `explain-agent.js` uses `SCHEDULE_TODAY = '2026-05-21'` as a fixed demo date. In production, payment schedule comparisons will be evaluated against a past date — producing incorrect overdue calculations.

**Fix:** Replace with `new Date().toISOString().split('T')[0]` or make it an env variable.

---

### M-8 — No checkpointer mode exposed in health endpoint

[`banking-sentinel.js`](file:///C:/Dev/Banking-Sentinel/srv/graph/banking-sentinel.js) L36–55: Falls back to `MemorySaver` silently when `POSTGRES_URL` is unavailable. The `/a2a/health` endpoint doesn't report whether persistence is active.

**Fix:** Expose `checkpointer` mode in the health response:
```js
checkpointer: usingMemorySaver ? 'memory (non-persistent)' : 'postgres'
```

---

## 🟢 LOW Issues / Observations

### L-1 — No automated test suite

No unit, integration, or CI tests exist. The `scripts/` directory has ad-hoc validation scripts but nothing runnable in a CI pipeline.

**Recommendation:** Add Jest unit tests for `extractJson()`, `validateAgentOutput()`, `calculateCostAUD()`, `chunkText()`, and `parseDtiLimit()`.

---

### L-2 — `uuid` imported twice in `server.js`

[`server.js`](file:///C:/Dev/Banking-Sentinel/srv/server.js) L10 and L69 both have `const { v4: uuid } = require('uuid')`. Remove the inner declaration at L69.

---

### L-3 — `synthesis-agent.js` — `const brief` is reassigned (runtime crash)

[`synthesis-agent.js`](file:///C:/Dev/Banking-Sentinel/srv/agents/synthesis-agent.js) L158–170:

```js
const brief = extractJson(text);
// ...
brief = { ... };  // ← TypeError: Assignment to constant variable
```

This crashes at runtime whenever the LLM fallback path is hit.

**Fix:** Change `const brief` to `let brief` at L151.

---

### L-4 — `IMPROVING` forward position state is unreachable

[`trajectory-agent.js`](file:///C:/Dev/Banking-Sentinel/srv/agents/trajectory-agent.js) L149–159: The `IMPROVING` check is a strict subset of `STABLE`, but `STABLE` is evaluated first in the ternary chain — `IMPROVING` is **never reached**.

**Fix:**
```js
forwardPosition = isDeteriorating ? 'DETERIORATING' : isImproving ? 'IMPROVING' : isStable ? 'STABLE' : 'MONITORING';
```

---

### L-5 — Hallucination check is too simplistic

[`guardrails/validate.js`](file:///C:/Dev/Banking-Sentinel/srv/guardrails/validate.js) L47–52: Word-frequency overlap between claims and source text will inflate scores for common banking terms. The LLM-as-judge approach in `ragas-evaluator.js` is more accurate.

**Recommendation:** Replace `crossCheckClaimsAgainstSources` with the RAGAS faithfulness evaluator for production.

---

### L-6 — DTI limit parsing fails silently

[`apra-embedder.js`](file:///C:/Dev/Banking-Sentinel/srv/rag/apra-embedder.js) L61–88: If all 4 regex patterns fail on a PDF, `RegulatoryThresholds` is not updated and the failure is only logged as `WARN`. The operator has no fallback mechanism.

**Fix:** Add a `/api/set-threshold` endpoint for operator override when auto-parsing fails.

---

### L-7 — No SIGTERM handler for graceful shutdown

On CF, containers receive SIGTERM before being killed. The server doesn't handle this — Langfuse traces may not flush, and in-flight SSE connections are dropped abruptly.

**Fix:**
```js
process.on('SIGTERM', async () => {
  await langfuseFlush();
  process.exit(0);
});
```

---

### L-8 — ML `requirements.txt` has no version pins

Unpinned `flask`, `scikit-learn`, `numpy` means `pip install` may pull incompatible versions, breaking the Isolation Forest's contamination model.

**Fix:** Pin to specific versions: `flask==3.1.0`, `scikit-learn==1.6.1`, `numpy==2.2.0`.

---

### L-9 — Solace message queue is unbounded

[`solace-publisher.js`](file:///C:/Dev/Banking-Sentinel/srv/events/solace-publisher.js) L19: `let _queue = []` can grow indefinitely during Solace outages.

**Fix:** Cap at 100 entries, dropping oldest: `if (_queue.length >= 100) _queue.shift();`

---

### L-10 — `default-env.json` not in `.cfignore`

`default-env.json` is in `.gitignore` but not `.cfignore`. A `cf push` from a dev machine that has this file will upload it to the CF droplet.

**Fix:** Add `default-env.json` to `.cfignore`.

---

## Positive Observations

| Area | Assessment |
|------|------------|
| **LangGraph state design** | Excellent. Annotation reducers (`last`, `sum`, `append`) correctly chosen. State shape well-documented with inline JSDoc. |
| **`extractJson()` utility** | Robust balanced-brace parser. Correctly handles trailing prose, markdown fences, nested braces. |
| **Reflection loop** | Reflexion-style critic is architecturally sound. Max re-query cap at 2 prevents infinite loops. |
| **RAGAS evaluation** | `runRagasEvaluation` is fire-and-forget with `Promise.allSettled` — non-blocking and correctly isolated. |
| **Isolation Forest** | The 2D feature vector `[payment_delay_days, dunning_level]` is well-reasoned. Z-score reason codes correctly attribute anomaly drivers. |
| **CPS 230 guardrail** | `validateAgentOutput` correctly gates on 40% confidence refusal and 70% re-query thresholds. Evidence source requirement is sound. |
| **Langfuse observability** | Singleton pattern is correct. `getLangchainHandler` cleanly instruments LangChain without coupling. |
| **Solace session** | Persistent session with reconnect + buffering queue is a substantial improvement over per-message connect/disconnect. |
| **PostgresSaver on CF** | Correctly throws if `VCAP_APPLICATION` is set but PostgreSQL unavailable — refuses to silently downgrade. |
| **`apraReady` determinism** | Correctly computed deterministically in code, not delegated to the LLM. |
| **SPARQL edge topology** | Two-pass SPARQL (reachability + real edge pairs) correctly avoids the star-graph bug. |
| **PDF chunking** | Sliding window with 100-char overlap is appropriate for regulatory text. |
| **Comment quality** | Every file uses `// AI: / Banking: / SAP:` triples consistently — excellent for stakeholder demos. |
| **HITL implementation** | `interruptBefore: ['humanApproval']` + `graph.getState()` verification before advancing is the correct LangGraph pattern. |
| **Error propagation** | Agents propagate meaningful errors rather than swallowing them silently. |

---

## Priority Fix Sequence

```
IMMEDIATE (before any external demo or deployment):
  C-1  Move HANA credentials out of .cdsrc.json + rotate
  C-2  Rotate all shared passwords (Saplabs12#...)
  L-3  Fix `const brief` → `let brief` — runtime crash on synthesis fallback

SHORT-TERM (before BTP CF deployment):
  C-3  Add auth to /admin
  C-4  Add auth to /a2a/agent
  C-5  Add role check to /a2a/approve
  H-1  Move auth:dummy to [development] profile only
  H-5  Add rate limiting + request body size limits
  M-5  Fix SSRF in apra-embedder pdfUrl
  M-4  Fix SQL injection via topK parameter
  L-10 Add default-env.json to .cfignore

MEDIUM-TERM (production hardening):
  M-1  Migrate intake-agent to extractJson()
  H-7  Fix rate-stress DTI calculation
  H-3  Fix scikit service in CF manifest or deploy as separate app
  L-4  Fix unreachable IMPROVING state
  L-2  Remove duplicate uuid import
  M-3  Add retry logic for external APIs
  L-7  Add SIGTERM handler
  M-6  Add pagination to admin API
  M-7  Parameterise SCHEDULE_TODAY
  L-9  Cap Solace queue

NICE-TO-HAVE:
  L-1  Add automated test suite (Jest)
  L-5  Replace hallucination check with RAGAS LLM-judge
  L-6  Add DTI parsing fallback + override endpoint
  L-8  Pin ML requirements.txt versions
```

---

## Schema Assessment

The 14-entity HANA schema is well-designed with correct SAP TRBK naming conventions. Areas for improvement:
- **Missing DB indexes**: `PARTNER`, `GPART`, `LOAN_ID`, `SESSION_ID` fields need explicit indexes for production query performance.
- **Missing FK constraints**: CDS supports `@assert.integrity` annotations — add referential integrity between `Loans.PARTNER` → `BusinessPartners.PARTNER`, etc.
- **`LargeString` for EMBEDDING**: Correct for now; upgrade to `Vector(1536)` when CDS 10 is available.

---

## Dependency Risk Assessment

| Package | Version | Risk |
|---------|---------|------|
| `@langchain/langgraph` | `^1.3.2` | Low-Medium — frequent pre-2.0 API changes |
| `@langchain/anthropic` | `^1.4.0` | Low |
| `pdf-parse` | `^1.1.4` | **HIGH** — unmaintained since 2020, known CVEs in test harness |
| `solclientjs` | `^10` | Low |
| `neo4j-driver` | `^6.0.1` | **Remove** — not used anywhere in the codebase (dead dependency) |
| `@sap/hana-client` | `^2` | Low |
| `openai` | `^4.104.0` | Low |

> **Action**: Remove `neo4j-driver` from `package.json`. Replace `pdf-parse` with `pdf-parse-fork` or `pdfjs-dist`.

---

*Review complete. Files reviewed: 28. Critical blockers: 5. High/medium must-fix: 12. Low/observations: 10.*
