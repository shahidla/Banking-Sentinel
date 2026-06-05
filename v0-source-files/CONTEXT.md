# Banking Sentinel — Project Context (Live Working Document)
## Based on v6 — updated with actual Phase 3 + Phase 4 + Phase 4b + Phase 5 build decisions
## BACKUP: Banking-Sentinel-Context-v6.md is the original design document — DO NOT MODIFY IT
## This file (CONTEXT.md) is the single source of truth for Claude Code — it is v6 content + actual build decisions
## Differences from v6: (1) RPT-1 uses rpt.cloud.sap consumer API, not SAP AI Hub (trial limitation); (2) All three (RPT-1 + PAL + LLM) always run simultaneously — no PAL/LLM ENV switch gate; (3) Graph traversal uses BFS via CAP SELECT not GRAPH_TABLE (GRAPH_TABLE is a preview feature not yet GA in this HANA tier); (4) KGE/Triple Store not available on BTP trial
## Phase 3 complete (2026-05-24): LangGraph StateGraph + Intake + SimpleQuery + Rejection + A2A endpoint — all three routes verified
## Phase 4 complete (2026-05-24): Pattern Agent — RPT-1 (rpt.cloud.sap consumer API) + PAL Isolation Forest EXPLAIN (real HANA AFL CALL) + LLM (claude-sonnet-4-6) all running simultaneously. Combined anomaly output for Synthesis. rpt1/pal/llm sub-objects in patternAssessment for educational popup side-by-side display.
## Phase 4b complete (2026-05-24): Relationship Agent — ReAct loop (max 6 steps), hana_graph_traverse (BFS over BUT050), exposure_calculator, apra_threshold_check. Returns relationshipMap {nodes, edges, groupExposure, aps221Pct, confidence, finding}.
## Phase 5 complete (2026-05-24): Trajectory Agent + Synthesis Agent + Human-in-the-loop interrupt (interruptBefore: humanApproval). PostgresSaver checkpointer wired. Full pipeline LIVE end-to-end.
## Graph Engine decision (2026-05-24): KGE (Triple Store) NOT on BTP trial. GRAPH_TABLE SQL function NOT supported (preview feature only in this tier). Workspace BP_RELATIONSHIP_GRAPH deployed as HDI artifact — production upgrade path when GRAPH_TABLE goes GA.
## KGE equivalent (2026-05-24): GraphDB (Graphwise sandbox) — RDF triple store + SPARQL. Same SPARQL queries run on HANA KGE in production (one endpoint change). 4035 triples loaded: 1000 BusinessPartners + 12 BUT050 relationships. SPARQL traversal from 30100003 finds 7 connected parties including TrustCo Holdings (4 hops). Sandbox expires every 7 days — restore with: npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid
## Phase 6 complete (2026-05-25): Self-RAG — real LLM confidence evaluation (4 dimensions), targeted re-query loop (max 2), reQueryHint drives focused Relationship Agent re-traversal. Confidence threshold 0.70.
## Phase 7 complete (2026-05-25): SSE + Solace dual-publish per node via graph.stream(). UI fully wired — anomaly strings, relationship finding, forward position, synthesis findings all live. Admin data browser: PostgreSQL sidebar with real COUNT(*) and Clear All. Security hardening: admin IP guard, APS 221 GROUP limit fix, orphaned-approve 404, real audit latency. Relationship Agent 45s timeout + SPARQL 8s AbortSignal. Logo added.
## Phase 8 — HDI Deploy + PAL Investigation (2026-05-25): BP_RELATIONSHIP_GRAPH.hdbgraphworkspace + 3 CDS views deployed to HANA Cloud HDI via hdi-deploy v5.6.1. PAL Isolation Forest CONFIRMED NOT AVAILABLE on HANA Cloud Free Tier — ScriptServer requires 3 vCPU minimum; Free Tier has 1 vCPU. PAL code preserved in pattern-agent.js (calls PAL_RUN_ISOLATION_FOREST procedure) — non-fatal on Free Tier (warns, continues). Deploy to paid 3vCPU HANA Cloud + grant AFL__SYS_AFL_AFLPAL_EXECUTE to #OO user to enable PAL (see SAP KB 3655407). Key deploy fix: VCAP_SERVICES needs "tags": ["hana"] + "plan": "hdi-shared" for xsenv.filterServices to pick up the service. db/src/.hdiconfig added for hdbgraphworkspace + hdbprocedure plugins.
## HDI Deploy command (2026-05-25): npx cds build --for hana → Copy-Item default-env.json gen\db\default-env.json → cd gen\db; node node_modules\@sap\cds-dk\node_modules\@sap\hdi-deploy\deploy.js --exit
## Last updated: 2026-06-05 (Session 3)
## Session 3 (2026-06-05) — Bug fixes, blog post, pattern agent threshold fix:
## - Git pull / reset to origin/main (unrelated histories from prior force push)
## - Security fix: manifest.yml with 8 live credentials was committed in previous session (Claude mistake). User rotated all keys. manifest.yml added to .gitignore. manifest.yml.template created with no credentials — all external API keys go via cf set-env only.
## - Implemented all code-review.md fixes: HANA native cosine SQL (ALL CAPS table name: BANKINGSENTINEL_REGULATORYDOCUMENTS), parseDtiLimit regex improved, sector concentration filter scoped, model set to cheapest (Haiku).
## - HANA data updates: BCA_DTI for 30100001 — INCOME_EXPIRY='2027-04-01', INCOME_SOURCE='CONTRACT'. BUT050 30100001→30910005 and 30100001→30910006 RELTYP='FAMILY_TRUST_MEMBER'. GraphDB re-seeded (4021 triples).
## - Fixed LangGraph state: added selfRagHistory (append reducer), hitlEnabled (last reducer), totalLatencyMs (last reducer) — LangGraph silently drops undeclared state fields.
## - Fixed Self-RAG: maxTokens 400→800 (was truncating JSON), return only [newItem] not full rebuilt array (append reducer was doubling history).
## - Fixed AuditLog: column is CREATED_AT not TIMESTAMP. Wrapped graph.updateState() in try-catch so AuditLog INSERT always runs.
## - Fixed admin sessions: joined AuditLog for COST_AUD/LATENCY_MS/TOKENS. Added delete button with confirm dialog.
## - Fixed report page: pal.totalScored, scikit findings format, relConfidence, currentDti/futureDti in SSE events, hitlEnabled in initialState.
## - Fixed trajectory: INCOME_EXPIRY_WARN_DAYS=365 (was 180). Removed STATUS filter from LoanSchedule (column doesn't exist).
## - Fixed pattern agent: LLM now receives APRA DTI threshold from RegulatoryThresholds table — was citing 6.00x from training data when DB threshold was 8.0x.
## - UI fixes: graph height 240→320px, node font size, scikit unavailable state, graph wrap height.
## - Created comprehensive blog post: Docs/banking-sentinel-blog.md (710 lines, verified twice).
## - Primary demo customer changed: 30100001 (not 30100003) — DTI 5.80x, income expires 2027-04-01, connected to 30910005/30910006 via FAMILY_TRUST_MEMBER.
## - Commits: multiple commits this session. Latest: 2f8dc88 (blog), 66d6b00 (pattern threshold fix), 6778e82 (selfRag/auditLog fixes).
## CONFIRMED WORKING (2026-06-05 test, session ui-1780635064618):
##   selfRagHistory: 1 clean iteration (no duplicates) ✓
##   totalCostAUD: 0.0022 ✓, totalLatencyMs: 40655ms ✓, auditTrail: populated ✓
##   hitlEnabled: correctly stored/reflected ✓, currentDti/futureDti in View Details ✓
##   forwardPosition: MONITORING (correct for Demo 1 — threshold 8.0x, futureDti 7.05 < 8.0) ✓
## DEMO 2 FLOW (not yet run): click APRA Notice → threshold → 6.0x → re-run → DETERIORATING, timeToBreach=299
## PENDING: CF deployment (cf push + 9x cf set-env for rotated credentials + cf restage)
## Last updated: 2026-05-27 (Session 2)
## Session 2 (2026-05-27) — Cleanup sprint + APRA Notice hardening:
## - Deleted 6 unused HANA tables (BPRoles, ContractAccounts, BKKN, LoanConditions, DFKKZP, BCA_RISK_CLASS) from schema.cds + admin.js + seed.js + 6 CSVs + 3 processed JSONs
## - Created scripts/archive/ — moved 10 one-time scripts + 10 gen_*.js files there
## - Deleted: tsconfig.json, stubs.js, Bloomberg.html, Context-v6.md, code-review.md, Data/regulatory/*.json, Data/ragas-*.json, Data/ABPRelationship.json, Data/ABusinessPartnerRole.json
## - Removed all "twinkle" references — button renamed: id=apraBtn, fn=triggerApraNotice()
## - Fixed banner: revert button always shown (removed display:none guard)
## - Added /api/dti-status endpoint + checkApraState() on page load (restores APRA Notice state from HANA)
## - Added parseDtiLimit() in apra-embedder.js (parses DTI value from PDF text — regex handles ≥ and word-numbers)
## - Session ID in admin Sessions tab now shows full UUID
## - History button now yellow (matches APRA Notice style)
## PENDING (Task 2): seed-regulatory.js needs rewrite to read 3 live APRA URLs + manipulate DTI text 6→8 for Demo 1 baseline. JSON source files deleted — script will fail until rewritten.
## PENDING: parseDtiLimit() regex not yet confirmed working against real PDF — needs test after server restart + APRA Notice click

## SESSION 2026-05-27 — UI Polish Sprint (Phases 9 continuation)

### What was completed this session:

**Graph chain fix (Phase 4b follow-up):**
- Rewrote SPARQL in hana_graph_traverse: 3 queries — reachability, real chain edges (VALUES clause), node names
- Star-graph bug fixed: edges now represent actual A→B pairs, not startNode→every-partner fan-out
- Guarantor contamination fixed: loan lookup scoped to startNode only (was fetching all traversed nodes)
- nodeDetails enrichment: returns {id, name, hop, relType} — preserved in relationshipAgent.js toolGraphData
- Canvas drawGraph() rewritten: directed BFS layout, arrowheads, edge type labels, two-line node labels (name + BP number)
- Canvas height: 120px → 240px; graph-wrap now clickable → expand modal (92vw × 85vh)

**Agent ordering bug discovered and fixed:**
- ACTUAL backend execution order: pattern → trajectory (a4) → relationship (a3) → selfRagCheck → humanApproval → synthesis
- UI labels showed a3=Relationship, a4=Trajectory — OPPOSITE of execution order (by intent: trajectory needs pattern output, relationship uses trajectory DTI context)
- SSE nextMap was completely wrong — `{ relationship: 'a4', trajectory: 'a4' }` caused a4 to flash-complete and a3 to never show active
- Fixed: `{ intake: 'a2', trajectory: 'a3' }` — now correctly activates a3 (relationship) after a4 (trajectory) completes
- Pattern handler now activates a4 on HIGH/MEDIUM risk path
- "7 / 5 complete" bug fixed: `data-counted` flag on DOM element prevents double-counting when a4 gets marked complete twice (trajectory + selfRagCheck both fire complete)

**20 UI improvements (Banking-Sentinel-AustralianBank.html):**
- WCAG AA contrast: `--light` changed from `#A0A0A0` (2.85:1) to `#767676` (4.54:1)
- Agent status badges: `● Thinking`, `↻ Re-querying`, `✓ Complete`, `○ Waiting` — symbol+text, not color-only
- Severity badges: `.sev-badge` classes (CRITICAL/HIGH/MEDIUM/LOW) replacing color-only `.bsev` in breach cards
- Regulatory Alerts (left panel): REMOVED — duplicate of Regulatory Breaches (right panel) which has more info
- Skip-state guard updated for new badge text strings

**Graph expand modal:**
- `drawGraph()` refactored to accept optional canvas param; stores `lastGraphData`
- Click graph-wrap → `openGraphModal()` → redraws at 92vw × 85vh
- Hover shows `⤢ expand` hint; close via ✕, backdrop click, or Escape key

**Admin.js — items 21–30:**
- 21: Color tokens: body `#e5e7eb`, muted `#94a3b8`, dim `#a3b1c6`, row border `#2b3145`
- 22: Table: th/td padding 10/14px, line-height 1.45, zebra even rows `#151a28`
- 23: Semantic badges: `.low` `.medium` `.high` `.critical`
- 24: Tab active `font-weight:700`, entity-btn active `font-weight:600`, active bg `#20263a`
- 25: Sticky context bar on all 3 panels (Engine, Table/Rows/Last loaded / Triples etc)
- 26: SKIPPED — Confidence & Data Gaps: admin browser has no session state to populate this from
- 27: Focus styles: `button:focus-visible, .tab:focus-visible` 2px blue outline
- 28: Error panels: Retry/Reload tables/Retry SPARQL buttons; `display:flex` actionable layout
- 29: Numeric column alignment: COUNT/AMOUNT/TOTAL/PCT/RISK_SCORE → right-aligned tabular-nums
- 30: Header: normal case, no `⬡` symbol, accent only on interactive elements

**Files cleaned up:**
- Deleted: `.tmp-dns-check.js`, `.tmp-hana-check.js`, `.tmp-tls-check.js` (debug temp scripts)
- Deleted: `scripts/test-neo4j.js` (Neo4j never used — GraphDB is the graph store)
- Deleted: `Docs/code-review.md` (superseded — all bugs from it were fixed)

### PENDING — 41 ITEMS (master list — do not derive from elsewhere):

**TOP-LEVEL (4):**
1. **Twinkle 2 UI button** — "Sync Latest APRA Standards" button in top bar. Backend fully built (`/a2a/sync-apra`, `apra-embedder.js`, Solace event, SSE banner all wired). Button POSTs `{ docTitle, standard, pdfUrl }` to `/a2a/sync-apra`. Use hardcoded APRA PDF URLs for demo: APS 221 → `https://www.apra.gov.au/sites/default/files/2025-12/Prudential%20Standard%20APS%20221%20Large%20Exposures.pdf`; CPS 230 → `https://www.apra.gov.au/sites/default/files/2026-04/Prudential%20Standard%20-%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf`. SSE banner (`regulatory_update` event) shows strip: "Syncing APRA Standards... 47 chunks embedded" then dismisses. Button lives in top bar alongside HITL toggle.
2. **Human Approval panel** — show one-line agent summary above Approve button + add Reject button. Currently risk officer approves blind. FIX: send agent summaries in Solace `banking/human/approval` SSE event payload: Pattern: `HIGH risk · RPT-1 82% · 5 anomalies` / Trajectory: `DTI 7.2 — in breach 116 days · DETERIORATING` / Relationship: `7 connected parties · APS 221 168% of limit` / Self-RAG: `confidence 0.82 · evidence sufficient`. Data already in LangGraph state at interrupt. Also add [Reject] button.
3. **HITL toggle** — `[Human Approval: OFF | ON]` in top bar. Default OFF. UI sends `hitlEnabled` in POST body → state. In `humanApproval` node: if `!state.hitlEnabled` → auto-approve, skip `interrupt()`. FILES: `srv/graph/state.js` (add `hitlEnabled: Boolean`), humanApproval node in `srv/graph/banking-sentinel.js`.
4. **Education drawer removal + View Details popup build** — Remove all edu drawer code from `Banking-Sentinel-AustralianBank.html`. Each agent gets a "View Details" popup with two sections: (1) HOW IT WORKS — content written in CONTEXT.md below; (2) WHAT IT FOUND — raw agent output. Build for all 7 agents + Human Approval.

**AGENT DATA + LOGIC FIXES (21):**
5. Add `"INCOME_EXPIRY": "2026-09-15"` to `Data/processed/BCA_DTI.json` for 30100003 record → re-run `node scripts/seed.js`. Without this field, futureDti / daysToExpiry / timeToBreach all return null in trajectory-agent.js.
6. RPT-1: drop `scoreMap` at `pattern-agent.js` line 88. Use real confidence from `myPrediction?.risk_category?.[0]?.confidence` (e.g. 0.82). Display as "HIGH · 82%" not "70". FILE: `srv/agents/pattern-agent.js`.
7. Drop hardcoded `patternAssessment.confidence = 0.85` at `pattern-agent.js` line 283. Use `rpt1Result.confidence` instead.
8. Scikit-IF: display "0 / 3 payment rows flagged" using `outliers.length` / `result.scored`. Pass `result.scored` through in progress event. FILE: `srv/agents/pattern-agent.js`.
9. Pattern "View Details" popup — raw unmodified output from all 3 models: RPT-1 (category + confidence), Scikit-IF (X/Y flagged + reason codes per row), LLM (numbered anomaly list). FILE: `Banking-Sentinel-AustralianBank.html`.
10. timeToBreach: when `breachFlag=true` calculate `Math.floor((today - new Date(dti.BREACH_DATE)) / (1000*60*60*24))` days in breach. Not hardcoded 0. FILE: `srv/agents/trajectory-agent.js` line 104.
11. Trajectory "View Details" popup — currentDti, futureDti, daysToExpiry, timeToBreach, forwardPosition, conflictingSignals list. Also surface conflictingSignals in Synthesis prompt (currently only console.log'd). FILE: `Banking-Sentinel-AustralianBank.html`.
12. aps221Pct fix: `exposure_calculator` must SUM(`Loans.AMOUNT`) WHERE PARTNER IN (all connected entity IDs from graph traversal). Currently wrong: SUM(`BCA_GUARANTOR.COVER_AMOUNT`) on start node only. FILE: `srv/tools/mcp-tools.js` line 223.
13. Relationship "View Details" popup — connected parties table (name, BP ID, hop, relType), group exposure vs APS 221 limit, aps221Pct, finding sentence, ReAct steps, confidence. FILE: `Banking-Sentinel-AustralianBank.html`.
14. Pass full relationship data to Synthesis: `finding`, `nodeDetails` (array of {id, name, hop, relType}), `confidence`, `steps`. Currently only `{ groupExposure, aps221Pct, nodeCount, edgeCount }` sent. FILE: `srv/agents/synthesis-agent.js` lines 72-76.
15. Self-RAG: add dedicated UI badge between Relationship (a3) and Human Approval. FILE: `Banking-Sentinel-AustralianBank.html`.
16. SSE wiring: wire `selfRagCheck` SSE event to new Self-RAG badge, not a4 (Trajectory). FILE: `Banking-Sentinel-AustralianBank.html` SSE handler.
17. selfRagHistory array: change `selfRagEvaluation` (overwritten each iteration) to `selfRagHistory` array (append each iteration). FILES: `srv/graph/state.js` (add field), `srv/agents/self-rag.js` (change return value).
18. Self-RAG badge shows re-query state live: "↻ Re-querying (1/2)" when confidence < 0.70, "✓ Complete — confidence 0.82" when passes. FILE: `Banking-Sentinel-AustralianBank.html`.
19. Self-RAG "View Details" popup — one section per iteration. Each shows: iteration number, confidence, reasoning, gaps, reQueryHint, decision (RE-QUERIED / PASSED). Data from `selfRagHistory`. FILE: `Banking-Sentinel-AustralianBank.html`.
20. Pass `selfRagHistory` to Synthesis agentContext. FILE: `srv/agents/synthesis-agent.js`.
21. Synthesis agentContext: expand with full evidence — RPT-1 real confidence, Scikit-IF scored/flagged counts + reason codes, Relationship finding + nodeDetails + confidence + steps, Trajectory conflictingSignals, Self-RAG history + gaps + reQueryCount, collateral LTV. FILE: `srv/agents/synthesis-agent.js` lines 54-77.
22. Synthesis prompt: add explicit instructions to use conflictingSignals, Scikit-IF reason codes, relationship node names, Self-RAG gaps. Define riskScore scale: LOW=0-25, MEDIUM=26-50, HIGH=51-75, CRITICAL=76-100. Remove "Max 4 findings" limit (see item 25). FILE: `srv/agents/synthesis-agent.js` line 82+.
23. Synthesis "View Details" popup — full raw LLM output: riskScore, riskLevel, confidence, all findings, recommendations, regulatoryRefs, uncertainties, apraReady, retrievedDocs snippets, token counts. FILE: `Banking-Sentinel-AustralianBank.html`.
24. apraReady: remove from LLM output schema. Calculate deterministically after LLM returns: `findings.length > 0 && findings.every(f => f.evidenceSource) && selfRagHistory?.at(-1)?.gaps?.length === 0 && regulatoryRefs.length > 0 && confidence > 0.70 && (!hitlEnabled || approvalStatus === 'approved')`. FILE: `srv/agents/synthesis-agent.js`.
25. Remove "Max 4 findings, 3 recommendations, 3 uncertainties" limits from Synthesis system prompt. LLM returns as many as evidence supports. Only constraint: each finding must have severity, standard, evidenceSource, confidence. FILE: `srv/agents/synthesis-agent.js` line 96.

**OTHER FIXES (3):**
26. NB-2 SPARQL multi-hop relType null — partners at hop 2+ show `relType: null`. Fix: build `Map<partnerId, relType>` from chain edges SPARQL (query 2) and use to enrich `traversalRows`. FILE: `srv/tools/mcp-tools.js` lines 127-145.
27. validate.js: connect CPS 230 guardrails — import and call `validateAgentOutput(brief)` in `srv/agents/synthesis-agent.js` before returning risk brief; call `crossCheckClaimsAgainstSources(evaluation)` in `srv/agents/self-rag.js` after confidence check. FILE: `srv/guardrails/validate.js` already built, just not imported.
28. RAGAS faithfulness fix (0.25 → >0.85): (1) per-signal retrieval — separate `hana_vector_search` per active risk signal (DTI→APS221 DTI clauses, group exposure→APS221 connected party, income expiry→CPS230 risk mgmt); (2) topK 3→5-7; (3) `useHyDE: false` → `true` in synthesis-agent.js. After fix: re-run `node scripts/test-rag.js` then `python scripts/ragas-eval.py`. FILE: `srv/agents/synthesis-agent.js`.

**EXPLAINABILITY REPORT (2):**
29. Backend — `GET /api/report/:sessionId` endpoint reading PostgresSaver checkpoint. Returns full per-agent data + reasoning for one specific BP run. FILE: `srv/server.js` (new route).
30. UI view — dedicated report page: what data each agent saw, how each algorithm reasoned, how agents handed off, full investigative trail. NOT the educational drawer. Shows actual data + actual decisions for one run.

**PHASE 10 (4):**
31. CF deployment — PostgresSaver bound service, env vars, `manifest.yml`.
32. Architecture diagram.
33. Blog post.
34. Demo video.
35. Cleanup unused regulatory files — delete `Data/regulatory/credit-policy-7-3.json` (sector concentration — not in demo story), delete any APS112 regulatory files, remove APS112 rows from `RegulatoryDocuments` in HANA, remove from seed data. Neither APS112 nor credit-policy-7-3 are used in the demo pipeline.
36. Export all HANA tables to CSV when dev is complete — one CSV per table, all records, for final data documentation and handover.

**TWINKLE 2 — DTI THRESHOLD DEMO FLOW (5):**
37. **De-hardcode DTI threshold** — Remove `APRA_DTI_LIMIT = 6.0` from `trajectory-agent.js` line 10. Read `LIMIT_PCT` from `RegulatoryThresholds` table (THRESHOLD_ID='APRA-DTI') at agent runtime via `cds.run(SELECT...)`. Same fix in `mcp-tools.js` `apra_threshold_check` line 255: remove `limit = 6.0`, query `RegulatoryThresholds` instead. Makes threshold fully dynamic — no code change needed when APRA updates the limit.
38. **Seed Demo 1 threshold = 8** — Update `Data/processed/RISK_THRESHOLD.json` APRA-DTI record: change `LIMIT_PCT` from 6 → 8. Re-run `node scripts/seed.js`. Demo 1 result: DTI 7.2 < 8.0 = compliant, no DTI breach flagged.
39. **Update `apra-embedder.js` for Twinkle 2** — After embedding DTI notice PDF chunks into `RegulatoryDocuments`, also run `UPDATE RegulatoryThresholds SET LIMIT_PCT=6 WHERE THRESHOLD_ID='APRA-DTI'`. Only triggers when `standard === 'DTI_NOTICE'`. This atomically updates both vector knowledge and the threshold in one Twinkle 2 click. FILE: `srv/rag/apra-embedder.js`.
40. **Prepare Demo 1 regulatory knowledge base** — Clear existing synthetic RegulatoryDocuments chunks from HANA. Seed with: (1) real APS 221 PDF — `https://www.apra.gov.au/sites/default/files/2025-12/Prudential%20Standard%20APS%20221%20Large%20Exposures.pdf`; (2) real CPS 230 PDF — `https://www.apra.gov.au/sites/default/files/2026-04/Prudential%20Standard%20-%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf`; (3) synthetic DTI notice with threshold=8.0 (`Data/regulatory/dti-notice-feb2026.json` — update all threshold references from 6.0 → 8.0 before embedding). Re-embed all via OpenAI `text-embedding-3-small`. One-time setup before Demo 1.
41. **Twinkle 2 button — add DTI notice URL** — Add DTI notice as third sync target: `https://www.apra.gov.au/sites/default/files/2025-11/Implementation%20Details%20-%20DTI%20limit.pdf` with `standard: 'DTI_NOTICE'`. During Twinkle 2 demo: this sync embeds real DTI clauses (threshold=6.0) into RegulatoryDocuments AND updates RegulatoryThresholds.LIMIT_PCT=6 via item 39. Re-run analysis → DTI 7.2 now breaches → Synthesis cites real APRA language. Demo 1→Demo 2 outcome change: COMPLIANT → BREACH.

### VIEW DETAILS POPUP — EDUCATIONAL CONTENT (ready to build — do not re-derive)
Each agent popup has two sections. "How it works" content is below. "What it found" content is in the agent fix items (1-20) above.

**AGENT 1 — INTAKE**
- AI Pattern: Router / Classifier
- Model: Claude Haiku (claude-haiku-4-5-20251001) — fast, cheap, structured output
- SAP Tech: CAP service endpoint, Solace topic `banking/intake/complete`
- Why this agent: Natural language queries cannot go directly to risk models. Intake extracts structured intent — customerId, query type, routing decision — as JSON. Without this, every downstream agent would need to parse free text.
- What it decides: routes to RISK_ASSESS (full pipeline), SIMPLE_QUERY (direct HANA lookup), or REJECTION (inappropriate request)

**AGENT 2 — PATTERN DETECTION**
- AI Pattern: Parallel multi-model execution — three independent signals run simultaneously, no single model decides alone
- Models: RPT-1 (rpt.cloud.sap consumer API) + Scikit Isolation Forest (ml/anomaly-service.py Flask) + Claude Haiku (LLM anomaly narrative)
- SAP Tech: rpt.cloud.sap tabular foundation model (in-context learning), HANA PAL Isolation Forest (production — requires 3 vCPU ScriptServer), Solace topic `banking/pattern/progress` per sub-result
- Why this agent: Establishes baseline risk signal before graph traversal. RPT-1 classifies risk category from financial ratios. Isolation Forest detects statistical payment outliers. LLM narrates anomalies in human-readable form for APRA CPS 230 justification requirement.
- Data read: BCA_DTI (DTI ratio, income, debt, breach flag), Loans (loan amounts, types), DFKKOP (payment records), BCA_COLLATERAL (collateral assets)

**AGENT 3 — RELATIONSHIP (executes AFTER Trajectory — see execution order)**
- AI Pattern: ReAct loop — LLM reasons about graph findings and decides which tool to call next, iteratively
- Model: Claude Haiku with tool calling — up to 6 ReAct steps
- SAP Tech: GraphDB (RDF triple store + SPARQL) — trial equivalent of HANA Knowledge Graph Engine. Same SPARQL queries run on HANA KGE in production (one endpoint change). Tools: hana_graph_traverse, exposure_calculator, apra_threshold_check
- Why this agent: APS 221 requires banks to aggregate exposure across ALL connected parties — parent, subsidiary, guarantor, family trust. No SQL query finds multi-hop relationships. Graph traversal finds what structured queries miss.
- What it decides: connected party network, total group exposure (AUD), APS 221 % of limit, whether board notification is required

**AGENT 4 — TRAJECTORY (executes BEFORE Relationship — intentional, do not change)**
- AI Pattern: Threshold proximity + conflicting signal resolution — deterministic rule engine, no LLM
- Model: None — pure formula and rule-based logic
- SAP Tech: BCA_DTI.INCOME_EXPIRY + BCA_DTI.BREACH_DATE + LoanSchedule — all HANA relational tables via CAP CDS
- Why this agent runs before Relationship: Relationship Agent needs forward DTI position to judge whether group exposure is material. A 168% APS 221 breach means more with DETERIORATING trajectory than with STABLE.
- Why no LLM: DTI projection is deterministic arithmetic. Forward DTI = totalDebt / (annualIncome × daysToExpiry/365). Conflicting signals are rule-based if/else. LLM adds no value here — adds latency and hallucination risk.
- What it produces: currentDti, futureDti, daysToExpiry, timeToBreach (days in breach or days until breach), forwardPosition (DETERIORATING/STABLE/IMPROVING/MONITORING), conflictingSignals list

**AGENT 5 — SELF-RAG (quality gate, not a data agent)**
- AI Pattern: Epistemic self-evaluation — LLM reads ALL previous agent outputs and judges if evidence is complete enough to present to a human
- Model: Claude Haiku — evaluates 4 dimensions: graph completeness, signal consistency, conflicting signals resolved, evidence trail
- SAP Tech: LangGraph conditional edge (addConditionalEdges) — routes back to Relationship Agent with targeted hint if confidence < 0.70, forward to Human Approval if >= 0.70. Max 2 re-queries.
- Why this agent: Prevents the pipeline from presenting incomplete findings to a risk officer. A graph that found 0 connected parties when RPT-1 scored HIGH is suspicious — Self-RAG catches this and re-queries with a targeted instruction.
- What it produces: overallConfidence (0-1), gaps (list of specific missing evidence), reQueryHint (exact instruction to Relationship Agent if re-querying), reasoning (one sentence). Stored as selfRagHistory array — one entry per iteration.

**HUMAN APPROVAL (not an agent — a LangGraph interrupt)**
- AI Pattern: Human-in-the-loop (HITL) — LangGraph interruptBefore pauses execution before Synthesis
- Model: None — human decision
- SAP Tech: LangGraph interrupt() + PostgresSaver checkpoint (PostgreSQL). Solace topic `banking/human/approval`. Resume event resumes the graph from the saved checkpoint.
- Why: APRA CPS 230 requires human sign-off before an AI system generates a board-level risk notification. The interrupt proves the human saw the findings before the brief was written.
- What it shows: pending findings from all agents, Approve / Reject button

**AGENT 6 — SYNTHESIS**
- AI Pattern: RAG (Retrieval-Augmented Generation) + synthesis under uncertainty
- Model: Claude Haiku — receives full agent evidence + retrieved APRA regulatory chunks, produces structured JSON brief
- SAP Tech: HANA Vector Engine — cosine similarity search over RegulatoryDocuments (APRA PDFs chunked + embedded via OpenAI text-embedding-3-small). Writes result to HANA RiskAssessments table.
- Why this agent: Risk brief must cite specific APRA standards, not general knowledge. RAG retrieves the exact regulatory clauses relevant to what was found — DTI breach → APS 221 large exposure section, income expiry → CPS 230 risk management. Without RAG, the LLM cites standards from training data which may be outdated.
- What it produces: riskScore, riskLevel, confidence, findings (with severity + standard + evidence source per finding), recommendations, regulatoryRefs, uncertainties, apraReady flag
- **Agent data + logic fixes** — do all together in one session. Files: `srv/agents/pattern-agent.js`, `srv/agents/trajectory-agent.js`, `srv/agents/relationship-agent.js`, `srv/agents/synthesis-agent.js`, `srv/tools/mcp-tools.js`, `Data/processed/BCA_DTI.json`, `Banking-Sentinel-AustralianBank.html`

  **DATA FIX:**
  1. FILE: `Data/processed/BCA_DTI.json` — Add `"INCOME_EXPIRY": "2026-09-15"` (approx 110 days from 2026-05-27) to the 30100003 record. Without this field, `futureDti`, `daysToExpiry`, `timeToBreach` in trajectory-agent.js all return null because the `if (dti.INCOME_EXPIRY)` block at line 41 never executes. After adding, re-run `node scripts/seed.js` to push to HANA.

  **PATTERN AGENT FIXES — FILE: `srv/agents/pattern-agent.js`:**
  2. BUG: `scoreMap` at line 88 maps RPT-1 category to hardcoded number (HIGH→70, MEDIUM→45, LOW→15, CRITICAL→90). RPT-1 API returns real confidence at `myPrediction?.risk_category?.[0]?.confidence` (e.g. 0.82) — already read at line 85 but discarded. FIX: Remove `scoreMap`. Return `{ category, confidence }` from `callRpt1()`. Remove the `score` field entirely from `patternAssessment`. Display in UI as "HIGH · 82%" not "70".
  3. BUG: `patternAssessment.confidence` at line 283 is hardcoded: `rpt1Result.success ? 0.85 : 0.60` — not derived from any model. FIX: Use `rpt1Result.confidence` (the real RPT-1 API value) as `patternAssessment.confidence`.
  4. BUG: Scikit-IF UI shows "0 anomalies" — meaningless without denominator. FIX: Flask response at `result.scored` already contains total rows scored. Display as "0 / 3 payment rows flagged" using `outliers.length` / `result.scored`. Pass `result.scored` through in the progress event and into `patternAssessment.pal`.
  5. NEW: "View Details" clickable popup on Pattern Agent badge. Shows raw unmodified output from all three models — no reformatting, no interpretation:
     - RPT-1 section: Category (HIGH/MEDIUM/LOW/CRITICAL) + Confidence (e.g. 0.82)
     - Scikit-IF section: "X / Y payment rows flagged" + for each flagged row: id, score, reason_code (e.g. "DAYS_OVERDUE 45 (z=3.21, portfolio mean=12)")
     - LLM section: numbered list of anomaly strings exactly as returned by Claude Haiku
     Data for popup must be stored in SSE event and in DOM — `patternAssessment.rpt1`, `patternAssessment.pal.findings`, `patternAssessment.llm.anomalies` all exist in state already.

  **TRAJECTORY AGENT FIXES — FILE: `srv/agents/trajectory-agent.js`:**
  6. BUG: `timeToBreach` at line 104 is hardcoded to `0` when `breachFlag=true`. This loses the information that the breach happened on a specific date. FIX: When `breachFlag=true`, calculate `timeToBreach = Math.floor((today - new Date(dti.BREACH_DATE)) / (1000*60*60*24))` — "days in breach". Field meaning changes: positive = days already in breach, negative = days until projected breach. `BREACH_DATE` field exists in BCA_DTI table (30100003 has `"BREACH_DATE": "2026-02-01"`).
  7. BUG: `conflictingSignals` array is computed correctly but only logged to console (trajectory-agent.js line 124). Never displayed in UI. Never used by Synthesis (it is passed in state but Synthesis prompt doesn't reference it explicitly). FIX: Surface in UI via "View Details" popup (see item 8) AND ensure Synthesis prompt explicitly lists conflictingSignals.
  8. NEW: "View Details" clickable popup on Trajectory Agent badge. Shows:
     - currentDti (e.g. 7.2) vs APRA limit (6.0) — already in breach
     - futureDti (calculated after INCOME_EXPIRY fix) — projected DTI post income expiry
     - daysToExpiry — days until income contract ends
     - timeToBreach — "in breach for X days" (after fix) or "projected breach in X days"
     - forwardPosition — DETERIORATING / STABLE / IMPROVING / MONITORING
     - conflictingSignals — numbered list of all signals (e.g. "RPT-1 scored HIGH but no formal breach recorded", "Income expires in 110 days")

  **RELATIONSHIP AGENT FIXES — FILES: `srv/tools/mcp-tools.js`, `srv/agents/relationship-agent.js`:**
  9. BUG: `groupExposure` in `hana_graph_traverse` (mcp-tools.js line 223) = SUM(BCA_GUARANTOR.COVER_AMOUNT) for startNode's loans only. This is guarantor coverage on ONE entity's loans — not APS 221 group exposure. APS 221 requires total credit facilities across ALL connected entities. FIX: `exposure_calculator` should SUM(Loans.AMOUNT) WHERE PARTNER IN (all connected entity IDs found by graph traversal). Change `exposure_calculator` to query `Loans` table (not `BCA_GUARANTOR`) and sum `AMOUNT` across all entity IDs in the group.
  10. BUG: Synthesis only receives `{ groupExposure, aps221Pct, nodeCount, edgeCount }` from Relationship Agent (synthesis-agent.js line 72-76). Missing: `finding` text (the one-sentence APS 221 verdict), connected party names, hop distances, edge relationship types, ReAct step count, confidence score. FIX: Pass full `relationshipMap` fields to Synthesis agentContext — specifically `finding`, `nodeDetails` (array of {id, name, hop, relType}), `confidence`, and `steps` (ReAct iteration count).
  11. NEW: "View Details" clickable popup on Relationship Agent badge. Shows:
      - Connected parties table: name, BP ID, hop distance, relationship type (guarantor/director/subsidiary)
      - Group exposure: AUD amount vs APS 221 limit (corrected calculation)
      - aps221Pct — % of limit used
      - APS 221 finding sentence
      - ReAct steps taken (e.g. "3 tool calls")
      - Confidence score

  **SELF-RAG FIXES — FILES: `srv/agents/self-rag.js`, `srv/graph/state.js`, `srv/server.js`, `Banking-Sentinel-AustralianBank.html`:**
  14. BUG: Self-RAG has no UI badge. Its SSE completion event is wired to update a4 (Trajectory) badge — wrong. This caused the "7/5 complete" double-count bug (fixed with data-counted workaround but root cause not fixed). FIX: Add a dedicated Self-RAG badge in the UI between Relationship (a3) and Human Approval. Renumber subsequent badges. Wire selfRagCheck SSE event to the new badge.
  15. BUG: `selfRagEvaluation` in LangGraph state is overwritten each iteration — only the last evaluation survives. If Self-RAG re-queries twice, only the second evaluation is kept; the first is lost. FIX: Change state field from `selfRagEvaluation` (single object) to `selfRagHistory` (array). Each call to `selfRagCheckNode` appends to the array: `selfRagHistory: [...(state.selfRagHistory || []), evaluation]`. Update `checkConfidence()` to read from `selfRagHistory[selfRagHistory.length - 1]`.  FILE: `srv/graph/state.js` — add `selfRagHistory` field. FILE: `srv/agents/self-rag.js` — change return value from `selfRagEvaluation: evaluation` to `selfRagHistory: [...(state.selfRagHistory || []), evaluation]`.
  16. NEW: Badge shows re-query state in real time. When confidence < 0.70 and re-query triggers: badge shows "↻ Re-querying (1/2)". When passes: "✓ Complete — confidence 0.82". Audience sees the system self-correcting live.
  17. NEW: "View Details" popup on Self-RAG badge. Shows ALL iterations — one section per re-query run. If re-queried twice, shows two full sections. Each section contains:
      - Iteration number (e.g. "Evaluation 1 of 2")
      - Overall confidence score (e.g. 0.62 → below threshold, triggered re-query)
      - Reasoning — one sentence why
      - Gaps identified — numbered list of specific gaps found
      - Re-query hint sent to Relationship Agent — exact instruction (e.g. "Start from 30910005, traverse deeper than 2 hops")
      - Decision: "RE-QUERIED" or "PASSED TO HUMAN APPROVAL"
      Final iteration also shows: total re-query count, final confidence, whether it passed or hit the max 2 re-query limit.
      Data source: `selfRagHistory` array in LangGraph state (after fix 15).

  **SYNTHESIS AGENT FIXES — FILE: `srv/agents/synthesis-agent.js`:**
  18. BUG: `agentContext` passed to Synthesis LLM (lines 54-77) is a thin summary. Specifically missing from what the LLM receives:
      - RPT-1 real confidence value (only hardcoded 0.85 is passed)
      - Scikit-IF: scored count, flagged count, reason codes for flagged rows
      - Relationship: `finding` text, connected party names, ReAct step count, confidence
      - Trajectory: `conflictingSignals` array IS passed (line 68) but not referenced in the system prompt
      - Self-RAG: `selfRagHistory` (all iterations), final confidence, gaps, reQueryCount — not in agentContext at all
      - Collateral: `collateralCount`, LTV ratio — not passed
      - Days in breach: `timeToBreach` IS passed but means 0 (hardcoded bug — fix item 6 first)
      FIX: Expand `agentContext` to include all of the above. Add `selfRag: { history: state.selfRagHistory, finalConfidence, reQueryCount }` block.
  19. BUG: Synthesis system prompt (line 82) does not instruct the LLM to use `conflictingSignals`, Scikit-IF reason codes, relationship node names, or Self-RAG gaps in findings. LLM ignores them even though they are in the context. FIX: Add explicit instructions: "Use conflictingSignals from trajectory to identify early warning vs confirmed breach. Use Scikit-IF reason codes as evidence for payment anomaly findings. Name specific connected parties from relationship nodeDetails in APS 221 findings. Surface unresolved Self-RAG gaps in the uncertainties field." Also define riskScore scale explicitly in prompt: "riskScore 0-100 where LOW=0-25, MEDIUM=26-50, HIGH=51-75, CRITICAL=76-100. Must be consistent with riskLevel." This ensures consistent scoring across runs.
  22. BUG: Synthesis system prompt (line 96) hardcodes "Max 4 findings, 3 recommendations, 3 uncertainties." If 5 CRITICAL findings exist, one is silently dropped — compliance gap. FIX: Remove all count limits from the system prompt. Let the LLM return as many findings, recommendations, and uncertainties as the evidence supports. Only constraint: each finding must have severity, standard, evidenceSource, and confidence fields.
  21. BUG: `apraReady` is decided by the LLM (system prompt just says `"apraReady": <true|false>`) — non-deterministic, not a compliance flag. In banking, apraReady means the brief meets minimum standard for board notification or APRA submission. FIX: Remove apraReady from LLM output schema. Calculate deterministically in synthesis-agent.js AFTER LLM returns, overriding whatever the LLM said:
      ```javascript
      brief.apraReady =
        brief.findings.length > 0 &&
        brief.findings.every(f => f.evidenceSource) &&
        (state.selfRagHistory?.at(-1)?.gaps?.length === 0) &&
        brief.regulatoryRefs.length > 0 &&
        brief.confidence > 0.70 &&
        (!state.hitlEnabled || state.approvalStatus === 'approved');
      ```
      Rules: (1) findings exist and every finding has an evidenceSource, (2) no unresolved Self-RAG gaps, (3) at least one APRA standard cited, (4) confidence > 0.70, (5) if HITL is ON then human must have approved. All 5 must pass. Any failure → apraReady = false.
  20. NEW: "View Details" popup on Synthesis Agent badge. Shows full raw LLM output — no reformatting:
      - riskScore (final integer 0-100)
      - riskLevel (LOW / MEDIUM / HIGH / CRITICAL)
      - confidence (overall brief confidence 0.00-1.00)
      - findings — full list, each with: finding text, severity (CRITICAL/HIGH/MEDIUM/LOW), standard (APS221/CPS230/DTI_NOTICE), evidenceSource (which agent), confidence per finding
      - recommendations — all action items as numbered list
      - regulatoryRefs — APRA standards cited (e.g. APS221, CPS230)
      - uncertainties — data gaps + any unresolved Self-RAG gaps
      - apraReady — true/false — whether brief is ready for board notification
      - retrievedDocs — APRA regulatory chunks retrieved from HANA Vector: title, standard, content snippet for each
      - tokens — input token count + output token count (shows LLM work done)
      Data source: `synthesisResult` + `retrievedDocs` already in LangGraph state — just needs UI wiring.

- **Explainability / Investigation Report** — post-run report showing WHY a BP was flagged: what data each agent saw, how each algorithm reasoned, how agents handed off to each other, full investigative trail. NOT the same as educational drawer (which explains AI patterns). This shows actual data + actual reasoning for a specific run. Data source: PostgresSaver checkpoint in PostgreSQL already holds full LangGraph state per session. Needs: `GET /api/report/:sessionId` endpoint + dedicated report page. Replaces admin item 26 (confidence block) and educational drawer for technical audience. Defer to dedicated session.
- **RAGAS faithfulness fix** — faithfulness:0.25 (1/4 findings supported). Root cause: one combined search query returns 3 generic APRA chunks; LLM cites specific clauses not in those chunks (uses training data = hallucination). Fix — three changes all in `synthesis-agent.js`:
  1. Per-signal retrieval: run separate `hana_vector_search` calls per active risk signal (DTI breach → APS 221 DTI clauses, group exposure → APS 221 connected party section, income expiry → CPS 230 risk management) and combine results instead of one long concatenated query
  2. Increase topK from 3 to 5-7 per signal search
  3. Enable HyDE: change `useHyDE: false` to `useHyDE: true` — HyDE generates a hypothetical APRA clause first, embeds that, finds chunks that look like the real clause rather than matching keywords. Already built in `mcp-tools.js` hana_vector_search, just disabled.
  After fixing: re-run `node scripts/test-rag.js` to regenerate `Data/ragas-dataset.json`, then `python scripts/ragas-eval.py` to confirm faithfulness > 0.85.
- **NB-2: SPARQL multi-hop relType null** — Partners at hop 2+ show `relType: null` in the Relationship popup table. Root cause: reachability SPARQL OPTIONAL clause only walks one step from startNode. Fix: build `Map<partnerId, relType>` from the chain edges SPARQL (query 2, which already has correct relType for all pairs) and use it to enrich `traversalRows` before returning from `hana_graph_traverse`. FILE: `srv/tools/mcp-tools.js` lines 127–145.
- **validate.js** — CPS 230 compliance guardrails disconnected. `validateAgentOutput()` and `crossCheckClaimsAgainstSources()` exist in `srv/guardrails/validate.js` but nothing imports them. CPS 230 requires AI outputs used in credit decisions to be validated against source data. FIX: (1) In `srv/agents/synthesis-agent.js` — import validate.js and call `validateAgentOutput(brief)` before returning the risk brief. If validation fails, add failure reason to `uncertainties`. (2) In `srv/agents/self-rag.js` — call `crossCheckClaimsAgainstSources(evaluation)` after the confidence check. These two call sites cover the two AI output boundaries that APRA CPS 230 requires to be validated.
- **Phase 10** — CF deployment, architecture diagram, blog post

### KEY ARCHITECTURAL DECISION (confirmed this session):
Trajectory (a4) runs BEFORE Relationship (a3) in the backend. This is intentional:
- Relationship Agent uses trajectoryAnalysis.forwardPosition + daysToExpiry as context for judging whether group exposure is material
- The UI label order (03=Relationship, 04=Trajectory) does NOT match execution order
- This is correct design — document it so future sessions don't try to "fix" the graph edge order

### LangGraph graph edge order (ACTUAL — banking-sentinel.js):
```
pattern → trajectory → relationship → selfRagCheck → humanApproval → synthesis
```
(NOT: pattern → relationship → trajectory as the UI numbering implies)

---

## CRITICAL — READ THIS ENTIRE DOCUMENT BEFORE TOUCHING ANY CODE

This document captures not just what to build but why — the reasoning, the journey, the decisions made and rejected, and the thinking behind every architectural choice. Claude Code must understand the context as deeply as the architect who designed it. Every section matters. Do not skip ahead.

---

## PART 1 — WHO I AM AND WHY THIS PROJECT EXISTS

### Who I Am

SAP Development Architect with 19 years of SAP experience, transitioning to AI Engineer/Architect. Currently working on a SAP TRBK implementation at a major Australian bank. Background: enterprise architecture, integration patterns, event-driven systems, SAP BTP, HANA, CPI, CAP, Solace.

Previously built MJ Live — a completed real-time AI cognitive pipeline on SAP BTP. MJ Live patterns carry forward. Ask for the GitHub link before starting.

I learn by building real things. I document as I build — not after. Every decision recorded: what was chosen, what was rejected, why.

**Three vocabularies rule:** Every technical term encountered during the build must be explained in three ways — AI meaning, banking meaning, SAP meaning. This applies throughout the build, not just to the 10 AI patterns in Part 8.

### Five Angles — All Equal Weight

This project exists for five reasons simultaneously. Claude Code must never prioritise one over another or discard any when making decisions. Each angle shapes every architectural choice.

**1. Skill Development**
Every component teaches a specific AI architecture pattern. The patterns are a structured curriculum embedded in a real project. Build so each pattern is visible, understandable, and explainable — not just functional.

**2. Enterprise AI Positioning**
Demonstrates that modern AI patterns — GraphRAG, multi-agent reasoning, observability, evaluation — belong inside SAP enterprise architecture, not alongside it. Every decision must be defensible to an SAP architect, an AI engineer, and a banking technologist simultaneously.

**3. Client Value**
Solves a real, measurable problem for a major Australian bank regulated by APRA. Connected party exposure, regulatory breach detection, early warning credit signals — genuine pain points. Nothing fake. Nothing generic. Every architectural decision must hold up in a client meeting.

**4. Knowledge Sharing**
Documented to serve three technical communities simultaneously — SAP architects learning AI, AI engineers learning enterprise integration, banking technologists learning both. The three-vocabulary approach and honest decision recording make the project useful beyond its immediate context.

**5. Production Readiness**
Architected from the start for delivery, not just demonstration. The transition from prototype to delivered project is a proven pattern — prototypes built this way have been paid for and delivered as real projects before. Production-grade thinking from the first line of code.

---

## PART 2 — THE JOURNEY TO THIS ARCHITECTURE

### Why We Are Here — The Full Chain of Reasoning

Claude Code must understand how the architecture evolved — not just what it is. Every step matters.

**Step 1 — Original Banking Sentinel design**
The first version was five agents doing structured queries in sequence — fetch loan data, traverse relationships, check thresholds, raise alerts. Node.js, direct Anthropic SDK calls, manual state management. Looked agentic. Was not.

**Step 2 — The ABAP challenge**
Critical question raised: "Could the same thing be done in ABAP?" Honest answer: yes. Fetch-validate-alert is exactly what ABAP does well. That realisation forced a complete rethink of what AI actually adds.

**Step 3 — What AI genuinely does that ABAP cannot**
Fundamental difference identified: ABAP fires rules. AI reasons through uncertainty.

Old school: if DTI > 6 then flag. That rule misses everything — is a DTI of 5.9 actually safer than 6.1? Not necessarily. It depends on employment stability, guarantor stress, sector trajectory, income source expiry. The hard rule cannot see this. The AI reasons through it.

The genuine AI capability is: reasoning over incomplete, ambiguous, conflicting data to produce a conclusion that a rules-based system structurally cannot reach.

**Step 4 — Five reasoning types, not five queries**
This led to redesigning the agents around five distinct types of reasoning:
- Pattern recognition across incomplete data — something feels wrong before any rule fires
- Relationship ambiguity — what kind of connection and how strong, not just that one exists
- Threshold proximity and conflicting signals — trajectory not just current state
- Confidence under uncertainty — the AI admits what it does not know and asks for more
- Synthesis across all four — holding contradictions, not resolving them prematurely

Together these produce reasoning genuinely impossible in ABAP.

**Step 5 — The SAP job posting**
A SAP Senior AI Developer role was reviewed. Required: LangGraph, A2A/MCP patterns, SAP AI Core, Joule, Python, LLMOps, MLOps, Responsible AI. This confirmed the architecture needed to check every box — not for name's sake but because they are essential for production-grade enterprise AI.

**Step 6 — SAP documentation research**
SAP Architecture Center confirmed: SAP Cloud SDK for AI supports both Python AND TypeScript/JavaScript. LangGraph is SAP's recommended agent framework. A2A is the protocol for Joule integration. CAP is the application layer. MCP is how agents connect to tools. This is SAP's own documented production stack as of 2026.

**Step 6b — SAP AI Golden Path deep read**
Three SAP AI Golden Path documents were read:
- architecture.learning.sap.com/docs/ai-golden-path
- architecture.learning.sap.com/docs/golden-path/ai-golden-path/build-and-deliver/classic-ml
- help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/what-is-sap-ai-core

Three significant findings that changed the architecture:

1. HANA Cloud now includes a Knowledge Graph Engine — AI-native, separate from the HANA Knowledge Graph Engine. More aligned with SAP AI Golden Path for relationship traversal.
2. RPT-1 is a foundation model for tabular prediction. No model training. No LLM call. Better than asking Claude to score credit risk from tabular data.
3. HANA PAL (Predictive Analytics Library) has built-in anomaly detection. Better than LLM for detecting payment anomalies in DFKKOP — statistically rigorous, no hallucination risk.

Decision made: use HANA native capabilities for what HANA does better. Use LLM for what only LLM can do.

**[ACTUAL BUILD DECISION — Phase 4]** RPT-1, PAL, and LLM all run simultaneously in the Pattern Agent — not as a PAL/LLM switch. This was the agreed architecture after seeing all three outputs side-by-side. The educational popup shows all three results. Combined anomaly list (PAL outlier texts + LLM narrative texts) is forwarded to Synthesis.

**Step 7 — The AI Core constraint**
SAP AI Core not available in BTP trial accounts. Only in free tier enterprise accounts requiring SAP BTPEA — not available to individuals. Real constraint, not a workaround situation.

**Step 8 — Three genuine workarounds**
- RPT-1 is available via a consumer API at `rpt.cloud.sap/api/predict` — personal API token, no AI Core required. Tested live: HTTP 200, prediction HIGH confidence 0.98. This is NOT the AI Hub — it is SAP's dedicated RPT consumer endpoint.
- Langfuse replaces AI Launchpad for observability. One config change to swap in production.
- Custom chat UI exposes A2A-compatible endpoint. Joule calls the same endpoint in enterprise environment. One agent, one endpoint, two callers.
- Claude API called directly via @langchain/anthropic — not through SAP Generative AI Hub (trial limitation). In production: route through CPI or AI Hub. One endpoint change.

**Step 9 — Requirements session**
Full requirements established: natural language intelligence, performance, zero code change adaptability (the second twinkle), what the system must not do, success definition, edge cases. See Part 5.

**Step 10 — The two twinkle moments and deliberate rejection**
Three specific demo moments were designed deliberately:
- Twinkle 1: AI finds a hidden connection nobody asked about through graph reasoning
- Twinkle 2: Regulatory change applied immediately by document upload with zero code change
- Deliberate rejection: System refuses to approve a loan — demonstrates Responsible AI live

---

## PART 3 — WHAT THIS PROJECT IS

### The Business Problem

Connected party risk in banking is invisible to SQL queries and ABAP programs. A borrower looks healthy alone. Their guarantor looks healthy alone. Connected — they may breach APRA's APS 221 large exposure limit. No hardcoded rule finds this. Graph traversal and AI reasoning does.

The deeper problem: when APRA changes a regulation, banks spend months rewriting code. When a borrower's risk profile changes, analysts only find out at the quarterly review. Banking Sentinel solves both — regulations live in the knowledge base as documents, the AI reads and applies them immediately. Risk state changes trigger real-time re-evaluation via Solace. Zero code change required.

### The Core Capability

The system answers any natural language question about borrower or portfolio risk using the data available in HANA. It does not have pre-programmed question types. The Intake Agent determines intent, appropriate agents activate, the answer emerges from reasoning over data.

For simple data queries ("what is the total loan amount?") — answer directly, no full pipeline.
For risk questions — full agent pipeline, reasoning, connection, explanation.

**What ABAP cannot do:**
ABAP answers the question you asked. It executes the logic you wrote. It finds what you told it to find.

Banking Sentinel understands the intent behind the question. It decides what to look for. It traverses relationships you did not specify. It reasons about what it found. It connects things across domains without being told to. It produces a narrative explaining its reasoning. It admits when it is uncertain. It stops itself when confidence is too low. It refuses to make decisions requiring human authorisation.

### The Two Twinkle Moments

**Twinkle 1 — The undiscovered connection:**
The Pattern Agent detects something is wrong even though individual metrics appear borderline acceptable. The Relationship Agent traverses to depth 6 and finds TrustCo Holdings — a parent entity connecting three borrowers nobody asked about. Group exposure is 92% of the APS 221 limit. The Synthesis Agent rejects its own confidence at 64%, re-queries, comes back at 89% with a finding connecting four borrowers, two guarantors, one family trust, and a regulatory breach nobody documented.

Nobody programmed that finding. The agent found it through reasoning. This must be REAL — not theatrical. The confidence must genuinely be below threshold and the re-query must genuinely find new information that changes the assessment.

**Twinkle 2 — The live regulatory update:**
APRA changes a regulation. The demo shows a "Sync Latest APRA Standards" button. The system connects to the official APRA website — live, in front of the audience — fetches the actual regulatory document, chunks it, embeds it, stores it in HANA Vector. Then re-runs B-001. Without a single line of code changing, the Synthesis Agent retrieves the new guideline on the next query. A borrower who was compliant yesterday is now flagged today.

Every person in a bank audience has lived through a regulatory change that took months to implement in ABAP. This takes seconds. That is the twinkle.

**The live APRA connection sequence:**
```
Button: "Sync Latest APRA Standards" clicked
        ↓
System fetches from live official APRA URLs:
  handbook.apra.gov.au/standard/aps-221
  apra.gov.au/sites/default/files/.../CPS-230-clean.pdf
  apra.gov.au/industries/1/standards
        ↓
Documents chunked, embedded via Claude embeddings
Stored in HANA Vector (RegulatoryDocuments entity)
        ↓
"APRA standards updated. Re-running B-001..."
        ↓
Synthesis Agent retrieves new content via hana_vector_search
Risk assessment changes
        ↓
New risk brief generated — different finding based on real regulation
```

**Official APRA document URLs:**
- APS 221: `https://handbook.apra.gov.au/standard/aps-221`
- CPS 230: `https://www.apra.gov.au/sites/default/files/2023-07/Prudential%20Standard%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf`
- All ADI standards: `https://www.apra.gov.au/industries/1/standards`

### The Deliberate Rejection Moment

You ask: "Approve the loan for BP233."

System responds: "I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation. Here is the risk profile for BP233 to inform your decision."

Script and rehearse this. It demonstrates Responsible AI live. It is not a failure — it is a feature. APRA's co-pilot requirement made visible.

---

## PART 4 — COMPLETE ARCHITECTURE AND DESIGN

### End-to-End Data Flow

```
USER TYPES QUERY IN HTML UI
"Analyse borrower B-001 for all risk dimensions"
        ↓
A2A Endpoint (/a2a/agent) — CAP exposes this
        ↓
LangGraph StateGraph — starts execution
        ↓
┌─────────────────────────────────────────────────────┐
│           LANGGRAPH AGENT GRAPH                     │
│                                                     │
│  [Intake Node]                                      │
│   Parse intent → identify customer → build plan     │
│   If simple query → direct HANA query → return      │
│   If risk query → route to specialist agents        │
│        ↓                                            │
│  [Pattern Node]                                     │
│   RPT-1 API → HANA PAL Isolation Forest → LLM      │
│   All three always run simultaneously               │
│   Holistic assessment → confidence score            │
│        ↓                                            │
│  [Relationship Node] ← ReAct loop here              │
│   MCP Tool: hana_graph_traverse(BUT050, depth=8)    │
│   MCP Tool: hana_graph_traverse(BCA_GUARANTOR)      │
│   Reason about connection types → weighted map      │
│        ↓                                            │
│  [Trajectory Node]                                  │
│   MCP Tool: hana_relational_query(BCA_DTI, BKKS)    │
│   MCP Tool: apra_threshold_check(exposure, limit)   │
│   Resolve conflicting signals → forward position    │
│        ↓                                            │
│  [Self-RAG Check] ← conditional edge               │
│   confidence < 0.70 → loop back to Relationship     │
│   confidence ≥ 0.70 → continue to Synthesis         │
│        ↓                                            │
│  [Human-in-the-Loop Interrupt]                      │
│   Pause execution → publish to Solace               │
│   Wait for human approval event                     │
│   On approval → continue                            │
│        ↓                                            │
│  [Synthesis Node]                                   │
│   MCP Tool: hana_vector_search(APRA standards)      │
│   Hold contradictions → confidence per finding      │
│   Generate APRA-ready risk brief                    │
└─────────────────────────────────────────────────────┘
        ↓
State persisted to PostgreSQL (thread_id keyed)
        ↓
Langfuse trace emitted (every node)
        ↓
Events published to Solace topics:
  banking/pipeline/status → Panel 2 (agent pipeline)
  banking/risk/findings → Panel 3 (risk brief)
  banking/human/approval → Panel 2 (pause indicator)
        ↓
HTML UI subscribes via Solace JS SDK WebSocket
Three panels update in real time
```

### The Full Stack — Every Component Justified

| Layer | Tool | Prototype | Production Swap | Why |
|---|---|---|---|---|
| Primary SDK | SAP Cloud SDK for AI (TypeScript) | npm install @sap-ai-sdk/ai-api | Same — add AI Core credentials | SAP's official SDK for pro-code agents on BTP. Type-safe abstractions for Generative AI Hub. |
| LLM Access | Claude API direct (@langchain/anthropic) | ANTHROPIC_API_KEY in .env | CPI → AI Core Generative AI Hub | Trial: direct API. Production: governed through CPI or AI Hub. One endpoint change. SAP and Anthropic official partners Sapphire 2026. |
| Agent Orchestration | LangGraph TypeScript (@langchain/langgraph) | npm install @langchain/langgraph | Same | SAP's recommended framework. Stateful graph, conditional routing, human-in-the-loop, 90M downloads. |
| Agent State Persistence | PostgreSQL (via LangGraph checkpointer) | Supabase session pooler | BTP PostgreSQL Hyperscaler Option | MemorySaver resets on CF restart. PostgresSaver survives restarts, deployments, sessions. Production non-negotiable. |
| Tool Protocol | MCP (Model Context Protocol) | Local MCP tool functions | MCP servers on BTP CF | Standard for agent-tool connections. SAP job requires A2A AND MCP. Tools exposed as MCP, not hardcoded functions. |
| Agent-UI Protocol | A2A (JSON-RPC 2.0) | Custom chat UI calls /a2a/agent | Joule calls same /a2a/agent endpoint | Open standard. One agent, one endpoint, two callers — custom UI now, Joule in enterprise. |
| Application Layer | SAP CAP TypeScript | cds watch local / cf push | Same | Business logic, OData, HANA connection, A2A endpoint hosting. SAP Architecture Center recommendation. |
| Graph Traversal | SAP HANA Cloud Knowledge Graph Engine | HANA Cloud trial | Same | SAP AI Golden Path recommended. AI-native graph reasoning. Multi-hop SPARQL traversal on BUT050 and BCA_GUARANTOR. |
| Semantic Search | SAP HANA Cloud Vector Engine | HANA Cloud trial | Same — native vector with CDS 10 | APRA documents embedded. Hybrid RAG with Full Text Search. |
| Tabular Risk Scoring | RPT-1 via rpt.cloud.sap consumer API | POST rpt.cloud.sap/api/predict, Bearer SAP_RPT_API_KEY | Same endpoint in production | Foundation model for tabular prediction. No training. In-context learning with [PREDICT] placeholder. Tested live: HTTP 200, HIGH confidence 0.98. Faster and cheaper than LLM for structured tabular data. |
| Anomaly Detection | HANA PAL Isolation Forest + LLM — ALL THREE RUN SIMULTANEOUSLY | PAL: _SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN via cds.run(). LLM: claude-sonnet-4-6 narrative. RPT-1: already above. | Same | All three always run. PAL: statistically rigorous, no hallucination. LLM: narrative for APRA CPS 230 human-readable justification. Educational popup shows all three side-by-side. No ENV switch gate — ANOMALY_DETECTION_MODE is UI display preference only. |
| Relational Data | SAP HANA Cloud | HANA Cloud trial | Same | TRBK synthetic data. Payment history, loan records, sector codes. |
| Integration | SAP BTP CPI | Integration Suite trial | Same — swap Claude API for AI Core | Three specific jobs. See Part 4 CPI section. |
| Events | Solace Advanced Event Mesh | Solace Cloud trial | Same | Real-time pipeline updates, risk state changes, regulatory events. |
| Observability | Langfuse (self-hosted or cloud) | Langfuse cloud free tier | SAP AI Launchpad | Every LangGraph node traced. Token usage, latency, cost per analysis. One config change to swap. |
| Evaluation | RAGAS (Python) | pip install ragas — runs as separate Python evaluation script | Same | RAG quality scored automatically. 20-question evaluation dataset. Python only. |
| Frontend | Three-panel HTML UI | Already built | Same — wire up, do not redesign | Banking-Sentinel-AustralianBank.html for client. Banking-Sentinel-Bloomberg.html for blog. |

### Exact npm Packages — Phase 0 Setup

```bash
npm install @langchain/langgraph
npm install @langchain/core
npm install @langchain/anthropic
npm install @sap-ai-sdk/ai-api
npm install @sap-ai-sdk/orchestration
npm install @langchain/langgraph-checkpoint-postgres
npm install pg
npm install langfuse
npm install langfuse-langchain
npm install @sap/cds
npm install @sap/hana-client
npm install solclientjs

# Python evaluation scripts only
pip install ragas
pip install langchain openai
pip install hana-ml   # optional — PAL also callable via SQLScript from CAP
```

### What Is Not Available on BTP Trial and Why

**SAP AI Core** — Requires SAP BTPEA enterprise agreement. Not for individuals.
Workaround: RPT-1 via rpt.cloud.sap consumer API. Claude via direct Anthropic API.
Production swap: Route LLM calls through CPI → AI Core Generative AI Hub. Change API endpoint URL.

**SAP AI Launchpad** — Requires AI Core.
Workaround: Langfuse. Identical observability capability.
Production swap: Switch LANGFUSE_HOST env var to AI Launchpad endpoint.

**SAP Joule** — Requires enterprise account.
Workaround: Custom HTML UI with A2A endpoint. Joule calls the same endpoint.
Production swap: Register agent in Joule via capability YAML. The /a2a/agent endpoint is already A2A protocol compliant.

**Python** — LangGraph TypeScript used throughout. Python used ONLY for RAGAS evaluation scripts.

**SQLite** — NOT used. HANA Cloud from Phase 0. No local SQLite fallback.

### LangGraph Graph Topology

```javascript
// srv/graph/banking-sentinel.js — CURRENT STATE (Phase 5 complete — full pipeline LIVE)
const graph = new StateGraph(BankingSentinelState)

// Nodes
.addNode('intake',       intakeAgent)      // LIVE
.addNode('simpleQuery',  simpleQueryNode)  // LIVE
.addNode('rejection',    rejectionNode)    // LIVE
.addNode('pattern',      patternAgent)     // LIVE — RPT-1 + PAL + LLM simultaneously
.addNode('relationship', relationshipAgent) // LIVE — ReAct loop, BFS graph traversal
.addNode('trajectory',   trajectoryAgent)  // LIVE — forward DTI, conflicting signals
.addNode('selfRagCheck', selfRagCheckNode) // Phase 6 stub
.addNode('humanApproval',humanApprovalNode) // LIVE — interruptBefore fires here
.addNode('synthesis',    synthesisAgent)   // LIVE — HANA Vector + APRA risk brief

// Entry point
graph.setEntryPoint('intake')

// Conditional routing from Intake
graph.addConditionalEdges('intake', routeFromIntake, {
  'simple_query':          'simpleQuery',
  'risk_analysis':         'pattern',
  'inappropriate_request': 'rejection'
})

// Terminals
graph.addEdge('simpleQuery', END)
graph.addEdge('rejection',   END)

// Conditional routing from Pattern — low risk skips graph traversal
graph.addConditionalEdges('pattern', routeAfterPattern, {
  'low_risk':  'synthesis',     // score < 30 — skip Relationship + Trajectory
  'high_risk': 'relationship'   // score >= 30 — full pipeline
})

graph.addEdge('relationship', 'trajectory')
graph.addEdge('trajectory',   'selfRagCheck')

// Self-RAG loop — max 2 re-queries
graph.addConditionalEdges('selfRagCheck', checkConfidence, {
  'requery': 'relationship',
  'proceed': 'humanApproval'
})

graph.addEdge('humanApproval', 'synthesis')
graph.addEdge('synthesis', END)

// Compiled with PostgresSaver checkpointer + interruptBefore humanApproval
graphInstance = graph.compile({
  checkpointer,
  interruptBefore: ['humanApproval']
});
```

**Routing logic:**
- `routeFromIntake`: action keywords → inappropriate_request; isSimpleDataQuery → simple_query; else → risk_analysis
- `routeAfterPattern`: score < 30 → low_risk; score >= 30 → high_risk
- `checkConfidence`: patternConf < 0.70 OR relConf < 0.70 AND requeryCount < 2 → requery; else → proceed

**Critical: Not all five agents always run:**
- **Low risk (score < 30):** Skip Relationship and Trajectory. Route directly to Synthesis. UI shows greyed-out Relationship + Trajectory nodes.
- **High risk (score >= 30):** Full pipeline — Relationship → Trajectory → Self-RAG → Human Approval → Synthesis.

### Pattern Agent — All Three Methods (Phase 4 LIVE)

```javascript
// srv/agents/pattern-agent.js

// Step 1: Fetch customer data from HANA via cds.run()
// Tables: Loans, BCA_DTI, DFKKOP, BCA_COLLATERAL

// Step 2: RPT-1 — rpt.cloud.sap/api/predict
// In-context learning: send portfolio rows with known labels + query row with [PREDICT]
// Returns: { score, category, confidence }
// Fallback: estimateScoreFromData() if RPT-1 unavailable

// Step 3: PAL Isolation Forest EXPLAIN
// Train on portfolio DFKKOP (no ID column)
// Score customer payment rows (ID as first column — P1, P2, ...)
// DO BEGIN ... _SYS_AFL.PAL_ISOLATION_FOREST → _SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN ... END
// Returns: [{ id, score, label, reasonCode }] — label -1 = outlier

// Step 4: LLM narrative anomaly detection
// claude-sonnet-4-6, JSON response { anomalies: [...] }
// APRA CPS 230 human-readable justification

// All three always run with independent try/catch — graceful fallback if any fails

// patternAssessment state shape:
// {
//   riskScore, riskLevel, confidence, signal,
//   rpt1: { score, category, confidence, success, error? },
//   pal:  { findings: [{id, score, label, reasonCode}], anomalyCount, success, error },
//   llm:  { anomalies: string[], tokensIn, tokensOut },
//   anomalies: string[]  // combined PAL outlier texts + LLM narrative — forwarded to Synthesis
// }
```

**PAL privilege requirement:** `AFL__SYS_AFL_AFLPAL_EXECUTE` on the HDI technical user. Grant via HANA Cloud Cockpit. If unavailable, PAL fails gracefully — RPT-1 + LLM still run.

**Real BP numbers:** 30100001, 30100003 etc. (8-digit SAP BP numbers). Never B-001 shorthand in code or queries.

**Primary demo customer:** 30100003 — DTI 7.2, BREACH_FLAG=true.

### The Five Agents — Detailed Description

**Agent 1 — Intake Node** (LIVE)
Reasoning: Intent understanding and routing.
Job: Parse any natural language query. Identify customer (8-digit SAP BP number). Detect inappropriate requests (approve/delete/override) → rejection node. Route simple data queries directly. Route risk questions to Pattern node.
TRBK access: None — pure intent parsing.

**Agent 2 — Pattern Node** (LIVE — Phase 4)
Reasoning: Pattern recognition across incomplete data.
Job: Look at the full customer picture holistically. RPT-1 quantifies the risk score. PAL finds statistical outliers. LLM narrates anomalies. All three run simultaneously. Something feels wrong even though no individual metric technically breaches a threshold.
TRBK access: Loans, BCA_DTI, DFKKOP, BCA_COLLATERAL via cds.run().
Output: riskScore, riskLevel, confidence, signal, rpt1/pal/llm sub-objects, combined anomalies.

**Agent 3 — Relationship Node** (LIVE — Phase 4b)
Reasoning: Relationship ambiguity.
Job: Traverse HANA Knowledge Graph Engine to find connected parties using SPARQL. Reason about NATURE and STRENGTH of each connection. Parent-subsidiary carries full exposure. Family trust requires reasoning not a rule.
TRBK access: BUT050, BCA_GUARANTOR via hana_graph_traverse MCP tool. Up to 8 hops via GraphDB SPARQL.
Output: weighted relationship map, confidence per connection type, total group exposure, aps221Pct, finding.

**Agent 4 — Trajectory Node** (LIVE — Phase 5)
Reasoning: Threshold proximity plus conflicting signals.
Job: Resolve conflicting signals — DTI 5.9 today but income contract expires in 3 months, effective future DTI 9.2. Time-to-breach estimation.
TRBK access: BCA_DTI, BCA_LOAN_SCHED, DFKKOP via hana_relational_query + apra_threshold_check.
Output: forward-looking risk position, time-to-breach in days, conflicting signals resolved.

**Agent 5 — Synthesis Node** (LIVE — Phase 5)
Reasoning: Confidence under uncertainty PLUS policy retrieval.
Job: Take outputs from all four nodes. Retrieve APRA regulatory documents via HANA Vector. Hold contradictions. Acknowledge unknowns. Generate risk brief with confidence per finding. Fires human-in-the-loop interrupt before outputting.
TRBK access: RegulatoryDocuments (HANA Vector) via hana_vector_search MCP tool.
Output: APRA-ready risk brief with score, level, findings, recommendations, evidence trail, uncertainties. Persisted to RiskAssessments HANA table.

### MCP Tool Layer

Five MCP tools:

```javascript
// Tool 1 — hana_graph_traverse: BUT050 + BCA_GUARANTOR, up to 8 hops, SPARQL
// Tool 2 — hana_vector_search: APRA regulatory docs, topK, optional HyDE
// Tool 3 — hana_relational_query: TRBK relational tables via cds.run()
// Tool 4 — apra_threshold_check: large_exposure | dti | sector_concentration
// Tool 5 — exposure_calculator: total group exposure, APS 221 utilisation
```

### Two UI Modes — Educational and Demo

**Educational Mode (toggle: ON)**
When each agent activates, a popup appears BEFORE the agent runs. The popup explains:
- What this agent does
- Why it was triggered
- What technology it uses (RPT-1, PAL, SPARQL, HANA Vector, etc.)
- What it is looking for

Pattern Agent popup shows RPT-1 output, PAL Isolation Forest output, and LLM narrative anomalies side-by-side.

**Demo Mode (toggle: OFF)**
No popups. Full pipeline runs without interruption. Clean, fast.

**Toggle button in UI header:**
```
[Educational Mode: ON] ←→ [Demo Mode: OFF]
```

### Langfuse TypeScript Setup

```javascript
const langfuseHandler = new CallbackHandler({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  host: process.env.LANGFUSE_HOST,
  sessionId: sessionId,
  userId: "banking-sentinel"
})

const config = {
  configurable: { thread_id: sessionId },
  callbacks: [langfuseHandler]
}
const result = await app.invoke(state, config)
await langfuseHandler.flushAsync()
```

### Responsible AI Implementation

**Confidence thresholds:**
- Below 40%: Refuse to generate finding. State what data is missing.
- 40-70%: Generate finding with explicit uncertainty statement.
- Above 70%: Generate finding normally.
- Self-RAG triggers at below 70% — re-queries before proceeding. Max 2 re-queries.

**Human-in-the-loop:**
LangGraph `interrupt()` fires before Synthesis executes. `banking/human/approval` event published to Solace. HTML UI shows pending findings + approval button. On approval — resume event fires, LangGraph resumes, Synthesis executes.

**Inappropriate request handling:**
Intake Agent pattern matches: approve, delete, modify, override → rejection node → standard refusal → logged to HANA.

### CPI — Three Legitimate Jobs

**Job 1** — Scheduled data ingestion pipeline (TRBK CSV → HANA).
**Job 2** — Governed AI gateway (API key management, retry, rate limiting, full audit trail).
**Job 3** — Risk and regulatory event publishing to Solace.

### Solace Topic Structure

```
banking/pipeline/status          → agent pipeline updates (Panel 2)
banking/risk/findings            → risk brief events (Panel 3)
banking/human/approval           → human-in-the-loop pause/resume
banking/trbk/payment_event       → inbound payment events from TRBK
banking/regulatory/update        → new APRA document uploaded
banking/session/reset            → reset session before new demo
```

### HANA CDS Schema Definition

```cds
namespace bankingsentinel;

entity BusinessPartners {
  key PARTNER    : String(10);
  BU_TYPE        : String(2);
  BU_SORT1       : String(50);
  SECTOR_CODE    : String(10);
  DTI_RATIO      : Decimal(5,2);
  INCOME_SOURCE  : String(100);
  INCOME_EXPIRY  : Date;
}

entity BUT050 {  // confirmed table name by bank architects
  key PARTNER1   : String(10);
  key PARTNER2   : String(10);
  RELTYP         : String(6);  // GRPAR=guarantor, TRUST_COMMON=trust
}

entity Loans {
  key LOAN_ID    : String(15);
  PARTNER        : String(10);
  AMOUNT         : Decimal(15,2);
  CURRENCY       : String(3);
  STATUS         : String(1);
  SECTOR_CODE    : String(10);
  DTI_RATIO      : Decimal(5,2);
  APPROVED_DATE  : Date;
}

entity BCA_GUARANTOR {
  key LOAN_ID    : String(15);
  key GUARANTOR  : String(10);
  COVER_AMOUNT   : Decimal(15,2);
}

entity DFKKOP {
  key OPBEL      : String(20);
  GPART          : String(10);  // SAP FI-CA field name — confirmed in schema.cds. DFKKZP uses PARTNER (different entity)
  LOAN_ID        : String(15);
  BETRW          : Decimal(15,2);
  FAEDN          : Date;
  DAYS_OVERDUE   : Integer;
}

entity DFKKZP {
  key PAYMENT_ID : String(12);
  LOAN_ID        : String(15);
  BETRW          : Decimal(15,2);
  BUDAT          : Date;
}

entity BCA_DTI {
  key PARTNER    : String(10);
  DTI_RATIO      : Decimal(5,2);
  BREACH_FLAG    : Boolean;
  TOTAL_DEBT     : Decimal(15,2);
  ANNUAL_INCOME  : Decimal(15,2);
  INCOME_EXPIRY  : Date;
}

entity BCA_COLLATERAL {
  key COLLATERAL_ID : String(15);
  LOAN_ID           : String(15);
  VALUE             : Decimal(15,2);
}

entity RegulatoryDocuments {
  key DOC_ID    : String(36);
  TITLE         : String(200);
  STANDARD      : String(20);
  CONTENT       : LargeString;
  EMBEDDING     : LargeString;
  UPLOADED_AT   : DateTime;
}

entity RiskAssessments {
  key SESSION_ID : String(36);
  PARTNER        : String(10);
  RISK_SCORE     : Integer;
  RISK_LEVEL     : String(10);
  FINDINGS       : LargeString;
  CONFIDENCE     : Decimal(3,2);
  CREATED_AT     : DateTime;
  APPROVED_BY    : String(50);
}

entity AuditLog {
  key LOG_ID    : String(36);
  SESSION_ID    : String(36);
  ACTION        : String(100);
  QUERY         : LargeString;
  RESPONSE      : LargeString;
  MODEL         : String(50);
  TOKENS        : Integer;
  LATENCY_MS    : Integer;
  COST_AUD      : Decimal(8,4);
  CREATED_AT    : DateTime;
}
```

### PostgreSQL State Persistence

```javascript
const pgPool = new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } })
const checkpointer = new PostgresSaver(pgPool)
await checkpointer.setup()
const app = graph.compile({ checkpointer })
// Phase 5 will add: interruptBefore: ['humanApproval']
```

PostgreSQL: Supabase session pooler for prototype. BTP PostgreSQL Hyperscaler Option for production.

### Cost Tracking Per Analysis

```javascript
const COST_PER_1K_INPUT_TOKENS  = 0.0025  // Claude Sonnet
const COST_PER_1K_OUTPUT_TOKENS = 0.0125

function calculateCost(inputTokens, outputTokens) {
  return (inputTokens / 1000 * COST_PER_1K_INPUT_TOKENS) +
         (outputTokens / 1000 * COST_PER_1K_OUTPUT_TOKENS)
}
```

---

## PART 5 — REQUIREMENTS

### Requirement 1 — Natural Language Risk Intelligence

The system must answer any natural language question about borrower or portfolio risk. No pre-programmed question types. Intake Agent determines intent, appropriate agents activate.

For simple data queries — answer directly. For risk questions — full agent pipeline. Reason. Connect. Explain.

### Requirement 2a — Performance and Concurrency

- Response time: under 30 seconds for full four-dimension risk analysis
- Visible progress makes latency acceptable (MJ Live proven pattern)
- Single session for prototype. PostgreSQL checkpointer architecture supports multi-session in production.

### Requirement 2b — Zero Code Change Adaptability

Two types of changes without any code modification:
- **Data changes via Solace:** Payment event fires → system re-evaluates automatically.
- **Regulatory changes via knowledge base:** APRA doc uploaded → Policy Agent applies immediately on next query.

### Requirement 3 — What the System Must NOT Do

- Must not make autonomous decisions — Human-in-the-loop pause is architectural enforcement
- Must not present findings below 70% confidence — state what data is missing
- Must not generate finding without evidence — every claim links to TRBK record or APRA document
- Must not comply with action requests — approve, delete, modify, override → reject clearly, log attempt

**Deliberate rejection script:**
Input: "Approve the loan for BP233."
Output: "I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation. Here is the risk profile for BP233 to inform your decision."

### Requirement 4 — Definition of Success

**Technical:** System runs end to end. Self-RAG re-query fires genuinely. Human approval pause works. Regulatory update applies without code change.

**Demo:** A banking professional watches and says "I understand what this does and I want it."

**Business:** The client asks "what would it take to implement this on our TRBK data?" — not "that was interesting."

### Requirement 5 — Edge Cases

- Borrower not found: clean error message, not crash
- Incomplete data: reason over what exists, state gaps, adjust confidence
- Conflicting data: surface conflict, explain both figures, flag for human review
- Inappropriate requests: reject clearly, log, continue

---

## PART 6 — SYNTHETIC TRBK DATA DESIGN

### The Four Hidden Risk Patterns

**Pattern 1 — Connected party + APS 221 breach (Twinkle 1):**
- Borrowers individually acceptable; combined group exposure 92% of APS 221 limit
- G-001 connected via BUT050 to G-002 (same family trust) — HIDDEN
- Requires 6-hop traversal: B-001 → BKKN → BCA_LOAN_HDR → BCA_GUARANTOR → G-001 → BUT050 → G-002

**Pattern 2 — DTI regulatory breach with trajectory:**
- Primary demo customer (BP 30100003): DTI ratio 7.2 — above APRA February 2026 limit of 6.0
- Income contract expiry in 3 months → effective future DTI 9.2
- Not yet reported to APRA

**Pattern 3 — Sector concentration:**
- Four borrowers in RETAIL_PROP via same guarantor network — combined 78% of sector limit

**Pattern 4 — Credit early warning:**
- BP 30100001: DFKKOP records 81/50/50 days overdue
- No corresponding DFKKZP payment record — missed repayment confirmed

### Dataset Scale

- 50 business partners: 30 individual borrowers, 10 corporate borrowers, 8 guarantors, 2 parent entities
- 60 loans
- APRA documents in HANA Vector: APS 221, APS 112, CPS 230, DTI Limit Activation Notice Feb 2026, Credit Policy §7.3

---

## PART 7 — RAGAS EVALUATION DATASET

20 questions across four dimensions: connected party risk (5), credit risk (5), sector concentration (5), regulatory (5). Run after each build phase. Target faithfulness > 0.85.

---

## PART 8 — AI DESIGN PATTERNS — 10 CONCEPTS

For every pattern: AI meaning, banking meaning, SAP meaning.

**1. GraphRAG** — Retrieval that traverses relationships. B-001's guarantor covers four other stressed borrowers. HANA Knowledge Graph Engine on BUT050 + BCA_GUARANTOR.

**2. Hybrid RAG** — Vector similarity + keyword search + reranking. HANA Vector cosine similarity + HANA Full Text Search in one query.

**3. HyDE** — Generate hypothetical ideal answer to improve retrieval signal. LangGraph node calls LLM once to enrich query before HANA Vector search.

**4. Agentic RAG** — Agent decides what to retrieve, when, in what order. LangGraph ReAct node calling hana_graph_traverse multiple times based on observations.

**5. ReAct Pattern** — Think → Act → Observe → Think → Act. LangGraph conditional edges — each observation determines next action.

**6. Multi-Agent** — Five specialised agents, one job each. LangGraph StateGraph with five nodes, state carries all findings between nodes.

**7. Self-RAG** — Agent evaluates its own retrieval quality, re-queries if confidence below threshold. LangGraph conditional edge after trajectory node — if confidence < 0.70, loop back to relationship.

**8. Temporal Memory** — State accumulates across agent steps. LangGraph typed BankingSentinelState passed through all nodes, persisted via PostgresSaver.

**9. AI Observability / LLMOps** — Every LLM call, token count, latency, cost traced. Langfuse traces every LangGraph node. APRA CPS 230 auditability requirement.

**10. RAGAS** — Automatic measurement of retrieval faithfulness, relevance, context precision. 20-question evaluation dataset run against HANA Vector queries.

---

## PART 9 — TRBK TABLE REFERENCE

| Table | Description | Role | Graph Role |
|---|---|---|---|
| BUT000 | Business Partner master | Customer/borrower node | Node |
| BUT050 | BP-to-BP Relationships — confirmed by bank architects | Connected parties, guarantors, subsidiaries | **Graph edge 1** |
| BKKF | Contract account master | Loan contract header | Node |
| BKKN | Contract-BP link | Connects borrower to contracts | Edge |
| BCA_LOAN_HDR | Loan header | Loan amount, currency, status, dates | Node |
| BCA_LOAN_SCHED | Repayment schedule | Expected payment dates/amounts | Node |
| BCA_GUARANTOR | Guarantor assignment | Who guarantees which loan | **Graph edge 2** |
| BCA_COLLATERAL | Collateral | Security value against loans | Node attribute |
| DFKKOP | Open items | Overdue payment records — primary risk signal | Risk signal |
| DFKKZP | Payment items | Actual payments — absence = missed payment | Risk signal |
| BCA_DTI | Debt to income ratio | APRA DTI limit compliance + income expiry | Risk attribute |

**HANA data layer separation:**
- HANA Knowledge Graph Engine: BUT050 + BCA_GUARANTOR — multi-hop SPARQL traversal
- HANA Vector Engine: APRA regulatory documents — semantic search
- HANA Relational: All other TRBK tables — structured queries via cds.run()

**HANA access pattern:**
- DBADMIN cannot access HDI schema directly — must use cds.run() (HDI technical user) or npx cds bind --exec for test scripts
- HDI schema: B8EC4EAB42CB46BE940B89D1209CC93D (internal — never hardcode, use CDS entity names)

---

## PART 10 — SAP JOB REQUIREMENTS MAPPING

| SAP Job Requirement | How Banking Sentinel Addresses It |
|---|---|
| Generative AI + Agentic AI on SAP BTP | LangGraph agents on BTP CF via SAP Cloud SDK for AI |
| RAG pipelines and retrieval workflows | HANA Vector + GraphRAG + Hybrid RAG + HyDE |
| Multi-agent orchestration | LangGraph supervisor with 5 specialist agents |
| A2A interaction patterns | /a2a/agent endpoint, JSON-RPC 2.0, Joule compatible |
| MCP interaction patterns | 5 MCP tools: graph, vector, relational, threshold, calculator |
| SAP HANA | HANA Cloud — all three engines |
| SAP Integration Services | CPI — three legitimate jobs |
| LLMOps/MLOps pipelines | Langfuse tracing + RAGAS evaluation + cost tracking |
| Responsible AI | Guardrails, confidence thresholds, human-in-the-loop, deliberate rejection |
| Vector databases | HANA Vector Engine |
| Knowledge graph integrations | HANA Knowledge Graph Engine |
| LangChain/LangGraph | @langchain/langgraph TypeScript |

**Extras:**
- RPT-1 tabular risk scoring (rpt.cloud.sap consumer API) — LLM not needed for tabular prediction
- HANA PAL Isolation Forest EXPLAIN — real in-database anomaly detection with feature attribution
- All three (RPT-1 + PAL + LLM) run simultaneously — demonstrated live in educational popup
- Zero code change regulatory updates (Twinkle 2)
- TRBK table names in evidence trails (immediate client recognition)

---

## PART 11 — BUILD PHASES

| Phase | What Gets Built | Status |
|---|---|---|
| 0 | Environment: LangGraph, Langfuse, PostgreSQL, Solace | ✅ COMPLETE |
| 1 | Synthetic TRBK data + HANA schema + four hidden patterns | ✅ COMPLETE |
| 2 | HANA Vector + Hybrid RAG + HyDE + RAGAS evaluation | ✅ COMPLETE |
| 3 | LangGraph StateGraph + Intake + SimpleQuery + Rejection + A2A endpoint | ✅ COMPLETE (2026-05-24) |
| 4 | Pattern Agent — RPT-1 + PAL Isolation Forest + LLM simultaneously | ✅ COMPLETE (2026-05-24) |
| 4b | Relationship Agent — ReAct loop, BFS graph traversal, exposure + APS 221 check | ✅ COMPLETE (2026-05-24) |
| 5 | Trajectory Agent + Synthesis Agent + Human-in-the-loop interrupt | ✅ COMPLETE (2026-05-24) |
| 6 | Self-RAG — real confidence evaluation + re-query loop | ✅ COMPLETE (2026-05-25) |
| 7 | Solace events + SSE dual-publish + UI fully wired + admin security | ✅ COMPLETE (2026-05-25) |
| 8 | HDI deploy + PAL investigation + observability + RAGAS baseline | ✅ COMPLETE (2026-05-25) |
| 9 | UI polish: graph chain, agent ordering, severity badges, admin redesign, graph modal | 🔄 IN PROGRESS (2026-05-27) |
| 9a | Education popup rework | 🔲 NEXT |
| 9b | RAGAS faithfulness fix (current score 0.25, target > 0.85) | 🔲 PENDING |
| 10 | CF deployment + architecture diagram + demo video + blog post | 🔲 PENDING |

**Graph Engine — Final Decision (2026-05-24):**

Hierarchy followed (SAP AI Golden Path replacement rule):
1. **KGE + SPARQL** → NOT on trial (Triple Store feature not enabled in HANA Cloud Central)
2. **HANA Property Graph + GRAPH_TABLE** → NOT on trial (preview feature — "incorrect syntax near MATCH" on all variants)
3. **GraphDB + SPARQL** → **IMPLEMENTED** (open source RDF triple store, same W3C SPARQL standard as KGE)

GraphDB implementation:
- Graphwise sandbox (free, 7-day rotation): `https://t5f027c83a0e2488da5e.sandbox.graphwise.ai`
- Repository: `banking-sentinel` | 4035 RDF triples | 1000 partners | 12 BUT050 relationships
- SPARQL traversal from 30100003 finds 7 connected parties including TrustCo Holdings (4 hops)
- `hana_graph_traverse` MCP tool queries GraphDB via SPARQL property paths with accurate hop counts
- Production swap: change GRAPHDB_ENDPOINT to HANA KGE endpoint — SPARQL queries are identical

BUT050 enrichment — Pattern 1 (Twinkle 1 chain):
```
30100003 →[FAMILY_TRUST_MEMBER]→ 30910005 →[FAMILY_TRUST_MEMBER]→ 30910006
→[SUBSIDIARY]→ 30910009 (TrustCo Group) →[PARENT_COMPANY]→ 30910010 (TrustCo Holdings)
```
30100001 and 30100002 also connected to TrustCo Group → connected party group for APS 221.

Restore GraphDB after sandbox expiry (every 7 days):
`npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid`

HANA workspace (production upgrade path):
- `db/src/BP_RELATIONSHIP_GRAPH.hdbgraphworkspace` deployed via HDI
- When GRAPH_TABLE goes GA: swap SPARQL query for single GRAPH_TABLE SQL statement

Admin UI: `/admin` → tab "GraphDB (KGE)" shows repository status, triple counts, live SPARQL traversal, sample RDF triples

**Phase 5 implemented:**
- trajectoryAgent: BCA_DTI.INCOME_EXPIRY → forward DTI calculation; conflicting signal resolution
- synthesisAgent: HANA Vector search on APRA docs + APRA-ready risk brief with confidence per finding
- humanApproval: LangGraph interruptBefore(['humanApproval']) + resume via approveRiskBrief action

---

## PART 12 — WHAT ALREADY EXISTS

**Three UI files — wire one, other follows same pattern:**
- `Banking-Sentinel-AustralianBank.html` — light theme, yellow diamond — use for client presentation
- `Banking-Sentinel-Bloomberg.html` — dark navy terminal — use for blog and general audience
- `Task3-Banking-Sentinel-UI.html` — earlier version — retire

**From MJ Live — what to take forward:**
- Solace JS SDK WebSocket connection pattern — consumer.html subscription code
- HANA Cloud connection setup in CAP package.json and .env
- BTP CF manifest.yml deployment pattern for two-app deployment
- Known fix: CAP start command is `cds-serve` not `cds` on CF
- Known fix: `cds.requires.auth.kind = "dummy"` for trial without XSUAA
- Known fix: Solace SDT format vs binary format

---

## PART 13 — REGULATORY AND BANKING CONTEXT

**APRA** — Australian Prudential Regulation Authority. Regulates all ADIs in Australia.

**Official APRA document URLs:**
- APS 221: `https://handbook.apra.gov.au/standard/aps-221`
- CPS 230: `https://www.apra.gov.au/sites/default/files/2023-07/Prudential%20Standard%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf`
- All ADI standards: `https://www.apra.gov.au/industries/1/standards`

- **APS 221 — Large Exposures:** Board notification required above 90% utilisation. Breach = regulatory enforcement.
- **CPS 230 — Operational Resilience (July 2025):** AI decisions must be transparent, auditable, resilient. Human oversight required.
- **DTI Limits — February 2026:** APRA activated restrictions on new lending at DTI > 6.0. Banks must identify and document pre-existing breaches. Primary demo customer (30100003) is exactly this scenario.

**SAP and Anthropic — Sapphire 2026:**
Official partnership announced May 2026. Claude is SAP's primary AI partner for the Autonomous Enterprise stack. Using Claude through SAP's infrastructure is the strategic direction, not a workaround.

---

## PART 14 — BLOG POST STRUCTURE

**Title:** "Connected Intelligence — Agentic AI on SAP BTP with Knowledge Graph, LangGraph and Claude"

1. The Problem — why connected party risk is invisible to ABAP and SQL
2. The Idea — AI that reasons, not just rules
3. What ABAP Cannot Do — the honest comparison
4. The Architecture — full stack diagram and component justification
5. The Five Agents — one reasoning type each, three vocabularies
6. Building It — phase by phase, decisions documented
7. The Two Twinkle Moments
8. The Deliberate Rejection — Responsible AI in action
9. LLMOps — what Langfuse and RAGAS revealed
10. The Procurement Parallel — same architecture, different domain
11. What I Learned — honest assessment
12. What's Next — path from prototype to delivery

---

## PART 15 — DEMO SCENARIOS

### Scenario 1 — Full Risk Analysis (Twinkle 1)
**Input:** "Analyse borrower 30100003 for all risk dimensions"
- Pattern Agent: RPT-1 scores HIGH, PAL detects payment anomaly, LLM provides narrative
- Relationship Agent: finds TrustCo Holdings at hop 6 (nobody asked about this)
- Self-RAG fires: confidence 64% → re-queries → 89% (Twinkle 1)
- Trajectory Agent: future DTI 9.2, time-to-breach 12 days
- Human-in-the-loop interrupt → risk officer approves
- Synthesis Agent: APRA-ready risk brief

### Scenario 2 — Simple Data Query
**Input:** "What is the total loan amount?"
- Intake → simpleQuery node → HANA query → result
- No full pipeline. Offers deeper analysis.

### Scenario 3 — Live Regulatory Update (Twinkle 2)
**Input:** Click "Sync Latest APRA Standards" → "Analyse 30100003"
- System fetches live APRA docs → chunks → embeds → HANA Vector
- Synthesis retrieves new content → risk assessment changes
- Zero code change

### Scenario 4 — Deliberate Rejection
**Input:** "Approve the loan for 30100003"
- Intake detects "Approve" → rejection node
- "I am a risk intelligence system. I surface findings and recommendations. Loan approval decisions require human authorisation. Here is the risk profile for 30100003 to inform your decision."

---

## PART 16 — INSTRUCTIONS FOR CLAUDE CODE

Read every word of this document.

**Never:**
- Name the bank client — say "major Australian bank" only
- Simplify the stack — every component is deliberate
- Use MemorySaver — PostgresSaver only
- Merge LangGraph and CAP roles
- Hardcode LLM tool calls — use MCP tools
- Skip human-in-the-loop — architecturally mandatory
- Generate findings without TRBK table evidence trail
- Redesign the UI — wire it
- Use SQLite — HANA Cloud from day one
- Use BP2000 — the correct table is BUT050, confirmed by bank architects
- Use B-001 shorthand — real BP numbers are 8-digit SAP BP numbers (30100001, 30100003 etc.)
- Run all five agents for low risk customers — use conditional routing
- Add Python to the main application — Python for RAGAS evaluation only
- Gate PAL/LLM with ENV switch — all three methods always run simultaneously

**Always:**
- Explain each AI pattern in three ways: AI terms, banking terms, SAP terms
- Document every decision — what chosen, what rejected, why
- Build one phase at a time — confirm phase before writing code
- Wire Langfuse from Phase 0
- Include TRBK table names in all evidence trails
- Make agent reasoning visible in the UI
- Implement both Educational Mode and Demo Mode — toggle button required
- Use SPARQL for HANA Knowledge Graph Engine queries
- Show greyed-out Relationship and Trajectory agents for low risk customers in Panel 2
- Use cds.run() for all HANA access (HDI technical user — DBADMIN cannot access HDI schema directly)
- Call RPT-1 via rpt.cloud.sap/api/predict with SAP_RPT_API_KEY (Bearer token) — not AI Hub

**On PAL:**
- PAL_ISOLATION_FOREST: 3 args — (training_data_no_id, params) → model
- PAL_ISOLATION_FOREST_EXPLAIN: 4 args — (data_with_id, model, params) → result
- Parameter table columns: PARAM_NAME, INT_VALUE, DOUBLE_VALUE, STRING_VALUE
- ID as first column in scoring data. No ID column in training data.
- Grant AFL__SYS_AFL_AFLPAL_EXECUTE to HDI technical user via HANA Cloud Cockpit

---

## PART 17 — ADDITIONAL PATTERNS FROM SAP AI GOLDEN PATH

**11. RPT-1 — Relational Foundation Model (Tabular AI)**
AI: Foundation model pretrained on tabular data. Predictions via in-context learning — no fine-tuning required. Send a feature table with [PREDICT] placeholder, get prediction back.
Banking: Credit risk scoring from borrower features (DTI, payment history, loan amount, sector) without writing model training code.
SAP: Consumer API at rpt.cloud.sap/api/predict. Personal API token (SAP_RPT_API_KEY). No AI Core required. RPT-1.5 GA in H2 2026.

**12. HANA PAL — Embedded In-Database Machine Learning**
AI: Statistical ML algorithms running natively inside the database. Train on portfolio, score one customer's rows. Isolation Forest detects anomalies by measuring how easily a point is isolated from the rest.
Banking: Payment anomaly detection on DFKKOP records. LABEL=-1 = outlier. REASON_CODE = which feature drove the anomaly (feature attribution). Statistically rigorous. No hallucination risk.
SAP: PAL Predictive Analytics Library built into HANA Cloud. Called via SQLScript anonymous DO block from CAP via cds.run(). Requires AFL__SYS_AFL_AFLPAL_EXECUTE permission on HDI technical user.

**Why both matter architecturally:**
The right question is never "can the LLM do this?" — it is "what is the best tool for this specific task?" RPT-1 and PAL are better than LLM for tabular and statistical tasks. LLM is better for reasoning, narrative, and policy interpretation. All three running simultaneously in the Pattern Agent — and being able to explain why each is there — is the definition of AI architect thinking.

---

## THE ONE RULE

Document as you build. Not after.

For every decision: what you chose, what you considered and rejected, why.

That record is what separates a prototype from a proposal, and a proposal from a contract.

---

*Five angles. Equal weight. Two genuine twinkle moments. One deliberate rejection. Three vocabularies throughout.*

*Build it like a senior AI architect who understands banking regulation, SAP enterprise architecture, and modern AI engineering simultaneously.*

*The client context is a major Australian bank. The specific name is never mentioned anywhere in code, comments, or documentation.*
