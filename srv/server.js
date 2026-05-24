// Banking Sentinel — CAP Server with A2A Endpoint
// AI: A2A (Agent-to-Agent) protocol — JSON-RPC 2.0 endpoint that Joule and the HTML UI call
// Banking: One endpoint, two callers — custom HTML UI during prototype, Joule in enterprise
// SAP: CAP bootstrap handler mounts the A2A route before CDS starts serving OData

'use strict';
require('dotenv').config();
const cds     = require('@sap/cds');
const express = require('express');
const { v4: uuid } = require('uuid');

let graph = null;
let langfuse = null;

// ── Langfuse observability (optional — fails gracefully if keys missing) ──
function initLangfuse() {
  try {
    const { Langfuse } = require('langfuse');
    langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl:   process.env.LANGFUSE_HOST || 'https://us.cloud.langfuse.com'
    });
    console.log('  [Server] Langfuse connected — all agent traces will appear in dashboard');
  } catch (e) {
    console.warn('  [Server] Langfuse not available — continuing without observability');
  }
}

// ── Cost tracking ──────────────────────────────────────────────────────────
// AI: LLMOps — every analysis run tracked for cost visibility
// Banking: Demonstrates AI ROI to bank stakeholders. AUD per risk brief.
// SAP: Stored in AuditLog HANA entity + visible in Langfuse dashboard
function calculateCostAUD(inputTokens, outputTokens) {
  const INPUT_PER_1K  = 0.0025; // Claude Sonnet AUD approximate
  const OUTPUT_PER_1K = 0.0125;
  return (inputTokens / 1000 * INPUT_PER_1K) + (outputTokens / 1000 * OUTPUT_PER_1K);
}

async function logToAuditLog(sessionId, query, response, state) {
  try {
    const { v4: uuid } = require('uuid');
    await cds.run(INSERT.into('bankingsentinel.AuditLog').entries({
      LOG_ID:     uuid(),
      SESSION_ID: sessionId,
      ACTION:     state.intent?.isSimpleDataQuery ? 'simple_query' :
                  state.intent?.isInappropriateRequest ? 'rejection' : 'risk_analysis',
      QUERY:      query,
      RESPONSE:   typeof response === 'object' ? JSON.stringify(response) : String(response),
      MODEL:      process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      TOKENS_IN:  state.totalInputTokens || 0,
      TOKENS_OUT: state.totalOutputTokens || 0,
      COST_AUD:   calculateCostAUD(state.totalInputTokens || 0, state.totalOutputTokens || 0),
      LATENCY_MS: 0,
      CREATED_AT: new Date().toISOString()
    }));
  } catch (e) {
    console.error('[Server] AuditLog insert failed:', e.message);
  }
}

// ── Solace publisher — fires when graph pauses for human approval ──────────
// AI: Event-driven notification — UI subscribes to Solace topic, shows pause indicator
// Banking: CPS 230 requires audit trail of human review decisions
// SAP: solclientjs (already in package.json) — same Solace broker used by MJ Live
async function publishApprovalEvent(payload) {
  const solace = require('solclientjs');
  return new Promise((resolve) => {
    try {
      const factoryProps = new solace.SolclientFactoryProperties();
      factoryProps.profile = solace.SolclientFactoryProfiles.version10;
      solace.SolclientFactory.init(factoryProps);

      const session = solace.SolclientFactory.createSession({
        url:      process.env.SOLACE_URL,
        vpnName:  process.env.SOLACE_VPN,
        userName: process.env.SOLACE_USERNAME,
        password: process.env.SOLACE_PASSWORD
      });

      session.on(solace.SessionEventCode.UP_NOTICE, () => {
        const msg = solace.SolclientFactory.createMessage();
        msg.setDestination(solace.SolclientFactory.createTopicDestination('banking/human/approval'));
        msg.setBinaryAttachment(JSON.stringify(payload));
        msg.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
        session.send(msg);
        console.log('  [Server] Solace event published → banking/human/approval');
        session.disconnect();
        resolve();
      });
      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e) => {
        console.warn('  [Server] Solace publish failed:', e.message || e);
        resolve(); // non-fatal
      });
      session.connect();
    } catch (e) {
      console.warn('  [Server] Solace publisher error:', e.message);
      resolve(); // non-fatal
    }
  });
}

// ── CAP bootstrap ──────────────────────────────────────────────────────────
cds.on('bootstrap', async (app) => {
  console.log('\n Banking Sentinel — Server Starting');
  console.log('====================================');

  // Parse JSON bodies
  app.use(express.json());

  // Data browser UI
  const { mountAdminUI } = require('./admin');
  mountAdminUI(app);

  // Initialise LangGraph graph (connects to PostgreSQL for state persistence)
  const { createBankingSentinelGraph } = require('./graph/banking-sentinel');
  graph = await createBankingSentinelGraph();
  console.log('  [Server] LangGraph graph ready');

  // Initialise Langfuse observability
  initLangfuse();

  // ── A2A Endpoint — JSON-RPC 2.0 ────────────────────────────────────────────
  // AI: A2A protocol — standard for agent-to-agent communication
  // Banking: Same endpoint handles HTML UI queries and Joule enterprise queries
  // SAP: /a2a/agent mounted before CDS OData routes. Joule registers this via capability YAML.
  app.post('/a2a/agent', async (req, res) => {
    const { method = 'analyseRisk', params = {}, id = uuid() } = req.body || {};
    const sessionId = params.sessionId || uuid();
    const startTime = Date.now();

    console.log(`\n[A2A] ${method} | session: ${sessionId} | query: "${(params.query || '').substring(0, 60)}"`);

    // Langfuse trace for this request
    const trace = langfuse?.trace({
      name:      'banking-sentinel-analysis',
      sessionId,
      userId:    'banking-sentinel',
      metadata:  { method, query: params.query }
    });

    try {
      const initialState = {
        query:      params.query || '',
        customerId: params.customerId || null,
        sessionId,
        requeryCount:      0,
        totalInputTokens:  0,
        totalOutputTokens: 0,
        messages: []
      };

      const config = {
        configurable: { thread_id: sessionId }
      };

      const finalState = await graph.invoke(initialState, config);

      // Check if graph paused at humanApproval (interruptBefore)
      const checkpoint = await graph.getState(config);
      const interrupted = checkpoint.next && checkpoint.next.includes('humanApproval');

      if (interrupted) {
        // Publish Solace event so UI shows pause indicator + Approve button
        await publishApprovalEvent({
          sessionId,
          customerId:         finalState.intent?.customerId,
          riskLevel:          finalState.patternAssessment?.riskLevel,
          riskScore:          finalState.patternAssessment?.riskScore,
          anomalyCount:       finalState.patternAssessment?.anomalies?.length || 0,
          forwardPosition:    finalState.trajectoryAnalysis?.forwardPosition,
          daysToExpiry:       finalState.trajectoryAnalysis?.daysToExpiry,
          conflictingSignals: finalState.trajectoryAnalysis?.conflictingSignals || [],
          requestedAt:        new Date().toISOString()
        });

        trace?.update({ output: 'awaiting_human_approval', metadata: { sessionId, latencyMs: Date.now() - startTime } });
        await langfuse?.flushAsync?.();

        return res.json({
          jsonrpc: '2.0',
          result: {
            sessionId,
            status:       'awaiting_approval',
            responseType: 'human_approval_required',
            riskLevel:    finalState.patternAssessment?.riskLevel,
            riskScore:    finalState.patternAssessment?.riskScore,
            message:      'Risk analysis paused — risk officer approval required before final brief is generated. POST /a2a/approve to resume.',
            tokensIn:     finalState.totalInputTokens,
            tokensOut:    finalState.totalOutputTokens
          },
          id
        });
      }

      // Determine the response based on which path was taken
      let answer, responseType;
      if (finalState.intent?.isInappropriateRequest) {
        answer = finalState.rejectionMessage;
        responseType = 'rejection';
      } else if (finalState.intent?.isSimpleDataQuery) {
        answer = finalState.simpleQueryResult;
        responseType = 'simple_query';
      } else {
        answer = finalState.synthesisResult
          ? JSON.stringify(finalState.synthesisResult)
          : 'Risk analysis pipeline executed';
        responseType = 'risk_analysis';
      }

      const latencyMs = Date.now() - startTime;
      const cost = calculateCostAUD(finalState.totalInputTokens, finalState.totalOutputTokens);

      console.log(`[A2A] Done | type: ${responseType} | tokens: ${finalState.totalInputTokens}in/${finalState.totalOutputTokens}out | AUD ${cost.toFixed(4)} | ${latencyMs}ms`);

      // Persist to AuditLog
      await logToAuditLog(sessionId, params.query, answer, finalState);

      // Flush Langfuse trace
      trace?.update({ output: answer, metadata: { latencyMs, cost, responseType } });
      await langfuse?.flushAsync?.();

      res.json({
        jsonrpc: '2.0',
        result: {
          sessionId,
          answer,
          responseType,
          intent:    finalState.intent,
          tokensIn:  finalState.totalInputTokens,
          tokensOut: finalState.totalOutputTokens,
          costAUD:   cost,
          latencyMs
        },
        id
      });

    } catch (err) {
      console.error(`[A2A] Error: ${err.message}`);
      trace?.update({ output: null, level: 'ERROR', metadata: { error: err.message } });
      await langfuse?.flushAsync?.();
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id
      });
    }
  });

  // ── Human Approval Resume ─────────────────────────────────────────────────
  // AI: Resumes the paused LangGraph execution from the humanApproval checkpoint
  // Banking: Risk officer hits Approve — graph continues to Synthesis and produces the APRA brief
  // SAP: Uses same thread_id (sessionId) to load checkpoint from PostgresSaver and resume
  app.post('/a2a/approve', async (req, res) => {
    const { sessionId, approvedBy = 'risk_officer' } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'sessionId required' }, id: null });
    }

    console.log(`\n[A2A] /approve | session: ${sessionId} | approvedBy: ${approvedBy}`);
    const config = { configurable: { thread_id: sessionId } };

    try {
      // Resume graph from interruptBefore checkpoint — humanApproval node runs, then synthesis
      const finalState = await graph.invoke(null, config);

      // Log approval to RiskAssessments
      try {
        await cds.run(
          UPDATE('bankingsentinel.RiskAssessments')
            .set({ APPROVED_BY: approvedBy, APPROVED_AT: new Date().toISOString() })
            .where({ SESSION_ID: sessionId })
        );
      } catch (e) {
        console.warn('[Server] RiskAssessments approval update failed:', e.message);
      }

      const synthesis = finalState.synthesisResult;
      console.log(`[A2A] /approve complete | score:${synthesis?.riskScore} level:${synthesis?.riskLevel}`);

      res.json({
        jsonrpc: '2.0',
        result: {
          sessionId,
          approvedBy,
          status:          'completed',
          synthesisResult: synthesis,
          tokensIn:        finalState.totalInputTokens,
          tokensOut:       finalState.totalOutputTokens
        },
        id: uuid()
      });
    } catch (err) {
      console.error(`[A2A] /approve error: ${err.message}`);
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id: null
      });
    }
  });

  // Health check
  app.get('/a2a/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'banking-sentinel',
      graph: graph ? 'ready' : 'not initialised',
      langfuse: langfuse ? 'connected' : 'not connected'
    });
  });

  console.log('  [Server] A2A endpoint ready: POST /a2a/agent');
  console.log('  [Server] Health check: GET /a2a/health\n');
});

// ── CAP service handler ──────────────────────────────────────────────────────
cds.on('served', () => {
  console.log('  [Server] CAP OData service ready');
  console.log('  [Server] Banking Sentinel fully operational\n');
});

module.exports = cds.server;
