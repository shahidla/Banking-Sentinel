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
// SAP: HANA native COSINE_SIMILARITY(TO_REAL_VECTOR(EMBEDDING), TO_REAL_VECTOR(?)) — single SQL
//      push-down, no full table scan in Node.js. EMBEDDING stored as JSON array string.

async function getEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: text })
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
  if (useHyDE) {
    const { ChatAnthropic } = require('@langchain/anthropic');
    const llm = new ChatAnthropic({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', maxTokens: 200 });
    const hydeResponse = await llm.invoke([{
      role: 'user',
      content: `Generate a precise APRA regulatory document excerpt that would directly answer: "${query}". Include exact thresholds and timeframes. 120 words max.`
    }]);
    searchText = typeof hydeResponse.content === 'string' ? hydeResponse.content : String(hydeResponse.content);
  }

  const queryEmbedding = await getEmbedding(searchText);
  const vectorStr = JSON.stringify(queryEmbedding);

  const db = await cds.connect.to('db');
  const params = [vectorStr];
  const whereClause = standard ? 'WHERE STANDARD = ?' : '';
  if (standard) params.push(standard);

  const rows = await db.run(
    `SELECT TOP ${topK} DOC_ID, TITLE, STANDARD, CONTENT,
       COSINE_SIMILARITY(TO_REAL_VECTOR(EMBEDDING), TO_REAL_VECTOR(?)) AS SIMILARITY
     FROM "BANKINGSENTINEL_REGULATORYDOCUMENTS"
     ${whereClause}
     ORDER BY SIMILARITY DESC`,
    params
  );

  return rows.map(r => ({
    DOC_ID:    r.DOC_ID,
    TITLE:     r.TITLE,
    STANDARD:  r.STANDARD,
    CONTENT:   r.CONTENT,
    similarity: parseFloat(r.SIMILARITY)
  }));
}

// ─── TOOL 3: hana_graph_traverse ────────────────────────────────────────────
// AI: Multi-hop graph traversal — the core of ReAct loop in Relationship Agent
// Banking: 30100001 → BUT050 → guarantor → BUT050 → parent entity (6 hops = APS 221 group found)
// SAP: Trial equivalent of HANA KGE — GraphDB (RDF triple store) + SPARQL property paths.
//      Same SPARQL query runs on HANA KGE in production — one endpoint change to swap.
//      Seed: npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid

const BASE_URI = 'urn:banking-sentinel:';

async function sparqlQuery(sparql) {
  const endpoint = `${process.env.GRAPHDB_ENDPOINT}/repositories/${process.env.GRAPHDB_REPOSITORY}`;
  const auth = Buffer.from(`${process.env.GRAPHDB_USERNAME}:${process.env.GRAPHDB_PASSWORD}`).toString('base64');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json', 'Authorization': `Basic ${auth}` },
    body: sparql,
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`GraphDB SPARQL error ${res.status}: ${(await res.text()).substring(0, 200)}`);
  return res.json();
}

async function hana_graph_traverse({ startNode, depth = 6 }) {
  const maxDepth = Math.min(depth, 8);
  const startUri = `${BASE_URI}partner/${startNode}`;

  // ── SPARQL 1: multi-hop reachability — finds all nodes within maxDepth hops ──
  const hopClauses = [];
  let path = 'bs:relatedTo';
  for (let h = 1; h <= maxDepth; h++) {
    hopClauses.push(`{ <${startUri}> ${path} ?node . BIND(${h} AS ?hop) }`);
    path += '/bs:relatedTo';
  }

  const reachabilitySparql = `
    PREFIX bs: <${BASE_URI}>
    SELECT ?partnerId (MIN(?hop) AS ?minHop) ?reltyp WHERE {
      ${hopClauses.join('\n      UNION\n      ')}
      ?node bs:partnerId ?partnerId .
      OPTIONAL {
        <${startUri}> ?rel ?node .
        FILTER(STRSTARTS(STR(?rel), "${BASE_URI}relatedTo/"))
        BIND(STRAFTER(STR(?rel), "relatedTo/") AS ?reltyp)
      }
      FILTER(?partnerId != "${startNode}")
    }
    GROUP BY ?partnerId ?reltyp
  `;

  const reach = await sparqlQuery(reachabilitySparql);
  const traversalRows = reach.results.bindings.map(b => ({
    PARTNER:  b.partnerId.value,
    REL_TYPE: b.reltyp?.value || null,
    HOP:      parseInt(b.minHop.value)
  }));

  const connectedPartners = traversalRows.map(r => r.PARTNER);
  const allPartners = [...new Set([startNode, ...connectedPartners])];

  // ── SPARQL 2: real edge pairs within the discovered subgraph ─────────────────
  // Returns actual A→B links — corrects the star-graph bug where everything
  // appeared as startNode→partner regardless of hop depth.
  const valuesList = allPartners.map(id => `"${id}"`).join(' ');
  const edgeSparql = `
    PREFIX bs: <${BASE_URI}>
    SELECT DISTINCT ?fromId ?reltype ?toId WHERE {
      ?s ?rel ?o .
      FILTER(STRSTARTS(STR(?rel), "${BASE_URI}relatedTo/"))
      ?s bs:partnerId ?fromId .
      ?o bs:partnerId ?toId .
      VALUES ?fromId { ${valuesList} }
      VALUES ?toId   { ${valuesList} }
      BIND(STRAFTER(STR(?rel), "relatedTo/") AS ?reltype)
    }
  `;
  const edgeResult = await sparqlQuery(edgeSparql);
  const chainEdges = edgeResult.results.bindings.map(b => ({
    from: b.fromId.value,
    to:   b.toId.value,
    type: b.reltype.value
  }));

  // ── SPARQL 3: node names for the full discovered set ────────────────────────
  const nameSparql = `
    PREFIX bs: <${BASE_URI}>
    SELECT ?partnerId ?name WHERE {
      VALUES ?partnerId { ${valuesList} }
      ?node bs:partnerId ?partnerId .
      OPTIONAL { ?node bs:name ?name }
    }
  `;
  const nameResult = await sparqlQuery(nameSparql);
  const nameMap = {};
  nameResult.results.bindings.forEach(b => {
    nameMap[b.partnerId.value] = b.name?.value || b.partnerId.value;
  });

  // ── Enriched node details — used by UI for rich graph rendering ──────────────
  // NB-2 fix: relType from SPARQL 1 is null for multi-hop nodes (property path loses edge type).
  // Fall back to the incoming edge type from chainEdges (SPARQL 2) when SPARQL 1 returns null.
  const nodeDetails = [
    { id: startNode, name: nameMap[startNode] || startNode, hop: 0, relType: null },
    ...traversalRows.map(r => {
      let relType = r.REL_TYPE;
      if (!relType) {
        const incomingEdge = chainEdges.find(e => e.to === r.PARTNER);
        relType = incomingEdge?.type || null;
      }
      return { id: r.PARTNER, name: nameMap[r.PARTNER] || r.PARTNER, hop: r.HOP, relType };
    })
  ];

  // ── Guarantor enrichment (startNode loans only) — exposure calculation only ──
  // Guarantor edges are NOT added to the graph: guarantors already appear via
  // SPARQL through BUT050 relatedTo triples. Adding loan-based edges creates
  // LOAN_ID dangling nodes that aren't in the partner node set.
  const loanRows = await cds.run(
    SELECT.from('bankingsentinel.Loans')
      .where({ PARTNER: startNode })
      .columns('LOAN_ID', 'PARTNER')
  );
  const loanIds = loanRows.map(l => l.LOAN_ID);

  let guarantors = [];
  if (loanIds.length > 0) {
    guarantors = await cds.run(
      SELECT.from('bankingsentinel.BCA_GUARANTOR')
        .where({ LOAN_ID: { in: loanIds }, STATUS: 'ACTIVE' })
    );
    guarantors.forEach(g => {
      if (!allPartners.includes(g.GUARANTOR_PARTNER)) allPartners.push(g.GUARANTOR_PARTNER);
    });
  }

  const groupExposure = guarantors.reduce((sum, g) => sum + parseFloat(g.COVER_AMOUNT || 0), 0);
  const limits = await cds.run(SELECT.from('bankingsentinel.ExposureLimits').where({ LIMIT_TYPE: 'GROUP' }));
  const aps221Pct = limits[0] ? (groupExposure / parseFloat(limits[0].LIMIT_AUD)) * 100 : 0;
  const maxHop = traversalRows.length > 0 ? Math.max(...traversalRows.map(r => r.HOP || 0)) : 0;

  console.log(`  [GraphTraverse] nodes:${allPartners.length} chainEdges:${chainEdges.length} guarantors:${guarantors.length} groupExposure:${groupExposure} aps221Pct:${aps221Pct.toFixed(1)}%`);

  return {
    nodes:       allPartners,   // flat string[] — backward compat for exposure_calculator
    nodeDetails,                // enriched objects — for UI graph rendering
    edges:       chainEdges,    // real A→B pairs from SPARQL — not a star
    groupExposure, aps221Pct, hops: maxHop
  };
}

// ─── TOOL 4: apra_threshold_check ───────────────────────────────────────────
// AI: Rule-based threshold check — not LLM reasoning, deterministic regulation lookup
// Banking: DTI 7.2 > 6.0 limit? APS 221 exposure > 90% of limit?
// SAP: Queries bankingsentinel.ExposureLimits and bankingsentinel.RegulatoryThresholds

async function apra_threshold_check({ metricType, value, entityId }) {
  let limit, threshold, breach, utilisation;

  if (metricType === 'large_exposure' || metricType === 'aps221') {
    // APS 221 connected-party group exposure uses GROUP limit; single-entity uses SINGLE limit
    const limitType = metricType === 'aps221' ? 'GROUP' : 'SINGLE';
    const limits = await cds.run(SELECT.from('bankingsentinel.ExposureLimits').where({ LIMIT_TYPE: limitType }));
    limit = limits[0]?.LIMIT_AUD;
    utilisation = limit ? (value / limit) * 100 : null;
    breach = utilisation > 100;
    threshold = limits[0]?.NOTIFICATION_PCT || 90;
  } else if (metricType === 'dti') {
    const dtiThresholdRows = await cds.run(
      SELECT.from('bankingsentinel.RegulatoryThresholds').where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' }).limit(1)
    );
    limit = parseFloat(dtiThresholdRows[0]?.LIMIT_PCT) || 8.0;
    utilisation = (value / limit) * 100;
    breach = value > limit;
    threshold = 100;
  } else if (metricType === 'sector_concentration') {
    const limits = await cds.run(
      SELECT.from('bankingsentinel.SectorExposureLimits').where({ SECTOR_CODE: entityId })
    );
    const sectorLimit = limits[0]?.LIMIT_AUD;
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
// Banking: Total credit exposure across a connected party group for APS 221
//          Uses SUM(Loans.AMOUNT) — direct loan value, not guarantee coverage amount
// SAP: Loans.AMOUNT is the funded credit exposure; COVER_AMOUNT is collateral, not exposure

async function exposure_calculator({ entityIds, includeGuarantors = true }) {
  if (!entityIds || entityIds.length === 0) return { total: 0, breakdown: [] };

  const guarantors = includeGuarantors
    ? await cds.run(SELECT.from('bankingsentinel.BCA_GUARANTOR').where({ GUARANTOR_PARTNER: { in: entityIds } }))
    : [];

  const loans = await cds.run(SELECT.from('bankingsentinel.Loans').where({ PARTNER: { in: entityIds } }));

  // APS 221 group exposure = sum of all direct loans to all connected entities
  const total = loans.reduce((sum, l) => sum + parseFloat(l.AMOUNT || 0), 0);

  const breakdown = entityIds.map(id => {
    const entityLoans     = loans.filter(l => l.PARTNER === id);
    const entityGuarantors = guarantors.filter(g => g.GUARANTOR_PARTNER === id);
    return {
      entityId:        id,
      directLoans:     entityLoans.length,
      loanAmount:      entityLoans.reduce((s, l) => s + parseFloat(l.AMOUNT || 0), 0),
      guaranteedLoans: entityGuarantors.length,
      coverAmount:     entityGuarantors.reduce((s, g) => s + parseFloat(g.COVER_AMOUNT || 0), 0)
    };
  });

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
    description: 'Multi-hop relationship traversal via SPARQL/GraphDB (HANA Knowledge Graph Engine in production — not available on BTP trial).',
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
  getEmbedding
};
