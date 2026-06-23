const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = "https://enlightlab.com";

const SEED_URLS = [
  "/", "/about/", "/contact/", "/case-study/huma/", "/blog/",
  "/services/ai-agent-development/",
  "/services/ai-consulting/",
  "/services/cto-as-a-service/",
  "/services/custom-web-development/",
  "/services/custom-mobile-app-development/",
  "/services/data-engineering/",
  "/services/devops-consulting/",
  "/services/it-staff-augmentation/",
  "/services/mvp-development-services/",
  "/services/claude-ai/",
  "/our-industry/healthcare/",
  "/our-industry/education/",
  "/our-industry/real-estate/",
  "/our-industry/ecommerce-software-development/",
  "/our-industry/insurance/",
  "/our-industry/travel-hospitality-software-development/",
  "/our-industry/custom-fintech-software-development/",
  "/technology/hire-reactjs-developers/",
  "/technology/hire-nextjs-developers/",
  "/technology/hire-nodejs-developers/"
];

// Load env variables manually from .env
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
const visited = new Set();

// Chunker to split page text into ~400 word segments with 50-word overlap
function chunkText(text, maxWords = 400, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];
  
  if (words.length <= maxWords) {
    return [text];
  }

  for (let i = 0; i < words.length; i += (maxWords - overlap)) {
    const chunk = words.slice(i, i + maxWords).join(' ');
    chunks.push(chunk);
    if (i + maxWords >= words.length) {
      break;
    }
  }
  return chunks;
}

// Get Gemini Embedding (gemini-embedding-001 - 768 dimensions)
async function getGeminiEmbedding(text) {
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
      console.error(`Gemini Embedding error (${response.status})`);
      return null;
    }
    const data = await response.json();
    return data.embedding?.values || null;
  } catch (err) {
    console.error("Failed to get embedding:", err);
    return null;
  }
}

// Clean and extract text from HTML page
function extractContent($, url) {
  // Remove site noise (navigation header, footer, scripts, styles)
  $("nav, footer, script, style, img, iframe, .wp-block-navigation, header").remove();
  
  const title = $("h1").first().text().trim() || $("title").text().trim() || "Untitled Page";
  
  const textBlocks = [];
  $("h1, h2, h3, h4, p, li").each((_, el) => {
    const text = $(el).text().trim();
    // Skip tiny text blocks, menu elements, and links
    if (text.length > 30) {
      textBlocks.push(text);
    }
  });

  const fullText = textBlocks.join('\n\n');
  return { url, title, fullText };
}

async function crawlPage(pathSuffix) {
  let pathName = pathSuffix.trim();
  if (!pathName.startsWith('/')) {
    pathName = '/' + pathName;
  }
  
  // Normalize path name (ends with a single slash unless it's empty)
  if (pathName !== '/' && !pathName.endsWith('/')) {
    pathName = pathName + '/';
  }
  
  const url = BASE_URL + pathName;
  
  if (visited.has(url)) return;
  visited.add(url);

  console.log(`\nCrawling: ${url}...`);

  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "EnlightLabBot/1.0" }
    });
    
    const $ = cheerio.load(data);

    // 1. Auto-discover links recursively from the raw DOM (before removing nav/footer)
    const linksToCrawl = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const fullUrl = new URL(href, BASE_URL);
        if (fullUrl.hostname === "enlightlab.com") {
          const p = fullUrl.pathname;
          
          // Only crawl allowed paths and ignore system directories
          if (
            !p.includes('/wp-') &&
            !p.includes('/feed') &&
            !p.includes('/author/') &&
            !p.includes('/comments/') &&
            (p === '/' ||
             p.startsWith('/about') ||
             p.startsWith('/contact') ||
             p.startsWith('/case-study') ||
             p.startsWith('/blog') ||
             p.startsWith('/services/') ||
             p.startsWith('/our-industry/') ||
             p.startsWith('/technology/'))
          ) {
            const normalizedPath = p.endsWith('/') ? p : p + '/';
            const normalizedBase = BASE_URL + normalizedPath;
            if (!visited.has(normalizedBase)) {
              linksToCrawl.push(normalizedPath);
            }
          }
        }
      } catch (_) {}
    });
    
    // 2. Clean HTML noise and extract page content
    const { title, fullText } = extractContent($, url);
    
    if (!fullText || fullText.length < 100) {
      console.log(`⚠ Page text too short, skipping database insert.`);
      // Still crawl discovered links on this page even if text is short
      for (const link of linksToCrawl) {
        await crawlPage(link);
      }
      return;
    }

    const chunks = chunkText(fullText, 400, 50);
    console.log(`✓ Scraped: "${title}" | Generated ${chunks.length} chunks.`);

    // 3. Delete existing vectors for this URL to avoid duplicates on re-crawls
    const { error: deleteError } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('url', url);
      
    if (deleteError) {
      console.error(`❌ Failed to delete old chunks for ${url}:`, deleteError.message);
      return;
    }

    // 4. Embed and insert each chunk into Supabase pgvector
    let successCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const embedding = await getGeminiEmbedding(chunkText);
      
      if (!embedding) {
        console.warn(`⚠ Skipping chunk #${i+1} due to embedding error.`);
        continue;
      }

      const { error: insertError } = await supabase
        .from('knowledge_base')
        .insert({
          url,
          title,
          content: chunkText,
          embedding
        });

      if (insertError) {
        console.error(`❌ Failed to save chunk #${i+1}:`, insertError.message);
      } else {
        successCount++;
      }
      
      // Delay to avoid hitting Gemini API rate limits
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`🎯 Successfully saved ${successCount}/${chunks.length} chunks to Supabase.`);

    // 5. Crawl discovered links recursively
    for (const link of linksToCrawl) {
      await crawlPage(link);
    }

  } catch (err) {
    console.error(`❌ Error crawling ${url}:`, err.message);
  }
}

async function run() {
  console.log("Starting Enlight Lab Web Crawler & Supabase Indexer...\n");
  for (const pathSuffix of SEED_URLS) {
    await crawlPage(pathSuffix);
    // Rate limit delay between seed page paths
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`\n🎉 Web crawling completed. Total pages processed: ${visited.size}`);
}

run();
