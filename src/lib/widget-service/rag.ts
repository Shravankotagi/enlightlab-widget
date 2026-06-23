import { createClient } from '@supabase/supabase-js';
import { getClientConfig } from './config';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Initialize Supabase client
const supabase = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

export interface ScoredMatch {
  id: string;
  url: string;
  title: string;
  content: string;
  similarity: number;
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
        },
        outputDimensionality: 768
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

export async function retrieveRelevantContext(query: string): Promise<string> {
  const config = getClientConfig();
  const apiKey = process.env.GEMINI_API_KEY || '';
  const embedModel = config.embeddings.model;
  const threshold = config.embeddings.similarityThreshold;

  if (!supabase) {
    console.warn("[RAG Service] Supabase client not initialized. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    return '';
  }

  if (!apiKey || !embedModel) {
    console.warn("[RAG Service] Gemini API key or embedding model configuration is missing.");
    return '';
  }

  // 1. Generate query embedding vector
  const queryVector = await getQueryEmbedding(query, apiKey, embedModel);
  if (!queryVector) {
    console.error("[RAG Service] Could not generate query embedding.");
    return '';
  }

  try {
    // 2. Perform similarity search in Supabase using the match_documents RPC function
    const { data: matches, error } = await supabase.rpc('match_documents', {
      query_embedding: queryVector,
      match_threshold: threshold,
      match_count: 5
    });

    if (error) {
      console.error("[RAG Service] Supabase similarity search error:", error.message);
      return '';
    }

    if (matches && matches.length > 0) {
      console.log(`[RAG Service] Found ${matches.length} matching vector chunks above similarity threshold ${threshold}.`);
      return (matches as ScoredMatch[])
        .map(item => `[Source: ${item.url} | Title: ${item.title}]\n${item.content}`)
        .join('\n\n');
    } else {
      console.log(`[RAG Service] No matches found above threshold ${threshold}.`);
      return '';
    }
  } catch (err) {
    console.error("[RAG Service] Error calling similarity search RPC:", err);
    return '';
  }
}
