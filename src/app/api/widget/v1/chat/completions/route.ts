import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig } from '@/lib/widget-service/config';
import { verifyOriginAndGetHeaders } from '@/lib/widget-service/cors';
import { checkBudgetLimit } from '@/lib/widget-service/usage';
import { retrieveRelevantContext } from '@/lib/widget-service/rag';
import { callLLM, ChatMessage } from '@/lib/widget-service/llm-proxy';
import { createHubSpotLead, LeadPayload } from '@/lib/widget-service/hubspot';

interface OpenAICompletionsBody {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
}

function parseLeadMetadata(text: string): { cleanText: string; lead?: any } {
  const leadRegex = /\[LEAD:\s*(.*?)\]/;
  const match = text.match(leadRegex);
  if (!match) return { cleanText: text };

  const rawMetadata = match[0];
  const body = match[1];
  
  const lead: any = {};
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
  // Allow Vapi service to call our completions endpoint
  // Vapi calls this from their servers, so Origin header might be empty
  // We check client configurations and allow it.
  const cors = verifyOriginAndGetHeaders(req);

  try {
    const body = (await req.json()) as OpenAICompletionsBody;
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Invalid messages' }, { status: 400 });
    }

    // 1. Voice minute budget enforcement
    const budget = checkBudgetLimit();
    if (budget.voiceCapExceeded) {
      console.warn("[Voice API] Voice minute budget exceeded.");
      const errorMsg = "Our voice assistant is temporarily offline due to monthly capacity. Please toggle to text chat or use the contact form to reach out. Thank you!";
      return NextResponse.json({
        id: 'chatcmpl-budget-cap',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        choices: [{
          index: 0,
          message: { role: 'assistant', content: errorMsg },
          finish_reason: 'stop'
        }]
      });
    }

    const config = getClientConfig();
    
    // Extract the latest query from user spoken transcript
    const lastUserMessage = messages[messages.length - 1]?.content || '';

    // 2. RAG Retrieval
    const retrievedContext = await retrieveRelevantContext(lastUserMessage);

    // 3. System Prompt variable injection
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
3. Keep spoken replies short, natural and conversational for voice turn-taking. Avoid lists or markdown formatting.
4. If you have captured name and email, output the progressive qualification tag at the end of your response:
[LEAD: name="NAME" email="EMAIL" company="COMPANY" role="ROLE" problem="PROBLEM" fitScore=FIT_SCORE highFit=true|false]`;

    // 4. Call LLM Proxy
    const llmRes = await callLLM(messages, fullSystemPrompt);

    // 5. Parse Lead Metadata Tags
    const { cleanText, lead } = parseLeadMetadata(llmRes.text);

    if (lead && lead.email && lead.name) {
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

      void createHubSpotLead(leadPayload);
    }

    // 6. Return OpenAI-compatible response payload for Vapi
    return NextResponse.json({
      id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'custom-claude-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: cleanText
        },
        finish_reason: 'stop'
      }]
    }, { headers: cors.headers });

  } catch (err) {
    console.error("[Voice API] Error processing completions:", err);
    return NextResponse.json({
      id: 'chatcmpl-error',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'I encountered an issue processing your request. Let me connect you with Dhananjay.' },
        finish_reason: 'stop'
      }]
    }, { status: 500 });
  }
}

export async function OPTIONS(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: cors.headers });
}
