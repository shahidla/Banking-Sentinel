// Banking Sentinel — APRA Regulatory Document Embedder (Twinkle 2)
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
// AI: Called by /a2a/sync-apra endpoint. Returns chunk count for event payload.
// Banking: Risk officer triggers this once when APRA publishes a new standard.
//          Synthesis immediately starts retrieving the new content.
// SAP: Inserts into HANA_VECTOR_STORE. Uses cds.run() (HDI technical user).
async function embedAndStoreApraDoc({ docTitle, standard, pdfUrl, pdfBase64 }) {
  console.log(`  [APRA Embedder] Extracting text: ${docTitle}`);
  const rawText  = await extractTextFromPdf({ pdfUrl, pdfBase64 });
  const chunks   = chunkText(rawText);
  console.log(`  [APRA Embedder] ${chunks.length} chunks created from ${rawText.length} chars`);

  let stored = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk     = chunks[i];
    const embedding = await embedChunk(chunk);

    await cds.run(INSERT.into('bankingsentinel.RegulatoryDocuments').entries({
      DOC_ID:      uuid(),
      TITLE:       `${docTitle} — chunk ${i + 1}`,
      STANDARD:    standard,             // APS 221, CPS 230, DTI Notice etc.
      CONTENT:     chunk,
      EMBEDDING:   JSON.stringify(embedding),
      UPLOADED_AT: new Date().toISOString()
    }));

    stored++;
    if (i % 10 === 0) {
      console.log(`  [APRA Embedder] ${stored}/${chunks.length} chunks stored`);
    }
  }

  console.log(`  [APRA Embedder] Complete — ${stored} chunks in HANA Vector`);
  return stored;
}

module.exports = { embedAndStoreApraDoc };
