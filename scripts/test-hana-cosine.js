'use strict';
require('dotenv').config();
// Test HANA native COSINE_SIMILARITY — confirms TO_REAL_VECTOR() SQL works end-to-end.
// Run: npx cds bind --exec node scripts/test-hana-cosine.js --profile hybrid

const cds = require('@sap/cds');

async function run() {
  console.log('\n Banking Sentinel — HANA cosine similarity smoke test');
  console.log('='.repeat(60));

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not set'); process.exit(1);
  }

  await cds.connect.to('db');

  // 1. Check row count
  const rows = await cds.run(
    `SELECT COUNT(*) AS N FROM "BANKINGSENTINEL_REGULATORYDOCUMENTS"`
  );
  const count = parseInt(rows[0]?.N ?? 0);
  console.log(`\n  RegulatoryDocuments rows: ${count}`);
  if (count === 0) {
    console.error('  No rows — run seed-regulatory.js first'); process.exit(1);
  }

  // 2. Get embedding for a test query
  console.log('\n  Getting embedding for "DTI debt-to-income ratio limit"...');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: 'DTI debt-to-income ratio limit' })
  });
  if (!res.ok) { console.error('OpenAI error:', res.status); process.exit(1); }
  const embedding = (await res.json()).data[0].embedding;
  console.log(`  Embedding dims: ${embedding.length}`);

  // 3. Run HANA native cosine SQL
  console.log('\n  Running COSINE_SIMILARITY(TO_REAL_VECTOR(...)) SQL...');
  const vectorStr = JSON.stringify(embedding);
  const results = await cds.run(
    `SELECT TOP 3 TITLE, STANDARD,
       COSINE_SIMILARITY(TO_REAL_VECTOR(EMBEDDING), TO_REAL_VECTOR(?)) AS SIMILARITY
     FROM "BANKINGSENTINEL_REGULATORYDOCUMENTS"
     ORDER BY SIMILARITY DESC`,
    [vectorStr]
  );

  console.log('\n  Top 3 results:');
  results.forEach((r, i) => {
    console.log(`    ${i + 1}. [${r.STANDARD}] ${r.TITLE}`);
    console.log(`       similarity: ${parseFloat(r.SIMILARITY).toFixed(4)}`);
  });

  const topSim = parseFloat(results[0]?.SIMILARITY ?? 0);
  if (results.length > 0 && topSim > 0.3) {
    console.log('\n  PASS — HANA cosine similarity working correctly');
  } else {
    console.log(`\n  WARN — top similarity ${topSim.toFixed(4)} is low; check embedding storage format`);
  }

  console.log('='.repeat(60));
  process.exit(0);
}

run().catch(e => { console.error('test-hana-cosine failed:', e.message); process.exit(1); });
