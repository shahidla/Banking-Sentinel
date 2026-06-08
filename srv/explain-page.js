'use strict';
// Banking Sentinel — Evidence Explanation Page
// Served at GET /explain/:sessionId
// Self-contained HTML; connects to SSE at /api/explain-stream/:sessionId

function renderExplainPage(sessionId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banking Sentinel — Evidence Trail</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --dark:#0f1117;--mid:#4A4A4A;--light:#767676;--border:#e2e6ea;
    --bg:#f0f2f5;--white:#ffffff;
    --green:#0D7A3E;--green-bg:rgba(13,122,62,0.08);
    --red:#D42020;  --red-bg:rgba(212,32,32,0.08);
    --amber:#C47A00;--amber-bg:rgba(196,122,0,0.08);
    --blue:#1A56DB; --yellow:#FFD000;
    --mono:'Courier New',monospace;--sans:'Segoe UI',system-ui,sans-serif;
  }
  body{font-family:var(--sans);background:var(--bg);color:var(--dark);font-size:14px;line-height:1.6}
  /* Header */
  header{background:var(--dark);color:white;padding:16px 32px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}
  .hdr-left h1{font-size:16px;font-weight:700;letter-spacing:-0.3px}
  .hdr-left .sub{font-family:var(--mono);font-size:10px;color:rgba(255,255,255,0.45);letter-spacing:1.5px;text-transform:uppercase;margin-top:3px}
  .hdr-right{display:flex;gap:10px;align-items:center}
  .badge-level{font-family:var(--mono);font-size:11px;padding:4px 10px;border-radius:2px;font-weight:700;letter-spacing:0.5px}
  .badge-level.critical{background:#3f1a1a;color:#fca5a5}
  .badge-level.high    {background:#3a1f16;color:#fb923c}
  .badge-level.medium  {background:#3a2f16;color:#fcd34d}
  .badge-level.low     {background:#163a2b;color:#86efac}
  .print-btn{font-family:var(--mono);font-size:10px;padding:6px 14px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.2);cursor:pointer;border-radius:2px;letter-spacing:1px;text-transform:uppercase}
  /* Progress bar */
  #progress-bar{height:3px;background:var(--yellow);width:0%;transition:width 0.4s ease;position:fixed;top:0;left:0;z-index:200}
  /* Main */
  main{max-width:980px;margin:0 auto;padding:28px 20px}
  /* Status bar */
  #status-bar{background:#1a1d2e;border:1px solid #2b3145;border-radius:4px;padding:12px 18px;margin-bottom:20px;display:flex;align-items:center;gap:12px;font-size:13px;color:#94a3b8}
  .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,0.1);border-top-color:var(--yellow);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0}
  @keyframes spin{to{transform:rotate(360deg)}}
  #status-text{flex:1}
  #status-done{display:none;color:#4ade80;font-weight:600}
  /* KPI row */
  .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:24px}
  .kpi{background:var(--white);border:1px solid var(--border);border-radius:4px;padding:14px}
  .kpi-label{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--light);margin-bottom:6px}
  .kpi-val{font-size:22px;font-weight:700;color:var(--dark);line-height:1}
  .kpi-sub{font-size:11px;color:var(--mid);margin-top:4px}
  /* Section cards */
  .section{background:var(--white);border:1px solid var(--border);border-radius:4px;margin-bottom:14px;overflow:hidden;opacity:0;transform:translateY(8px);transition:opacity 0.3s ease,transform 0.3s ease}
  .section.visible{opacity:1;transform:none}
  .section-hdr{display:flex;align-items:center;gap:10px;padding:11px 16px;background:var(--dark);color:white}
  .section-num{font-family:var(--mono);font-size:9px;color:rgba(255,255,255,0.35);width:22px}
  .section-name{font-weight:700;font-size:14px;flex:1}
  .section-sub{font-family:var(--mono);font-size:9px;color:var(--yellow);opacity:0.8;text-align:right}
  .section-loading{display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:12px;color:#94a3b8;border-bottom:1px solid var(--border);background:rgba(0,0,0,0.015)}
  .section-loading.done{display:none}
  /* Data area */
  .data-area{padding:14px 16px;border-bottom:1px solid var(--border)}
  /* Narrative area */
  .narrative-area{padding:14px 16px;font-size:13px;color:var(--mid);line-height:1.95;min-height:0;transition:min-height 0.3s;white-space:pre-wrap}
  .narrative-area b{color:var(--ink);font-weight:600}
  .narrative-area:not(:empty){min-height:40px}
  .cursor{display:inline-block;width:2px;height:14px;background:var(--amber);animation:blink 0.7s infinite;vertical-align:middle;margin-left:1px}
  @keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}
  /* Tables inside sections */
  .data-area table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px}
  .data-area table:last-child{margin-bottom:0}
  .data-area thead th{background:#f0f2f5;color:var(--mid);font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.8px;padding:6px 10px;text-align:left;border-bottom:2px solid var(--border);white-space:nowrap}
  .data-area tbody td{padding:6px 10px;border-bottom:1px solid var(--border);color:var(--dark);font-variant-numeric:tabular-nums}
  .data-area tbody tr:hover td{background:#f8f9fb}
  .data-area td.flag,.data-area span.flag{color:var(--red);font-weight:700}
  .null-val{color:#bbb;font-style:italic}
  .no-data{font-size:12px;color:var(--light);font-style:italic;padding:6px 0}
  /* Sub-titles */
  .sub-title{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:var(--amber);margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--border)}
  .sub-title.warn{color:var(--red)}
  /* KV grid */
  .kv-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 20px;margin-bottom:10px}
  .kv-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.04);font-size:12px}
  .kv-label{font-family:var(--mono);font-size:10px;color:var(--light);text-transform:uppercase}
  .kv-val{font-weight:600;color:var(--dark)}
  .kv-flag{color:var(--red)!important}
  /* Calc box */
  .calc-box{background:#f8f9fb;border:1px solid var(--border);border-radius:3px;padding:10px 14px;margin-top:10px;font-size:12px}
  .calc-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(0,0,0,0.04)}
  .calc-row:last-child{border-bottom:none}
  .calc-row.flag{color:var(--red)}
  .calc-row strong{font-weight:700}
  /* Findings */
  .findings-list{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
  .finding-card{border-radius:3px;padding:10px 14px;border-left:3px solid}
  .finding-card.high{border-color:var(--red);background:var(--red-bg)}
  .finding-card.medium{border-color:var(--amber);background:var(--amber-bg)}
  .finding-card.low{border-color:var(--green);background:var(--green-bg)}
  .finding-sev{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--light);margin-bottom:4px}
  .finding-text{font-size:13px;color:var(--dark);line-height:1.5}
  .finding-src{font-family:var(--mono);font-size:10px;color:var(--light);margin-top:4px}
  /* Anomaly list */
  .anomaly-list{margin:6px 0 0 16px;font-size:12px;line-height:1.8;color:var(--amber)}
  /* Rec list */
  .rec-list{margin:6px 0 0 18px;font-size:13px;line-height:1.8;color:var(--mid)}
  /* Context note — "How this check works" block */
  .context-note{background:linear-gradient(135deg,#0f1f2e 0%,#0d1a26 100%);border:1px solid #1e3a52;border-left:3px solid var(--yellow);border-radius:3px;padding:12px 16px;margin-bottom:14px}
  .context-note-title{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--yellow);margin-bottom:8px;opacity:0.9}
  .context-note ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
  .context-note li{font-size:12px;color:rgba(255,255,255,0.75);line-height:1.6;padding-left:16px;position:relative}
  .context-note li::before{content:"→";position:absolute;left:0;color:var(--yellow);opacity:0.7;font-size:10px;top:1px}
  .context-note code{font-family:var(--mono);font-size:10px;background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:2px;color:#93c5fd}
  .context-note strong{color:rgba(255,255,255,0.9);font-weight:600}
  /* Agent note */
  .agent-note{font-size:12px;color:var(--mid);background:#f8f9fb;border:1px solid var(--border);border-radius:3px;padding:10px 12px;margin-top:6px;line-height:1.7}
  /* Error */
  #error-msg{display:none;background:#2d1515;border:1px solid #7f1d1d;border-radius:4px;padding:16px 20px;color:#fca5a5;margin-bottom:20px}
  /* Footer */
  footer{max-width:980px;margin:24px auto;padding:0 20px 40px;font-family:var(--mono);font-size:10px;color:var(--light);letter-spacing:0.5px}
</style>
</head>
<body>

<div id="progress-bar"></div>

<header>
  <div class="hdr-left">
    <h1>Banking Sentinel — Evidence Trail</h1>
    <div class="sub" id="hdr-sub">Session ${sessionId.slice(0,12)}… · Loading…</div>
  </div>
  <div class="hdr-right">
    <span class="badge-level" id="hdr-badge" style="display:none"></span>
    <button class="print-btn" onclick="window.print()">⎙ Print</button>
    <button class="print-btn" onclick="window.open('/report/${sessionId}','_blank')">Risk Report ↗</button>
  </div>
</header>

<main>

  <div id="error-msg"></div>

  <div id="status-bar">
    <div class="spinner" id="spinner"></div>
    <div id="status-text">Connecting to evidence stream…</div>
    <div id="status-done">Evidence trail complete.</div>
  </div>

  <div class="kpi-row" id="kpi-row" style="display:none">
    <div class="kpi"><div class="kpi-label">Risk Score</div><div class="kpi-val" id="kpi-score">—</div><div class="kpi-sub">out of 100</div></div>
    <div class="kpi"><div class="kpi-label">Risk Level</div><div class="kpi-val" id="kpi-level" style="font-size:16px">—</div></div>
    <div class="kpi"><div class="kpi-label">Customer</div><div class="kpi-val" style="font-size:16px" id="kpi-partner">—</div></div>
    <div class="kpi"><div class="kpi-label">Session</div><div class="kpi-val" style="font-size:11px;font-family:monospace" id="kpi-session">—</div></div>
    <div class="kpi"><div class="kpi-label">Generated</div><div class="kpi-val" style="font-size:13px" id="kpi-ts">—</div></div>
  </div>

  <div id="sections-container"></div>

</main>

<footer id="footer" style="display:none">
  Evidence Trail generated by Banking Sentinel · APS 221 · CPS 230 · For internal review only
</footer>

<script>
const SESSION_ID = '${sessionId}';
const container  = document.getElementById('sections-container');
const progress   = document.getElementById('progress-bar');
const spinner    = document.getElementById('spinner');
const statusText = document.getElementById('status-text');
const statusDone = document.getElementById('status-done');

let sectionCount  = 0;
const TOTAL_SECTIONS = 7;
let sectionCursors = {};  // sectionId → cursor element

const levelColors = { CRITICAL:'critical', HIGH:'high', MEDIUM:'medium', LOW:'low' };

function setProgress(pct) {
  progress.style.width = pct + '%';
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
  spinner.style.display = 'none';
  statusText.textContent = 'Error generating evidence trail.';
}

function mkSection(ev) {
  const div = document.createElement('div');
  div.className = 'section';
  div.id = 'section-' + ev.sectionId;
  div.innerHTML = \`
    <div class="section-hdr">
      <span class="section-num">\${ev.icon}</span>
      <span class="section-name">\${ev.title}</span>
      <span class="section-sub">\${ev.subtitle || ''}</span>
    </div>
    <div class="section-loading" id="sloading-\${ev.sectionId}">
      <div class="spinner" style="width:10px;height:10px;border-width:1.5px"></div>
      <span>Generating analysis…</span>
    </div>
    <div class="data-area" id="sdata-\${ev.sectionId}">\${ev.staticHtml || ''}</div>
    <div class="narrative-area" id="snarr-\${ev.sectionId}"></div>
  \`;
  container.appendChild(div);
  // Animate in
  requestAnimationFrame(() => { requestAnimationFrame(() => { div.classList.add('visible'); }); });
}

function appendText(sectionId, delta) {
  const narr = document.getElementById('snarr-' + sectionId);
  if (!narr) return;
  // Remove cursor if exists
  let cursor = narr.querySelector('.cursor');
  if (cursor) cursor.remove();
  // Append text node
  narr.appendChild(document.createTextNode(delta));
  // Re-add cursor
  cursor = document.createElement('span');
  cursor.className = 'cursor';
  narr.appendChild(cursor);
}

// Bullets stream as plain text ("• Input: ..."); once a section finishes,
// bold the leading "• Label:" so the four stages stay scannable at a glance.
function formatNarrative(text) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/^(•\\s*)([A-Za-z][A-Za-z ]*?:)/gm, '$1<b>$2</b>');
}

function finaliseSection(sectionId) {
  const narr    = document.getElementById('snarr-' + sectionId);
  const loading = document.getElementById('sloading-' + sectionId);
  if (narr) {
    const c = narr.querySelector('.cursor'); if (c) c.remove();
    narr.innerHTML = formatNarrative(narr.textContent);
  }
  if (loading) loading.classList.add('done');
  sectionCount++;
  setProgress(Math.round((sectionCount / TOTAL_SECTIONS) * 100));
  statusText.textContent = \`Section \${sectionCount} of \${TOTAL_SECTIONS} complete…\`;
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'explain_start':
      document.getElementById('kpi-partner').textContent  = ev.partnerId || '—';
      document.getElementById('kpi-session').textContent  = SESSION_ID.slice(0,14) + '…';
      document.getElementById('kpi-ts').textContent       = new Date().toLocaleTimeString();
      document.getElementById('kpi-row').style.display    = 'grid';
      document.getElementById('hdr-sub').textContent      = 'Session ' + SESSION_ID.slice(0,12) + '… · Customer ' + (ev.partnerId || '—') + (ev.cached ? ' · replaying saved trail' : '');
      statusText.textContent = ev.cached
        ? 'Replaying saved evidence trail for customer ' + (ev.partnerId || '—') + ' — identical to the original run…'
        : 'Fetching data for customer ' + (ev.partnerId || '—') + '…';
      setProgress(5);
      break;

    case 'explain_section_begin':
      statusText.textContent = 'Building: ' + ev.title + '…';
      mkSection(ev);
      break;

    case 'explain_text_delta':
      appendText(ev.sectionId, ev.delta);
      break;

    case 'explain_section_end':
      finaliseSection(ev.sectionId);
      break;

    case 'explain_complete':
      spinner.style.display   = 'none';
      statusDone.style.display = 'block';
      statusDone.textContent  = ev.cached
        ? 'Evidence trail complete — replayed from the saved record (identical to the original run).'
        : 'Evidence trail complete — saved for future visits.';
      statusText.textContent  = '';
      document.getElementById('footer').style.display = 'block';
      setProgress(100);
      setTimeout(() => { progress.style.opacity = 0; }, 1000);
      break;

    case 'explain_error':
      showError(ev.error);
      break;
  }
}

// Populate KPI score/level from DOM once verdict section arrives
function tryPopulateKpis() {
  setTimeout(() => {
    const scoreEl = document.querySelector('.kv-val');  // first kv-val in snapshot
    const badge   = document.getElementById('hdr-badge');
    const kpiScore = document.getElementById('kpi-score');
    const kpiLevel = document.getElementById('kpi-level');
    // These get populated from explain_start data or from verdict section
  }, 500);
}

// SSE connection
const es = new EventSource('/api/explain-stream/' + SESSION_ID);
es.onmessage = (event) => {
  try { handleEvent(JSON.parse(event.data)); } catch (_) {}
};
es.onerror = () => {
  if (es.readyState === EventSource.CLOSED) return;
  showError('Connection to evidence stream lost. The session may have expired.');
  es.close();
};

statusText.textContent = 'Connecting to evidence stream…';
</script>
</body>
</html>`;
}

module.exports = { renderExplainPage };
