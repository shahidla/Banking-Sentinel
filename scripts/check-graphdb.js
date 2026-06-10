// One-off: check GraphDB connectivity and whether the 11 BCA_DTI demo
// customers (30100001-30100013, minus 0007/0011) and their connected
// parties (BUT050) are present as RDF triples.
'use strict';
require('dotenv').config();

const GRAPHDB_ENDPOINT   = process.env.GRAPHDB_ENDPOINT;
const GRAPHDB_REPOSITORY = process.env.GRAPHDB_REPOSITORY;
const SPARQL_QUERY_URL   = `${GRAPHDB_ENDPOINT}/repositories/${GRAPHDB_REPOSITORY}`;
const BASE_URI = 'urn:banking-sentinel:';

function authHeader() {
  const user = process.env.GRAPHDB_USERNAME;
  const pass = process.env.GRAPHDB_PASSWORD;
  return { 'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
}

async function sparqlQuery(query) {
  const response = await fetch(SPARQL_QUERY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      'Accept': 'application/sparql-results+json',
      ...authHeader()
    },
    body: query,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphDB query failed (${response.status}): ${text.substring(0, 300)}`);
  }
  return response.json();
}

(async () => {
  console.log(`Endpoint:   ${GRAPHDB_ENDPOINT}`);
  console.log(`Repository: ${GRAPHDB_REPOSITORY}`);

  console.log('\n1. Total triple count:');
  const countResult = await sparqlQuery(`SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }`);
  console.log('  ', countResult.results.bindings[0].n.value, 'triples');

  console.log('\n2. Total BusinessPartner nodes:');
  const partnerResult = await sparqlQuery(`
    PREFIX bs: <${BASE_URI}>
    SELECT (COUNT(*) AS ?n) WHERE { ?s bs:type bs:BusinessPartner }
  `);
  console.log('  ', partnerResult.results.bindings[0].n.value, 'partner nodes');

  const demoIds = ['30100001','30100002','30100003','30100004','30100005','30100006','30100008','30100009','30100010','30100012','30100013'];
  console.log('\n3. Presence check for the 11 demo partners + their BUT050-connected parties:');
  const valuesList = demoIds.map(id => `"${id}"`).join(' ');
  const presenceResult = await sparqlQuery(`
    PREFIX bs: <${BASE_URI}>
    SELECT ?partnerId WHERE {
      VALUES ?partnerId { ${valuesList} }
      ?node bs:partnerId ?partnerId .
    }
  `);
  const found = new Set(presenceResult.results.bindings.map(b => b.partnerId.value));
  for (const id of demoIds) {
    console.log(`   ${id}: ${found.has(id) ? 'FOUND' : 'MISSING'}`);
  }

  console.log('\n4. Traversal check from 30100001 (depth 6):');
  const traversal = await sparqlQuery(`
    PREFIX bs: <${BASE_URI}>
    SELECT DISTINCT ?partnerId WHERE {
      <${BASE_URI}partner/30100001> bs:relatedTo* ?node .
      ?node bs:partnerId ?partnerId .
      FILTER(?partnerId != "30100001")
    }
  `);
  console.log('   Connected partners:', traversal.results.bindings.map(b => b.partnerId.value));

  console.log('\n5. Traversal check from 30100002 (depth 6):');
  const traversal2 = await sparqlQuery(`
    PREFIX bs: <${BASE_URI}>
    SELECT DISTINCT ?partnerId WHERE {
      <${BASE_URI}partner/30100002> bs:relatedTo* ?node .
      ?node bs:partnerId ?partnerId .
      FILTER(?partnerId != "30100002")
    }
  `);
  console.log('   Connected partners:', traversal2.results.bindings.map(b => b.partnerId.value));

  console.log('\n6. Guarantor nodes 30910005-30910008 present?');
  const guarResult = await sparqlQuery(`
    PREFIX bs: <${BASE_URI}>
    SELECT ?partnerId WHERE {
      VALUES ?partnerId { "30910005" "30910006" "30910007" "30910008" }
      ?node bs:partnerId ?partnerId .
    }
  `);
  console.log('   Found:', guarResult.results.bindings.map(b => b.partnerId.value));

})().catch(e => {
  console.error('CHECK FAILED:', e.message);
  process.exit(1);
});
