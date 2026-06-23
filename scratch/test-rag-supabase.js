const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables manually from .env
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
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
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: Missing GEMINI_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getQueryEmbedding(text) {
  const model = 'gemini-embedding-001';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_API_KEY}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768
      })
    });
    if (!response.ok) {
      console.error(`Gemini embedding error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.embedding?.values || null;
  } catch (err) {
    console.error("Failed to generate query embedding:", err.message);
    return null;
  }
}

async function testQuery(query) {
  console.log(`\n========================================`);
  console.log(`QUERY: "${query}"`);
  console.log(`========================================`);
  
  const queryVector = await getQueryEmbedding(query);
  if (!queryVector) {
    console.error("❌ Failed to embed query.");
    return;
  }

  const { data: matches, error } = await supabase.rpc('match_documents', {
    query_embedding: queryVector,
    match_threshold: 0.50, // similarity threshold
    match_count: 3
  });

  if (error) {
    console.error("❌ similarity search error:", error.message);
    return;
  }

  if (matches && matches.length > 0) {
    console.log(`✅ FOUND ${matches.length} MATCHING CHUNKS:\n`);
    matches.forEach((item, idx) => {
      console.log(`[#${idx+1}] URL: ${item.url}`);
      console.log(`     Title: ${item.title}`);
      console.log(`     Similarity Score: ${(item.similarity * 100).toFixed(2)}%`);
      console.log(`     Snippet: ${item.content.substring(0, 200)}...\n`);
    });
  } else {
    console.log(`⚠️ NO MATCHES ABOVE THRESHOLD (Grounding restriction applied).`);
  }
}

async function run() {
  await testQuery("Tell me about your AI agent development service");
  await testQuery("What case studies do you have for healthcare");
  await testQuery("Do you hire ReactJS or NextJS developers");
  await testQuery("What did you do for Pasqal?");
  await testQuery("What is your favorite recipe for chocolate cake"); // Out-of-KB test query
}

run();
