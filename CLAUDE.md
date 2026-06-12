# Banking Sentinel

LangGraph multi-agent risk-analysis demo for an Australian bank, built on SAP CAP + HANA Cloud.

## Architecture

**Agent pipeline** (`srv/agents/`): Intake → Pattern → Relationship → Trajectory → Synthesis,
orchestrated as a LangGraph StateGraph in `srv/server.js`. Intake classifies queries
(SIMPLE_DATA_QUERY / RISK_ANALYSIS / INAPPROPRIATE_REQUEST) via an LLM; RISK_ANALYSIS is the
default fallback.

Pattern Agent (`srv/agents/pattern-agent.js`) runs three things in parallel via
`Promise.allSettled`:
- **RPT-1** (SAP tabular foundation model, `rpt.cloud.sap/api/predict`): in-context learning —
  sends 200 `BCA_CREDIT_HISTORY` rows (each with a known `arrears_outcome`:
  LOW/MEDIUM/HIGH/CRITICAL) plus this customer's 1 `BCA_DTI` row with `arrears_outcome:
  '[PREDICT]'`. Predicts a graded *repayment-risk* category (not binary), mapped to 0-100 via
  `scoreFloors = { LOW:0, MEDIUM:26, HIGH:51, CRITICAL:76 }`.
- **Isolation Forest** anomaly detector (scikit by default, `ml/anomaly-service.py` Flask
  service on `SCIKIT_SERVICE_URL`/`localhost:5001`; HANA PAL alternative via
  `ANOMALY_ENGINE=pal`, not default). Trains on portfolio-wide `(days_overdue, amount)` pairs
  (DFKKOP+DFKKOPK, top 500 each), scores this customer's own DFKKOP+DFKKOPK rows. `label:-1` =
  this payment row is a statistical outlier vs. portfolio norms; `reason_code` says whether
  overdue-days or amount drove it.
- LLM narrative pass.

## HANA schema (14 tables, `db/schema.cds`, seeded via `scripts/seed.js`)

BusinessPartners, BUT050, Loans, LoanSchedule, BCA_GUARANTOR, BCA_COLLATERAL, BCA_DTI,
BCA_CREDIT_HISTORY (200 rows, RPT-1 context), BCA_SECTOR, RegulatoryThresholds,
ExposureLimits, SectorExposureLimits, **DFKKOP** (open items / current ledger — 1-2 rows per
active loan), **DFKKOPK** (cleared items / payment history — ~12 months per loan, 138 rows).

DFKKOP+DFKKOPK together give every demo loan a full payment story: months of clean DFKKOPK
history, then current open/overdue DFKKOP items. `srv/explain-agent.js` does a 3-way
cross-reference of LoanSchedule ↔ DFKKOP ↔ DFKKOPK using a fixed reference date
`SCHEDULE_TODAY = '2026-05-21'` (a deliberate "demo today", not the wall-clock date) to
distinguish genuinely-missing past-due payments from not-yet-due future ones.

11 demo customers: 30100001-30100006, 30100008-30100010, 30100012-30100013
(30100007/30100011 don't exist — used as "not found" test cases).
`scripts/audit-demo-customers.js` validates data sensibility across all of these.

## Conventions

- **LLM JSON parsing**: any agent asking Claude for JSON must use `extractJson()` from
  `srv/utils/llm-json.js` — balanced brace-counting instead of a greedy regex, so trailing
  prose containing `{`/`}` doesn't break parsing. Wired into pattern-agent,
  relationship-agent, reflection, synthesis-agent, ragas-evaluator. `intake-agent.js` (~line 60)
  still uses the old greedy regex — flagged, not yet migrated.

## Running locally

`npm run start:local` — already passes `--profile hybrid` to `cds serve`, no `CDS_ENV` needed.
Standalone scripts (`scripts/*.js`) need `CDS_ENV=hybrid node --env-file=.env scripts/<name>.js`
since they call `cds.connect.to('db')` directly without a `--profile` flag.

## HANA Cloud trial recovery

The HANA Cloud trial instance stops itself periodically (trial auto-suspend); user restarts it
manually from the SAP BTP cockpit.

- **Stopped**: `Could not establish connection... Socket closed by peer` (-10709).
- **Still resuming** (1-2 min after restart): `RTE:[300012] Cannot create SSL engine` (-10709,
  HY000). Both mean wait-and-retry, not a config problem.
- One-off `RTE:[300004] MS Crypto API is not available` on the very first request after a
  server restart is transient pool warm-up — self-recovers.
- `npx cds deploy --to hana` does **not** work in this environment (no `cf login`, SSL errors
  even when warm). For schema changes, use a one-off script with `cds.connect.to('db')` + raw
  `CREATE COLUMN TABLE bankingsentinel_<NAME> (...)` SQL — see
  `scripts/create-dfkkopk-table.js` for the pattern.

**Full reseed procedure** (from `/c/Dev/Banking-Sentinel`, `CDS_ENV=hybrid`):
1. If schema changed: one-off `CREATE COLUMN TABLE` script (see above).
2. `node --env-file=.env scripts/seed.js` — reseeds all 14 tables (DELETE+INSERT), ~10-20s.
3. `node --env-file=.env scripts/audit-demo-customers.js` — sanity-checks all 11 demo
   customers (DTI math, schedule sums, DFKKOP/DFKKOPK coverage per loan).
4. `npm run start:local`.

GraphDB and Supabase do **not** need reseeding when HANA is reseeded — `scripts/seed-graphdb.js`
only ingests BusinessPartners+BUT050 (separate trigger), and Supabase tables self-create via
`CREATE TABLE IF NOT EXISTS` / LangGraph `.setup()`.

## Context Management Rules

**Compaction**: always preserve the current task list, key architectural decisions, file
paths modified this session, unresolved bugs, and the next planned step. Discard verbose
tool output, full file contents, and test logs. Banking-Sentinel-specific: also preserve
which HANA tables/files were touched and whether reseed/audit scripts have re-run since
(stale seed data after a schema change is a common bug source here), and any in-progress
agent-pipeline explanations (RPT-1, Isolation Forest, etc.) — the user works through each
agent's mechanics one at a time in a recap-and-confirm style and expects continuity. Exact
file paths and line numbers of code changes matter, not just summaries.

**Progress tracking**: maintain `PROGRESS.md` in the project root at all times. After
completing each task/subtask, update it with what was completed (files changed, decisions
made), what's in progress, what's next, and any gotchas/constraints/decisions that must not
be forgotten. After any compaction or `/clear`, re-read `PROGRESS.md` and this file before
doing anything else.

**Reading files**: don't read entire directories or the whole repo. Read only the files
needed for the current task; for large files, read only the relevant section (grep first).
Never re-read a file that hasn't changed since last read.

**Tool output discipline**: pipe test/build output through `tail`/`grep` to capture only
failures and summaries (e.g. `npm test 2>&1 | tail -50`). Summarize long output instead of
keeping it verbatim.

**Subagents for exploration**: for any codebase-wide search, analysis, or research task,
use a subagent and return only a concise summary to the main conversation.

**Scope discipline**: work on ONE task at a time, don't preload context for future tasks.
When a task is complete, update `PROGRESS.md`, then stop and confirm before starting the
next one.

## File reading rules (STRICT)
- NEVER read a source file in full if it is over 100 lines.
- ALWAYS use Grep first to locate the relevant function/section, then Read
  with offset/limit to read ONLY that section (max ~60 lines at a time).
- Never re-read a file already read this session unless it was modified.
- For schema/config files (schema.cds, package.json, mta.yaml): grep for
  the specific entity/key needed, never read the whole file.

## Server cleanup
- To stop running servers, run scripts/kill-servers.cmd.
- NEVER use wmic or netstat process discovery to find processes.

## Progress tracking
- Maintain PROGRESS.md: current step, key decisions, next step only.
- Move completed phases to HISTORY.md (do not auto-read HISTORY.md).
- After any compaction, re-read PROGRESS.md and CLAUDE.md before continuing.