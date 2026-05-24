// Banking Sentinel — GraphDB Seed Script
// AI: Loads HANA relational data as RDF triples into GraphDB knowledge graph
// Banking: BUT050 (connected party relationships) + BusinessPartners become graph nodes/edges
// SAP: Trial equivalent of HANA KGE — same SPARQL queries work on both endpoints
//
// Run anytime to restore GraphDB sandbox (expires every 7 days):
//   npx cds bind --exec node scripts/seed-graphdb.js --profile hybrid

require('dotenv').config();
const cds = require('@sap/cds');

const GRAPHDB_ENDPOINT   = process.env.GRAPHDB_ENDPOINT;
const GRAPHDB_REPOSITORY = process.env.GRAPHDB_REPOSITORY;
const SPARQL_UPDATE_URL  = `${GRAPHDB_ENDPOINT}/repositories/${GRAPHDB_REPOSITORY}/statements`;
const SPARQL_QUERY_URL   = `${GRAPHDB_ENDPOINT}/repositories/${GRAPHDB_REPOSITORY}`;
const BASE_URI = 'urn:banking-sentinel:';

(async () => {
  await cds.connect.to('db');

  try {
    console.log('=== Banking Sentinel — GraphDB Seed ===\n');

    // ─── 1. Read from HANA via CAP (HDI technical user) ──────────────────
    console.log('Reading BusinessPartners from HANA...');
    const partners = await cds.run(
      SELECT.from('bankingsentinel.BusinessPartners')
        .columns('PARTNER', 'BU_TYPE', 'BU_SORT1', 'SECTOR_CODE', 'DTI_RATIO')
    );
    console.log(`  ${partners.length} business partners`);

    console.log('Reading BUT050 relationships from HANA...');
    const edges = await cds.run(
      SELECT.from('bankingsentinel.BUT050').columns('PARTNER1', 'PARTNER2', 'RELTYP')
    );
    console.log(`  ${edges.length} relationships`);

    // ─── 2. Clear existing graph ──────────────────────────────────────────
    console.log('\nClearing existing GraphDB triples...');
    await sparqlUpdate(`CLEAR ALL`);
    console.log('  Cleared');

    // ─── 3. Build RDF triples ─────────────────────────────────────────────
    console.log('\nBuilding RDF triples...');
    const triples = [];

    // BusinessPartner nodes — each partner becomes an RDF resource with properties
    for (const p of partners) {
      const subject = `<${BASE_URI}partner/${p.PARTNER}>`;
      triples.push(`${subject} <${BASE_URI}type> <${BASE_URI}BusinessPartner> .`);
      triples.push(`${subject} <${BASE_URI}partnerId> "${p.PARTNER}" .`);
      if (p.BU_TYPE)     triples.push(`${subject} <${BASE_URI}buType> "${p.BU_TYPE}" .`);
      if (p.BU_SORT1)    triples.push(`${subject} <${BASE_URI}name> "${escape(p.BU_SORT1)}" .`);
      if (p.SECTOR_CODE) triples.push(`${subject} <${BASE_URI}sectorCode> "${p.SECTOR_CODE}" .`);
      if (p.DTI_RATIO)   triples.push(`${subject} <${BASE_URI}dtiRatio> "${p.DTI_RATIO}" .`);
    }

    // BUT050 relationships — each row becomes an RDF triple linking two partners
    for (const e of edges) {
      const subject = `<${BASE_URI}partner/${e.PARTNER1}>`;
      const object  = `<${BASE_URI}partner/${e.PARTNER2}>`;
      triples.push(`${subject} <${BASE_URI}relatedTo/${e.RELTYP}> ${object} .`);
      triples.push(`${subject} <${BASE_URI}relatedTo> ${object} .`);
    }

    console.log(`  ${triples.length} triples built`);

    // ─── 4. Load into GraphDB in batches ─────────────────────────────────
    console.log('\nLoading triples into GraphDB...');
    const BATCH = 500;
    for (let i = 0; i < triples.length; i += BATCH) {
      const batch = triples.slice(i, i + BATCH);
      await sparqlUpdate(`INSERT DATA { ${batch.join('\n')} }`);
      process.stdout.write(`  ${Math.min(i + BATCH, triples.length)}/${triples.length} triples loaded\r`);
    }
    console.log(`\n  Done — ${triples.length} triples in GraphDB`);

    // ─── 5. Verify with SPARQL traversal ─────────────────────────────────
    console.log('\nVerifying — SPARQL traversal from 30100003 (depth 6)...');
    const result = await sparqlQuery(`
      PREFIX bs: <${BASE_URI}>
      SELECT DISTINCT ?partnerId ?reltyp WHERE {
        <${BASE_URI}partner/30100003> bs:relatedTo* ?node .
        ?node bs:partnerId ?partnerId .
        OPTIONAL {
          <${BASE_URI}partner/30100003> ?rel ?node .
          BIND(STRAFTER(STR(?rel), "relatedTo/") AS ?reltyp)
        }
        FILTER(?partnerId != "30100003")
      }
      LIMIT 20
    `);
    console.log(`  Connected parties found: ${result.results.bindings.length}`);
    result.results.bindings.forEach(b =>
      console.log(`    → ${b.partnerId?.value} (${b.reltyp?.value || 'direct'})`)
    );

    console.log('\n=== Seed complete ===');
    console.log(`Endpoint:   ${GRAPHDB_ENDPOINT}`);
    console.log(`Repository: ${GRAPHDB_REPOSITORY}`);
    console.log(`Triples:    ${triples.length}`);

  } catch (e) {
    console.error('Seed failed:', e.message);
    process.exit(1);
  }
})();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getHdiSchema() {
  // HDI schema from HANA connection — read from env or derive from known schema
  return process.env.HANA_HDI_SCHEMA || 'B8EC4EAB42CB46BE940B89D1209CC93D';
}

function escape(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function authHeader() {
  const user = process.env.GRAPHDB_USERNAME;
  const pass = process.env.GRAPHDB_PASSWORD;
  if (!user || !pass) return {};
  return { 'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
}

async function sparqlUpdate(updateQuery) {
  const response = await fetch(SPARQL_UPDATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-update', ...authHeader() },
    body: updateQuery
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphDB update failed (${response.status}): ${text.substring(0, 200)}`);
  }
}

async function sparqlQuery(query) {
  const response = await fetch(SPARQL_QUERY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      'Accept': 'application/sparql-results+json',
      ...authHeader()
    },
    body: query
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphDB query failed (${response.status}): ${text.substring(0, 200)}`);
  }
  return response.json();
}
