// Banking Sentinel — MCP Tool Definitions
// AI: MCP (Model Context Protocol) — standard for agent-tool connections. Agents call tools,
//     not hardcoded functions. Tool discovery = capability declaration.
// Banking: Tools are the agent's hands — hana_relational_query fetches loan data,
//          hana_graph_traverse finds connected parties, hana_vector_search retrieves APRA rules.
// SAP: 5 MCP tools covering all three HANA engines (relational, graph, vector) + regulatory checks

'use strict';
const cds = require('@sap/cds');

// ─── TOOL 1: hana_relational_query ──────────────────────────────────────────
// AI: Structured data retrieval — TRBK relational tables. No reasoning here.
// Banking: Fetch loan amounts, DTI ratios, payment records — inputs to agent reasoning
// SAP: cds.run(SELECT.from('bankingsentinel.X').where(...)) — CAP handles HANA connection

async function hana_relational_query({ tables, filters = {}, fields = [] }) {
  if (!tables || tables.length === 0) throw new Error('tables is required');

  const entity = tables[0].includes('.') ? tables[0] : `bankingsentinel.${tables[0]}`;
  let query = SELECT.from(entity);
  if (fields.length > 0) query = query.columns(...fields);
  if (Object.keys(filters).length > 0) query = query.where(filters);

  return cds.run(query);
}

// ─── TOOL 2: hana_vector_search ─────────────────────────────────────────────
// AI: Semantic similarity search — finds APRA regulatory chunks closest to the query
// Banking: "Is this a large exposure?" → retrieves APS 221 clauses on large exposure limits
// SAP: HANA Vector Engine via LargeString EMBEDDING field + cosine similarity in Node.js
//      Production upgrade: COSINE_SIMILARITY(TO_REAL_VECTOR(EMBEDDING), TO_REAL_VECTOR(?))

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function getEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  });
  if (!response.ok) throw new Error(`OpenAI embedding error ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding;
}

async function hana_vector_search({ query, topK = 5, useHyDE = false, standard = null }) {
  let searchText = query;

  // HyDE: generate a hypothetical APRA document excerpt first, then embed that
  // AI: Improves retrieval for sparse regulatory queries (question vs declaration vocabulary gap)
  // Banking: "Does this breach APS 221?" → HyDE generates "A connected group exposure exceeding..."
  // SAP: Pre-processing step before HANA Vector query (will become a LangGraph node in Phase 5)
  if (useHyDE) {
    const { ChatAnthropic } = require('@langchain/anthropic');
    const llm = new ChatAnthropic({ model: 'claude-sonnet-4-6', maxTokens: 200 });
    const hydeResponse = await llm.invoke([{
      role: 'user',
      content: `Generate a precise APRA regulatory document excerpt that would directly answer: "${query}". Include exact thresholds and timeframes. 120 words max.`
    }]);
    searchText = typeof hydeResponse.content === 'string' ? hydeResponse.content : String(hydeResponse.content);
  }

  const queryEmbedding = await getEmbedding(searchText);

  let docsQuery = SELECT.from('bankingsentinel.RegulatoryDocuments');
  if (standard) docsQuery = docsQuery.where({ STANDARD: standard });
  const allDocs = await cds.run(docsQuery);

  if (allDocs.length === 0) return [];

  const scored = allDocs.map(doc => ({
    DOC_ID: doc.DOC_ID,
    TITLE: doc.TITLE,
    STANDARD: doc.STANDARD,
    CONTENT: doc.CONTENT,
    similarity: cosineSimilarity(queryEmbedding, JSON.parse(doc.EMBEDDING))
  }));

  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

// ─── TOOL 3: hana_graph_traverse ────────────────────────────────────────────
// AI: Multi-hop graph traversal — the core of ReAct loop in Relationship Agent
// Banking: B-001 → BKKN → BCA_GUARANTOR → G-001 → BUT050 → G-002 (6 hops = APS 221 group found)
// SAP: HANA Knowledge Graph Engine (SPARQL) — Phase 4 implementation
//      Phase 3 stub: sequential CDS queries (same logic, no SPARQL syntax)

async function hana_graph_traverse({ startNode, nodeType = 'BusinessPartner', depth = 6, filters = {} }) {
  // Phase 3 stub — returns direct relationships via SQL joins
  // Full HANA Knowledge Graph Engine SPARQL implementation in Phase 4
  const results = {
    nodes: [startNode],
    edges: [],
    groupExposure: 0,
    aps221Pct: 0,
    hops: 0,
    note: 'Phase 3 stub — HANA Knowledge Graph Engine SPARQL in Phase 4'
  };

  // Get guarantors for this partner
  const guarantors = await cds.run(
    SELECT.from('bankingsentinel.BCA_GUARANTOR')
      .where(`LOAN_ID IN (SELECT LOAN_ID FROM bankingsentinel_BKKN WHERE GPART = '${startNode}')`)
  );

  for (const g of guarantors) {
    results.nodes.push(g.GUARANTOR_PARTNER);
    results.edges.push({ from: startNode, to: g.GUARANTOR_PARTNER, type: 'GUARANTEED_BY', hop: 1 });
    results.groupExposure += parseFloat(g.COVER_AMOUNT || 0);
  }

  // Check BUT050 for connected parties
  const connected = await cds.run(
    SELECT.from('bankingsentinel.BUT050').where({ PARTNER1: startNode })
  );
  for (const c of connected) {
    if (!results.nodes.includes(c.PARTNER2)) results.nodes.push(c.PARTNER2);
    results.edges.push({ from: c.PARTNER1, to: c.PARTNER2, type: c.RELTYP, hop: 2 });
  }

  // APS 221 utilisation
  const limits = await cds.run(SELECT.from('bankingsentinel.ExposureLimits').where({ LIMIT_TYPE: 'GROUP' }));
  if (limits[0]) results.aps221Pct = (results.groupExposure / limits[0].LIMIT_AUD) * 100;

  results.hops = results.edges.length;
  return results;
}

// ─── TOOL 4: apra_threshold_check ───────────────────────────────────────────
// AI: Rule-based threshold check — not LLM reasoning, deterministic regulation lookup
// Banking: DTI 7.2 > 6.0 limit? APS 221 exposure > 90% of limit?
// SAP: Queries bankingsentinel.ExposureLimits and bankingsentinel.RegulatoryThresholds

async function apra_threshold_check({ metricType, value, entityId }) {
  let limit, threshold, breach, utilisation;

  if (metricType === 'large_exposure' || metricType === 'aps221') {
    const limits = await cds.run(SELECT.from('bankingsentinel.ExposureLimits').where({ LIMIT_TYPE: 'SINGLE' }));
    limit = limits[0]?.LIMIT_AUD;
    utilisation = limit ? (value / limit) * 100 : null;
    breach = utilisation > 100;
    threshold = limits[0]?.NOTIFICATION_PCT || 90;
  } else if (metricType === 'dti') {
    limit = 6.0; // APRA February 2026 activation
    utilisation = (value / limit) * 100;
    breach = value > limit;
    threshold = 100;
  } else if (metricType === 'sector_concentration') {
    const limits = await cds.run(SELECT.from('bankingsentinel.SectorExposureLimits'));
    const sectorLimit = limits[0]?.LIMIT_AUD; // simplified — lookup by sector in Phase 5
    utilisation = sectorLimit ? (value / sectorLimit) * 100 : null;
    breach = utilisation > 100;
    threshold = 75;
  }

  return {
    metricType,
    entityId,
    value,
    limit,
    utilisation: utilisation?.toFixed(1),
    breach,
    boardNotificationRequired: utilisation >= threshold,
    threshold,
    regulatoryReference: metricType === 'dti' ? 'APRA DTI Limit Activation Notice February 2026' : 'APS 221'
  };
}

// ─── TOOL 5: exposure_calculator ────────────────────────────────────────────
// AI: Deterministic aggregation — not LLM, pure arithmetic over HANA records
// Banking: Total guaranteed exposure across a connected party group for APS 221
// SAP: SUM(COVER_AMOUNT) from BCA_GUARANTOR grouped by guarantor network

async function exposure_calculator({ entityIds, includeGuarantors = true }) {
  if (!entityIds || entityIds.length === 0) return { total: 0, breakdown: [] };

  const guarantors = includeGuarantors
    ? await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ GUARANTOR_PARTNER: { in: entityIds } }))
    : [];

  const loans = await cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: { in: entityIds } }));

  const total = guarantors.reduce((sum, g) => sum + parseFloat(g.COVER_AMOUNT || 0), 0);
  const breakdown = entityIds.map(id => ({
    entityId: id,
    guaranteedLoans: guarantors.filter(g => g.GUARANTOR_PARTNER === id).length,
    guaranteedAmount: guarantors.filter(g => g.GUARANTOR_PARTNER === id)
      .reduce((s, g) => s + parseFloat(g.COVER_AMOUNT || 0), 0),
    directLoans: loans.filter(l => l.PARTNER === id).length
  }));

  return { total, breakdown, currency: 'AUD' };
}

// ─── MCP TOOL REGISTRY ──────────────────────────────────────────────────────
// AI: Tool discovery — agents query this registry for available capabilities
// Banking: Each tool corresponds to a specific TRBK data source or regulatory check
// SAP: In production, these become registered MCP servers on BTP CF

const MCP_TOOLS = {
  hana_relational_query: {
    description: 'Query TRBK relational tables in HANA Cloud. Returns structured data.',
    inputSchema: {
      tables: 'string[]  // e.g. ["DFKKOP"] or ["bankingsentinel.BCA_DTI"]',
      filters: 'object   // e.g. { PARTNER: "30100001", STATUS: "OPEN" }',
      fields:  'string[] // specific fields to return, empty = all'
    },
    fn: hana_relational_query
  },
  hana_vector_search: {
    description: 'Semantic search over APRA regulatory documents in HANA Vector.',
    inputSchema: {
      query:   'string  // natural language query',
      topK:    'number  // default 5',
      useHyDE: 'boolean // generate hypothetical document first (Phase 2 HyDE pattern)',
      standard: 'string // filter by standard: APS221, CPS230, DTI_LIMIT_FEB2026 etc.'
    },
    fn: hana_vector_search
  },
  hana_graph_traverse: {
    description: 'Multi-hop relationship traversal via HANA Knowledge Graph Engine.',
    inputSchema: {
      startNode: 'string  // e.g. "30100001"',
      nodeType:  'string  // BusinessPartner | Loan | Guarantor',
      depth:     'number  // max 8 hops',
      filters:   'object  // e.g. { relTypes: ["FAMILY_TRUST_MEMBER"] }'
    },
    fn: hana_graph_traverse
  },
  apra_threshold_check: {
    description: 'Check a value against APRA regulatory thresholds.',
    inputSchema: {
      metricType: 'string // large_exposure | dti | sector_concentration',
      value:      'number // the value to check',
      entityId:   'string // borrower or guarantor ID'
    },
    fn: apra_threshold_check
  },
  exposure_calculator: {
    description: 'Calculate total group exposure across connected entities for APS 221.',
    inputSchema: {
      entityIds:        'string[]  // guarantor or borrower IDs in the group',
      includeGuarantors: 'boolean  // include guaranteed loan amounts'
    },
    fn: exposure_calculator
  }
};

module.exports = {
  MCP_TOOLS,
  hana_relational_query,
  hana_vector_search,
  hana_graph_traverse,
  apra_threshold_check,
  exposure_calculator,
  cosineSimilarity,
  getEmbedding
};
