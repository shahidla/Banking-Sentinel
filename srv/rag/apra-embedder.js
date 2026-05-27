// Banking Sentinel — APRA Regulatory Document Embedder
// AI: RAG knowledge base update — PDF → chunks → embeddings → HANA Vector
// Banking: New APRA standard uploaded at runtime. Synthesis retrieves via vector similarity search.
//          Zero code change — knowledge updates through data, not deployment.
// SAP: HANA_VECTOR_STORE entity stores chunk text + embedding vector. hana_vector_search MCP reads it.

'use strict';
require('dotenv').config();
const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');

const CHUNK_SIZE  = 800;   // characters per chunk — balances context and retrieval precision
const CHUNK_OVERLAP = 100; // overlap prevents losing meaning at chunk boundaries

// ── Text chunking — sliding window ───────────────────────────────────────────
// AI: Overlap ensures regulatory sentences that span chunk boundaries are retrievable
// Banking: "APS 221 requires..." spans multiple paragraphs — overlap prevents loss
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

// ── PDF text extraction ───────────────────────────────────────────────────────
// AI: pdf-parse extracts raw text. Tables and headers lose formatting — acceptable for RAG.
// Banking: APRA standards are text-heavy; tables are secondary to paragraph content.
async function extractTextFromPdf(source) {
  const pdfParse = require('pdf-parse');
  let buffer;

  if (source.pdfBase64) {
    buffer = Buffer.from(source.pdfBase64, 'base64');
  } else if (source.pdfUrl) {
    const https = require('https');
    const http  = require('http');
    const client = source.pdfUrl.startsWith('https') ? https : http;
    buffer = await new Promise((resolve, reject) => {
      client.get(source.pdfUrl, (response) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
    });
  } else {
    throw new Error('pdfUrl or pdfBase64 required');
  }

  const data = await pdfParse(buffer);
  return data.text;
}

// ── DTI limit parser — reads actual value from PDF text ──────────────────────
const WORD_NUMBERS = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };

function parseDtiLimit(text) {
  // Pattern 1: "DTI ≥ 6" or "DTI >= 6" (appears in APRA calculation steps)
  const m1 = text.match(/DTI\s*[≥>=]+\s*(\d+(?:\.\d+)?)/);
  if (m1) {
    const val = parseFloat(m1[1]);
    if (val > 1 && val < 20) return val;
  }
  // Pattern 2: "DTI greater or equal to six times" (narrative form)
  const m2 = text.match(/DTI\s+greater\s+or\s+equal\s+to\s+([\w]+)\s+times?/i);
  if (m2) {
    const word = m2[1].toLowerCase();
    const val  = WORD_NUMBERS[word] ?? parseFloat(word);
    if (val > 1 && val < 20) return val;
  }
  // Pattern 3: generic "X times" near debt-to-income
  const m3 = text.match(/debt[- ]to[- ]income[^.]{0,80}(\d+(?:\.\d+)?)\s*times/i);
  if (m3) {
    const val = parseFloat(m3[1]);
    if (val > 1 && val < 20) return val;
  }
  return null;
}

// ── OpenAI embedding ──────────────────────────────────────────────────────────
// AI: text-embedding-3-small — 1536-dimensional vector. Matches what Synthesis uses for search.
// Banking: Same model for embed + search = correct cosine similarity
// SAP: OPENAI_API_KEY in .env — same key as used by CAP AI services
async function embedChunk(text) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return response.data[0].embedding;   // float[] — 1536 dimensions
}

// ── Main entry point ──────────────────────────────────────────────────────────
// AI: Called by /a2a/sync-apra endpoint. Returns { stored, thresholdUpdated } for event payload.
// Banking: Risk officer triggers this once when APRA publishes a new standard.
//          If standard=DTI_NOTICE, also updates RegulatoryThresholds.LIMIT_PCT to 6.0
//          Threshold tightening from 8x to 6x triggers breach on next pipeline run.
// SAP: Inserts into bankingsentinel.RegulatoryDocuments. Uses cds.run() (HDI technical user).
async function embedAndStoreApraDoc({ docTitle, standard, pdfUrl, pdfBase64 }) {
  console.log(`  [APRA Embedder] Extracting text: ${docTitle}`);
  const rawText  = await extractTextFromPdf({ pdfUrl, pdfBase64 });
  const chunks   = chunkText(rawText);
  console.log(`  [APRA Embedder] ${chunks.length} chunks created from ${rawText.length} chars`);

  // For DTI_NOTICE: replace existing chunks so threshold=6 content supersedes threshold=8
  if (standard === 'DTI_NOTICE') {
    const existing = await cds.run(
      SELECT.from('bankingsentinel.RegulatoryDocuments').where({ STANDARD: 'DTI_NOTICE' }).columns('DOC_ID')
    );
    if (existing.length > 0) {
      await cds.run(DELETE.from('bankingsentinel.RegulatoryDocuments').where({ STANDARD: 'DTI_NOTICE' }));
      console.log(`  [APRA Embedder] Replaced ${existing.length} existing DTI_NOTICE chunks`);
    }
  }

  let stored = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk     = chunks[i];
    const embedding = await embedChunk(chunk);

    await cds.run(INSERT.into('bankingsentinel.RegulatoryDocuments').entries({
      DOC_ID:      uuid(),
      TITLE:       `${docTitle} — chunk ${i + 1}`,
      STANDARD:    standard,             // APS221, CPS230, DTI_NOTICE etc.
      CONTENT:     chunk,
      EMBEDDING:   JSON.stringify(embedding),
      UPLOADED_AT: new Date().toISOString()
    }));

    stored++;
    if (i % 10 === 0) {
      console.log(`  [APRA Embedder] ${stored}/${chunks.length} chunks stored`);
    }
  }

  // APRA Notice: parse real DTI limit from PDF and update RegulatoryThresholds
  let thresholdUpdated = false;
  let dtiLimit = null;
  if (standard === 'DTI_NOTICE') {
    dtiLimit = parseDtiLimit(rawText);
    if (dtiLimit === null) {
      console.warn('  [APRA Embedder] WARNING: could not parse DTI limit from PDF — RegulatoryThresholds NOT updated');
    } else {
      await cds.run(
        UPDATE('bankingsentinel.RegulatoryThresholds')
          .set({ LIMIT_PCT: dtiLimit })
          .where({ THRESHOLD_TYPE: 'DEBT_TO_INCOME' })
      );
      thresholdUpdated = true;
      console.log(`  [APRA Embedder] RegulatoryThresholds.LIMIT_PCT updated to ${dtiLimit} (parsed from PDF) — next pipeline run will detect breach`);
    }
  }

  console.log(`  [APRA Embedder] Complete — ${stored} chunks in HANA Vector`);
  return { stored, thresholdUpdated, dtiLimit };
}

module.exports = { embedAndStoreApraDoc };
