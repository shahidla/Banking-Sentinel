// Banking Sentinel — CAP Server with A2A Endpoint
// AI: A2A (Agent-to-Agent) protocol — JSON-RPC 2.0 endpoint that Joule and the HTML UI call
// Banking: One endpoint, two callers — custom HTML UI during prototype, Joule in enterprise
// SAP: CAP bootstrap handler mounts the A2A route before CDS starts serving OData

'use strict';
require('dotenv').config();
const cds     = require('@sap/cds');
const express = require('express');
const { v4: uuid } = require('uuid');
const path = require('path');
const {
  publishPipelineStatus,
  publishRiskFindings,
  publishHumanApproval,
  publishRegulatoryUpdate,
  publishSessionReset
} = require('./events/solace-publisher');
const { runRagasEvaluation } = require('./observability/ragas-evaluator');
const { flush: langfuseFlush } = require('./observability/langfuse-client');
const { progressEmitter } = require('./agents/pattern-agent');

let graph = null;
let langfuse = null;

// ── SSE client registry — browser connects here for real-time agent events ──
// AI: SSE relays per-node graph.stream() events directly to the HTML UI
// Banking: Panel 2 updates live as each agent completes — no polling needed
// SAP: Solace publishes for enterprise consumers; SSE serves the local HTML UI
const sseClients = new Map(); // sessionId → Express response

function pushSSE(sessionId, type, data) {
  const client = sseClients.get(sessionId);
  if (client && !client.writableEnded) {
    client.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  }
}

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

async function logToAuditLog(sessionId, query, response, state, latencyMs = 0) {
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
      LATENCY_MS: latencyMs,
      CREATED_AT: new Date().toISOString()
    }));
  } catch (e) {
    console.error('[Server] AuditLog insert failed:', e.message);
  }
}

// ── CAP bootstrap ──────────────────────────────────────────────────────────
cds.on('bootstrap', async (app) => {
  console.log('\n Banking Sentinel — Server Starting');
  console.log('====================================');

  // Parse JSON bodies
  app.use(express.json());

  // Serve HTML UI at root
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../v0-source-files/Banking-Sentinel-AustralianBank.html'));
  });

  // Serve logo
  app.get('/logo.png', (req, res) => {
    res.sendFile(path.join(__dirname, '../Docs/logo.png'));
  });


  // ── SSE endpoint — browser subscribes for real-time agent progress ─────────
  // AI: Browser opens EventSource('/a2a/events?sessionId=xxx'), server pushes per-node events
  // Banking: Panel 2 ticks each agent green as it completes — no polling, no refresh
  // SAP: SSE for HTML UI + Solace for enterprise (Joule, dashboards) — both run simultaneously
  app.get('/a2a/events', (req, res) => {
    const { sessionId } = req.query;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    res.write('data: {"type":"connected"}\n\n');
    if (sessionId) sseClients.set(sessionId, res);
    req.on('close', () => { if (sessionId) sseClients.delete(sessionId); });
  });

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

    // Langfuse trace for this request — traceId flows into state so agents attach child spans
    const trace = langfuse?.trace({
      name:      'banking-sentinel-analysis',
      sessionId,
      userId:    'banking-sentinel',
      input:     { query: params.query, customerId: params.customerId },
      metadata:  { method }
    });
    const traceId = trace?.id || null;

    try {
      const initialState = {
        query:      params.query || '',
        customerId: params.customerId || null,
        sessionId,
        traceId,
        requeryCount:      0,
        totalInputTokens:  0,
        totalOutputTokens: 0,
        messages: []
      };

      const config = {
        configurable: { thread_id: sessionId }
      };

      // ── graph.stream() — yields after each node, enabling real-time Solace events ──
      // AI: Stream replaces invoke() — same execution, but we get per-node state updates
      // Banking: UI Panel 2 shows live pipeline progress ("Relationship Agent... running")
      // SAP: Each node completion → publishPipelineStatus → UI subscriber updates instantly

      // Forward pattern sub-task progress events to the SSE client for this session
      const onPatternProgress = (evt) => {
        if (evt.sessionId === sessionId) pushSSE(sessionId, 'pattern_progress', evt);
      };
      progressEmitter.on('progress', onPatternProgress);

      let finalState = { ...initialState };
      for await (const chunk of await graph.stream(initialState, { ...config, streamMode: 'updates' })) {
        // Fan-out nodes can produce multiple entries in one chunk — iterate all
        for (const [nodeName, nodeState] of Object.entries(chunk)) {
        finalState = { ...finalState, ...nodeState };

        const eventData = {
          agent:          nodeName,
          status:         'complete',
          customerId:     finalState.intent?.customerId || initialState.customerId,
          riskScore:      finalState.patternAssessment?.riskScore,
          riskLevel:      finalState.patternAssessment?.riskLevel,
          signal:         finalState.patternAssessment?.signal,
          anomalyCount:   finalState.patternAssessment?.anomalies?.length,
          anomalies:      finalState.patternAssessment?.anomalies,
          patternConf:    finalState.patternAssessment?.confidence,
          rpt1Success:    finalState.patternAssessment?.rpt1?.success,
          palCount:       finalState.patternAssessment?.pal?.anomalyCount ?? 0,
          llmCount:       finalState.patternAssessment?.llm?.anomalies?.length ?? 0,
          nodes:          finalState.relationshipMap?.nodes?.length,
          graphNodes:     finalState.relationshipMap?.nodes,
          graphEdges:     finalState.relationshipMap?.edges,
          groupExposure:  finalState.relationshipMap?.groupExposure,
          aps221Pct:      finalState.relationshipMap?.aps221Pct,
          relationshipFinding: finalState.relationshipMap?.finding,
          forwardPosition:finalState.trajectoryAnalysis?.forwardPosition,
          daysToExpiry:   finalState.trajectoryAnalysis?.daysToExpiry,
          confidence:     finalState.selfRagEvaluation?.overallConfidence,
          reQueryHint:    finalState.reQueryHint,
          requeryCount:   finalState.requeryCount,
          findingsCount:  finalState.synthesisResult?.findings?.length,
          apraReady:      finalState.synthesisResult?.apraReady
        };

        pushSSE(sessionId, 'pipeline_status', eventData);
        await publishPipelineStatus(sessionId, nodeName, 'complete', {
          customerId: eventData.customerId,
          riskScore:  eventData.riskScore,
          riskLevel:  eventData.riskLevel
        });
        } // end per-node loop
      } // end stream chunk loop

      progressEmitter.off('progress', onPatternProgress);

      // Check if graph paused at humanApproval (interruptBefore)
      const checkpoint = await graph.getState(config);
      const interrupted = checkpoint.next && checkpoint.next.includes('humanApproval');

      if (interrupted) {
        // Push SSE to browser + Solace event for enterprise consumers
        pushSSE(sessionId, 'human_approval', {
          riskScore:  finalState.patternAssessment?.riskScore,
          riskLevel:  finalState.patternAssessment?.riskLevel,
          message:    'Risk officer approval required'
        });
        await publishHumanApproval(sessionId, {
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
        await langfuseFlush();

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

      // Push SSE + Solace for risk findings
      if (finalState.synthesisResult) {
        pushSSE(sessionId, 'risk_findings', { synthesisResult: finalState.synthesisResult });
        await publishRiskFindings(sessionId, finalState.synthesisResult);
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
      await logToAuditLog(sessionId, params.query, answer, finalState, latencyMs);

      // RAGAS-style quality evaluation — fire-and-forget, pushes SSE when done
      if (finalState.synthesisResult && traceId) {
        runRagasEvaluation(traceId, params.query, finalState.synthesisResult, finalState.retrievedDocs)
          .then(ragasResult => {
            if (ragasResult) pushSSE(sessionId, 'ragas_scores', ragasResult);
          })
          .catch(e => console.warn('[RAGAS] evaluation error:', e.message));
      }

      // Finalise and flush Langfuse trace
      trace?.update({ output: answer, metadata: { latencyMs, cost, responseType, tokensIn: finalState.totalInputTokens, tokensOut: finalState.totalOutputTokens } });
      await langfuseFlush();

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
      await langfuseFlush();
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
      // Resume graph from interruptBefore — stream so UI gets synthesis progress event
      let finalState = {};
      let chunksReceived = 0;
      for await (const chunk of await graph.stream(null, { ...config, streamMode: 'updates' })) {
        chunksReceived++;
        const [nodeName, nodeState] = Object.entries(chunk)[0];
        finalState = { ...finalState, ...nodeState };
        const eventData = {
          agent:        nodeName,
          status:       'complete',
          findingsCount: finalState.synthesisResult?.findings?.length,
          riskScore:    finalState.synthesisResult?.riskScore,
          riskLevel:    finalState.synthesisResult?.riskLevel,
          confidence:   finalState.synthesisResult?.confidence
        };
        pushSSE(sessionId, 'pipeline_status', eventData);
        await publishPipelineStatus(sessionId, nodeName, 'complete', {});
      }

      // No chunks = no paused session existed for this sessionId
      if (chunksReceived === 0) {
        console.warn(`[A2A] /approve — no paused session found for ${sessionId}`);
        return res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: `No paused session found for sessionId: ${sessionId}` },
          id: null
        });
      }

      // Push SSE + Solace for final risk findings
      if (finalState.synthesisResult) {
        pushSSE(sessionId, 'risk_findings', { synthesisResult: finalState.synthesisResult });
        await publishRiskFindings(sessionId, finalState.synthesisResult);
      }

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

      const approveCost = calculateCostAUD(finalState.totalInputTokens || 0, finalState.totalOutputTokens || 0);
      res.json({
        jsonrpc: '2.0',
        result: {
          sessionId,
          approvedBy,
          status:          'completed',
          synthesisResult: synthesis,
          tokensIn:        finalState.totalInputTokens,
          tokensOut:       finalState.totalOutputTokens,
          costAUD:         approveCost
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

  // ── Twinkle 2 — Regulatory Document Sync ─────────────────────────────────
  // AI: RAG knowledge base update — fetch PDF, chunk, embed, store in HANA Vector
  // Banking: New APRA standard published → risk officer uploads it → applies immediately
  //          No code change, no redeployment — knowledge base updates at runtime
  // SAP: POST body: { docTitle, standard, pdfUrl or pdfBase64 }
  //      Embeddings stored in RegulatoryDocuments entity. Synthesis retrieves on next query.
  app.post('/a2a/sync-apra', async (req, res) => {
    const { docTitle, standard, pdfUrl, pdfBase64 } = req.body || {};
    const sessionId = req.body.sessionId || uuid();

    if (!docTitle || !standard) {
      return res.status(400).json({ error: 'docTitle and standard are required' });
    }
    if (!pdfUrl && !pdfBase64) {
      return res.status(400).json({ error: 'pdfUrl or pdfBase64 is required' });
    }

    console.log(`\n[A2A] /sync-apra | standard: ${standard} | doc: ${docTitle}`);

    try {
      const { embedAndStoreApraDoc } = require('./rag/apra-embedder');
      const chunkCount = await embedAndStoreApraDoc({ docTitle, standard, pdfUrl, pdfBase64 });

      pushSSE(sessionId, 'regulatory_update', { docTitle, standard, chunkCount });
      await publishRegulatoryUpdate(sessionId, docTitle, standard, chunkCount);

      console.log(`[A2A] /sync-apra complete | ${chunkCount} chunks embedded | event published`);
      res.json({
        status: 'ok',
        docTitle,
        standard,
        chunkCount,
        message: `${chunkCount} chunks embedded in HANA Vector. Synthesis will use on next query.`
      });
    } catch (err) {
      console.error(`[A2A] /sync-apra error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Session Reset ─────────────────────────────────────────────────────────
  // AI: Demo reset — clears UI state for next scenario via Solace event
  // Banking: Clean slate before each demo run — no stale findings from previous analysis
  // SAP: UI subscribes to banking/session/reset and resets all three panels on receipt
  app.post('/a2a/reset', async (req, res) => {
    const { sessionId = uuid() } = req.body || {};
    console.log(`\n[A2A] /reset | session: ${sessionId}`);
    await publishSessionReset(sessionId);
    res.json({ status: 'ok', sessionId, message: 'Session reset event published' });
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

  app.get('/a2a/config', (req, res) => {
    const engine = (process.env.ANOMALY_ENGINE || 'scikit').toLowerCase();
    res.json({
      anomalyEngine:      engine,
      anomalyEngineLabel: engine === 'pal' ? 'HANA PAL' : 'Scikit-IF'
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
