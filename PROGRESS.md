# Progress

## Completed
- DFKKOPK entity (`db/schema.cds`) + 138-row payment-history seed
  (`Data/processed/DFKKOPK.json`), wired through `scripts/seed.js`,
  `pattern-agent.js` (fetchCustomerData + scikit scoring), `explain-agent.js`
  (payment history table + 3-way LoanSchedule↔DFKKOP↔DFKKOPK cross-ref),
  `admin.js`/`server.js` whitelists. Deployed to HANA, full reseed +
  audit-demo-customers.js clean for all 11 customers.
- DFKKOP fix row for L-004/30100003 (was missing all DFKKOP rows).
- LLM JSON hardening: `extractJson()` (`srv/utils/llm-json.js`) wired into
  pattern-agent, relationship-agent, self-rag, synthesis-agent, ragas-evaluator.
  `intake-agent.js` (~line 60) still uses the old greedy regex — not migrated.
- Created `CLAUDE.md` (architecture, schema, conventions, HANA recovery
  runbook, context management rules).

## AGREED DESIGN — IF redesign + Trajectory rate-stress (locked, not yet implemented)

Justification (researched this session): SAP PAL has `PAL_ANOMALY_DETECTION`
(IF is a legitimate native PAL capability); banks use unsupervised IF for
"early warning" on loan portfolios precisely because no labeled
default/outcome dataset exists — matches this demo's situation. Separately,
APRA APG223's serviceability buffer (assess repayment capacity at +3% above
current rate) is a real, well-known regulatory concept.

### A. Isolation Forest — 2D feature set (Pattern Agent / ml/anomaly-service.py)
1. `payment_delay_days` = AUGDT - FAEDN per DFKKOP/DFKKOPK row. Currently ALL
   138 DFKKOPK rows hardcoded `AUGDT = FAEDN - 1` (zero variance) — needs
   real ±0-3d variance for clean months, then an escalating trend for
   distressed loans.
2. `dunning_level` — NEW ordinal column (0-3) on DFKKOP/DFKKOPK, modeled on
   real SAP `MAHNV`/`FKKMAKO.MAHNS` (dunning level). Escalates in lockstep
   with payment_delay_days for distressed loans.
3. `contamination='auto'` replaces hardcoded `0.1` in `ml/anomaly-service.py`
   (agreed earlier, bundle with this work).

Demo narrative: clean performers (L-006, L-008, L-009, L-010, L-011, L-012)
flat `(0-1 days, level 0)` across all 12 months. Distressed loans (L-001,
L-002, L-003, L-005) show joint escalation in recent months, e.g.
`(1,0) → (4,0) → (12,1) → (35,2) → (81,3)`.

Why non-SQL-replicable: IF detects the JOINT/correlated escalation across two
differently-typed dimensions (continuous delay + ordinal dunning level) — not
a single-field threshold a WHERE clause could replicate.

### B. Trajectory Agent — add +3% rate-stress as a 2nd stressor
Alongside the existing income-expiry projection, add a second "flavour":

- **Current**: `currentDti = TOTAL_DEBT / ANNUAL_INCOME` (already computed)
- **+3% stress**: `futureDti_rateStress = TOTAL_DEBT / (ANNUAL_INCOME -
  TOTAL_DEBT * 0.03)` — NEW. No `Loans` join needed (`TOTAL_DEBT` already
  aggregates across a customer's loans). No `BCA_DTI` seed changes needed.
- New `RegulatoryThresholds` row: `THRESHOLD_TYPE='RATE_STRESS_BUFFER'`,
  `LIMIT_PCT=3.0`, `REGULATOR='APRA'`, description referencing APG223
  serviceability buffer — fetched dynamically, same pattern as
  `APRA_DTI_LIMIT`.

Verified against the REAL existing `BCA_DTI.json` — produces a natural 3-way
spread with **zero data changes**:
| Customer | Current DTI | +3% Stress DTI | Bucket |
|---|---|---|---|
| 30100003 | 7.2 (already breached) | 9.18 | already breaching — unchanged |
| 30100001 | 5.8 (under 6.0) | **6.99** | NEW — crosses limit only under stress |
| 30100004 | 5.4 (under 6.0) | **6.46** | NEW — crosses limit only under stress |
| 30100008 | 4.9 | 5.74 | near-miss, stays resilient |
| 30100002/5/6/9/10/12/13 | 0.19-4.2 | all stay well under 6.0 | resilient |

Synthesis combines both agents' outputs (no new Synthesis code needed): a
customer flagged by IF (current behavior drifting) AND Trajectory (future DTI
breach under standard rate-stress test) = compounding risk finding.

### Implementation sequence (locked)
1. **DONE** — `RegulatoryThresholds` row (RATE_STRESS_BUFFER=3.0, reseeded) +
   `trajectory-agent.js` `futureDtiRateStress` calc + DETERIORATING/
   conflictingSignals logic. Also wired into UI: `report-page.js` (new
   "Rate-Stress DTI (+3%, APG 223)" row + formula in agent-info panel) and
   `explain-agent.js` (updated decision-tree text/cascade, new "Step 2b" calc
   box, RegulatoryThresholds table now shows RATE_STRESS_BUFFER row too).
   Verified against real HANA data via `scripts/test-trajectory.js` and
   `scripts/test-trajectory-apra-notice.js` (latter toggles DTI limit to 6.0x
   then reverts to 8.0x). Confirmed: at baseline (8.0x) numbers compute
   correctly but don't change forwardPosition for 30100001/30100004; at
   post-APRA-notice (6.0x) both flip STABLE→DETERIORATING with the new
   rate-stress signal (5.8x→6.99x, 5.4x→6.46x), 30100008 stays resilient
   (5.74x), 30100003's already-breaching guard correctly suppresses a
   redundant signal. DB reverted to 8.0x baseline after test.
2. **DONE** — `MAHNS` (Dunning Level, SAP `FKKMAKO.MAHNS`, ordinal 0-3)
   integer column added to `DFKKOP` and `DFKKOPK` in `db/schema.cds`.
   Deployed to HANA Cloud and verified: both tables now have a `MAHNS`
   column (currently `null` on all rows — population is Step 3), confirmed
   via direct CDS query (`DFKKOP` 13 rows, `DFKKOPK` 138 rows) and via
   `/admin/api/hana/DFKKOP` / `DFKKOPK` after a server restart.

   **Deploy procedure that worked** (the standard "no drama" CAP dev-loop —
   document for future schema changes): `DFKKOPK` and `BCA_CREDIT_HISTORY`
   had been created in earlier sessions via raw `CREATE TABLE` (outside HDI
   tracking), which made `cds deploy` fail with "duplicate table name" when
   trying to also apply the `DFKKOP` migration (HDI deploys are
   all-or-nothing — a failure rolls back every change in that run, even ones
   that individually reported "ok"). Fix:
   1. `DROP TABLE bankingsentinel_DFKKOPK` and
      `DROP TABLE bankingsentinel_BCA_CREDIT_HISTORY` via the runtime `_RT`
      user (`.env` creds) — only works because `_RT` created those tables
      itself originally.
   2. `npx cds deploy --to hana` (no `--profile` flag, from
      `/c/Dev/Banking-Sentinel`) — auto-detects `default-env.json`'s
      `VCAP_SERVICES`, no `cf login` needed. This both recreates the dropped
      tables as HDI-managed AND applies HDI's automatic "fast migration"
      ALTER TABLE to `DFKKOP` for the new `MAHNS` column, in one deploy.
   3. `node --env-file=.env scripts/seed.js` — reseeds all 14 tables
      (DFKKOPK 138 rows, BCA_CREDIT_HISTORY 200 rows, etc).
   4. Restart local server (`npm run start:local`) so the running CDS model
      picks up the new column for `/admin`.

   Also confirmed the trial instance had auto-suspended mid-session
   ("HANA Database instance is stopping") — user restarted via BTP cockpit;
   unrelated to the privilege issue above.
3. Regenerate `Data/processed/DFKKOPK.json`: realistic `payment_delay_days`
   variance + `dunning_level` escalation per the narrative above.
4. `ml/anomaly-service.py`: 2D feature vector (payment_delay_days,
   dunning_level) + `contamination='auto'`.
5. `pattern-agent.js` `fetchCustomerData`: include `dunning_level` in scikit
   feature mapping.
6. Full reseed + `audit-demo-customers.js` + risk-analysis runs for
   30100001, 30100003, 30100004.

## Next
- Steps 1-2 done. Step 3 (regenerate DFKKOPK.json with payment_delay_days
  variance + MAHNS escalation narrative, update seed.js mapDFKKOP/mapDFKKOPK
  to pass through MAHNS) — awaiting go-ahead.

## Gotchas / decisions to not forget
- This whole IF/Trajectory thread is presented to SAP/bank stakeholders —
  algorithm choices must be justified by real bank/SAP practice (done — see
  AGREED DESIGN above).
- Relationship Agent's "graph-based" framing — CONFIRMED genuinely graph-based
  (ReAct + `hana_graph_traverse`) this session, no longer a concern.
- HANA Cloud trial auto-suspends — see CLAUDE.md recovery procedure before
  assuming a connection error is a code bug.
- Step 1 is independent and reseed-free — good first implementation task,
  doesn't block on steps 2-6.
