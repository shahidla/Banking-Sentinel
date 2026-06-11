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
3. **DONE** — `scripts/regenerate-payment-history.js` regenerated
   `Data/processed/DFKKOPK.json` (138 rows): `AUGDT` now varies ±0-1 day
   around `FAEDN` for clean months (was hardcoded `FAEDN-1` for all rows),
   and the last 5 months (H08-H12) of the 4 distressed loans escalate per
   the narrative — `L-001` `(1,0)→(4,0)→(12,1)→(35,2)→(81,3)`, `L-002`
   `(1,0)→(3,0)→(9,1)→(24,2)→(50,3)`, `L-003`
   `(0,0)→(2,0)→(6,1)→(16,1)→(30,2)`, `L-005`
   `(0,0)→(1,0)→(4,0)→(9,1)→(15,1)` — each ending at the same magnitude as
   that loan's currently-open `DFKKOP` overdue item. `Data/processed/DFKKOP.json`
   (13 rows) got `MAHNS` set to match: 3/3/3/2/1 for the 5 open overdue rows
   (`OP-L001-001/002`, `OP-L002-001`, `OP-L003-001`, `OP-L005-001`), 0 for all
   8 `CLEARED` rows. `mapDFKKOP`/`mapDFKKOPK` in `scripts/seed.js` updated to
   pass `MAHNS` through (default 0). Reseeded (138/13 rows) and verified via
   `audit-demo-customers.js` (clean for all 11 customers) and
   `/admin/api/hana/DFKKOP` (MAHNS values confirmed).
4. **DONE** — `ml/anomaly-service.py`: training (`X_train`) and scoring
   (`X_score`) feature vectors changed from `[days_overdue, amount]` to
   `[payment_delay_days, dunning_level]` (reads `r.get('payment_delay_days')`
   / `r.get('dunning_level')` from the request JSON). `contamination=0.1`
   replaced with `contamination='auto'`. Reason-code logic reworked to
   `mean_delay`/`std_delay`/`mean_dunning`/`std_dunning` with new
   `PAYMENT_DELAY_DAYS ...` / `DUNNING_LEVEL ...` reason strings.

   Verified live: killed and restarted `npm run start:local` (CAP :4004 +
   scikit :5001) so the new code loads, then POSTed directly to
   `/anomaly` with the new field names:
   - Portfolio of mostly-clean rows (delay 0±1, dunning 0) plus a few
     escalating rows (4/0, 12/1, 35/2) → scoring `{81, dunning=3}` gave
     `label=-1, score=1.0, reason="PAYMENT_DELAY_DAYS 81 (z=7.48, portfolio
     mean=4.7)"`; scoring a clean `{0,0}` row gave `label=1, score=0.0,
     reason=null`.
   - Probe: portfolio of all-clean (0/0) rows, scoring `{delay=1,
     dunning=3}` (high dunning, low delay) → `label=-1, reason="DUNNING_LEVEL
     3 (z=3.00, portfolio mean=0.0)"` — confirms the dunning-dominant branch
     of the reason-code logic also works.

   **Note**: `pattern-agent.js` still sends the OLD field names
   (`days_overdue`/`amount`) — until Step 5 rewires it, the live
   `/anomaly` calls from the app will score on `{0,0}` for every row
   (both fields default to 0 via `.get(..., 0)`), so no crash but no real
   signal yet. This is expected/intentional given the locked sequence.
5. **DONE** — `pattern-agent.js`:
   - Added `daysBetween(faedn, augdt)` helper (clearing date - due date, days).
   - `fetchCustomerData`: `portfolioOpen`/`portfolioCleared` queries now select
     `MAHNS` (and `FAEDN`/`AUGDT` for cleared) instead of `BETRW`. The
     `portfolio` array is now built directly as
     `{ payment_delay_days, dunning_level }` — `DAYS_OVERDUE`/`MAHNS` for open
     items, `daysBetween(FAEDN, AUGDT)`/`MAHNS` for cleared history.
   - `runScikitAnomalyDetection`: `portfolio`/`payments`/`history` mappings
     now send `payment_delay_days`/`dunning_level` (matching the Step 4
     `/anomaly` contract) instead of `days_overdue`/`amount`.
6. **DONE** — Full reseed (`node --env-file=.env scripts/seed.js`, all 14
   tables OK, 138/13 rows for DFKKOPK/DFKKOP) + `audit-demo-customers.js`
   (clean for all 11 customers, no errors/mismatches). Restarted
   `npm run start:local` to load the Step 5 pattern-agent code, then ran full
   `/a2a/agent analyseRisk` (hitl:false) end-to-end for all 3 target
   customers:
   - **30100001** (L-001/L-002, distressed): riskScore 78 CRITICAL. Pattern
     finding: *"Persistent payment delinquency: 11/27 payment rows flagged;
     delays up to 81 days; dunning level 3."* — 27 = 24 DFKKOPK history rows
     (12×2 loans) + 3 DFKKOP open rows for GPART 30100001.
   - **30100003** (L-004, clean performer + DTI rate-stress flagship):
     riskScore 63 HIGH. No payment-delinquency finding from pattern (correct —
     L-004 is MAHNS=0 throughout); findings dominated by DTI/rate-stress
     (7.2x→9.2x) and APS221 guarantor consolidation, as expected. Confirms
     the original "No payment rows for this customer to score" bug (fixed
     earlier) stays fixed under the new 2D vector.
   - **30100004** (L-005, distressed): riskScore 37 MEDIUM. Pattern finding:
     *"4/13 payment rows flagged as anomalies with isolation scores
     0.881-1.000; DUNNING_LEVEL escalation observed"*; recommendation
     references monitoring *"DUNNING_LEVEL 1"* — confirms the new
     `DUNNING_LEVEL ...` reason-code string (Step 4) flows through to the
     LLM synthesis narrative.

   All 3 runs HTTP 200, ~80-90s each, no errors. The "AGREED DESIGN" IF
   redesign + Trajectory rate-stress feature is now fully implemented and
   verified end-to-end.

## Follow-up enhancement — Pattern Agent LLM anomaly detection (DONE)
With the 2D IF redesign in place, the Pattern Agent's 3rd "AI method"
(`runLlmAnomalyDetection` in `pattern-agent.js`, Claude Haiku 4.5) was still
sending its OLD, narrower data slice (`BCA_DTI`, `Loans`, 10 `DFKKOP` rows,
`collateralCount` only). `data.history` (DFKKOPK) and `data.collateral`
(BCA_COLLATERAL) were already fetched by `fetchCustomerData` for the scikit
path but unused by the LLM.

Implemented the agreed OLD→NEW redesign:
- `summary` now includes `paymentHistory` (full `data.history`, mapped to
  `{loanId, faedn, augdt, dunningLevel}`) and `collateral` (full
  `data.collateral`, mapped to `{loanId, type, value}`) instead of just a
  count.
- System prompt restructured into 3 rule blocks: existing DTI rules
  unchanged; new **Payment trend rules** (look for an ESCALATING TREND across
  `paymentHistory` per loan, describe narratively, explicitly told NOT to
  flag a single row's delay/dunning — that's the scikit/PAL job); new
  **Collateral rules** (flag under-collateralized loans where `loans.AMOUNT`
  > total pledged `collateral.value`).
- `LoanSchedule` deliberately NOT added — that 3-way cross-reference
  (PENDING/not-yet-due logic) belongs to `explain-agent.js`'s audit-trail
  role, not the Pattern Agent's risk-identification role.

Verified live (restart `npm run start:local`, full `/a2a/agent analyseRisk`
for 30100001, hitl:false): `[Pattern/LLM] anomalies:3 tokens:2029in/124out`
(was ~700-900in before) —
  1. *"Loan L-001 deteriorated from on-time to dunning level 3 / 81-day delay
     over last 5 months."*
  2. *"Loan L-002 deteriorated from on-time to dunning level 3 / 50-day delay
     over last 5 months."*
  3. *"Multiple loans in distress: L-001 and L-002 both at dunning level 3
     with open overdue payments."*
Exactly the trend-narrative behavior designed — confirms the LLM is now
reasoning over the payment-history trajectory rather than a static snapshot.
Full risk run HTTP 200, riskScore 62 HIGH, no errors.

## Next
- All 6 AGREED DESIGN steps + the Pattern Agent LLM enhancement above are
  done, reseeded (where applicable), and verified end-to-end via real
  `/a2a/agent` risk-analysis runs. Nothing outstanding from this design doc.
  Recommend: review `git diff`, then commit + push.

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
