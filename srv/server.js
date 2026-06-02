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
const { getLangfuse, flush: langfuseFlush } = require('./observability/langfuse-client');
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

// ── Langfuse observability — shared singleton from langfuse-client.js ────────
// Phase 8d: consolidated from two separate instances (server + langfuse-client) to one.
// langfuseFlush() now flushes top-level traces AND child spans from agents.
function initLangfuse() {
  langfuse = getLangfuse();
  if (langfuse) {
    console.log('  [Server] Langfuse connected — all agent traces will appear in dashboard');
  } else {
    console.warn('  [Server] Langfuse not available — continuing without observability');
  }
}

// ── Cost tracking ──────────────────────────────────────────────────────────
// AI: LLMOps — every analysis run tracked for cost visibility
// Banking: Demonstrates AI ROI to bank stakeholders. AUD per risk brief.
// SAP: Stored in AuditLog HANA entity + visible in Langfuse dashboard
// USD prices × 1.55 AUD/USD — updated per Anthropic pricing page 2026-05
const MODEL_PRICING_AUD = {
  'claude-haiku-4-5-20251001': { in: 0.000388, out: 0.001938 },
  'claude-sonnet-4-6':         { in: 0.00465,  out: 0.02325  },
  'claude-opus-4-7':           { in: 0.02325,  out: 0.11625  }
};
function calculateCostAUD(inputTokens, outputTokens) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const rates = MODEL_PRICING_AUD[model] || MODEL_PRICING_AUD['claude-haiku-4-5-20251001'];
  return (inputTokens / 1000 * rates.in) + (outputTokens / 1000 * rates.out);
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
    const hitlEnabled = params.hitl !== false; // default true; UI sends false when HITL toggle is OFF
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
      try {
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
            rpt1Category:   finalState.patternAssessment?.rpt1?.category,
            rpt1Confidence: finalState.patternAssessment?.rpt1?.confidence,
            palCount:       finalState.patternAssessment?.pal?.anomalyCount ?? 0,
            palTotalScored: finalState.patternAssessment?.pal?.totalScored  ?? 0,
            llmCount:       finalState.patternAssessment?.llm?.anomalies?.length ?? 0,
            nodes:          finalState.relationshipMap?.nodes?.length,
            graphNodes:     finalState.relationshipMap?.nodeDetails?.length > 0
                              ? finalState.relationshipMap.nodeDetails
                              : finalState.relationshipMap?.nodes,
            graphEdges:     finalState.relationshipMap?.edges,
            groupExposure:  finalState.relationshipMap?.groupExposure,
            aps221Pct:      finalState.relationshipMap?.aps221Pct,
            relationshipFinding: finalState.relationshipMap?.finding,
            forwardPosition:finalState.trajectoryAnalysis?.forwardPosition,
            daysToExpiry:   finalState.trajectoryAnalysis?.daysToExpiry,
            conflictingSignals: finalState.trajectoryAnalysis?.conflictingSignals,
            timeToBreach:   finalState.trajectoryAnalysis?.timeToBreach,
            selfRagConf:    finalState.selfRagEvaluation?.overallConfidence,
            selfRagHistory: finalState.selfRagHistory,
            selfRagIteration: finalState.requeryCount,
            selfRagReasoning: finalState.selfRagEvaluation?.reasoning,
            selfRagGaps:    finalState.selfRagEvaluation?.gaps,
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
      } finally {
        progressEmitter.off('progress', onPatternProgress);
      }

      // Check if graph paused at humanApproval (interruptBefore)
      const checkpoint = await graph.getState(config);
      const interrupted = checkpoint.next && checkpoint.next.includes('humanApproval');

      if (interrupted && !hitlEnabled) {
        // HITL OFF — auto-advance past humanApproval and continue to synthesis
        console.log(`  [A2A] HITL=OFF — auto-advancing past humanApproval for ${sessionId}`);
        await graph.updateState(config, {}, 'humanApproval');
        for await (const chunk of await graph.stream(null, { ...config, streamMode: 'updates' })) {
          for (const [nodeName, nodeState] of Object.entries(chunk)) {
            finalState = { ...finalState, ...nodeState };
            const autoEvt = { agent: nodeName, status: 'complete', customerId: finalState.intent?.customerId || params.customerId };
            pushSSE(sessionId, 'pipeline_status', { ...autoEvt, ...finalState.patternAssessment ? { riskScore: finalState.patternAssessment.riskScore, findingsCount: finalState.synthesisResult?.findings?.length, apraReady: finalState.synthesisResult?.apraReady } : {} });
          }
        }
        if (finalState.synthesisResult) {
          pushSSE(sessionId, 'risk_findings', { synthesisResult: finalState.synthesisResult });
          await publishRiskFindings(sessionId, finalState.synthesisResult);
        }
      } else if (interrupted) {
        // HITL ON — Push SSE with full agent context so risk officer sees summary in approveBar
        pushSSE(sessionId, 'human_approval', {
          riskScore:    finalState.patternAssessment?.riskScore,
          riskLevel:    finalState.patternAssessment?.riskLevel,
          signal:       finalState.patternAssessment?.signal,
          nodes:        finalState.relationshipMap?.nodes?.length,
          groupExposure:finalState.relationshipMap?.groupExposure,
          forwardPosition: finalState.trajectoryAnalysis?.forwardPosition,
          daysToExpiry: finalState.trajectoryAnalysis?.daysToExpiry,
          selfRagConf:  finalState.selfRagEvaluation?.overallConfidence,
          selfRagIteration: finalState.requeryCount,
          message:      'Risk officer approval required'
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
    const approveStart = Date.now();
    const config = { configurable: { thread_id: sessionId } };

    try {
      // Verify the graph is actually paused at humanApproval before proceeding
      const checkpoint = await graph.getState(config);
      const interrupted = checkpoint.next && checkpoint.next.includes('humanApproval');
      if (!interrupted) {
        console.warn(`[A2A] /approve — no paused session at humanApproval for ${sessionId} (next: ${JSON.stringify(checkpoint.next)})`);
        return res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: `No paused session found for sessionId: ${sessionId}` },
          id: null
        });
      }

      // Advance the checkpoint past interruptBefore by marking humanApproval as complete.
      // Without this, graph.stream(null, config) re-triggers interruptBefore and synthesis never runs.
      await graph.updateState(config, {}, 'humanApproval');
      console.log(`  [A2A] Checkpoint advanced past humanApproval — streaming synthesis for ${sessionId}`);

      // Resume graph — now starts at synthesis (humanApproval already advanced)
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
          confidence:   finalState.synthesisResult?.confidence,
          apraReady:    finalState.synthesisResult?.apraReady
        };
        pushSSE(sessionId, 'pipeline_status', eventData);
        await publishPipelineStatus(sessionId, nodeName, 'complete', {});
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

      const synthesis    = finalState.synthesisResult;
      const approveLatMs = Date.now() - approveStart;
      console.log(`[A2A] /approve complete | score:${synthesis?.riskScore} level:${synthesis?.riskLevel}`);

      // AuditLog + RAGAS — same as the initial analysis path (Incomplete 3 fix)
      const savedState = checkpoint.values || {};
      const origQuery  = savedState.query   || '';
      const traceId    = savedState.traceId || null;
      await logToAuditLog(sessionId, origQuery, synthesis, finalState, approveLatMs);
      if (synthesis) {
        runRagasEvaluation(traceId, origQuery, synthesis, finalState.retrievedDocs)
          .then(r => { if (r) pushSSE(sessionId, 'ragas_scores', r); })
          .catch(() => {});
      }

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

  // ── Reject ────────────────────────────────────────────────────────────────
  app.post('/a2a/reject', async (req, res) => {
    const { sessionId, rejectedBy = 'risk_officer' } = req.body || {};
    console.log(`[A2A] /reject | session:${sessionId} | by:${rejectedBy}`);
    if (sessionId) {
      try {
        await cds.run(
          UPDATE('bankingsentinel.RiskAssessments')
            .set({ APPROVED_BY: `REJECTED:${rejectedBy}`, APPROVED_AT: new Date().toISOString() })
            .where({ SESSION_ID: sessionId })
        );
      } catch (e) { /* best-effort — table may not have this session yet */ }
    }
    res.json({ jsonrpc: '2.0', result: { sessionId, status: 'rejected', rejectedBy }, id: uuid() });
  });

  // ── APRA Notice — Regulatory Document Sync ───────────────────────────────
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
      const { stored: chunkCount, thresholdUpdated } = await embedAndStoreApraDoc({ docTitle, standard, pdfUrl, pdfBase64 });

      pushSSE(sessionId, 'regulatory_update', { docTitle, standard, chunkCount, thresholdUpdated });
      await publishRegulatoryUpdate(sessionId, docTitle, standard, chunkCount);

      const msg = thresholdUpdated
        ? `${chunkCount} chunks embedded. DTI threshold updated to 6.0x — re-run pipeline to see breach.`
        : `${chunkCount} chunks embedded in HANA Vector. Synthesis will use on next query.`;

      console.log(`[A2A] /sync-apra complete | ${chunkCount} chunks embedded | thresholdUpdated:${thresholdUpdated} | event published`);
      res.json({ status: 'ok', docTitle, standard, chunkCount, thresholdUpdated, message: msg });
    } catch (err) {
      console.error(`[A2A] /sync-apra error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── DTI Status — on-load state check for UI button restore ──────────────
  app.get('/api/dti-status', async (req, res) => {
    try {
      const row = await cds.run(
        SELECT.one.from('bankingsentinel.RegulatoryThresholds')
          .where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' })
      );
      const limit = parseFloat(row?.LIMIT_PCT ?? 8.0);
      res.json({ dtiLimit: limit, apraNoticeActive: limit <= 6.0 });
    } catch (e) {
      res.json({ dtiLimit: 8.0, apraNoticeActive: false });
    }
  });

  // ── Regulatory Threshold Reset ────────────────────────────────────────────
  // Reverts DTI threshold from 6.0x (APRA Notice) back to 8.0x (Demo 1 baseline)
  app.post('/api/reset-threshold', async (req, res) => {
    try {
      await cds.run(
        UPDATE('bankingsentinel.RegulatoryThresholds')
          .set({ LIMIT_PCT: 8.0 })
          .where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' })
      );
      console.log('[API] DTI threshold reset to 8.0x (Demo 1 baseline)');
      res.json({ status: 'ok', message: 'DTI threshold reset to 8.0x' });
    } catch (err) {
      console.error('[API] reset-threshold error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Explainability Report — JSON API ─────────────────────────────────────
  // Reads the LangGraph checkpoint for a session and returns full per-agent data
  app.get('/api/report/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
      if (!graph) return res.status(503).json({ error: 'Graph not ready' });
      const checkpoint = await graph.getState({ configurable: { thread_id: sessionId } });
      if (!checkpoint || !checkpoint.values) return res.status(404).json({ error: 'Session not found' });
      const s = checkpoint.values;

      // Pull AuditLog rows for this session from HANA
      let auditTrail = [];
      try {
        auditTrail = await cds.run(
          SELECT.from('bankingsentinel.AuditLog').where({ SESSION_ID: sessionId }).orderBy('TIMESTAMP asc')
        );
      } catch (_) {}

      const synth = s.synthesisResult || {};
      res.json({
        sessionId,
        generatedAt:  new Date().toISOString(),
        standard:     'CPS 230 · APS 221',
        partner:      s.customerId || '—',
        query:        s.query || '—',
        // Intent
        intent:       s.intent || null,
        // Pattern Agent
        patternAssessment: s.patternAssessment || null,
        // Trajectory Agent
        trajectoryAnalysis: s.trajectoryAnalysis || null,
        // Relationship Agent
        relationshipMap: s.relationshipMap ? {
          nodes:         s.relationshipMap.nodes,
          edges:         s.relationshipMap.edges,
          groupExposure: s.relationshipMap.groupExposure,
          aps221Pct:     s.relationshipMap.aps221Pct,
          confidence:    s.relationshipMap.confidence,
          finding:       s.relationshipMap.finding || null,
          hops:          s.relationshipMap.hops || null
        } : null,
        // Self-RAG
        selfRagEvaluation: s.selfRagEvaluation || null,
        selfRagHistory:    s.selfRagHistory    || [],
        requeryCount:  s.requeryCount || 0,
        reQueryHint:   s.reQueryHint || null,
        // Human Approval
        hitlEnabled:  s.hitlEnabled ?? true,
        approvedBy:   auditTrail.find(r => r.ACTION === 'human_approval')?.DETAILS || null,
        // Synthesis
        riskScore:    synth.riskScore,
        riskLevel:    synth.riskLevel,
        confidence:   synth.confidence,
        findings:     synth.findings || [],
        recommendations: synth.recommendations || [],
        regulatoryRefs:  synth.regulatoryRefs || [],
        uncertainties:   synth.uncertainties || [],
        apraReady:    synth.apraReady,
        // Tokens + cost totals derived from audit trail
        totalInputTokens:  s.totalInputTokens || 0,
        totalOutputTokens: s.totalOutputTokens || 0,
        totalCostAUD:  auditTrail.reduce((sum, r) => sum + (parseFloat(r.COST_AUD) || 0), 0),
        totalLatencyMs: auditTrail.reduce((sum, r) => sum + (parseInt(r.LATENCY_MS) || 0), 0),
        // SAP tables accessed during this pipeline run
        trbkTables: ['BUT050', 'BCA_GUARANTOR', 'DFKKOP', 'BCA_DTI', 'BCA_LOAN_HDR', 'Loans', 'BCA_SECTOR'],
        // Audit
        auditTrail:   auditTrail.map(r => ({
          action:    r.ACTION,
          model:     r.MODEL,
          tokensIn:  r.TOKENS_IN,
          tokensOut: r.TOKENS_OUT,
          costAUD:   r.COST_AUD,
          latencyMs: r.LATENCY_MS
        }))
      });
    } catch (err) {
      console.error('[Report]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Explainability Report — HTML page ────────────────────────────────────
  // Self-contained page; fetches /api/report/:sessionId and renders full trail
  app.get('/report/:sessionId', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(require('./report-page').renderReportPage(req.params.sessionId));
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
