'use strict';
const cds = require('@sap/cds');

const HANA_ENTITIES = [
  'BusinessPartners', 'BPRoles', 'Loans', 'LoanConditions', 'LoanSchedule',
  'BCA_GUARANTOR', 'BUT050', 'BKKN', 'BCA_DTI', 'DFKKOP', 'DFKKZP',
  'BCA_SECTOR', 'SectorExposureLimits', 'RegulatoryThresholds', 'ExposureLimits',
  'RegulatoryDocuments', 'RiskAssessments', 'AuditLog',
  'ContractAccounts', 'BCA_COLLATERAL', 'BCA_RISK_CLASS'
];

const DEMO_PARTNER = '30100003';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Banking Sentinel — Data Browser</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; font-size: 16px; }
  header { background: #1a1d2e; border-bottom: 2px solid #f59e0b; padding: 12px 20px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 18px; font-weight: 600; color: #f59e0b; letter-spacing: 0.05em; }
  header span { font-size: 14px; color: #64748b; }
  .tabs { display: flex; background: #1a1d2e; border-bottom: 1px solid #2d3148; }
  .tab { padding: 10px 24px; font-size: 15px; cursor: pointer; color: #64748b; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .tab:hover { color: #e2e8f0; }
  .tab.active { color: #f59e0b; border-bottom-color: #f59e0b; }
  .layout { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 220px; background: #12141f; border-right: 1px solid #2d3148; overflow-y: auto; flex-shrink: 0; }
  .sidebar-header { padding: 10px 14px; font-size: 12px; font-weight: 700; color: #475569; letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid #2d3148; }
  .entity-btn { display: block; width: 100%; text-align: left; padding: 8px 14px; font-size: 14px; color: #94a3b8; background: none; border: none; cursor: pointer; border-left: 2px solid transparent; transition: all 0.1s; }
  .entity-btn:hover { background: #1a1d2e; color: #e2e8f0; }
  .entity-btn.active { background: #1a1d2e; color: #f59e0b; border-left-color: #f59e0b; }
  .entity-btn .count { float: right; font-size: 12px; color: #475569; }
  .main { flex: 1; overflow: auto; padding: 16px; }
  .panel { display: none; height: 100%; }
  .panel.active { display: flex; flex-direction: column; height: 100%; }
  .data-area { flex: 1; overflow: auto; }
  .info-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-shrink: 0; }
  .info-bar h2 { font-size: 16px; font-weight: 600; color: #e2e8f0; }
  .badge { background: #1e3a5f; color: #60a5fa; font-size: 13px; padding: 2px 8px; border-radius: 10px; }
  .badge.green { background: #14532d; color: #4ade80; }
  .badge.yellow { background: #451a03; color: #f59e0b; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  thead { position: sticky; top: 0; z-index: 10; }
  th { background: #1a1d2e; color: #94a3b8; font-weight: 600; padding: 8px 12px; text-align: left; border-bottom: 1px solid #2d3148; white-space: nowrap; font-size: 13px; letter-spacing: 0.05em; }
  td { padding: 7px 12px; border-bottom: 1px solid #1e2235; color: #cbd5e1; vertical-align: top; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:hover td { background: #1a1d2e; }
  .null { color: #3d4461; font-style: italic; }
  .bool-true { color: #4ade80; }
  .bool-false { color: #f87171; }
  .empty { padding: 40px; text-align: center; color: #3d4461; font-size: 15px; }
  .loading { padding: 40px; text-align: center; color: #64748b; font-size: 15px; }
  .error { padding: 16px; background: #2d1515; border: 1px solid #7f1d1d; border-radius: 6px; color: #fca5a5; font-size: 15px; margin-bottom: 12px; }
  .pg-section { margin-bottom: 24px; }
  .pg-section h3 { font-size: 15px; color: #94a3b8; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid #2d3148; }
  .pg-section .purpose { font-size: 13px; color: #64748b; margin-bottom: 8px; font-style: italic; background: #12141f; padding: 6px 10px; border-left: 2px solid #2d3148; border-radius: 0 4px 4px 0; }
  .refresh-btn { padding: 5px 12px; background: #1e3a5f; color: #60a5fa; border: 1px solid #2563eb; border-radius: 4px; font-size: 14px; cursor: pointer; }
  .refresh-btn:hover { background: #2563eb; }
</style>
</head>
<body>

<header>
  <h1>⬡ BANKING SENTINEL — DATA BROWSER</h1>
  <span>HANA Cloud + PostgreSQL</span>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('hana')">HANA Cloud</div>
  <div class="tab" onclick="switchTab('pg')">PostgreSQL (LangGraph)</div>
  <div class="tab" onclick="switchTab('graph')">GraphDB (KGE)</div>
</div>

<div class="layout">

  <!-- HANA sidebar -->
  <div class="sidebar" id="hana-sidebar">
    <div class="sidebar-header">Tables</div>
    ${HANA_ENTITIES.map(e => `<button class="entity-btn" id="btn-${e}" onclick="loadHana('${e}')">${e}<span class="count" id="cnt-${e}"></span></button>`).join('\n    ')}
  </div>

  <!-- Main content -->
  <div class="main">

    <!-- HANA panel -->
    <div class="panel active" id="panel-hana">
      <div class="info-bar">
        <h2 id="hana-title">Select a table →</h2>
        <span class="badge" id="hana-badge" style="display:none"></span>
        <button class="refresh-btn" onclick="reloadHana()" style="display:none" id="hana-refresh">↻ Refresh</button>
      </div>
      <div class="data-area">
        <div class="empty" id="hana-empty">Select a table from the sidebar to browse data.</div>
        <div id="hana-loading" class="loading" style="display:none">Loading...</div>
        <div id="hana-error" class="error" style="display:none"></div>
        <div id="hana-table"></div>
      </div>
    </div>

    <!-- PostgreSQL panel -->
    <div class="panel" id="panel-pg">
      <div class="info-bar">
        <h2>PostgreSQL — LangGraph State Tables</h2>
        <button class="refresh-btn" onclick="loadPg()">↻ Refresh</button>
      </div>
      <div class="data-area">
        <div id="pg-loading" class="loading">Loading...</div>
        <div id="pg-error" class="error" style="display:none"></div>
        <div id="pg-content"></div>
      </div>
    </div>

    <!-- GraphDB KGE panel -->
    <div class="panel" id="panel-graph">
      <div class="info-bar">
        <h2>GraphDB — Knowledge Graph (KGE Equivalent)</h2>
        <button class="refresh-btn" onclick="loadGraph()">↻ Refresh</button>
      </div>
      <div class="data-area">
        <div id="graph-loading" class="loading">Loading...</div>
        <div id="graph-error" class="error" style="display:none"></div>
        <div id="graph-content"></div>
      </div>
    </div>

  </div>
</div>

<script>
let currentEntity = null;

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', (tab==='hana'&&i===0)||(tab==='pg'&&i===1)||(tab==='graph'&&i===2)));
  document.getElementById('hana-sidebar').style.display = tab === 'hana' ? 'block' : 'none';
  document.getElementById('panel-hana').classList.toggle('active', tab === 'hana');
  document.getElementById('panel-pg').classList.toggle('active', tab === 'pg');
  document.getElementById('panel-graph').classList.toggle('active', tab === 'graph');
  if (tab === 'pg') loadPg();
  if (tab === 'graph') loadGraph();
}

async function loadHana(entity) {
  currentEntity = entity;
  document.querySelectorAll('.entity-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + entity).classList.add('active');
  document.getElementById('hana-empty').style.display = 'none';
  document.getElementById('hana-loading').style.display = 'block';
  document.getElementById('hana-error').style.display = 'none';
  document.getElementById('hana-table').innerHTML = '';
  document.getElementById('hana-title').textContent = entity;
  document.getElementById('hana-refresh').style.display = 'inline';

  try {
    const r = await fetch('/admin/api/hana/' + entity);
    const d = await r.json();
    document.getElementById('hana-loading').style.display = 'none';
    if (d.error) {
      document.getElementById('hana-error').textContent = d.error;
      document.getElementById('hana-error').style.display = 'block';
      return;
    }
    const badge = document.getElementById('hana-badge');
    badge.textContent = d.count + ' rows';
    badge.className = 'badge ' + (d.count > 0 ? 'green' : '');
    badge.style.display = 'inline';
    document.getElementById('cnt-' + entity).textContent = d.count;
    document.getElementById('hana-table').innerHTML = renderTable(d.rows);
  } catch(e) {
    document.getElementById('hana-loading').style.display = 'none';
    document.getElementById('hana-error').textContent = e.message;
    document.getElementById('hana-error').style.display = 'block';
  }
}

function reloadHana() { if (currentEntity) loadHana(currentEntity); }

function renderTable(rows) {
  if (!rows || rows.length === 0) return '<div class="empty">No data in this table.</div>';
  const cols = Object.keys(rows[0]);
  const head = '<thead><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead>';
  const body = '<tbody>' + rows.map(row =>
    '<tr>' + cols.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return '<td class="null">null</td>';
      if (v === true) return '<td class="bool-true">true</td>';
      if (v === false) return '<td class="bool-false">false</td>';
      return '<td title="' + String(v).replace(/"/g,'&quot;') + '">' + String(v).substring(0,120) + '</td>';
    }).join('') + '</tr>'
  ).join('') + '</tbody>';
  return '<table>' + head + body + '</table>';
}

async function loadPg() {
  document.getElementById('pg-loading').style.display = 'block';
  document.getElementById('pg-error').style.display = 'none';
  document.getElementById('pg-content').innerHTML = '';
  try {
    const r = await fetch('/admin/api/pg');
    const d = await r.json();
    document.getElementById('pg-loading').style.display = 'none';
    if (d.error) {
      document.getElementById('pg-error').textContent = d.error;
      document.getElementById('pg-error').style.display = 'block';
      return;
    }
    const tables = Object.keys(d);
    if (tables.length === 0) {
      document.getElementById('pg-content').innerHTML = '<div class="empty">No tables found in PostgreSQL.</div>';
      return;
    }
    const TABLE_PURPOSE = {
      checkpoints:           'Full agent state snapshot saved after each LangGraph node completes. Keyed by thread_id + checkpoint_id. Used to resume interrupted workflows (e.g. human-in-the-loop approval across server restarts).',
      checkpoint_writes:     'Intermediate channel writes recorded during node execution before the checkpoint is finalised. Enables partial replay if a node crashes mid-run.',
      checkpoint_blobs:      'Large binary state values (e.g. embeddings, serialised objects) stored separately from the main checkpoint row to keep checkpoint queries fast.',
      checkpoint_migrations: 'Schema version tracking for PostgresSaver. Each row = one applied migration. Ensures setup() is idempotent across deployments.'
    };
    document.getElementById('pg-content').innerHTML = tables.map(t =>
      '<div class="pg-section">' +
      '<h3>' + t + ' <span style="color:#475569;font-size:11px;">(' + d[t].count + ' rows)</span></h3>' +
      (TABLE_PURPOSE[t] ? '<div class="purpose">' + TABLE_PURPOSE[t] + '</div>' : '') +
      renderTable(d[t].rows) +
      '</div>'
    ).join('');
  } catch(e) {
    document.getElementById('pg-loading').style.display = 'none';
    document.getElementById('pg-error').textContent = e.message;
    document.getElementById('pg-error').style.display = 'block';
  }
}

async function loadGraph() {
  document.getElementById('graph-loading').style.display = 'block';
  document.getElementById('graph-error').style.display = 'none';
  document.getElementById('graph-content').innerHTML = '';
  try {
    const r = await fetch('/admin/api/graph');
    const d = await r.json();
    document.getElementById('graph-loading').style.display = 'none';
    if (d.error) {
      document.getElementById('graph-error').textContent = d.error;
      document.getElementById('graph-error').style.display = 'block';
      return;
    }
    let html = '';

    // GraphDB status
    html += '<div class="pg-section"><h3>GraphDB Repository Status</h3>';
    html += '<div class="purpose">GraphDB (RDF triple store + SPARQL) — KGE equivalent for trial. Same SPARQL queries run on HANA KGE in production. Sandbox expires every 7 days — restore with: npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid</div>';
    html += renderTable([{
      'Endpoint':        d.endpoint,
      'Repository':      d.repository,
      'Total Triples':   d.tripleCount,
      'Partners (nodes)': d.partnerCount,
      'Relations (edges)': d.relationCount,
      'Status':          d.tripleCount > 0 ? 'LIVE' : 'EMPTY — run seed script'
    }]);
    html += '</div>';

    // SPARQL traversal
    html += '<div class="pg-section"><h3>Live SPARQL Traversal — Partner 30100003 (depth 6)</h3>';
    html += '<div class="purpose">SPARQL property path query on GraphDB. Finds all connected parties reachable from demo partner up to 6 hops. In production this query runs identically on HANA KGE. Twinkle 1: TrustCo Holdings discovered at hop 4.</div>';
    if (d.traversalError) {
      html += '<div class="error">' + d.traversalError + '</div>';
    } else if (d.traversal.length === 0) {
      html += '<div class="empty">No connected parties found — GraphDB may need re-seeding.</div>';
    } else {
      html += renderTable(d.traversal);
    }
    html += '</div>';

    // Sample triples
    html += '<div class="pg-section"><h3>Sample RDF Triples</h3>';
    html += '<div class="purpose">RDF triple store — every fact is stored as subject → predicate → object. BUT050 relationships become typed triples. BusinessPartners become RDF resources with properties.</div>';
    html += d.sampleTriples.length > 0 ? renderTable(d.sampleTriples) : '<div class="empty">No triples found.</div>';
    html += '</div>';

    document.getElementById('graph-content').innerHTML = html;
  } catch(e) {
    document.getElementById('graph-loading').style.display = 'none';
    document.getElementById('graph-error').textContent = e.message;
    document.getElementById('graph-error').style.display = 'block';
  }
}

// Load row counts for all entities on startup
async function loadCounts() {
  for (const entity of ${JSON.stringify(HANA_ENTITIES)}) {
    fetch('/admin/api/hana/' + entity)
      .then(r => r.json())
      .then(d => { if (d.count !== undefined) document.getElementById('cnt-' + entity).textContent = d.count; })
      .catch(() => {});
  }
}
loadCounts();
</script>
</body>
</html>`;

function mountAdminUI(app) {
  app.get('/admin', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    res.send(HTML);
  });

  app.get('/admin/api/hana/:entity', async (req, res) => {
    const entity = req.params.entity;
    if (!HANA_ENTITIES.includes(entity)) return res.status(400).json({ error: 'Unknown entity: ' + entity });
    try {
      const rows = await cds.run(SELECT.from(`bankingsentinel.${entity}`).limit(200));
      const clean = rows.map(r => {
        if (r.EMBEDDING) r.EMBEDDING = '[vector — ' + (r.EMBEDDING.length) + ' chars]';
        return r;
      });
      res.json({ count: clean.length, rows: clean });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/admin/api/graph', async (req, res) => {
    const endpoint   = process.env.GRAPHDB_ENDPOINT;
    const repository = process.env.GRAPHDB_REPOSITORY;
    const auth = Buffer.from(`${process.env.GRAPHDB_USERNAME}:${process.env.GRAPHDB_PASSWORD}`).toString('base64');
    const BASE_URI = 'urn:banking-sentinel:';

    const sparql = async (query) => {
      const r = await fetch(`${endpoint}/repositories/${repository}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json', 'Authorization': `Basic ${auth}` },
        body: query
      });
      if (!r.ok) throw new Error(`GraphDB ${r.status}: ${(await r.text()).substring(0, 200)}`);
      return r.json();
    };

    try {
      // Triple count
      const countResult = await sparql(`SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }`);
      const tripleCount = countResult.results.bindings[0]?.n?.value || 0;

      // Partner count
      const partnerResult = await sparql(`PREFIX bs: <${BASE_URI}> SELECT (COUNT(?p) AS ?n) WHERE { ?p bs:type bs:BusinessPartner }`);
      const partnerCount = partnerResult.results.bindings[0]?.n?.value || 0;

      // Relation count
      const relResult = await sparql(`PREFIX bs: <${BASE_URI}> SELECT (COUNT(*) AS ?n) WHERE { ?s bs:relatedTo ?o }`);
      const relationCount = relResult.results.bindings[0]?.n?.value || 0;

      // SPARQL traversal from demo partner (depth 6)
      let traversal = [], traversalError = null;
      try {
        const hopClauses = [];
        let path = 'bs:relatedTo';
        for (let h = 1; h <= 6; h++) {
          hopClauses.push(`{ <${BASE_URI}partner/${DEMO_PARTNER}> ${path} ?node . BIND(${h} AS ?hop) }`);
          path += '/bs:relatedTo';
        }
        const tResult = await sparql(`
          PREFIX bs: <${BASE_URI}>
          SELECT ?partnerId (MIN(?hop) AS ?minHop) ?reltyp WHERE {
            ${hopClauses.join('\n            UNION\n            ')}
            ?node bs:partnerId ?partnerId .
            OPTIONAL {
              <${BASE_URI}partner/${DEMO_PARTNER}> ?rel ?node .
              FILTER(STRSTARTS(STR(?rel), "${BASE_URI}relatedTo/"))
              BIND(STRAFTER(STR(?rel), "relatedTo/") AS ?reltyp)
            }
            FILTER(?partnerId != "${DEMO_PARTNER}")
          }
          GROUP BY ?partnerId ?reltyp
        `);
        traversal = tResult.results.bindings.map(b => ({
          PARTNER:   b.partnerId.value,
          REL_TYPE:  b.reltyp?.value || 'RELATED',
          HOP:       parseInt(b.minHop.value)
        })).sort((a, b) => a.HOP - b.HOP);
      } catch (e) { traversalError = e.message.substring(0, 300); }

      // Sample triples
      const sampleResult = await sparql(`
        PREFIX bs: <${BASE_URI}>
        SELECT ?subject ?predicate ?object WHERE {
          ?subject bs:relatedTo ?object .
          ?subject bs:partnerId ?s .
          ?object  bs:partnerId ?o .
          BIND(STRAFTER(STR(?subject), "partner/") AS ?subject)
          BIND("relatedTo" AS ?predicate)
          BIND(STRAFTER(STR(?object), "partner/") AS ?object)
        } LIMIT 15
      `).catch(() => ({ results: { bindings: [] } }));
      const sampleTriples = sampleResult.results.bindings.map(b => ({
        Subject:   b.subject.value,
        Predicate: b.predicate.value,
        Object:    b.object.value
      }));

      res.json({ endpoint, repository, tripleCount, partnerCount, relationCount, traversal, traversalError, sampleTriples });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/admin/api/pg', async (req, res) => {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.POSTGRES_URL, connectionTimeoutMillis: 5000 });
      const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'checkpoint%' ORDER BY table_name`);
      const results = {};
      for (const t of tables.rows) {
        const r = await pool.query(`SELECT * FROM "${t.table_name}" LIMIT 50`);
        results[t.table_name] = { count: r.rowCount, rows: r.rows };
      }
      await pool.end();
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('  [Admin] Data browser: GET /admin');
}

module.exports = { mountAdminUI };
