import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig } from '@/lib/widget-service/config';
import { verifyOriginAndGetHeaders } from '@/lib/widget-service/cors';
import { isRateLimited } from '@/lib/widget-service/rate-limiter';
import { checkBudgetLimit } from '@/lib/widget-service/usage';
import { retrieveRelevantContext } from '@/lib/widget-service/rag';
import { callLLM, ChatMessage } from '@/lib/widget-service/llm-proxy';
import { createHubSpotLead, LeadPayload } from '@/lib/widget-service/hubspot';

interface ChatRequestBody {
  messages: ChatMessage[];
  sessionId: string;
}

interface ParsedLead {
  name?: string;
  email?: string;
  company?: string;
  role?: string;
  problemStatement?: string;
  fitScore?: number;
  isHighFit?: boolean;
}

function parseLeadMetadata(text: string): { cleanText: string; lead?: ParsedLead } {
  const leadRegex = /\[LEAD:\s*(.*?)\]/;
  const match = text.match(leadRegex);
  if (!match) return { cleanText: text };

  const rawMetadata = match[0];
  const body = match[1];
  
  const lead: ParsedLead = {};
  
  // Regex to match keys like name="John Doe", fitScore=5, highFit=true
  const pairRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\w+))/g;
  let pairMatch;
  while ((pairMatch = pairRegex.exec(body)) !== null) {
    const key = pairMatch[1];
    const val = pairMatch[2] || pairMatch[3] || pairMatch[4];
    
    if (key === 'name') lead.name = val;
    else if (key === 'email') lead.email = val;
    else if (key === 'company') lead.company = val;
    else if (key === 'role') lead.role = val;
    else if (key === 'problem') lead.problemStatement = val;
    else if (key === 'fitScore') lead.fitScore = parseInt(val, 10);
    else if (key === 'highFit') lead.isHighFit = val === 'true';
  }

  const cleanText = text.replace(rawMetadata, '').trim();
  return { cleanText, lead };
}

export async function POST(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const body = (await req.json()) as ChatRequestBody;
    const { messages, sessionId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Invalid messages array' }, { status: 400, headers: cors.headers });
    }

    // 1. Rate Limiting
    if (isRateLimited(req, sessionId)) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: cors.headers }
      );
    }

    // 2. Budget Cap Checks
    const budget = checkBudgetLimit();
    if (budget.tokenCapExceeded) {
      console.warn("[Chat API] Token budget cap reached. Rejecting request.");
      return NextResponse.json(
        { 
          error: 'Budget cap exceeded',
          message: 'The assistant is temporarily offline. Please use the contact form to reach out.'
        },
        { status: 503, headers: cors.headers }
      );
    }

    const config = getClientConfig();
    const lastUserMessage = messages[messages.length - 1]?.content || '';

    // 3. RAG Retrieval
    const retrievedContext = await retrieveRelevantContext(lastUserMessage);
    
    // 4. Construct System Prompt with Grounding Context
    let basePrompt = config.llm.systemPrompt;
    basePrompt = basePrompt
      .replace(/\{\{companyName\}\}/g, config.companyName)
      .replace(/\{\{founderName\}\}/g, config.founderName)
      .replace(/\{\{founderEmail\}\}/g, config.founderEmail);

    const fullSystemPrompt = `${basePrompt}

[Knowledge Base Context]:
${retrievedContext || 'No specific background matching the query was found in the Knowledge Base. Rely on core capabilities or redirect to founder if unsure.'}

IMPORTANT GROUNDING CONSTRAINTS:
1. ONLY answer questions about ${config.companyName}'s services, testimonials, metrics, founder and case studies using facts from the [Knowledge Base Context] above.
2. If the context does not contain enough info to answer, say exactly: 'I don't have that information — let me connect you to ${config.founderName} at ${config.founderEmail}' and offer to book a call or capture their info. Never guess or invent facts.
3. If you have captured name and email, output the progressive qualification tag at the end of your response:
[LEAD: name="NAME" email="EMAIL" company="COMPANY" role="ROLE" problem="PROBLEM" fitScore=FIT_SCORE highFit=true|false]
Replace variables dynamically based on what you have gathered so far. Evaluate fit Score (1-5) and highFit (true if Series A-C CTO/VP in priority vertical, false otherwise).`;

    // 5. Call LLM
    const llmRes = await callLLM(messages, fullSystemPrompt);
    
    // 6. Parse Lead Metadata Tags
    const { cleanText, lead } = parseLeadMetadata(llmRes.text);

    let isHighFit = false;
    if (lead) {
      isHighFit = lead.isHighFit || false;

      // If we have at least name and email, push/update in HubSpot CRM
      if (lead.email && lead.name) {
        // Construct the full conversation transcript for HubSpot note attachment
        const transcriptText = messages
          .map(m => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`)
          .concat([`Assistant: ${cleanText}`])
          .join('\n\r');

        const leadPayload: LeadPayload = {
          name: lead.name,
          email: lead.email,
          company: lead.company || '',
          role: lead.role || '',
          problemStatement: lead.problemStatement || '',
          fitScore: lead.fitScore || 0,
          isHighFit: lead.isHighFit || false,
          transcript: transcriptText
        };

        // Fire HubSpot background execution
        void createHubSpotLead(leadPayload);
      }
    }

    return NextResponse.json({
      text: cleanText,
      isHighFit
    }, { headers: cors.headers });

  } catch (err) {
    console.error("[Chat API] Error processing conversation:", err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: cors.headers }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: cors.headers });
}
