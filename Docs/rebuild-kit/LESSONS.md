---
name: lessons-learned
description: "Hard-won lessons from Banking Sentinel build — mistakes made, patterns that worked, things to do differently next project"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eb083334-7392-4f68-9c28-83e3afbe21f8
---

## Lessons from Banking Sentinel (accumulated 2026-05-24 → 2026-05-27)

---

### L1 — Read the graph definition before assuming execution order
**What happened:** Assumed LangGraph executed agents in UI label order (a3 relationship before a4 trajectory). Backend actually runs trajectory → relationship. The SSE nextMap was completely wrong for 2+ sessions before discovery.
**Why it matters:** The UI showed confusing "7/5 complete" and agents activating in wrong order.
**Rule:** When debugging agent ordering, read `banking-sentinel.js` addEdge() lines first — the source of truth, not the UI.

---

### L2 — Canvas `drawGraph()` must accept a target canvas param from the start
**What happened:** `drawGraph()` was hardcoded to `document.getElementById('graphCanvas')`. Adding the expand modal required refactoring the signature. Should have been `drawGraph(nodes, edges, canvas?)` from day one.
**Rule:** Any function that renders to a specific DOM element should accept that element as an optional parameter, so it can be reused in modals or test harnesses without refactoring.

---

### L3 — SSE badge text is a hidden dependency
**What happened:** Changed badge text from `'Thinking...'` to `'● Thinking'`. There was a guard `badge.textContent === 'Thinking...'` in the synthesis skip-state handler that silently broke. The fix was invisible until manually traced.
**Rule:** When changing string constants used as state tokens, grep the entire file for those strings before committing. Badge text is not just display — it is state.

---

### L4 — SPARQL VALUES clause is the fix for star-graph topology
**What happened:** First SPARQL implementation returned all reachable nodes from startNode correctly, but emitted edges as `startNode → everyPartner` (star). Fixing required a second SPARQL query using VALUES clause to get actual `?fromId ?rel ?toId` pairs between discovered nodes.
**Rule:** SPARQL reachability (property paths like `?s bs:relatedTo* ?o`) finds nodes. Getting the actual edge pairs between them requires a separate VALUES-filtered edge query. These are two different questions.

---

### L5 — LLM summaries lose graph topology — preserve tool output separately
**What happened:** The ReAct LLM summarised graph results as flat `{"nodes": ["30910005", ...]}` losing all edge topology and node names. The fix was to cache `toolGraphData` at the first successful `hana_graph_traverse` call in the agent loop.
**Rule:** In a ReAct loop, never rely on the LLM's final text summary for structured data that must be preserved exactly. Cache tool outputs directly in the agent function.

---

### L6 — HANA PAL is not available on Free Tier (documented, not a surprise)
**What happened:** PAL Isolation Forest requires ScriptServer with minimum 3 vCPU. HANA Cloud Free Tier has 1 vCPU. PAL will always fail gracefully on Free Tier.
**Rule:** For next project — if PAL is needed, start with HANA Cloud Paid tier or document from day one that PAL is production-only. Don't spend time debugging PAL calls on Free Tier.

---

### L7 — Context compaction loses specific lists — paste them back
**What happened:** User's 10 admin.js UI change list (items 21–30) was in the compacted portion of the conversation. When resuming, had to ask user to re-paste the list, adding friction.
**Rule:** When receiving a numbered list of changes, save the full list to a memory file immediately or implement them all in the same session. Don't let a list survive in conversation context across a compaction boundary.

---

### L8 — Double-completion counter bug from dual SSE events
**What happened:** Agent 4 (Trajectory + Reflection) received two `setAgent('a4', 'complete')` calls — one from the trajectory node completing, one from reflectionCheck. Each incremented `agentsDone`, causing "7 / 5 complete".
**Fix:** `data-counted` attribute on the DOM element — only count first `complete` transition, reset on non-idle state change.
**Rule:** Any counter that tracks "how many X have completed" must be idempotent per entity. If the same entity can complete multiple times (e.g. reflectionCheck updates a4), use a set or flag, not a raw counter.

---

### L9 — `gen/` folder is CDS build output — never commit, never edit directly
**What happened:** `gen/` contains a full copy of `srv/` produced by `npx cds build`. It is gitignored. Edits to `srv/` are the source of truth; `gen/` is regenerated.
**Rule:** Always edit `srv/` directly. Run `npx cds build --for hana` only before HDI deploy.

---

### L10 — Duplicate data in two panels is always worth questioning
**What happened:** "Regulatory Alerts" (left panel) and "Regulatory Breaches" (right panel) both rendered `synthesisResult.findings`. Discovered only when user asked "are these the same?"
**Rule:** When building a multi-panel UI, explicitly list which data each panel owns. If the same data source appears in two places, it must serve genuinely different purposes (different format, different audience, different level of detail) — otherwise remove one.

---

### L11 — Node version path issue in PowerShell tool vs terminal
**What happened:** `node` not on PATH in the PowerShell tool (nvm-windows sets PATH only for interactive terminal sessions). Could not run node scripts to validate SPARQL output. Had to ask user to run GraphDB queries directly in browser UI.
**Rule:** For validation that requires running Node scripts, provide the command for the user to run rather than trying to run it through the Claude Code PowerShell tool in an nvm-windows environment.

---

### L12 — The education popup needs a rethink before building
**What happened:** The educational drawer was built in Phase 9 but needs a full rework — content structure, timing, UX flow. Building it before fully designing it created technical debt.
**Rule:** For UI components with complex interaction patterns (drawers, modals, progressive disclosure), spend one session designing the full UX (what triggers it, what it shows, how it closes, how it works in demo mode vs educational mode) before writing a single line of code.

---

### L13 — Model outputs must be traced end-to-end before claiming they are used
**What happened:** Full agent output review (2026-05-27) revealed: RPT-1 real confidence discarded, Scikit-IF scored count not displayed, timeToBreach hardcoded to 0, Reflection output never reaches Synthesis, conflictingSignals computed but never displayed or used in Synthesis prompt. Data was computed but not consumed anywhere meaningful.
**Rule:** For every model/agent output field, explicitly verify: (1) is it displayed in the UI? (2) does it reach Synthesis? (3) does the Synthesis prompt reference it? If any answer is no, the field is dead weight.

---

### L14 — "Sent to Synthesis" is not the same as "used by Synthesis"
**What happened:** `conflictingSignals` from Trajectory IS in the agentContext passed to Synthesis. But the Synthesis system prompt never mentions it. Claude Haiku ignores fields not explicitly called out in the prompt.
**Rule:** Adding a field to the LLM context object is step 1. Step 2 is adding explicit instructions in the system prompt to use that field. Without step 2, the LLM will not reliably use the field.

---

### L15 — APS 221 group exposure calculation was measuring the wrong thing
**What happened:** `groupExposure` in mcp-tools.js calculated SUM(BCA_GUARANTOR.COVER_AMOUNT) on the start node's loans. APS 221 requires total credit facilities (SUM of Loans.AMOUNT) across ALL connected entities in the group. These are different questions — guarantor cover vs total group lending.
**Rule:** When implementing a regulatory calculation, verify the exact definition in the standard before coding. APS 221 group exposure = total credit facilities across connected party network, not guarantor coverage amounts.

---

### L16 — Compliance flags must be deterministic, not LLM-generated
**What happened:** `apraReady` was left as an LLM output field — the model guessed true/false. In banking, whether a brief meets APRA submission standard is a hard rule check, not a judgement call. LLM produced inconsistent results.
**Rule:** Any field that represents a compliance or regulatory gate (apraReady, breachFlag, thresholdExceeded) must be calculated deterministically from data after the LLM returns — override whatever the LLM said. Never trust an LLM to make a compliance decision.

---

### L17 — RAGAS faithfulness fails when one combined vector query covers multiple signals
**What happened:** Synthesis used one long concatenated search query for all risk signals. Returned 3 generic APRA chunks. LLM then cited specific clauses not in those chunks (hallucination). Faithfulness score: 0.25.
**Rule:** For RAG over regulatory documents with multiple distinct signals, run separate vector searches per signal (DTI, APS 221, CPS 230) and combine results. One query → generic chunks. Per-signal queries → precise clause retrieval. Also increase topK from 3 to 5-7.

---

### L18 — Button state is ephemeral — always restore from DB on page load
**What happened:** APRA Notice button shows correct state (amber "✓ DTI → 6.0x") after clicking, but reverts to default on every page reload because state is in-memory JS only.
**Fix:** Add a lightweight `GET /api/dti-status` endpoint that reads current threshold from HANA. Call `checkApraState()` on page load — restores button style + banner + revert button from live data.
**Rule:** Any UI element whose state changes based on a server-side action must restore its state from the server on page load. Never rely on in-memory state surviving a reload.

---

### L19 — The revert button was hidden by a stale display:none guard
**What happened:** Fallback banner code had `if (banner.style.display === 'none')` — if banner was already visible from SSE, the fallback never ran and revert button was never injected. Also if no pipeline had run, SSE wasn't connected, so neither path showed the button.
**Fix:** Always update banner content regardless of current display state. Remove the guard entirely.
**Rule:** Never conditionally update content based on the element's current display state. Always write the full updated content and set display state explicitly.

---

### L20 — Test regex against actual extracted PDF text before deploying
**What happened:** Wrote regex patterns based on assumed PDF phrasing. Actual PDF uses Unicode ≥ (U+2265) in "DTI ≥ 6" and word-numbers in "DTI greater or equal to six times". Neither pattern was in the initial regex.
**Fix:** Add a temporary `console.log(rawText.substring(0, 600))` after PDF extraction, trigger once, read the actual phrasing, then write regex to match it exactly.
**Rule:** Never write a regex to parse document text without first seeing a sample of that text. Add a debug log, trigger once, read output, remove log. This is faster than guessing.

---

### L21 — Don't hardcode values that live in documents
**What happened:** APRA Notice button always set RegulatoryThresholds.LIMIT_PCT = 6.0 hardcoded — the value wasn't actually read from the PDF. Demo story claimed the system "reads the real document and applies it" but this was misleading.
**Fix:** Parse the actual value from the PDF text using regex, use that parsed value in the UPDATE.
**Rule:** If a value is in a document the system reads, extract it from the document. Hardcoding it defeats the purpose of document processing and misleads anyone who sees the demo or reads the code.

---

### L22 — LangGraph silently drops state fields not declared in Annotation.Root
**What happened:** reflectionHistory, hitlEnabled, and totalLatencyMs were all computed and returned by agents but vanished from the checkpoint. LangGraph does not warn — it silently ignores fields not in the Annotation.Root declaration.
**Fix:** Add every field the pipeline uses to state.js with the correct reducer (last, sum, append). If a field is missing from state.js it effectively does not exist.
**Rule:** After adding any new field to an agent's return value, immediately add it to state.js. Run a test pipeline and verify the field appears in the checkpoint before moving on.

---

### L23 — Reflection append reducer + manual history rebuild = duplicates
**What happened:** reflection.js was returning `reflectionHistory: [...prevHistory, newItem]` (manually rebuilding the full array). The append reducer then appended this full array to the existing state — doubling every entry after the first iteration.
**Fix:** Return only `[newItem]` from the node. The append reducer accumulates automatically.
**Rule:** When a state field uses an append reducer, nodes must return only the NEW items to add — never the full rebuilt array. The reducer is the accumulator, not the node.

---

### L24 — AuditLog CREATED_AT vs TIMESTAMP column name
**What happened:** AuditLog query used `.orderBy('TIMESTAMP asc')` but the column is `CREATED_AT`. Silent failure — no error, just empty auditTrail. totalCostAUD was always 0 in the report because the reduce over an empty array returns 0.
**Fix:** Use the actual column name from schema.cds, not an assumed name. Checked: it is CREATED_AT.
**Rule:** Always verify column names against schema.cds before writing queries. Do not assume standard names like TIMESTAMP — HANA CDS uses whatever name is in the entity definition.

---

### L25 — graph.updateState() blocking logToAuditLog()
**What happened:** `await graph.updateState()` ran before `logToAuditLog()`. If graph.updateState() threw, the AuditLog INSERT never ran — losing the permanent CPS 230 record. The try-catch was around the wrong scope.
**Fix:** Wrap graph.updateState() in its own try-catch. logToAuditLog() runs unconditionally after it.
**Rule:** State persistence (PostgreSQL checkpoint) and audit logging (HANA) are independent concerns. Never let one block the other. Each gets its own try-catch.

---

### L26 — LLM cites training-data threshold when no threshold is in the prompt
**What happened:** Pattern agent LLM received raw customer data (DTI_RATIO=5.80) but no APRA threshold. It inferred "approaches APRA limit of 6.00x" from training knowledge — the real-world APRA DTI limit. But the DB threshold was 8.0x (Demo 1 default), creating an inconsistency between pattern agent output and trajectory agent calculation.
**Fix:** Fetch the threshold from RegulatoryThresholds in the same Promise.all as other customer data, and inject it into the LLM system prompt explicitly.
**Rule:** Never let an LLM infer a regulatory threshold from training data. Always pass the current DB value explicitly. "The LLM knows" is not a substitute for providing the correct value in the prompt.
