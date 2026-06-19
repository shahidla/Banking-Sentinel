// Banking Sentinel — shared retry wrapper for external API calls
// AI: Agents call third-party services (RPT-1, OpenAI, scikit, GraphDB) that
//     occasionally return transient errors (429 rate-limit, 502/503/504) or
//     drop the connection. A single transient blip shouldn't fail a whole
//     risk-analysis run.
// Banking: retries with exponential backoff before surfacing the error to
//     the agent, which would otherwise abort the pipeline for the customer.

'use strict';

const { Agent } = require('undici');

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

// Node's global fetch defaults to a 10s TCP connect timeout (undici default),
// too tight for rpt.cloud.sap's trial tier which occasionally takes longer
// to accept a connection under load. 30s gives slow-but-alive connections
// room to complete instead of failing before the request even starts.
const longConnectAgent = new Agent({ connect: { timeout: 30000 } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// `optionsFn` is called fresh for each attempt so AbortSignal.timeout()
// (which can only be used once) gets a new signal per retry.
async function fetchWithRetry(url, optionsFn, { retries = 2, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const options = typeof optionsFn === 'function' ? optionsFn() : optionsFn;
      const response = await fetch(url, { dispatcher: longConnectAgent, ...options });
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return response;
    } catch (err) {
      console.error(`  [fetchWithRetry] ${url} attempt ${attempt} failed: ${err.message}`, err.cause || err);
      lastError = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

module.exports = { fetchWithRetry };
