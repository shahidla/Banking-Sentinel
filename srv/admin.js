'use strict';
const cds = require('@sap/cds');

const HANA_ENTITIES = [
  'BusinessPartners', 'BUT050', 'Loans', 'LoanSchedule',
  'BCA_GUARANTOR', 'BCA_COLLATERAL', 'BCA_DTI', 'BCA_CREDIT_HISTORY', 'DFKKOP', 'DFKKOPK',
  'BCA_SECTOR', 'SectorExposureLimits', 'RegulatoryThresholds', 'ExposureLimits',
  'RegulatoryDocuments', 'RiskAssessments', 'AuditLog'
];

const DEMO_PARTNER = '30100003';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Banking Sentinel — Data Browser</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  /* 21 — Improved color tokens */
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e5e7eb; height: 100vh; display: flex; flex-direction: column; font-size: 16px; }
  /* 30 — Header: normal case, accent on interactive only */
  header { background: #1a1d2e; border-bottom: 1px solid #2b3145; padding: 12px 20px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 16px; font-weight: 600; color: #e5e7eb; letter-spacing: 0; }
  header span { font-size: 13px; color: #94a3b8; }
  /* 24 — Tab nav clarity */
  .tabs { display: flex; background: #1a1d2e; border-bottom: 1px solid #2b3145; }
  .tab { padding: 10px 24px; font-size: 14px; cursor: pointer; color: #94a3b8; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .tab:hover { color: #e5e7eb; }
  .tab.active { color: #60a5fa; border-bottom-color: #60a5fa; font-weight: 700; }
  /* 27 — Focus styles */
  button:focus-visible, .tab:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
  .layout { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 220px; background: #12141f; border-right: 1px solid #2b3145; overflow-y: auto; flex-shrink: 0; display: flex; flex-direction: column; }
  .sidebar-header { padding: 10px 14px; font-size: 11px; font-weight: 700; color: #a3b1c6; letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid #2b3145; flex-shrink: 0; }
  .sidebar-tables { flex: 1; overflow-y: auto; }
  .sidebar-actions { padding: 8px 10px; border-top: 1px solid #2b3145; flex-shrink: 0; }
  .btn-clear-all { width: 100%; padding: 6px 10px; background: #3d1515; color: #fca5a5; border: 1px solid #7f1d1d; font-size: 12px; cursor: pointer; text-align: left; border-radius: 3px; }
  .btn-clear-all:hover { background: #7f1d1d; }
  .entity-btn { display: block; width: 100%; text-align: left; padding: 8px 14px; font-size: 13px; color: #94a3b8; background: none; border: none; cursor: pointer; border-left: 2px solid transparent; transition: all 0.1s; }
  .entity-btn:hover { background: #20263a; color: #e5e7eb; }
  /* 24 — Active nav clarity */
  .entity-btn.active { background: #20263a; color: #60a5fa; border-left-color: #60a5fa; font-weight: 600; }
  .entity-btn .count { float: right; font-size: 11px; color: #a3b1c6; }
  .entity-btn .clr { float: right; font-size: 10px; color: #7f1d1d; margin-right: 6px; opacity: 0; transition: opacity 0.1s; }
  .entity-btn:hover .clr { opacity: 1; }
  .main { flex: 1; overflow: auto; padding: 16px; }
  .panel { display: none; height: 100%; }
  .panel.active { display: flex; flex-direction: column; height: 100%; }
  .data-area { flex: 1; overflow: auto; }
  /* 25 — Sticky context bar */
  .context-bar { position: sticky; top: 0; z-index: 20; background: #111827; border: 1px solid #2b3145; padding: 7px 12px; margin-bottom: 12px; display: flex; gap: 20px; flex-shrink: 0; border-radius: 3px; }
  .context-field { display: flex; flex-direction: column; gap: 1px; }
  .context-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #a3b1c6; }
  .context-value { font-size: 12px; color: #e5e7eb; font-variant-numeric: tabular-nums; }
  .info-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-shrink: 0; }
  .info-bar h2 { font-size: 15px; font-weight: 600; color: #e5e7eb; }
  /* 23 — Semantic badges */
  .badge { background: #1e3a5f; color: #60a5fa; font-size: 12px; padding: 2px 8px; border-radius: 10px; }
  .badge.green  { background: #14532d; color: #4ade80; }
  .badge.yellow { background: #451a03; color: #f59e0b; }
  .badge.low      { background: #163a2b; color: #86efac; }
  .badge.medium   { background: #3a2f16; color: #fcd34d; }
  .badge.high     { background: #3a1f16; color: #fb923c; }
  .badge.critical { background: #3f1a1a; color: #fca5a5; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead { position: sticky; top: 0; z-index: 10; }
  /* 22 — Table readability */
  th { background: #1a1d2e; color: #94a3b8; font-weight: 600; padding: 10px 14px; text-align: left; border-bottom: 1px solid #2b3145; white-space: nowrap; font-size: 12px; letter-spacing: 0.05em; }
  td { padding: 10px 14px; border-bottom: 1px solid #2b3145; color: #cbd5e1; vertical-align: top; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.45; }
  /* 22 — Zebra rows */
  tbody tr:nth-child(even) td { background: #151a28; }
  tr:hover td { background: #20263a !important; }
  /* 29 — Numeric column alignment */
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .null { color: #3d4461; font-style: italic; }
  .bool-true { color: #4ade80; }
  .bool-false { color: #f87171; }
  .empty { padding: 40px; text-align: center; color: #3d4461; font-size: 14px; }
  .loading { padding: 40px; text-align: center; color: #94a3b8; font-size: 14px; }
  /* 28 — Actionable error states */
  .error { padding: 14px 16px; background: #2d1515; border: 1px solid #7f1d1d; border-radius: 6px; color: #fca5a5; font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .error-msg { flex: 1; }
  .error-retry { padding: 4px 12px; background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; border-radius: 3px; font-size: 12px; cursor: pointer; white-space: nowrap; }
  .error-retry:hover { background: #991b1b; }
  .pg-section { margin-bottom: 24px; }
  .pg-section h3 { font-size: 14px; color: #94a3b8; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid #2b3145; }
  .pg-section .purpose { font-size: 12px; color: #94a3b8; margin-bottom: 8px; font-style: italic; background: #12141f; padding: 6px 10px; border-left: 2px solid #2b3145; border-radius: 0 4px 4px 0; }
  .refresh-btn { padding: 5px 12px; background: #1e3a5f; color: #60a5fa; border: 1px solid #2563eb; border-radius: 4px; font-size: 13px; cursor: pointer; }
  .refresh-btn:hover { background: #2563eb; }
</style>
</head>
<body>

<header>
  <h1>Banking Sentinel — Data Browser</h1>
  <span>HANA Cloud · PostgreSQL · GraphDB</span>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('hana')">HANA Cloud</div>
  <div class="tab" onclick="switchTab('pg')">PostgreSQL (LangGraph)</div>
  <div class="tab" onclick="switchTab('graph')">GraphDB (KGE)</div>
  <div class="tab" onclick="switchTab('sessions')">Pipeline Sessions</div>
</div>

<div class="layout">

  <!-- HANA sidebar -->
  <div class="sidebar" id="hana-sidebar">
    <div class="sidebar-header">Tables</div>
    <div class="sidebar-tables">
      ${HANA_ENTITIES.map(e => `<button class="entity-btn" id="btn-${e}" onclick="loadHana('${e}')">${e}<span class="count" id="cnt-${e}"></span></button>`).join('\n      ')}
    </div>
  </div>

  <!-- Postgres sidebar -->
  <div class="sidebar" id="pg-sidebar" style="display:none;">
    <div class="sidebar-header">Tables</div>
    <div class="sidebar-tables" id="pg-table-list">
      <div style="padding:14px;font-size:13px;color:#94a3b8;">Loading...</div>
    </div>
    <div class="sidebar-actions">
      <button class="btn-clear-all" onclick="clearAllPg()">✕ Clear All Checkpoints</button>
    </div>
  </div>

  <!-- Main content -->
  <div class="main">

    <!-- HANA panel -->
    <div class="panel active" id="panel-hana">
      <div class="context-bar">
        <div class="context-field"><span class="context-label">Engine</span><span class="context-value">SAP HANA Cloud</span></div>
        <div class="context-field"><span class="context-label">Table</span><span class="context-value" id="ctx-hana-table">—</span></div>
        <div class="context-field"><span class="context-label">Rows</span><span class="context-value" id="ctx-hana-rows">—</span></div>
        <div class="context-field"><span class="context-label">Last loaded</span><span class="context-value" id="ctx-hana-time">—</span></div>
      </div>
      <div class="info-bar">
        <h2 id="hana-title">Select a table →</h2>
        <span class="badge" id="hana-badge" style="display:none"></span>
        <button class="refresh-btn" onclick="reloadHana()" style="display:none" id="hana-refresh">↻ Refresh</button>
      </div>
      <div class="data-area">
        <div class="empty" id="hana-empty">Select a table from the sidebar to browse data.</div>
        <div id="hana-loading" class="loading" style="display:none">Loading...</div>
        <div id="hana-error" class="error" style="display:none"><span class="error-msg"></span><button class="error-retry" onclick="reloadHana()">Retry</button></div>
        <div id="hana-table"></div>
      </div>
    </div>

    <!-- PostgreSQL panel -->
    <div class="panel" id="panel-pg">
      <div class="context-bar">
        <div class="context-field"><span class="context-label">Engine</span><span class="context-value">PostgreSQL (LangGraph)</span></div>
        <div class="context-field"><span class="context-label">Table</span><span class="context-value" id="ctx-pg-table">—</span></div>
        <div class="context-field"><span class="context-label">Rows</span><span class="context-value" id="ctx-pg-rows">—</span></div>
        <div class="context-field"><span class="context-label">Last loaded</span><span class="context-value" id="ctx-pg-time">—</span></div>
      </div>
      <div class="info-bar">
        <h2 id="pg-title">Select a table →</h2>
        <span class="badge" id="pg-badge" style="display:none"></span>
        <button class="refresh-btn" onclick="reloadPg()" style="display:none" id="pg-refresh">↻ Refresh</button>
      </div>
      <div class="data-area">
        <div class="empty" id="pg-empty">Select a table from the sidebar to view its data.</div>
        <div id="pg-loading" class="loading" style="display:none">Loading...</div>
        <div id="pg-error" class="error" style="display:none"><span class="error-msg"></span><button class="error-retry" onclick="reloadPg()">Reload tables</button></div>
        <div id="pg-content"></div>
      </div>
    </div>

    <!-- GraphDB KGE panel -->
    <div class="panel" id="panel-graph">
      <div class="context-bar">
        <div class="context-field"><span class="context-label">Engine</span><span class="context-value">GraphDB (SPARQL/RDF)</span></div>
        <div class="context-field"><span class="context-label">Triples</span><span class="context-value" id="ctx-graph-triples">—</span></div>
        <div class="context-field"><span class="context-label">Partners</span><span class="context-value" id="ctx-graph-partners">—</span></div>
        <div class="context-field"><span class="context-label">Relations</span><span class="context-value" id="ctx-graph-relations">—</span></div>
      </div>
      <div class="info-bar">
        <h2>GraphDB — Knowledge Graph (KGE equivalent)</h2>
        <button class="refresh-btn" onclick="loadGraph()">↻ Refresh</button>
      </div>
      <div class="data-area">
        <div id="graph-loading" class="loading">Loading...</div>
        <div id="graph-error" class="error" style="display:none"><span class="error-msg"></span><button class="error-retry" onclick="loadGraph()">Retry SPARQL</button></div>
        <div id="graph-content"></div>
      </div>
    </div>

    <!-- Sessions panel -->
    <div class="panel" id="panel-sessions">
      <div class="context-bar">
        <div class="context-field"><span class="context-label">Source</span><span class="context-value">HANA · RiskAssessments</span></div>
        <div class="context-field"><span class="context-label">Runs</span><span class="context-value" id="ctx-sessions-count">—</span></div>
        <div class="context-field"><span class="context-label">Last loaded</span><span class="context-value" id="ctx-sessions-time">—</span></div>
        <button class="refresh-btn" onclick="loadSessions()" style="margin-left:auto">↺ Refresh</button>
      </div>
      <div class="data-area">
        <div id="sessions-loading" class="loading">Loading pipeline runs...</div>
        <div id="sessions-error" class="error" style="display:none"><span class="error-msg"></span><button class="error-retry" onclick="loadSessions()">Retry</button></div>
        <div id="sessions-content"></div>
      </div>
    </div>

  </div>
</div>

<script>
let currentEntity = null;

function switchTab(tab) {
  const tabs = ['hana','pg','graph','sessions'];
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', tabs[i] === tab));
  document.getElementById('hana-sidebar').style.display = tab === 'hana' ? 'flex' : 'none';
  document.getElementById('pg-sidebar').style.display   = tab === 'pg'   ? 'flex' : 'none';
  document.getElementById('panel-hana').classList.toggle('active', tab === 'hana');
  document.getElementById('panel-pg').classList.toggle('active', tab === 'pg');
  document.getElementById('panel-graph').classList.toggle('active', tab === 'graph');
  document.getElementById('panel-sessions').classList.toggle('active', tab === 'sessions');
  if (tab === 'pg') loadPgSidebar();
  if (tab === 'graph') loadGraph();
  if (tab === 'sessions') loadSessions();
}

async function loadSessions() {
  document.getElementById('sessions-loading').style.display = 'block';
  document.getElementById('sessions-error').style.display   = 'none';
  document.getElementById('sessions-content').innerHTML     = '';
  try {
    const res  = await fetch('/admin/api/sessions');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);

    document.getElementById('ctx-sessions-count').textContent = data.length + ' runs';
    document.getElementById('ctx-sessions-time').textContent  = new Date().toLocaleTimeString();
    document.getElementById('sessions-loading').style.display = 'none';

    if (!data.length) {
      document.getElementById('sessions-content').innerHTML = '<div class="empty">No pipeline runs recorded yet. Run a risk analysis from the main UI.</div>';
      return;
    }

    const levelColor = { CRITICAL:'#fca5a5', HIGH:'#fca5a5', MEDIUM:'#fcd34d', LOW:'#4ade80' };

    // Group by partner for easy before/after comparison
    const byPartner = {};
    data.forEach(r => {
      if (!byPartner[r.PARTNER]) byPartner[r.PARTNER] = [];
      byPartner[r.PARTNER].push(r);
    });

    let html = '';
    for (const [partner, runs] of Object.entries(byPartner)) {
      html += \`<div style="margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;padding:8px 0 6px;border-bottom:1px solid #2b3145;margin-bottom:8px">
          Customer · \${partner} &nbsp;·&nbsp; \${runs.length} run\${runs.length !== 1 ? 's' : ''}
        </div>
        <table><thead><tr>
          <th>Risk Level</th><th>Score</th><th>Confidence</th><th>Cost (AUD)</th><th>Latency</th><th>Tokens</th><th>Approved By</th><th>Run At</th><th>Session ID</th><th></th>
        </tr></thead><tbody>\`;
      runs.forEach(r => {
        const col   = levelColor[r.RISK_LEVEL] || '#94a3b8';
        const conf  = r.CONFIDENCE != null ? Math.round(r.CONFIDENCE * 100) + '%' : '—';
        const ts    = r.CREATED_AT ? new Date(r.CREATED_AT).toLocaleString() : '—';
        const sid   = r.SESSION_ID || '';
        const cost  = r.COST_AUD   ? 'AUD ' + Number(r.COST_AUD).toFixed(4) : '—';
        const lat   = r.LATENCY_MS ? Math.round(r.LATENCY_MS / 1000) + 's'  : '—';
        const tIn   = r.TOKENS_IN  || 0;
        const tOut  = r.TOKENS_OUT || 0;
        const tok   = (tIn || tOut)
          ? \`<span title="\${tIn.toLocaleString()} in / \${tOut.toLocaleString()} out">\${(tIn + tOut).toLocaleString()}</span>\`
          : '—';
        html += \`<tr>
          <td><span style="color:\${col};font-weight:700">\${r.RISK_LEVEL || '—'}</span></td>
          <td class="num">\${r.RISK_SCORE ?? '—'}</td>
          <td class="num">\${conf}</td>
          <td class="num" style="color:#4ade80">\${cost}</td>
          <td class="num">\${lat}</td>
          <td class="num" style="font-size:11px">\${tok}</td>
          <td>\${r.APPROVED_BY || '—'}</td>
          <td>\${ts}</td>
          <td style="font-family:monospace;font-size:10px;color:#94a3b8;word-break:break-all">\${sid}</td>
          <td style="display:flex;gap:6px;flex-wrap:nowrap">
            <button onclick="window.open('/explain/\${sid}','_blank','noopener')" style="padding:4px 10px;background:#1e3a5f;color:#60a5fa;border:1px solid #2563eb;border-radius:3px;font-size:12px;cursor:pointer;white-space:nowrap">View Report ↗</button>
            <button onclick="deleteSession('\${sid}',this)" style="padding:4px 10px;background:#3d1515;color:#fca5a5;border:1px solid #7f1d1d;border-radius:3px;font-size:12px;cursor:pointer">✕</button>
          </td>
        </tr>\`;
      });
      html += '</tbody></table></div>';
    }
    document.getElementById('sessions-content').innerHTML = html;
  } catch (err) {
    document.getElementById('sessions-loading').style.display = 'none';
    document.getElementById('sessions-error').style.display   = 'flex';
    document.getElementById('sessions-error').querySelector('.error-msg').textContent = err.message;
  }
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
      document.getElementById('hana-error').querySelector('.error-msg').textContent = d.error;
      document.getElementById('hana-error').style.display = 'flex';
      return;
    }
    const badge = document.getElementById('hana-badge');
    badge.textContent = d.count + ' rows';
    badge.className = 'badge ' + (d.count > 0 ? 'green' : '');
    badge.style.display = 'inline';
    document.getElementById('cnt-' + entity).textContent = d.count;
    document.getElementById('ctx-hana-table').textContent = entity;
    document.getElementById('ctx-hana-rows').textContent  = d.count.toLocaleString();
    document.getElementById('ctx-hana-time').textContent  = new Date().toLocaleTimeString();
    document.getElementById('hana-table').innerHTML = renderTable(d.rows);
  } catch(e) {
    document.getElementById('hana-loading').style.display = 'none';
    document.getElementById('hana-error').querySelector('.error-msg').textContent = e.message;
    document.getElementById('hana-error').style.display = 'flex';
  }
}

async function deleteSession(sessionId, btn) {
  if (!confirm('Delete session ' + sessionId + '?')) return;
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch('/admin/api/sessions/' + sessionId, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    btn.closest('tr').remove();
  } catch (e) {
    btn.disabled = false; btn.textContent = '✕';
    alert('Delete failed: ' + e.message);
  }
}

function reloadHana() { if (currentEntity) loadHana(currentEntity); }

const NUMERIC_COL_RE = /COUNT|AMOUNT|TOTAL|PCT|RISK_SCORE|LIMIT|EXPOSURE|DTI|BALANCE|RATE/i;
function renderTable(rows) {
  if (!rows || rows.length === 0) return '<div class="empty">No data in this table.</div>';
  const cols = Object.keys(rows[0]);
  const head = '<thead><tr>' + cols.map(c => '<th' + (NUMERIC_COL_RE.test(c) ? ' class="num"' : '') + '>' + c + '</th>').join('') + '</tr></thead>';
  const body = '<tbody>' + rows.map(row =>
    '<tr>' + cols.map(c => {
      const v = row[c];
      const numCls = NUMERIC_COL_RE.test(c) ? ' class="num"' : '';
      if (v === null || v === undefined) return '<td class="null">N/A</td>';
      if (v === true)  return '<td' + numCls + ' class="bool-true">true</td>';
      if (v === false) return '<td' + numCls + ' class="bool-false">false</td>';
      return '<td' + numCls + ' title="' + String(v).replace(/"/g,'&quot;') + '">' + String(v).substring(0,120) + '</td>';
    }).join('') + '</tr>'
  ).join('') + '</tbody>';
  return '<table>' + head + body + '</table>';
}

let currentPgTable = null;

async function loadPgSidebar() {
  try {
    const r = await fetch('/admin/api/pg');
    const d = await r.json();
    if (d.error) { document.getElementById('pg-table-list').innerHTML = '<div style="padding:14px;color:#fca5a5;font-size:12px;">' + d.error + '</div>'; return; }
    const tables = Object.keys(d);
    document.getElementById('pg-table-list').innerHTML = tables.map(t =>
      '<button class="entity-btn" id="pgbtn-' + t + '" data-table="' + t + '">' + t +
      (t !== 'checkpoint_migrations' ? '<span class="clr" data-table="' + t + '">✕</span>' : '') +
      '<span class="count" id="pgcnt-' + t + '">' + d[t].count + '</span></button>'
    ).join('');
    document.querySelectorAll('#pg-table-list .entity-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { loadPgTable(btn.dataset.table); });
      var clr = btn.querySelector('.clr');
      if (clr) clr.addEventListener('click', function(e) { e.stopPropagation(); clearPgTable(e, btn.dataset.table); });
    });
  } catch(e) {
    document.getElementById('pg-table-list').innerHTML = '<div style="padding:14px;color:#fca5a5;font-size:12px;">' + e.message + '</div>';
  }
}

async function loadPgTable(table) {
  currentPgTable = table;
  document.querySelectorAll('[id^="pgbtn-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('pgbtn-' + table);
  if (btn) btn.classList.add('active');
  document.getElementById('pg-title').textContent = table;
  document.getElementById('pg-empty').style.display = 'none';
  document.getElementById('pg-loading').style.display = 'block';
  document.getElementById('pg-error').style.display = 'none';
  document.getElementById('pg-content').innerHTML = '';
  document.getElementById('pg-refresh').style.display = 'inline';
  try {
    const r = await fetch('/admin/api/pg');
    const d = await r.json();
    document.getElementById('pg-loading').style.display = 'none';
    if (d.error) {
      document.getElementById('pg-error').querySelector('.error-msg').textContent = d.error;
      document.getElementById('pg-error').style.display = 'flex';
      return;
    }
    const td = d[table];
    if (!td) { document.getElementById('pg-content').innerHTML = '<div class="empty">Table not found.</div>'; return; }
    const badge = document.getElementById('pg-badge');
    badge.textContent = td.count + ' rows';
    badge.className = 'badge ' + (td.count > 0 ? 'green' : '');
    badge.style.display = 'inline';
    document.getElementById('ctx-pg-table').textContent = table;
    document.getElementById('ctx-pg-rows').textContent  = td.count.toLocaleString();
    document.getElementById('ctx-pg-time').textContent  = new Date().toLocaleTimeString();
    document.getElementById('pg-content').innerHTML = td.rows.length === 0
      ? '<div class="empty">No data in this table.</div>'
      : renderTable(td.rows);
  } catch(e) {
    document.getElementById('pg-loading').style.display = 'none';
    document.getElementById('pg-error').querySelector('.error-msg').textContent = e.message;
    document.getElementById('pg-error').style.display = 'flex';
  }
}

function reloadPg() { if (currentPgTable) loadPgTable(currentPgTable); }

async function clearPgTable(evt, table) {
  evt.stopPropagation();
  if (!confirm('Clear all rows from "' + table + '"?')) return;
  try {
    await fetch('/admin/api/pg/clear/' + table, { method: 'DELETE' });
    await loadPgSidebar();
    if (currentPgTable === table) loadPgTable(table);
  } catch(e) { alert(e.message); }
}

async function clearAllPg() {
  if (!confirm('Clear all checkpoint data? This cannot be undone.')) return;
  try {
    await fetch('/admin/api/pg/clear', { method: 'DELETE' });
    await loadPgSidebar();
    if (currentPgTable) loadPgTable(currentPgTable);
  } catch(e) { alert(e.message); }
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
      document.getElementById('graph-error').querySelector('.error-msg').textContent = d.error;
      document.getElementById('graph-error').style.display = 'flex';
      return;
    }
    document.getElementById('ctx-graph-triples').textContent   = Number(d.tripleCount).toLocaleString();
    document.getElementById('ctx-graph-partners').textContent  = d.partnerCount;
    document.getElementById('ctx-graph-relations').textContent = d.relationCount;
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
    html += '<div class="purpose">SPARQL property path query on GraphDB. Finds all connected parties reachable from demo partner up to 6 hops. In production this query runs identically on HANA KGE. Demo: TrustCo Holdings discovered at hop 4.</div>';
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
    document.getElementById('graph-loading').style.display = 'none';
    document.getElementById('graph-error').querySelector('.error-msg').textContent = e.message;
    document.getElementById('graph-error').style.display = 'flex';
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

// Auto-switch tab from URL param, e.g. /admin?tab=sessions
const urlTab = new URLSearchParams(window.location.search).get('tab');
if (urlTab) switchTab(urlTab);
</script>
</body>
</html>`;

// Restrict all /admin routes to localhost + optionally an ADMIN_TOKEN in env
// ADMIN_IP_WHITELIST=disabled bypasses the check for demo/CF deployments
function adminGuard(req, res, next) {
  if ((process.env.ADMIN_IP_WHITELIST || '').toLowerCase() === 'disabled') return next();
  const ip = req.ip || req.connection.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const token = process.env.ADMIN_TOKEN;
  if (token) {
    const provided = (req.headers['x-admin-token'] || req.query.token || '').trim();
    if (provided !== token) return res.status(401).json({ error: 'Unauthorized' });
  } else if (!isLocal) {
    return res.status(403).json({ error: 'Admin only accessible from localhost' });
  }
  next();
}

function mountAdminUI(app) {
  app.use('/admin', adminGuard);

  app.get('/admin', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    res.send(HTML);
  });

  app.get('/admin/api/hana/:entity', async (req, res) => {
    const entity = req.params.entity;
    if (!HANA_ENTITIES.includes(entity)) return res.status(400).json({ error: 'Unknown entity: ' + entity });
    try {
      const [rows, countResult] = await Promise.all([
        cds.run(SELECT.from(`bankingsentinel.${entity}`).limit(200)),
        cds.run(SELECT.one.from(`bankingsentinel.${entity}`).columns('count(*) as n'))
      ]);
      const totalCount = parseInt(countResult?.n ?? rows.length);
      const clean = rows.map(r => {
        if (r.EMBEDDING) r.EMBEDDING = '[vector — ' + (r.EMBEDDING.length) + ' chars]';
        return r;
      });
      res.json({ count: totalCount, rows: clean });
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

  const { Pool } = require('pg');
  const pgPool = process.env.POSTGRES_URL
    ? new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 })
    : null;
  const PG_TABLES = ['checkpoint_migrations', 'checkpoints', 'checkpoint_blobs', 'checkpoint_writes'];

  app.get('/admin/api/pg', async (req, res) => {
    if (!pgPool) return res.status(500).json({ error: 'POSTGRES_URL not configured' });
    try {
      const results = {};
      for (const t of PG_TABLES) {
        try {
          const [rows, cnt] = await Promise.all([
            pgPool.query(`SELECT * FROM "${t}" ORDER BY 1 LIMIT 50`),
            pgPool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
          ]);
          results[t] = { count: cnt.rows[0].n, rows: rows.rows };
        } catch { results[t] = { count: 0, rows: [] }; }
      }
      res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/admin/api/pg/clear/:table', async (req, res) => {
    if (!pgPool) return res.status(500).json({ error: 'POSTGRES_URL not configured' });
    const table = req.params.table;
    if (!PG_TABLES.includes(table)) return res.status(400).json({ error: 'Table not allowed' });
    if (table === 'checkpoint_migrations') return res.status(400).json({ error: 'Cannot clear migrations table' });
    try { await pgPool.query(`TRUNCATE "${table}"`); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/admin/api/pg/clear', async (req, res) => {
    if (!pgPool) return res.status(500).json({ error: 'POSTGRES_URL not configured' });
    try { await pgPool.query(`TRUNCATE checkpoints, checkpoint_blobs, checkpoint_writes`); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Sessions — all pipeline runs from RiskAssessments + cost/latency from AuditLog
  app.get('/admin/api/sessions', async (req, res) => {
    try {
      const rows = await cds.run(
        SELECT.from('bankingsentinel.RiskAssessments').orderBy('CREATED_AT desc')
      );
      // Enrich with cost + latency from AuditLog (one row per session)
      let auditMap = {};
      try {
        const audit = await cds.run(
          SELECT.from('bankingsentinel.AuditLog')
            .columns('SESSION_ID', 'COST_AUD', 'LATENCY_MS', 'TOKENS_IN', 'TOKENS_OUT')
        );
        audit.forEach(a => {
          if (!auditMap[a.SESSION_ID]) auditMap[a.SESSION_ID] = { COST_AUD: 0, LATENCY_MS: 0, TOKENS_IN: 0, TOKENS_OUT: 0 };
          auditMap[a.SESSION_ID].COST_AUD    += parseFloat(a.COST_AUD  || 0);
          auditMap[a.SESSION_ID].LATENCY_MS  += parseInt(a.LATENCY_MS  || 0);
          auditMap[a.SESSION_ID].TOKENS_IN   += parseInt(a.TOKENS_IN   || 0);
          auditMap[a.SESSION_ID].TOKENS_OUT  += parseInt(a.TOKENS_OUT  || 0);
        });
      } catch (_) {}
      const enriched = rows.map(r => ({ ...r, ...(auditMap[r.SESSION_ID] || {}) }));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Delete a single session from RiskAssessments + AuditLog
  app.delete('/admin/api/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
      await cds.run(DELETE.from('bankingsentinel.RiskAssessments').where({ SESSION_ID: sessionId }));
      await cds.run(DELETE.from('bankingsentinel.AuditLog').where({ SESSION_ID: sessionId }));
      res.json({ ok: true, sessionId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('  [Admin] Data browser: GET /admin');
}

module.exports = { mountAdminUI };
