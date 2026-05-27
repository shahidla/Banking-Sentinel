'use strict';
require('dotenv').config();
const cds  = require('@sap/cds');
const path = require('path');
const fs   = require('fs');
const { v4: uuid } = require('uuid');

const DELAY_MS = 120;  // ms between OpenAI calls — stay within rate limit

// All three regulatory JSON files — one chunk per section
const JSON_SOURCES = [
  path.join(__dirname, '../Data/regulatory/aps-221.json'),
  path.join(__dirname, '../Data/regulatory/cps-230.json'),
  path.join(__dirname, '../Data/regulatory/dti-notice-feb2026.json')
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  });
  if (!response.ok) throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
  return (await response.json()).data[0].embedding;
}

async function embedAndInsert(title, standard, chunks) {
  let stored = 0;
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i]);
    await cds.run(INSERT.into('bankingsentinel.RegulatoryDocuments').entries({
      DOC_ID:      uuid(),
      TITLE:       `${title} — ${i + 1}`,
      STANDARD:    standard,
      CONTENT:     chunks[i],
      EMBEDDING:   JSON.stringify(embedding),
      UPLOADED_AT: new Date().toISOString()
    }));
    stored++;
    console.log(`    [${i + 1}/${chunks.length}] chunks embedded`);
    await sleep(DELAY_MS);
  }
  return stored;
}

async function run() {
  console.log('\n Banking Sentinel — seed-regulatory.js');
  console.log(' Demo 1 knowledge base: APS221 + CPS230 + DTI notice (threshold 8.0x) — from JSON, one chunk per section');
  console.log('='.repeat(70));

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not set in .env'); process.exit(1);
  }

  await cds.connect.to('db');

  // Clear all existing regulatory docs
  const existing = await cds.run(SELECT.from('bankingsentinel.RegulatoryDocuments'));
  console.log(`\n  Clearing ${existing.length} existing chunks from HANA...`);
  if (existing.length > 0) await cds.run(DELETE.from('bankingsentinel.RegulatoryDocuments'));
  console.log('  Cleared.\n');

  let totalChunks = 0;

  for (const jsonPath of JSON_SOURCES) {
    const doc    = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const chunks = doc.sections.map(s => `${doc.title} — ${s.heading}\n\n${s.content}`);
    console.log(`  Processing: ${doc.title}`);
    console.log(`  ${chunks.length} sections → ${chunks.length} chunks`);
    const n = await embedAndInsert(doc.title, doc.standard, chunks);
    totalChunks += n;
    console.log(`  Done: ${n} chunks for ${doc.standard}\n`);
  }

  // Summary
  const byStd = await cds.run(
    SELECT.from('bankingsentinel.RegulatoryDocuments')
      .columns('STANDARD', 'count(*) as N')
      .groupBy('STANDARD')
  );
  console.log('='.repeat(70));
  console.log(`  Total chunks embedded: ${totalChunks}`);
  console.log('  Breakdown:');
  byStd.forEach(r => console.log(`    ${r.STANDARD}: ${r.N} chunks`));
  console.log('\n  Demo 1 regulatory knowledge base READY');
  console.log('  Apply APRA Notice button will replace DTI_NOTICE chunks with 6.0x content\n');

  process.exit(0);
}

run().catch(e => { console.error('seed-regulatory failed:', e); process.exit(1); });
