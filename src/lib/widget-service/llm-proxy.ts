import { getClientConfig, resolveEnvKey } from './config';
import { recordTokenUsage } from './usage';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function callLLM(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<LLMResponse> {
  const config = getClientConfig();
  const provider = config.llm.provider.toLowerCase();
  const model = config.llm.model;
  
  // Resolve API Key dynamically from environment
  let apiKey = '';
  if (provider === 'gemini') {
    apiKey = process.env.GEMINI_API_KEY || '';
  } else if (provider === 'anthropic') {
    apiKey = process.env.ANTHROPIC_API_KEY || '';
  } else if (provider === 'openai') {
    apiKey = process.env.OPENAI_API_KEY || '';
  }

  if (!apiKey) {
    throw new Error(`API key for LLM provider '${provider}' is not set in environment.`);
  }

  if (provider === 'gemini') {
    return callGemini(messages, systemPrompt, model, apiKey);
  } else if (provider === 'anthropic') {
    return callAnthropic(messages, systemPrompt, model, apiKey);
  } else if (provider === 'openai') {
    return callOpenAI(messages, systemPrompt, model, apiKey);
  } else {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

async function callGemini(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string,
  apiKey: string
): Promise<LLMResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  // Format history for Gemini
  const contents = messages
    .filter(m => m.role !== 'system') // Gemini system instruction is separate
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const body = {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const promptTokens = data.usageMetadata?.promptTokenCount || 0;
  const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
  const totalTokens = data.usageMetadata?.totalTokenCount || 0;

  recordTokenUsage(totalTokens);

  return {
    text,
    usage: { promptTokens, completionTokens, totalTokens }
  };
}

async function callAnthropic(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string,
  apiKey: string
): Promise<LLMResponse> {
  const url = 'https://api.anthropic.com/v1/messages';
  
  // Filter and convert roles
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

  const body = {
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: anthropicMessages,
    temperature: 0.2
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  const promptTokens = data.usage?.input_tokens || 0;
  const completionTokens = data.usage?.output_tokens || 0;
  const totalTokens = promptTokens + completionTokens;

  recordTokenUsage(totalTokens);

  return {
    text,
    usage: { promptTokens, completionTokens, totalTokens }
  };
}

async function callOpenAI(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string,
  apiKey: string
): Promise<LLMResponse> {
  const url = 'https://api.openai.com/v1/chat/completions';
  
  const openAIMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role,
      content: m.content
    }))
  ];

  const body = {
    model,
    messages: openAIMessages,
    temperature: 0.2,
    max_tokens: 1024
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  const promptTokens = data.usage?.prompt_tokens || 0;
  const completionTokens = data.usage?.completion_tokens || 0;
  const totalTokens = data.usage?.total_tokens || 0;

  recordTokenUsage(totalTokens);

  return {
    text,
    usage: { promptTokens, completionTokens, totalTokens }
  };
}
