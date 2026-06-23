const fs = require('fs');
const path = require('path');

// Resolve project root paths
const configPath = path.join(__dirname, '../config/client.json');

if (!fs.existsSync(configPath)) {
  console.error("Error: config/client.json not found. Please create it first.");
  process.exit(1);
}

const clientConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const clientName = clientConfig.clientName || 'enlightlab';
const kbDir = path.join(__dirname, `../clients/${clientName}/kb`);
const indexOutputPath = path.join(__dirname, `../clients/${clientName}/kb_index.json`);

// Load API Keys
// Load .env variables manually for script compatibility
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Remove surrounding quotes if present
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY not found in environment. Script will index raw text chunks without vector embeddings.");
}

async function getGeminiEmbedding(text) {
  if (!GEMINI_API_KEY) return null;
  const embedModel = clientConfig.embeddings?.model || 'embedding-001';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${embedModel}:embedContent?key=${GEMINI_API_KEY}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: `models/${embedModel}`,
        content: {
          parts: [{ text: text }]
        }
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini Embeddings error (${response.status}):`, errText);
      return null;
    }
    const data = await response.json();
    return data.embedding?.values || null;
  } catch (err) {
    console.error("Failed to fetch Gemini embedding:", err);
    return null;
  }
}

function chunkFile(filename, content) {
  const chunks = [];
  
  // Split content by markdown sub-headings (e.g. ## Section Name)
  // This splits the document into logical paragraphs and keeps the header inside the chunk text for semantic context
  const sections = content.split(/(?=^##\s+)/m);
  
  let documentTitle = filename.replace('.md', '');
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    documentTitle = titleMatch[1].trim();
  }

  sections.forEach((section, idx) => {
    const trimmed = section.trim();
    if (!trimmed) return;

    // Parse the section title
    let sectionTitle = documentTitle;
    const headerMatch = trimmed.match(/^##\s+(.+)$/m);
    if (headerMatch) {
      sectionTitle = headerMatch[1].trim();
    }

    // Split very long sections into smaller chunks of ~500 chars with ~100 overlap
    if (trimmed.length > 800) {
      const words = trimmed.split(/\s+/);
      let currentChunkWords = [];
      let currentLength = 0;
      let chunkIdx = 0;

      for (let i = 0; i < words.length; i++) {
        currentChunkWords.push(words[i]);
        currentLength += words[i].length + 1;

        if (currentLength > 500 || i === words.length - 1) {
          const chunkText = currentChunkWords.join(' ');
          chunks.push({
            id: `${filename.replace('.md', '')}_s${idx}_c${chunkIdx}`,
            source: filename,
            documentTitle: documentTitle,
            title: `${sectionTitle} (Part ${chunkIdx + 1})`,
            text: chunkText
          });
          
          // Keep overlap: slide window back by ~15 words
          const overlapCount = Math.min(15, currentChunkWords.length);
          currentChunkWords = currentChunkWords.slice(-overlapCount);
          currentLength = currentChunkWords.reduce((sum, word) => sum + word.length + 1, 0);
          chunkIdx++;
        }
      }
    } else {
      chunks.push({
        id: `${filename.replace('.md', '')}_s${idx}`,
        source: filename,
        documentTitle: documentTitle,
        title: sectionTitle,
        text: trimmed
      });
    }
  });

  return chunks;
}

async function run() {
  if (!fs.existsSync(kbDir)) {
    console.error(`Error: Knowledge Base directory '${kbDir}' does not exist.`);
    process.exit(1);
  }

  const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.md'));
  console.log(`Found ${files.length} KB source files:`, files);

  let allChunks = [];
  files.forEach(file => {
    const filePath = path.join(kbDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const chunks = chunkFile(file, content);
    console.log(`- Split '${file}' into ${chunks.length} chunks.`);
    allChunks = allChunks.concat(chunks);
  });

  console.log(`Generated total of ${allChunks.length} raw text chunks. Generating vector embeddings...`);

  const indexedChunks = [];
  let successCount = 0;

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    console.log(`[${i + 1}/${allChunks.length}] Embedding chunk: "${chunk.title}"`);
    
    // Attempt vector generation
    const embedding = await getGeminiEmbedding(chunk.text);
    
    indexedChunks.push({
      ...chunk,
      embedding: embedding || []
    });

    if (embedding) {
      successCount++;
    }
    
    // Sleep briefly to prevent rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Ensure output directory exists
  const outputDir = path.dirname(indexOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(indexOutputPath, JSON.stringify(indexedChunks, null, 2), 'utf8');
  console.log(`\nSuccessfully saved ${indexedChunks.length} indexed chunks to: ${indexOutputPath}`);
  console.log(`Vector embeddings successfully generated for ${successCount}/${indexedChunks.length} chunks.`);
}

run().catch(err => {
  console.error("Index script failed:", err);
});
