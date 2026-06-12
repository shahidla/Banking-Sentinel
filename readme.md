# Banking Sentinel

A multi-agent AI risk-intelligence system for connected-party credit risk
(TRBK), built on **SAP CAP + HANA Cloud** and a **LangGraph** agent pipeline.
Given a customer/borrower, it produces an evidence-backed risk assessment
covering statistical anomalies, forward-looking DTI/serviceability stress,
related-party exposure, and an APRA-aligned narrative — with full
human-in-the-loop approval and an explainability trail.

## Architecture

The pipeline is a LangGraph `StateGraph` (`srv/graph/banking-sentinel.js`):

```
Intake → Pattern ─┬─ (low risk) ──────────────────────────► Synthesis
                   └─ (high risk) → Trajectory → Relationship
                                     → Reflection → Human Approval → Synthesis
```

- **Intake** — classifies the query (simple data lookup vs. full risk
  analysis vs. out-of-scope) via an LLM.
- **Pattern** — runs RPT-1 (SAP tabular foundation model), an Isolation
  Forest anomaly detector (scikit-learn by default, HANA PAL optional), and
  an LLM narrative, in parallel.
- **Trajectory** — projects forward DTI (income-expiry scenario and APRA
  APG 223 +3% rate-stress scenario) against `RegulatoryThresholds`.
- **Relationship** — ReAct loop over a GraphDB/SPARQL knowledge graph to
  find guarantors, related entities and APS 221 group exposure.
- **Reflection** — re-queries for missing evidence (max 2 iterations).
- **Human Approval** — pauses for sign-off before high-risk findings reach
  Synthesis.
- **Synthesis** — produces the final risk brief.

Data lives in 14 HANA tables (`db/schema.cds`), seeded by `scripts/seed.js`.
Regulatory text (APRA standards) is embedded and retrieved via HANA native
vector search. See `CLAUDE.md` for full implementation details and
conventions.

## Prerequisites

- Node.js 20+
- Python 3.10+ (for the scikit-learn anomaly service)
- A HANA Cloud instance, a GraphDB (or HANA KGE) endpoint, a Postgres
  instance (Supabase or BTP Postgres), and API keys for Anthropic, OpenAI,
  SAP RPT-1 and Langfuse — see the commented `.env` for the full list.

## Running locally

```bash
npm install
npm run start:local
```

`start:local` runs the CAP server (`cds serve --profile hybrid`, against the
live HANA Cloud/GraphDB/Postgres instances configured in `.env`) and the
Python anomaly service side by side.

Useful scripts:

- `node --env-file=.env scripts/seed.js` — reseed all 14 HANA tables
- `node --env-file=.env scripts/audit-demo-customers.js` — sanity-check
  seeded data for the demo customers
- `node --env-file=.env scripts/seed-graphdb.js` — (re)load the relationship
  graph into GraphDB (sandbox instances expire every 7 days)

## Admin UI

`/admin` exposes a dashboard over the HANA tables, GraphDB, Postgres session
log, and run history — useful for inspecting agent runs and underlying data
without a HANA client.

## API

`POST /a2a/agent` — JSON-RPC 2.0 endpoint:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "analyseRisk",
  "params": { "query": "Analyse credit risk for customer 30100001", "customerId": "30100001", "hitl": false }
}
```

`GET /a2a/events` streams progress via SSE. `/report/:sessionId` and
`/explain/:sessionId` render the final report and evidence trail.

## Deployment (SAP BTP / Cloud Foundry)

```bash
cp manifest.yml.template manifest.yml   # fill in route names if needed
cf push
```

Secrets are never stored in `manifest.yml` — set them once via `cf set-env`
(see the comments in `manifest.yml.template`) and `cf restage`. The ML
anomaly service deploys as a separate `python_buildpack` app
(`banking-sentinel-scikit`) referenced via `SCIKIT_SERVICE_URL`.
