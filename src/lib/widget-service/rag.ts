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

async function rewriteQuery(
  query: string,
  apiKey: string,
  companyName: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  try {
    const prompt = `You are a search query optimizer for a RAG system.
Given a user query (which may contain typos, spelling errors, grammatical mistakes, or pronouns referring to the company, your services, or founder), rewrite it to be a clean, optimized search phrase in English for retrieving relevant context. If the query is related to the company, ensure "${companyName}" is included in the rewritten query. Correct all typos and misspellings.

Examples:
- "what all services are being provided by this comapny" -> "services provided by ${companyName}"
- "who found it" -> "founder of ${companyName}"
- "fractional cto work you did" -> "fractional CTO services case studies ${companyName}"
- "is patient data secure" -> "security privacy HIPAA compliance ${companyName}"
- "who is dj" -> "Dhananjay Goel dj ${companyName}"
- "what tech stack do you use" -> "technology stack frameworks ${companyName}"
- "tell me abot your servcies" -> "services provided by ${companyName}"

User Query: "${query}"

Return ONLY the clean optimized search query. Do not add any conversational text, explanations, or quotes.`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 60
        }
      })
    });

    if (!response.ok) {
      console.warn(`[RAG Query Rewrite] Failed to rewrite query, using original. Status: ${response.status}`);
      return query;
    }

    const data = await response.json();
    const rewritten = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || query;
    // Strip quotes if LLM added them
    return rewritten.replace(/^["']|["']$/g, '').trim();
  } catch (err) {
    console.error("[RAG Query Rewrite] Error during query rewrite:", err);
    return query;
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

  // 1. Rewrite query to correct typos and resolve pronouns/company references using LLM
  const companyName = config.companyName || 'Enlight Lab';
  let searchNormalizedQuery = query;
  try {
    searchNormalizedQuery = await rewriteQuery(query, apiKey, companyName);
    console.log(`[RAG Service] Original Query: "${query}" | Rewritten Query for RAG: "${searchNormalizedQuery}"`);
  } catch (e) {
    console.warn("[RAG Service] Query rewrite failed, falling back to original query.", e);
  }

  // 2. Generate query embedding vector
  const queryVector = await getQueryEmbedding(searchNormalizedQuery, apiKey, embedModel);
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
