'use strict';
require('dotenv').config();
const cds  = require('@sap/cds');
const https = require('https');
const http  = require('http');
const { v4: uuid } = require('uuid');

const DELAY_MS   = 120;
const CHUNK_SIZE  = 800;
const CHUNK_OVERLAP = 100;

// Live APRA document URLs
const APRA_SOURCES = [
  {
    title:    'Prudential Standard APS 221 Large Exposures',
    standard: 'APS221',
    url:      'https://www.apra.gov.au/sites/default/files/2025-12/Prudential%20Standard%20APS%20221%20Large%20Exposures.pdf'
  },
  {
    title:    'Prudential Standard CPS 230 Operational Risk Management',
    standard: 'CPS230',
    url:      'https://www.apra.gov.au/sites/default/files/2026-04/Prudential%20Standard%20-%20CPS%20230%20Operational%20Risk%20Management%20-%20clean.pdf'
  },
  {
    title:    'APRA DTI Limit Implementation Details — February 2026',
    standard: 'DTI_NOTICE',
    url:      'https://www.apra.gov.au/sites/default/files/2025-11/Implementation%20Details%20-%20DTI%20limit.pdf'
  }
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPdf(url) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchPdf(response.headers.location).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} fetching ${url}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function extractText(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return data.text;
}

// Demo 1 baseline: real DTI PDF says 6.0x — replace with 8.0x so the first run is compliant.
// Demo 2: clicking "Apply APRA Notice" re-downloads the real PDF, parses 6.0, sets breach state.
function modifyDtiTextForDemo1(text) {
  return text
    .replace(/DTI[^<>\n]{0,30}[≥>=]+\s*6(\.0)?/g, 'DTI ≥ 8$1')
    .replace(/DTI\s+(?:ratio\s+)?greater(?:\s+than)?\s+or\s+equal\s+to\s+six\s+times/gi, 'DTI greater or equal to eight times')
    .replace(/\bsix\s+times\b/gi, 'eight times');
}

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter(c => c.length > 50);
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
      TITLE:       `${title} — chunk ${i + 1}`,
      STANDARD:    standard,
      CONTENT:     chunks[i],
      EMBEDDING:   JSON.stringify(embedding),
      UPLOADED_AT: new Date().toISOString()
    }));
    stored++;
    if (i % 5 === 0) console.log(`    [${i + 1}/${chunks.length}] chunks embedded`);
    await sleep(DELAY_MS);
  }
  return stored;
}

async function run() {
  console.log('\n Banking Sentinel — seed-regulatory.js');
  console.log(' Demo 1 knowledge base: APS221 + CPS230 + DTI notice (threshold 8.0x baseline)');
  console.log('='.repeat(70));

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not set in .env'); process.exit(1);
  }

  await cds.connect.to('db');

  const existing = await cds.run(SELECT.from('bankingsentinel.RegulatoryDocuments'));
  console.log(`\n  Clearing ${existing.length} existing chunks from HANA...`);
  if (existing.length > 0) await cds.run(DELETE.from('bankingsentinel.RegulatoryDocuments'));
  console.log('  Cleared.\n');

  let totalChunks = 0;
  const failed = [];

  for (const source of APRA_SOURCES) {
    try {
      console.log(`  Fetching: ${source.title}`);
      const buffer = await fetchPdf(source.url);
      console.log(`  Downloaded ${(buffer.length / 1024).toFixed(0)} KB`);

      let text = await extractText(buffer);
      console.log(`  Extracted ${text.length} chars`);

      if (source.standard === 'DTI_NOTICE') {
        text = modifyDtiTextForDemo1(text);
        console.log('  DTI text modified: 6.0x → 8.0x (Demo 1 baseline)');
      }

      const chunks = chunkText(text);
      console.log(`  ${chunks.length} chunks → embedding...`);

      const n = await embedAndInsert(source.title, source.standard, chunks);
      totalChunks += n;
      console.log(`  Done: ${n} chunks for ${source.standard}\n`);
    } catch (e) {
      console.error(`  SKIPPED ${source.standard} — ${e.message}\n`);
      failed.push(source.standard);
    }
  }

  if (failed.length === APRA_SOURCES.length) {
    console.error('  All regulatory sources failed — aborting, RegulatoryDocuments left empty.');
    process.exit(1);
  }

  // Set Demo 1 baseline threshold: 8.0x (compliant state)
  await cds.run(
    UPDATE('bankingsentinel.RegulatoryThresholds')
      .set({ LIMIT_PCT: 8.0 })
      .where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' })
  );
  console.log('  RegulatoryThresholds.LIMIT_PCT reset to 8.0x (Demo 1 baseline)');

  const byStd = await cds.run(
    SELECT.from('bankingsentinel.RegulatoryDocuments')
      .columns('STANDARD', 'count(*) as N')
      .groupBy('STANDARD')
  );
  console.log('='.repeat(70));
  console.log(`  Total chunks embedded: ${totalChunks}`);
  byStd.forEach(r => console.log(`    ${r.STANDARD}: ${r.N} chunks`));
  if (failed.length > 0) console.log(`  Skipped sources (fetch failed): ${failed.join(', ')}`);
  console.log('\n  Demo 1 regulatory knowledge base READY');
  console.log('  Click "Apply APRA Notice" to load real 6.0x threshold → Demo 2\n');

  process.exit(0);
}

run().catch(e => { console.error('seed-regulatory failed:', e); process.exit(1); });
