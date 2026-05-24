// Banking Sentinel — Simple Query Node
// AI: Direct data retrieval — no agent reasoning, no graph traversal. Fast path for factual questions.
// Banking: "What is total loan amount?" should not trigger a five-agent risk pipeline.
//          ABAP would answer this. So should we — fast, direct, no over-engineering.
// SAP: Queries HANA relational tables via CDS SELECT. Routes to END immediately after.
//      Panel 2 in the UI shows Relationship + Trajectory nodes as greyed out for simple queries.

'use strict';
const cds = require('@sap/cds');
const { ChatAnthropic } = require('@langchain/anthropic');

const SIMPLE_QUERY_SYSTEM = `You are Banking Sentinel, an AI risk intelligence system for a major Australian bank.
Answer the user's question using ONLY the provided portfolio statistics below.
Be concise and precise. Use AUD currency where applicable.
After your answer, offer: "Would you like a full risk analysis of any specific borrower?"
Do NOT add commentary not supported by the statistics provided.`;

async function simpleQueryNode(state) {
  // Fetch a context package of common portfolio statistics
  // This is safe: no dynamic SQL, predefined CDS queries only
  const [loanStats, borrowerCount, overdueItems, dtiBreaches, guarantorExposure, sectorConc] = await Promise.all([
    cds.run(SELECT.from('bankingsentinel.Loans').columns('sum(AMOUNT) as TOTAL', 'count(*) as COUNT')),
    cds.run(SELECT.from('bankingsentinel.BusinessPartners').columns('count(*) as COUNT')),
    cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ STATUS: 'OPEN' })),
    cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ BREACH_FLAG: true })),
    cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').columns('sum(COVER_AMOUNT) as TOTAL', 'count(*) as COUNT')),
    cds.run(SELECT.from('bankingsentinel.BCA_SECTOR').columns('SECTOR_CODE', 'count(*) as COUNT').groupBy('SECTOR_CODE'))
  ]);

  // If query is about a specific borrower, fetch their data too
  let borrowerData = '';
  const customerId = state.intent?.customerId || state.customerId;
  if (customerId) {
    const partnerMap = { 'B-001': '30100001', 'B-002': '30100002', 'B-003': '30100003',
      'G-001': '30910005', 'G-002': '30910006' };
    const partnerId = partnerMap[customerId] || customerId;

    const [dti, loans, overdue] = await Promise.all([
      cds.run(SELECT.from('bankingsentinel.BCA_DTI').where({ PARTNER: partnerId })),
      cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: partnerId })),
      cds.run(SELECT.from('bankingsentinel.DFKKOP').where({ GPART: partnerId, STATUS: 'OPEN' }))
    ]);

    if (dti.length > 0) {
      borrowerData = `\n${customerId} Data: DTI ratio ${dti[0].DTI_RATIO} (APRA limit 6.0, breach: ${dti[0].BREACH_FLAG}), Income expiry: ${dti[0].INCOME_EXPIRY || 'N/A'}`;
    }
    if (loans.length > 0) {
      const totalLoans = loans.reduce((s, l) => s + parseFloat(l.AMOUNT || 0), 0);
      borrowerData += `, Loans: ${loans.length} totalling AUD ${totalLoans.toLocaleString()}`;
    }
    if (overdue.length > 0) {
      const maxOverdue = Math.max(...overdue.map(o => o.DAYS_OVERDUE || 0));
      borrowerData += `, Open overdue items: ${overdue.length} (max ${maxOverdue} days)`;
    }
  }

  const totalLoan = parseFloat(loanStats[0]?.TOTAL || 0);
  const topSectors = sectorConc.sort((a, b) => b.COUNT - a.COUNT).slice(0, 3)
    .map(s => `${s.SECTOR_CODE} (${s.COUNT})`).join(', ');
  const totalGuarantorExposure = parseFloat(guarantorExposure[0]?.TOTAL || 0);

  const portfolioContext = `Portfolio Statistics as at today:
- Total loan portfolio: AUD ${totalLoan.toLocaleString()} across ${loanStats[0]?.COUNT || 0} loans
- Total business partners: ${borrowerCount[0]?.COUNT || 0}
- Open overdue payment items: ${overdueItems.length} items requiring attention
- DTI regulatory breaches (APRA limit 6.0): ${dtiBreaches.length} identified
- Total guaranteed exposure: AUD ${totalGuarantorExposure.toLocaleString()} across ${guarantorExposure[0]?.COUNT || 0} guarantor assignments
- Top sectors: ${topSectors}${borrowerData}`;

  const llm = new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxTokens: 400
  });

  const response = await llm.invoke([
    { role: 'system', content: SIMPLE_QUERY_SYSTEM },
    { role: 'user', content: `Query: ${state.query}\n\n${portfolioContext}` }
  ]);

  const answer = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);

  console.log(`  [SimpleQuery] Answered: ${answer.substring(0, 80)}...`);

  return {
    simpleQueryResult: answer,
    totalInputTokens:  response.usage_metadata?.input_tokens || 0,
    totalOutputTokens: response.usage_metadata?.output_tokens || 0
  };
}

module.exports = { simpleQueryNode };
