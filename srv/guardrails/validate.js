// Banking Sentinel — Responsible AI Guardrails
// AI: Validation layer between every LangGraph agent node. Not behavioural — structural.
//     Every agent output passes through before being added to state.
// Banking: APRA CPS 230 requires every AI decision to be auditable and evidence-backed.
//          Below 40% confidence = refuse to output. Below 70% = Self-RAG re-query.
// SAP: Called as an intermediate node in the LangGraph StateGraph between each specialist agent

'use strict';

function validateAgentOutput(output, agentName) {
  const issues = [];

  // 1. Schema validation — correct shape
  if (!output || typeof output !== 'object') {
    return { valid: false, issues: ['Output is not an object'] };
  }

  // 2. Confidence check — below 40% = refuse to present findings
  const confidence = output.confidence;
  if (confidence !== undefined && confidence < 0.40) {
    issues.push(`Confidence ${(confidence * 100).toFixed(0)}% below 40% minimum — refusing to generate finding`);
    return { valid: false, issues, action: 'REFUSE', confidence };
  }

  // 3. Evidence check — every finding must have a source
  if (output.findings && Array.isArray(output.findings)) {
    const unsourced = output.findings.filter(f => !f.evidenceSource && !f.evidence);
    if (unsourced.length > 0) {
      issues.push(`${unsourced.length} finding(s) have no evidence source — not CPS 230 compliant`);
    }
  }

  // 4. Self-RAG trigger — below 70% triggers re-query (not refusal)
  const needsRequery = confidence !== undefined && confidence < 0.70;

  return {
    valid: issues.length === 0,
    issues,
    needsRequery,
    confidence,
    action: issues.length > 0 ? 'FLAG' : needsRequery ? 'REQUERY' : 'PASS',
    agent: agentName
  };
}

// Used by Synthesis Agent to check hallucination risk
function crossCheckClaimsAgainstSources(claims, sources) {
  if (!claims || !sources || sources.length === 0) return 0;
  const sourceText = sources.map(s => s.CONTENT || s.content || '').join(' ').toLowerCase();
  const claimTerms = claims.toLowerCase().split(/\s+/).filter(t => t.length > 5);
  const supported = claimTerms.filter(term => sourceText.includes(term)).length;
  return claimTerms.length > 0 ? supported / claimTerms.length : 1;
}

module.exports = { validateAgentOutput, crossCheckClaimsAgainstSources };
