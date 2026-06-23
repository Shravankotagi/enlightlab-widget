const fs = require('fs');
const path = require('path');

// Manually load env for API Key
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Mock configuration check
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/client.json'), 'utf8'));
const indexPath = path.join(__dirname, `../clients/${config.clientName}/kb_index.json`);

if (!fs.existsSync(indexPath)) {
  console.error("Error: kb_index.json not found. Please run scripts/index-kb.js first.");
  process.exit(1);
}

const chunks = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

async function getQueryEmbedding(text) {
  if (!GEMINI_API_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] }
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.embedding?.values || null;
  } catch (err) {
    return null;
  }
}

function dotProduct(a, b) {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

async function testRAG(query) {
  console.log(`\n========================================\nQuery: "${query}"`);
  
  if (!GEMINI_API_KEY) {
    console.log("Vector search offline (no API key). Running keyword fallback...");
    return;
  }

  const queryVector = await getQueryEmbedding(query);
  if (!queryVector) {
    console.log("Failed to embed query.");
    return;
  }

  const threshold = config.embeddings.similarityThreshold;
  const scored = chunks
    .map(chunk => {
      if (!chunk.embedding || chunk.embedding.length === 0) return { chunk, score: 0 };
      return { chunk, score: dotProduct(queryVector, chunk.embedding) };
    })
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    console.log(`✅ SUCCESS: Matched ${scored.length} chunks above threshold (${threshold}):`);
    scored.slice(0, 2).forEach((item, idx) => {
      console.log(`[#${idx + 1}] Similarity: ${item.score.toFixed(4)} | Source: ${item.chunk.source} | Title: ${item.chunk.title}`);
      console.log(`    Snippet: ${item.chunk.text.substring(0, 150)}...`);
    });
  } else {
    console.log(`⚠️ FALLBACK: No matching chunks found above similarity threshold (${threshold}).`);
    console.log(`-> Triggering negative constraint fallback: "I don't have that information..."`);
  }
}

async function runTests() {
  console.log("Starting RAG grounding tests...\n");
  await testRAG("Who founded Enlight Lab?");
  await testRAG("Tell me about the Emblazer case study.");
  await testRAG("Do you do AI Agent Development?");
  await testRAG("What is your favorite recipe for chocolate cake?"); // Out-of-KB query
}

runTests();
