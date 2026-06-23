# BLOG.md Review — Fix List + Audience Appeal Notes

Review of `Docs/rebuild-kit/BLOG.md` against the current codebase (`srv/agents/*.js`,
`CLAUDE.md`, `PROGRESS.md`) and against `Docs/evidence-paper-30100001.md`. Goal: factual
accuracy, no overclaiming, no hallucination, and language that lands correctly with both an
SAP audience and an AI-practitioner audience.

No changes have been made to `BLOG.md` itself — this is the punch list only.

---

## A. Hallucinations / factual errors (fix regardless of audience)

**A1. RPT-1 method description (§6, Agent 1, Method 1) is wrong on three counts.**
Blog says: *"fetches the last 20 customers from `BCA_DTI`... DTI ratio, breach flag, total
debt, annual income, risk category."*
Actual code (`srv/agents/pattern-agent.js:79`): pulls from `BCA_CREDIT_HISTORY`, `.limit(50)`,
label column `arrears_outcome` (LOW/MEDIUM/HIGH/CRITICAL). `BCA_DTI` only supplies the single
query row being predicted, not the context rows. Wrong table, wrong row count, wrong label
name — an SAP/technical reader who opens the repo will see this doesn't match the code.

Bonus: the code comment at `pattern-agent.js:66` itself says "200 historical cases" while the
real call is `.limit(50)` — that comment is stale too and should be corrected alongside the
blog fix (not part of BLOG.md, but same root cause).

**A2. Pattern Agent Method 2 (Isolation Forest) describes a retired version of the algorithm.**
Blog: 1D feature `(days_overdue, amount)` from `DFKKOP` alone, "3 payment rows scored, 0
flagged" for 30100001.
Actual (per `PROGRESS.md`'s AGREED DESIGN work, implemented and verified end-to-end): 2D
feature `(payment_delay_days, dunning_level)` from `DFKKOP`+`DFKKOPK` combined. The verified
live run for this exact customer produced *"11/27 payment rows flagged; delays up to 81 days;
dunning level 3"* — not 3-rows-0-flagged. The blog documents the pre-redesign agent.

**A3. Pattern Agent Method 3 (LLM anomaly) — the 5-anomaly example predates the LLM redesign.**
Current system prompt looks for escalating payment trends + collateral under-coverage; the
verified run for 30100001 produced 3 trend-narrative anomalies about L-001/L-002 dunning
escalation — not the 5 generic items currently in the blog (DTI buffer, overdue days, contract
expiry, term-deposit classification, unreconciled BUDAT).

**A4. Trajectory Agent section omits the rate-stress test entirely.**
`trajectory-agent.js` runs a second independent projection — APG 223 +3% rate-stress
(`futureDtiRateStress`, its own `rateStressBreach` flag, its own conflicting-signal text). Not
mentioned in §6 Agent 2 or its sample JSON output. A reader who checks the code will find a
field and a whole calculation step the blog never describes.

**A5. RAGAS is referenced twice but was removed from the codebase entirely.**
§2 "For AI Practitioners" (*"RAGAS-style claim-source faithfulness checking"*) and §6 Agent 6
Step 4 (*"RAGAS Claim-Source Overlap Check"*). Per `PROGRESS.md`, RAGAS itself (the library/
metric) was deleted; the Synthesis guardrail's own cosine-similarity claim-source check still
exists, but it isn't RAGAS and never depended on the RAGAS package. Attributing it to RAGAS
is now a false claim about the dependency tree.

**A6. §7's worked example doesn't match `Docs/evidence-paper-30100001.md`** for the same
customer ID — debt, income, risk score/level, group exposure, confidence, and `apraReady` all
differ between the two documents. Needs a fresh pipeline run; do not reconcile two stale
snapshots, replace with one current one.

**A7. "299 days to expiry"** (§1, §6 Agent 2, §7, Summary) is computed live from `new Date()`
in `trajectory-agent.js` — will be wrong at publish time unless regenerated then, not now.
Same root cause/fix as A6.

---

## B. Overclaiming — the SAP-ecosystem framing

The blog states as settled fact, in the second thing an SAP reader sees (§2 "For SAP
Customers") and again in the Summary: *"runs entirely on SAP BTP... without leaving the SAP
ecosystem... SAP's graph engine... without AI Core."* The actual stack includes Claude
(Anthropic), OpenAI embeddings, LangGraph, Langfuse, GraphDB (not HANA KGE), Supabase/Postgres
— none SAP, none swapped for SAP equivalents, because AI Core/AI Launchpad were never
available on the trial tier used. That is an access constraint, not a deliberate choice, and
the blog currently frames it as a deliberate proof point ("proves SAP's native AI stack can
power production-grade risk intelligence").

Why this matters for each audience:
- **SAP readers** will check whether the reasoning/orchestration layer is SAP-native (it's the
  most expensive, highest-IP part of the system) — once they find it isn't, they'll discount
  the rest of the document, including the parts that are genuinely true and strong (HANA
  Cloud, CAP, RPT-1 are real and working).
- **AI readers** will read "without AI Core" as a slightly odd brag and infer AI Core was
  never actually evaluated — undercutting the "we proved X" framing.

Three spots carrying this overclaim:
- §2 "For SAP Customers" — blends the SAP-proven layer (HANA Cloud, CAP, RPT-1) with the
  non-SAP reasoning layer into one "entirely on SAP BTP" claim.
- §11 "What Comes Next" — *"The architecture does not change... The upgrade path is a
  configuration change, not a rebuild"* — states the PAL/HANA-KGE swap as proven when it is
  designed-for-compatibility but **untested** against a live PAL/KGE instance.
- Summary's closing paragraph — restates the same "entirely on SAP BTP... without leaving the
  ecosystem, without AI Core" claim where it will be most remembered.

**Content-change suggestion** (not applied): reframe as a **mixed-stack architecture** —
explicit that the SAP-native data/ML layer (HANA Cloud, CAP, RPT-1) is proven and
interchangeable with PAL/KGE, and that the reasoning/orchestration layer (LLM, LangGraph,
Langfuse) is non-SAP *by access constraint* (no AI Core on the trial tier), not because it was
found to be superior or because of a deliberate bake-off. This is a more credible and more
interesting story for an SAP-ambassador audience than "did it all in SAP" — it signals you
know exactly where the SAP boundary is, which builds more trust than claiming there isn't one.

---

## C. Dashboard labeling honesty (smaller instance of the same B pattern)

§9 labels a dashboard row "**PAL** — 0 / 3 payment rows flagged" — but the actual demo run
uses scikit-learn (PAL is the documented production alternative behind
`ANOMALY_ENGINE=pal`, not the default). Calling it "PAL" in the live-demo walkthrough implies
PAL ran, when scikit-learn did. Same fix pattern as B: label it scikit-learn in
demo-walkthrough sections; reserve "PAL" for the stack table / "what comes next" sections
where it's correctly the production target, not what actually executed.

---

## D. Presentation / wording — audience appeal

### For an SAP-ambassador / SAP-customer audience
- §8 (Regulatory Compliance by Design) is the strongest section in the document — each
  APRA standard mapped to specific code, no hedging, no AI jargon. Consider leading with this
  closer to the top, or at least signposting it earlier in the TOC framing, since SAP
  reviewers respond more to "this satisfies a named obligation" than to agent-orchestration
  mechanics.
- The stack table (§4) is good practice for this audience — keep the "Why X?" sub-sections
  for RPT-1/LangGraph/HANA Vector, they read like genuine engineering rationale rather than
  marketing copy.
- Once B is fixed, the "mixed stack, SAP boundary known and explicit" framing will land better
  with SAP technical reviewers than an unqualified "built entirely on SAP" claim — overclaiming
  to this specific audience is a credibility risk, not a strength; they will check.

### For an AI-practitioner audience
- §6's "Output (JSON)" blocks per agent are the right format for this audience — keep them,
  but once A1-A4 are corrected, make sure the JSON schemas shown include the fields that
  actually exist now (e.g. Trajectory's `futureDtiRateStress`/`rateStressBreach`), not a
  simplified/outdated state shape.
- §2 "For AI Practitioners" oversells pattern-spotting slightly by naming RAGAS (A5) — once
  fixed, consider keeping the *concept* reference ("a RAGAS-inspired faithfulness check,
  implemented directly rather than via the library") if you want the name-recognition value
  without the false dependency claim.
- The Reflection/HITL/re-query loop (§6 Agent 4-5) is the part most likely to interest this
  audience structurally (Reflexion-style critic + bounded re-query + LangGraph interrupt) —
  it's accurately described today and doesn't need a content change, just verify the numeric
  example (confidence 0.72, 3 gaps) is replaced consistently with whatever the fresh rerun
  produces (A6).

### Title (optional, not a correctness fix)
Current: *"Banking Sentinel: A Multi-Agent AI Risk Intelligence System Built on SAP BTP."*
Once B is addressed, a title consistent with the honest mixed-stack framing would read better,
e.g. *"Banking Sentinel: A Multi-Agent Credit-Risk Copilot on SAP HANA Cloud — Built on a Mixed
AI Stack."*

---

## What's needed to close out A6/A7

A fresh `analyseRisk` run for customer 30100001 (full agent log/JSON output, plus the date the
run was taken) — everything else in this list (A1-A5, B, C, D) is independent of that rerun
and can be applied at any time.
