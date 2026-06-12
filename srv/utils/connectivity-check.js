// Banking Sentinel — startup connectivity self-check
// AI: Several external services (GraphDB sandbox, Anthropic/OpenAI keys) are
//     configured via env vars that drift between local .env and the CF env
//     (cf set-env) — and the GraphDB sandbox expires every 7 days. Both kinds
//     of drift previously surfaced only when an agent run failed mid-pipeline.
// Banking: run a cheap check at startup and log it loudly, so a stale
//     GraphDB endpoint or a missing credential is visible in `cf logs`
//     immediately after deploy, not three agent-hops into a customer query.

'use strict';

const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'GRAPHDB_ENDPOINT', 'GRAPHDB_REPOSITORY', 'GRAPHDB_USERNAME', 'GRAPHDB_PASSWORD',
  'POSTGRES_URL'
];

async function checkGraphDb() {
  const endpoint   = process.env.GRAPHDB_ENDPOINT;
  const repository = process.env.GRAPHDB_REPOSITORY;
  if (!endpoint || !repository) {
    return { name: 'GraphDB', ok: false, detail: 'GRAPHDB_ENDPOINT/GRAPHDB_REPOSITORY not set' };
  }

  const url  = `${endpoint}/repositories/${repository}`;
  const auth = Buffer.from(`${process.env.GRAPHDB_USERNAME}:${process.env.GRAPHDB_PASSWORD}`).toString('base64');

  try {
    const res = await fetch(url, {
      method:   'POST',
      headers:  { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json', 'Authorization': `Basic ${auth}` },
      body:     'ASK { ?s ?p ?o }',
      signal:   AbortSignal.timeout(8000),
      redirect: 'manual'
    });

    if (res.status >= 300 && res.status < 400) {
      return { name: 'GraphDB', ok: false, detail: `redirected (HTTP ${res.status}) to ${res.headers.get('location')} — sandbox likely expired/renamed, get a fresh sandbox and update GRAPHDB_ENDPOINT (local .env + cf set-env)` };
    }
    if (!res.ok) {
      return { name: 'GraphDB', ok: false, detail: `HTTP ${res.status} — check GRAPHDB_USERNAME/GRAPHDB_PASSWORD` };
    }
    return { name: 'GraphDB', ok: true, detail: 'reachable' };
  } catch (e) {
    return { name: 'GraphDB', ok: false, detail: e.message };
  }
}

function checkRequiredEnv() {
  return REQUIRED_ENV
    .filter(key => !process.env[key])
    .map(key => ({ name: key, ok: false, detail: 'not set' }));
}

// Runs once at startup. Does not throw — connectivity problems are logged as
// warnings, not fatal, since the app can still serve simple queries.
async function runConnectivityChecks() {
  const results = [...checkRequiredEnv(), await checkGraphDb()];
  for (const r of results) {
    if (!r.ok) console.warn(`  [Startup Check] ${r.name}: ${r.detail}`);
  }
  if (results.every(r => r.ok)) {
    console.log('  [Startup Check] All external service env vars present, GraphDB reachable');
  }
  return results;
}

module.exports = { runConnectivityChecks };
