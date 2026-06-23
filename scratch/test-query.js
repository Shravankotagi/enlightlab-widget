const fs = require('fs');
const path = require('path');

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
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/client.json'), 'utf8'));
const indexPath = path.join(__dirname, `../clients/${config.clientName}/kb_index.json`);
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
  console.log(`\nQuery: "${query}"`);
  const queryVector = await getQueryEmbedding(query);
  if (!queryVector) {
    console.log("Failed to embed query.");
    return;
  }

  const scored = chunks
    .map(chunk => {
      if (!chunk.embedding || chunk.embedding.length === 0) return { chunk, score: 0 };
      return { chunk, score: dotProduct(queryVector, chunk.embedding) };
    })
    .sort((a, b) => b.score - a.score);

  console.log("Top 5 matches:");
  scored.slice(0, 5).forEach((item, idx) => {
    console.log(`[#${idx + 1}] Score: ${item.score.toFixed(4)} | Title: ${item.chunk.title} | Source: ${item.chunk.source}`);
    console.log(`    Snippet: ${item.chunk.text.substring(0, 120)}...`);
  });
}

testRAG("in which sectors does enlight lab actually work");
