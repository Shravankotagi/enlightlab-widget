import fs from 'fs';
import path from 'path';
import { getClientConfig } from './config';

export interface IndexedChunk {
  id: string;
  source: string;
  documentTitle: string;
  title: string;
  text: string;
  embedding?: number[];
}

let cachedIndex: IndexedChunk[] | null = null;

function loadKBIndex(clientName: string): IndexedChunk[] {
  if (cachedIndex) return cachedIndex;
  try {
    const indexPath = path.join(process.cwd(), `clients/${clientName}/kb_index.json`);
    if (!fs.existsSync(indexPath)) {
      console.warn(`[RAG Service] Index file not found at: ${indexPath}`);
      return [];
    }
    const raw = fs.readFileSync(indexPath, 'utf8');
    cachedIndex = JSON.parse(raw) as IndexedChunk[];
    return cachedIndex;
  } catch (err) {
    console.error("[RAG Service] Failed to load KB index:", err);
    return [];
  }
}

async function getQueryEmbedding(
  text: string,
  apiKey: string,
  model: string
): Promise<number[] | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: {
          parts: [{ text }]
        }
      })
    });
    if (!response.ok) {
      console.error(`[RAG Service] Embed query returned status ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.embedding?.values || null;
  } catch (err) {
    console.error("[RAG Service] Query embedding fetch failed:", err);
    return null;
  }
}

function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function keywordSearchFallback(query: string, chunks: IndexedChunk[]): IndexedChunk[] {
  const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  if (terms.length === 0) return [];

  return chunks
    .map(chunk => {
      const matchText = `${chunk.title} ${chunk.documentTitle} ${chunk.text}`.toLowerCase();
      let matchCount = 0;
      terms.forEach(term => {
        if (matchText.includes(term)) matchCount++;
      });
      return { chunk, score: matchCount };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(item => item.chunk);
}

export async function retrieveRelevantContext(query: string): Promise<string> {
  const config = getClientConfig();
  const chunks = loadKBIndex(config.clientName);
  
  if (chunks.length === 0) {
    return '';
  }

  // 1. Attempt Vector Similarity Search
  const apiKey = process.env.GEMINI_API_KEY || '';
  const embedModel = config.embeddings.model;
  const threshold = config.embeddings.similarityThreshold;

  if (apiKey && embedModel) {
    const queryVector = await getQueryEmbedding(query, apiKey, embedModel);
    
    if (queryVector) {
      const scored = chunks
        .map(chunk => {
          if (!chunk.embedding || chunk.embedding.length === 0) {
            return { chunk, score: 0 };
          }
          const score = dotProduct(queryVector, chunk.embedding);
          return { chunk, score };
        })
        .filter(item => item.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (scored.length > 0) {
        console.log(`[RAG Service] Found ${scored.length} matching vector chunks above similarity threshold ${threshold}.`);
        return scored
          .map(item => `[Source: ${item.chunk.source} | Title: ${item.chunk.title}]\n${item.chunk.text}`)
          .join('\n\n');
      }
    }
  }

  // 2. Keyword Fallback Search
  console.log("[RAG Service] Falling back to keyword-matching lookup.");
  const keywordMatches = keywordSearchFallback(query, chunks);
  if (keywordMatches.length > 0) {
    return keywordMatches
      .map(chunk => `[Source: ${chunk.source} | Title: ${chunk.title}]\n${chunk.text}`)
      .join('\n\n');
  }

  return '';
}
