// Banking Sentinel — Phase 2: RAG Retrieval Testing + RAGAS Dataset Generation
// Tests: Basic Vector Search, Hybrid RAG, HyDE
// Generates: Data/ragas-dataset.json for Python RAGAS evaluation
// AI Pattern: Hybrid RAG + HyDE (Hypothetical Document Embeddings)
// Banking: Retrieve APRA regulatory context for risk assessment questions
// SAP: HANA Cloud Vector Engine query via LargeString cosine similarity
// Run: cds bind --exec node scripts/test-rag.js

'use strict';
require('dotenv').config();
const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

// ─── COSINE SIMILARITY ──────────────────────────────────────────────────────
// AI: Measures angle between two vectors — 1.0 = identical, 0 = orthogonal
// Banking: How similar is the query meaning to the document chunk meaning?
// SAP: Applied on EMBEDDING LargeString field; HANA native REAL_VECTOR upgrade in CDS 10
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── KEYWORD SCORE ──────────────────────────────────────────────────────────
// AI: TF-IDF proxy — term frequency in chunk vs query terms
// Banking: Ensures exact regulatory terms (APS 221, DTI 6.0) are matched even if
//          the embedding doesn't capture rare regulatory terminology precisely
// SAP: In production, replace with HANA Full Text Search (CREATE FULLTEXT INDEX)
function keywordScore(content, query) {
  const stopWords = new Set(['is', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'at', 'by', 'from', 'as', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'can', 'could', 'not', 'no', 'so', 'if', 'its', 'it', 'this', 'that', 'any', 'all']);
  const queryTerms = query.toLowerCase().split(/\W+/).filter(t => t.length > 3 && !stopWords.has(t));
  if (queryTerms.length === 0) return 0;
  const contentLower = content.toLowerCase();
  const hits = queryTerms.filter(term => contentLower.includes(term)).length;
  return hits / queryTerms.length;
}

// ─── OPENAI API CALLS ───────────────────────────────────────────────────────
async function getEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.data[0].embedding;
}

async function generateWithClaude(systemPrompt, userPrompt) {
  const { ChatAnthropic } = await import('@langchain/anthropic');
  const llm = new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxTokens: 400
  });
  const response = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);
  return response.content;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── RETRIEVAL APPROACHES ───────────────────────────────────────────────────

// 1. Basic Vector Search
async function vectorSearch(allDocs, queryText, topK = 5) {
  const queryEmbedding = await getEmbedding(queryText);
  const scored = allDocs.map(doc => ({
    ...doc,
    score: cosineSimilarity(queryEmbedding, JSON.parse(doc.EMBEDDING))
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// 2. Hybrid RAG — vector similarity + keyword overlap
// AI: Addresses vocabulary mismatch: rare regulatory terms missed by embeddings alone
// Banking: "APS 221" as a code term may not embed as distinctly as its semantic meaning
// SAP: Production upgrade: replace keywordScore() with HANA Full Text Search ranking
async function hybridSearch(allDocs, queryText, topK = 5, alpha = 0.7) {
  const queryEmbedding = await getEmbedding(queryText);
  const scored = allDocs.map(doc => {
    const vecScore = cosineSimilarity(queryEmbedding, JSON.parse(doc.EMBEDDING));
    const kwScore = keywordScore(doc.CONTENT, queryText);
    return { ...doc, vectorScore: vecScore, kwScore, score: alpha * vecScore + (1 - alpha) * kwScore };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// 3. HyDE — Hypothetical Document Embeddings
// AI: Generate what the ideal answer looks like, embed THAT, then search
// Banking: "Does sector concentration require escalation?" is vague for vector search.
//          HyDE generates "Credit Policy §7.3 requires escalation when..." first
// SAP: Pre-processing LangGraph node in the Synthesis Agent before hana_vector_search MCP call
async function hydeSearch(allDocs, queryText, topK = 5) {
  const hypothetical = await generateWithClaude(
    'You are an expert on APRA banking regulations and Australian bank credit policy. Generate a precise regulatory document excerpt that would directly answer the following question. Be specific — include exact thresholds, percentages, and timeframes where relevant. 150 words maximum.',
    queryText
  );
  const hydeText = typeof hypothetical === 'string' ? hypothetical : hypothetical[0]?.text || String(hypothetical);
  const hydeEmbedding = await getEmbedding(hydeText);
  const scored = allDocs.map(doc => ({
    ...doc,
    score: cosineSimilarity(hydeEmbedding, JSON.parse(doc.EMBEDDING)),
    hydeQuery: hydeText
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── RAGAS EVALUATION QUESTIONS ─────────────────────────────────────────────
// From v6 Part 7 — 9 questions that require regulatory document retrieval
const RAGAS_QUESTIONS = [
  {
    id: 'R-Q03',
    question: 'Does the B-001 connected group breach APS 221 large exposure requirements, and what action is required?',
    groundTruth: 'Yes. The connected group exposure reaches 92% of the APS 221 large exposure limit. APS 221 requires Board notification when aggregate exposure exceeds 90% of the large exposure limit. Board notification is required immediately.'
  },
  {
    id: 'R-Q08',
    question: 'Does B-001 breach the APRA February 2026 DTI limit, and what is the applicable limit?',
    groundTruth: 'Yes. B-001 has a DTI ratio of 7.2. The APRA February 2026 DTI Limit Activation Notice sets a limit of 6.0 for new lending. A DTI of 7.2 exceeds the limit of 6.0.'
  },
  {
    id: 'R-Q10',
    question: 'What are the reporting requirements for an identified DTI breach under the February 2026 APRA notice?',
    groundTruth: 'ADIs must document identified DTI breaches within 5 business days of identification and report to APRA through the prudential reporting framework. Remediation plans must be submitted to APRA within 30 business days of the identification of a material breach.'
  },
  {
    id: 'R-Q14',
    question: 'Does the RETAIL_PROP sector concentration require escalation under credit policy, and what is the escalation requirement?',
    groundTruth: 'Yes. A combined RETAIL_PROP exposure of AUD 12.4 million represents 78% of the AUD 16 million sector limit. Credit Policy §7.3.1 requires a formal Sector Concentration Monitoring Report to the Risk Committee when exposure exceeds 75% of the sector limit. A monitoring report must be submitted.'
  },
  {
    id: 'R-Q16',
    question: 'Which APRA standards are relevant to B-001 complete risk profile?',
    groundTruth: 'APS 221 applies to the connected group large exposure of 92% utilisation. The February 2026 DTI Limit Activation Notice applies to the DTI breach of 7.2 against a limit of 6.0. CPS 230 applies because AI risk intelligence systems used in this assessment must have human oversight before finalising recommendations.'
  },
  {
    id: 'R-Q17',
    question: 'What action does APS 221 require when a connected group exposure reaches 92% utilisation of the large exposure limit?',
    groundTruth: 'APS 221 requires formal Board notification within three business days when aggregate exposure to a connected group reaches or exceeds 90% of the applicable large exposure limit. The Board notification must include the identity of the connected group, total exposure amount, applicable limit, utilisation percentage, and a proposed management action plan.'
  },
  {
    id: 'R-Q18',
    question: 'What is the required remediation timeline for an unreported DTI breach under the February 2026 APRA notice?',
    groundTruth: 'Under the February 2026 DTI Limit Activation Notice, identified DTI breaches must be documented within 5 business days of identification and reported to APRA. Remediation plans must be submitted to APRA within 30 business days of identifying a material breach. A monitoring plan must be implemented within 15 business days.'
  },
  {
    id: 'R-Q19',
    question: 'Does B-001 risk profile require human approval before AI recommendations are finalised, and which APRA standard requires this?',
    groundTruth: 'Yes. CPS 230 requires that all material AI-generated risk recommendations be subject to mandatory human review before finalisation. CPS 230 states that AI can be a co-pilot but must never be an autopilot. The human-in-the-loop checkpoint must be implemented at the architectural level and is not optional.'
  },
  {
    id: 'R-Q05',
    question: 'What defines a connected group of counterparties under APS 221, and how does a family trust structure qualify?',
    groundTruth: 'Under APS 221, a group of connected counterparties exists where entities are linked such that financial distress in one would likely cause distress in another. A family trust structure qualifies as a connected group where beneficiaries are counterparties of the ADI. Entities linked through a common family trust structure must have their combined exposures aggregated as a single connected group for APS 221 large exposure limit purposes.'
  }
];

async function generateAnswer(contexts, question) {
  const contextText = contexts.map((c, i) => `[Source ${i + 1}: ${c.TITLE}]\n${c.CONTENT}`).join('\n\n---\n\n');
  return generateWithClaude(
    'You are an APRA regulatory compliance expert. Answer the question based ONLY on the provided regulatory document excerpts. Be precise and cite specific requirements. If a threshold, percentage, or timeframe is mentioned in the sources, include it exactly.',
    `REGULATORY SOURCES:\n${contextText}\n\nQUESTION: ${question}\n\nANSWER:`
  );
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function testRag() {
  console.log('\n Banking Sentinel — Phase 2: RAG Testing + RAGAS Dataset Generation');
  console.log('=====================================================================\n');

  if (!process.env.OPENAI_API_KEY) { console.error('ERROR: OPENAI_API_KEY missing'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ERROR: ANTHROPIC_API_KEY missing'); process.exit(1); }

  await cds.connect.to('db');

  // Load all documents from HANA once — reuse for all queries
  const allDocs = await cds.run(SELECT.from('bankingsentinel.RegulatoryDocuments'));
  if (allDocs.length === 0) {
    console.error('ERROR: No documents in RegulatoryDocuments — run embed-documents.js first');
    process.exit(1);
  }
  console.log(`  Loaded ${allDocs.length} document chunks from HANA\n`);

  // ── Quick smoke test: compare retrieval approaches on one question ──
  const testQuery = 'What action does APS 221 require when connected group exposure reaches 90%?';
  console.log('Smoke Test — Comparing retrieval approaches');
  console.log(`Query: "${testQuery}"\n`);

  const [vecResults, hybridResults, hydeResults] = await Promise.all([
    vectorSearch(allDocs, testQuery, 3),
    hybridSearch(allDocs, testQuery, 3),
    hydeSearch(allDocs, testQuery, 3)
  ]);

  console.log('  Vector Search top 3:');
  vecResults.forEach((r, i) => console.log(`    ${i + 1}. [${r.score.toFixed(4)}] ${r.TITLE}`));

  console.log('\n  Hybrid RAG top 3:');
  hybridResults.forEach((r, i) => console.log(`    ${i + 1}. [${r.score.toFixed(4)}] ${r.TITLE}`));

  console.log('\n  HyDE top 3:');
  hydeResults.forEach((r, i) => console.log(`    ${i + 1}. [${r.score.toFixed(4)}] ${r.TITLE}`));

  // ── Full RAGAS dataset generation using Hybrid RAG (best balance) ──
  console.log('\n\nGenerating RAGAS evaluation dataset (Hybrid RAG for all 9 questions)...\n');

  const ragasDataset = [];
  let questionNum = 0;

  for (const q of RAGAS_QUESTIONS) {
    questionNum++;
    console.log(`  [${questionNum}/${RAGAS_QUESTIONS.length}] ${q.id}: ${q.question.substring(0, 60)}...`);

    try {
      const contexts = await hybridSearch(allDocs, q.question, 5);
      await delay(200);

      const answer = await generateAnswer(contexts, q.question);
      const answerText = typeof answer === 'string' ? answer : answer[0]?.text || String(answer);
      await delay(200);

      ragasDataset.push({
        question_id: q.id,
        question: q.question,
        answer: answerText,
        contexts: contexts.map(c => c.CONTENT),
        context_titles: contexts.map(c => c.TITLE),
        context_scores: contexts.map(c => c.score),
        ground_truth: q.groundTruth,
        retrieval_method: 'hybrid_rag'
      });

      console.log(`         Answer: ${answerText.substring(0, 100)}...`);
      console.log(`         Top context: ${contexts[0]?.TITLE} [${contexts[0]?.score?.toFixed(4)}]`);

    } catch (err) {
      console.error(`         ERROR: ${err.message}`);
      ragasDataset.push({
        question_id: q.id,
        question: q.question,
        answer: 'ERROR: ' + err.message,
        contexts: [],
        context_titles: [],
        context_scores: [],
        ground_truth: q.groundTruth,
        retrieval_method: 'hybrid_rag'
      });
    }
  }

  // Save RAGAS dataset
  const outputPath = path.join(__dirname, '../Data/ragas-dataset.json');
  fs.writeFileSync(outputPath, JSON.stringify(ragasDataset, null, 2));

  console.log(`\n${'='.repeat(53)}`);
  console.log(`  RAGAS dataset generated: ${ragasDataset.length} questions`);
  console.log(`  Saved to: Data/ragas-dataset.json`);
  console.log(`  Run: python scripts/ragas-eval.py`);
  console.log('\n  Phase 2 Step 2 COMPLETE — dataset ready for RAGAS scoring');

  process.exit(0);
}

testRag().catch(e => {
  console.error('RAG test failed:', e);
  process.exit(1);
});
