// Banking Sentinel — Solace Event Publisher
// AI: Event-driven architecture — agents publish state changes as real-time events
// Banking: Risk officer sees live pipeline progress. APRA CPS 230 auditability.
// SAP: Solace Advanced Event Mesh — same broker as MJ Live (topic prefix: banking/*)
//
// Topics:
//   banking/pipeline/status    → each agent start + complete (Panel 2 live progress)
//   banking/risk/findings      → synthesis result ready (Panel 3 risk brief)
//   banking/human/approval     → pipeline paused, awaiting risk officer approval
//   banking/regulatory/update  → new APRA document uploaded and embedded (Twinkle 2)
//   banking/session/reset      → demo reset before new scenario

'use strict';

let solaceFactory = null;

function getSolaceFactory() {
  if (solaceFactory) return solaceFactory;
  const solace = require('solclientjs');
  const props = new solace.SolclientFactoryProperties();
  props.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(props);
  solaceFactory = solace.SolclientFactory;
  return solaceFactory;
}

// ── Core publish — connect, send one message, disconnect ─────────────────────
// AI: Fire-and-forget pattern — agent does not wait for subscriber acknowledgement
// Banking: Pipeline cannot block on UI delivery — risk analysis continues regardless
// SAP: Solace DIRECT delivery mode — same pattern as MJ Live consumer.html events
async function publish(topic, payload) {
  return new Promise((resolve) => {
    try {
      const solace  = require('solclientjs');
      const factory = getSolaceFactory();

      const session = factory.createSession({
        url:      process.env.SOLACE_URL,
        vpnName:  process.env.SOLACE_VPN,
        userName: process.env.SOLACE_USERNAME,
        password: process.env.SOLACE_PASSWORD
      });

      session.on(solace.SessionEventCode.UP_NOTICE, () => {
        const msg = factory.createMessage();
        msg.setDestination(factory.createTopicDestination(topic));
        msg.setBinaryAttachment(JSON.stringify({ ...payload, publishedAt: new Date().toISOString() }));
        msg.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
        session.send(msg);
        console.log(`  [Solace] → ${topic}`);
        session.disconnect();
        resolve(true);
      });

      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e) => {
        console.warn(`  [Solace] publish failed (${topic}): ${e.infoStr || e.message || 'connection error'}`);
        resolve(false);
      });

      session.on(solace.SessionEventCode.DISCONNECTED, () => resolve(true));
      session.connect();
    } catch (e) {
      console.warn(`  [Solace] publisher error (${topic}): ${e.message}`);
      resolve(false);
    }
  });
}

// ── Topic publishers ─────────────────────────────────────────────────────────

// AI: Per-agent progress event — UI shows which agent is running right now
// Banking: Transparency into pipeline — "Relationship Agent traversing connected parties..."
// SAP: Panel 2 in Banking-Sentinel-AustralianBank.html subscribes to this topic
async function publishPipelineStatus(sessionId, agentName, status, data = {}) {
  return publish('banking/pipeline/status', {
    sessionId,
    agent:  agentName,   // intake | pattern | relationship | trajectory | selfRagCheck | synthesis
    status,              // running | complete | requerying
    ...data
  });
}

// AI: Final synthesis output event — UI renders the APRA-ready risk brief
// Banking: Panel 3 updates with risk score, findings, recommendations
// SAP: Published after humanApproval resume + synthesis completion
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

// AI: Human-in-the-loop pause event — pipeline halted, awaiting human decision
// Banking: Risk officer receives notification to review preliminary findings
// SAP: Panel 2 shows pause indicator + Approve button when this event arrives
async function publishHumanApproval(sessionId, data = {}) {
  return publish('banking/human/approval', { sessionId, ...data });
}

// AI: Regulatory knowledge base updated — Synthesis will retrieve new content on next query
// Banking: Twinkle 2 — APRA document uploaded, zero code change, policy applies immediately
// SAP: Triggers re-evaluation indicator in UI — "Standards updated, re-run analysis?"
async function publishRegulatoryUpdate(sessionId, docTitle, standard, chunkCount) {
  return publish('banking/regulatory/update', {
    sessionId,
    docTitle,
    standard,
    chunkCount,
    message: `${standard} updated — ${chunkCount} chunks embedded in HANA Vector. Re-run analysis to apply.`
  });
}

// AI: Demo reset event — clears UI state for next scenario
// Banking: Clean slate before each demo run — no stale findings from previous analysis
// SAP: UI subscribes and resets all three panels on receipt
async function publishSessionReset(sessionId) {
  return publish('banking/session/reset', { sessionId });
}

module.exports = {
  publishPipelineStatus,
  publishRiskFindings,
  publishHumanApproval,
  publishRegulatoryUpdate,
  publishSessionReset
};
