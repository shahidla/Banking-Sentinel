// Banking Sentinel — Phase 2: APRA Regulatory Document Embedding
// Chunks regulatory documents and stores embeddings in HANA Vector (RegulatoryDocuments table)
// AI Pattern: Knowledge Base Construction for RAG
// Banking: APRA standards embedded so agents can retrieve them by semantic similarity
// SAP: HANA Cloud Vector Engine via LargeString storage, CDS for DB connection
// Run: cds bind --exec node scripts/embed-documents.js

'use strict';
require('dotenv').config();
const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const REGULATORY_DIR = path.join(__dirname, '../Data/regulatory');

async function getEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI embeddings API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding; // 1536-dimensional float array
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function embed() {
  console.log('\n Banking Sentinel — Phase 2: Document Embedding');
  console.log('================================================\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not found in .env');
    process.exit(1);
  }

  await cds.connect.to('db');

  // Clear existing regulatory documents before re-embedding
  const existing = await cds.run(SELECT.from('bankingsentinel.RegulatoryDocuments'));
  if (existing.length > 0) {
    console.log(`  Clearing ${existing.length} existing document chunks...`);
    await cds.run(DELETE.from('bankingsentinel.RegulatoryDocuments'));
    console.log('  Cleared.\n');
  }

  const files = fs.readdirSync(REGULATORY_DIR).filter(f => f.endsWith('.json'));
  console.log(`  Found ${files.length} regulatory documents: ${files.join(', ')}\n`);

  let totalChunks = 0;
  let errors = 0;

  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(REGULATORY_DIR, file), 'utf8'));
    console.log(`  Processing: ${doc.title}`);
    console.log(`  Standard: ${doc.standard} | Sections: ${doc.sections.length}`);

    for (let i = 0; i < doc.sections.length; i++) {
      const section = doc.sections[i];
      // Prepend heading to content for richer embedding context
      const chunkText = `${doc.title} — ${section.heading}\n\n${section.content}`;

      try {
        const embedding = await getEmbedding(chunkText);

        await cds.run(
          INSERT.into('bankingsentinel.RegulatoryDocuments').entries({
            DOC_ID: uuid(),
            TITLE: `${doc.standard} — ${section.heading}`,
            STANDARD: doc.standard,
            CONTENT: chunkText,
            EMBEDDING: JSON.stringify(embedding),
            UPLOADED_AT: new Date().toISOString()
          })
        );

        console.log(`    [${i + 1}/${doc.sections.length}] Embedded: ${section.heading}`);
        totalChunks++;

        // Rate limit: 100ms between calls to stay well within OpenAI limits
        await delay(100);

      } catch (err) {
        console.error(`    ERROR embedding "${section.heading}": ${err.message}`);
        errors++;
      }
    }

    console.log(`  Done: ${doc.sections.length} chunks from ${doc.standard}\n`);
  }

  // Verify what's in HANA
  const count = await cds.run(SELECT.from('bankingsentinel.RegulatoryDocuments').columns('count(*) as N'));
  const byStandard = await cds.run(
    SELECT.from('bankingsentinel.RegulatoryDocuments')
      .columns('STANDARD', 'count(*) as CHUNKS')
      .groupBy('STANDARD')
  );

  console.log('='.repeat(48));
  console.log(`  Total chunks embedded: ${totalChunks}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  HANA record count: ${count[0]?.N}`);
  console.log('\n  Chunks by standard:');
  byStandard.forEach(r => console.log(`    ${r.STANDARD}: ${r.CHUNKS} chunks`));

  if (errors === 0) {
    console.log('\n  Phase 2 Step 1 COMPLETE — regulatory knowledge base ready');
  } else {
    console.log('\n  Completed with errors — check output above');
  }

  process.exit(errors > 0 ? 1 : 0);
}

embed().catch(e => {
  console.error('Embedding failed:', e);
  process.exit(1);
});
