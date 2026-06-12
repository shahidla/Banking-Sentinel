// Banking Sentinel — Langfuse Observability Client (Phase 8)
// AI: LLMOps singleton — one client, shared across all agents via require() cache
//     Every agent attaches child spans to the top-level trace created in server.js
// Banking: APRA CPS 230 operational resilience — AI pipelines must be auditable,
//          cost must be measured, quality must be evaluated
// SAP: Langfuse on BTP CF (Docker or managed) — cost dashboard for AI API usage

'use strict';

let _langfuse = null;

function getLangfuse() {
  if (_langfuse) return _langfuse;
  try {
    const { Langfuse } = require('langfuse');
    _langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl:   process.env.LANGFUSE_HOST || 'https://us.cloud.langfuse.com'
    });
    return _langfuse;
  } catch (e) {
    return null;
  }
}

// ── Span helper ──────────────────────────────────────────────────────────────
// AI: Each agent creates one span per execution, attached to the top-level trace
// Banking: Span = "Relationship Agent ran, took 8.4s, used 412 tokens, cost AUD 0.003"
// SAP: traceId flows through LangGraph state — agents attach without knowing the transport

function startSpan(traceId, name, input = {}) {
  const lf = getLangfuse();
  if (!lf || !traceId) return null;
  return lf.span({ traceId, name, input, startTime: new Date() });
}

function endSpan(span, output = {}, metadata = {}) {
  if (!span) return;
  span.end({ output, metadata });
}

// ── LangChain callback handler ───────────────────────────────────────────────
// AI: Intercepts every LangChain LLM call automatically — tokens, latency, model, prompt
// Banking: Relationship Agent (ReAct loop) + Synthesis Agent use LangChain — all captured
// SAP: CallbackHandler from langfuse/langchain wraps each ChatAnthropic.invoke()

function getLangchainHandler(traceId, agentName) {
  try {
    const { CallbackHandler } = require('langfuse/langchain');
    const lf = getLangfuse();
    if (!lf || !traceId) return null;
    return new CallbackHandler({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl:   process.env.LANGFUSE_HOST || 'https://us.cloud.langfuse.com',
      traceId,
      traceName: agentName
    });
  } catch (e) {
    return null;
  }
}

async function flush() {
  const lf = getLangfuse();
  if (!lf) return;
  try { await lf.flushAsync?.(); } catch (e) { /* non-blocking */ }
}

module.exports = { getLangfuse, getLangchainHandler, startSpan, endSpan, flush };
