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

async function checkEmbedding(model, dim) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_API_KEY}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: "Hello world" }] },
        outputDimensionality: dim
      })
    });
    if (!response.ok) {
      console.log(`Failed for model ${model}: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.log(text);
      return;
    }
    const data = await response.json();
    console.log(`Model ${model} with outputDimensionality ${dim} returned size:`, data.embedding?.values?.length);
  } catch (err) {
    console.error(`Error checking model ${model}:`, err.message);
  }
}

async function run() {
  await checkEmbedding('gemini-embedding-001', 768);
}

run();
