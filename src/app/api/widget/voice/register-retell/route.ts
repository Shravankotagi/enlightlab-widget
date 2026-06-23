import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, resolveEnvKey } from '@/lib/widget-service/config';
import { verifyOriginAndGetHeaders } from '@/lib/widget-service/cors';
import { checkBudgetLimit } from '@/lib/widget-service/usage';

export async function POST(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    // 1. Budget checking
    const budget = checkBudgetLimit();
    if (budget.voiceCapExceeded) {
      return NextResponse.json(
        { error: 'Voice call budget limit reached. Please use text chat.' },
        { status: 503, headers: cors.headers }
      );
    }

    const config = getClientConfig();
    if (!config.voice || config.voice.provider !== 'retell') {
      return NextResponse.json(
        { error: 'Retell voice provider is not active.' },
        { status: 400, headers: cors.headers }
      );
    }

    const agentId = config.voice.agentId;
    const apiKeyEnvName = config.voice.apiKeyEnv || 'RETELL_API_KEY';
    const apiKey = resolveEnvKey(apiKeyEnvName);

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Retell API Key is not configured on the server.' },
        { status: 500, headers: cors.headers }
      );
    }

    if (!agentId || agentId === 'retell-agent-id-here') {
      return NextResponse.json(
        { error: 'Retell Agent ID is not configured on the server.' },
        { status: 400, headers: cors.headers }
      );
    }

    // 2. Fetch call token from Retell AI
    const url = 'https://api.retellai.com/v2/create-web-call';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: agentId
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Retell API] Failed to create web call (${response.status}):`, errText);
      return NextResponse.json(
        { error: `Retell API error: ${errText}` },
        { status: response.status, headers: cors.headers }
      );
    }

    const data = await response.json();
    
    return NextResponse.json({
      accessToken: data.access_token,
      callId: data.call_id
    }, { headers: cors.headers });

  } catch (err) {
    console.error("[Retell Register API] Error creating web call:", err);
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
