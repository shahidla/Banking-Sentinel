// Banking Sentinel — Solace Event Publisher
// AI: Event-driven architecture — agents publish state changes as real-time events
// Banking: Risk officer sees live pipeline progress. APRA CPS 230 auditability.
// SAP: Solace Advanced Event Mesh — same broker as MJ Live (topic prefix: banking/*)
//
// Arch 1 fix: persistent session — connect once at startup, reuse for all publishes.
// The old pattern (connect → send → disconnect per message) hit Solace VPN connection
// limits under concurrent load (8 msgs × 5 analysts = 40 TCP handshakes).
//
// Topics:
//   banking/pipeline/status    → each agent start + complete (Panel 2 live progress)
//   banking/risk/findings      → synthesis result ready (Panel 3 risk brief)
//   banking/human/approval     → pipeline paused, awaiting risk officer approval
//   banking/regulatory/update  → new APRA document uploaded and embedded (Twinkle 2)
//   banking/session/reset      → demo reset before new scenario

'use strict';

let _factory  = null;
let _session  = null;
let _ready    = false;
let _queue    = [];      // messages buffered while connecting
let _connecting = false;

function getFactory() {
  if (_factory) return _factory;
  const solace = require('solclientjs');
  const props = new solace.SolclientFactoryProperties();
  props.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(props);
  _factory = solace.SolclientFactory;
  return _factory;
}

function flushQueue() {
  const factory = getFactory();
  const solace  = require('solclientjs');
  while (_queue.length > 0 && _ready && _session) {
    const { topic, payload } = _queue.shift();
    try {
      const msg = factory.createMessage();
      msg.setDestination(factory.createTopicDestination(topic));
      msg.setBinaryAttachment(JSON.stringify({ ...payload, publishedAt: new Date().toISOString() }));
      msg.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
      _session.send(msg);
      console.log(`  [Solace] → ${topic}`);
    } catch (e) {
      console.warn(`  [Solace] send failed (${topic}): ${e.message}`);
    }
  }
}

function connectSession() {
  if (_connecting || _ready) return;
  if (!process.env.SOLACE_URL) {
    console.warn('  [Solace] SOLACE_URL not set — publisher disabled');
    return;
  }

  _connecting = true;
  const solace  = require('solclientjs');
  const factory = getFactory();

  try {
    _session = factory.createSession({
      url:      process.env.SOLACE_URL,
      vpnName:  process.env.SOLACE_VPN,
      userName: process.env.SOLACE_USERNAME,
      password: process.env.SOLACE_PASSWORD,
      reconnectRetries:          10,
      reconnectRetryWaitInMsecs: 3000
    });

    _session.on(solace.SessionEventCode.UP_NOTICE, () => {
      console.log('  [Solace] Persistent session connected');
      _ready      = true;
      _connecting = false;
      flushQueue();
    });

    _session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e) => {
      console.warn(`  [Solace] Connection failed: ${e.infoStr || 'unknown'}`);
      _ready      = false;
      _connecting = false;
      _session    = null;
    });

    _session.on(solace.SessionEventCode.DISCONNECTED, () => {
      console.warn('  [Solace] Session disconnected — will reconnect on next publish');
      _ready      = false;
      _connecting = false;
      _session    = null;
    });

    _session.connect();
  } catch (e) {
    console.warn(`  [Solace] createSession failed: ${e.message}`);
    _connecting = false;
    _session    = null;
  }
}

// ── Core publish — queue if not yet connected, send immediately if ready ─────
async function publish(topic, payload) {
  if (!process.env.SOLACE_URL) return false;

  _queue.push({ topic, payload });

  if (_ready && _session) {
    flushQueue();
  } else {
    connectSession();
    // Queue will be flushed in UP_NOTICE handler when session comes up.
    // Return immediately — fire-and-forget; pipeline does not wait for Solace.
  }
  return true;
}

// ── Topic publishers ─────────────────────────────────────────────────────────

async function publishPipelineStatus(sessionId, agentName, status, data = {}) {
  return publish('banking/pipeline/status', {
    sessionId,
    agent:  agentName,
    status,
    ...data
  });
}

async function publishRiskFindings(sessionId, synthesisResult) {
  return publish('banking/risk/findings', {
    sessionId,
    riskScore:       synthesisResult?.riskScore,
    riskLevel:       synthesisResult?.riskLevel,
    confidence:      synthesisResult?.confidence,
    apraReady:       synthesisResult?.apraReady,
    findings:        synthesisResult?.findings        || [],
    recommendations: synthesisResult?.recommendations || [],
    regulatoryRefs:  synthesisResult?.regulatoryRefs  || []
  });
}

async function publishHumanApproval(sessionId, data = {}) {
  return publish('banking/human/approval', { sessionId, ...data });
}

async function publishRegulatoryUpdate(sessionId, docTitle, standard, chunkCount) {
  return publish('banking/regulatory/update', {
    sessionId, docTitle, standard, chunkCount,
    message: `${standard} updated — ${chunkCount} chunks embedded in HANA Vector. Re-run analysis to apply.`
  });
}

async function publishSessionReset(sessionId) {
  return publish('banking/session/reset', { sessionId });
}

// Eagerly connect on module load so the session is ready before the first analysis
connectSession();

module.exports = {
  publishPipelineStatus,
  publishRiskFindings,
  publishHumanApproval,
  publishRegulatoryUpdate,
  publishSessionReset
};
