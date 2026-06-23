import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig } from '@/lib/widget-service/config';
import { verifyOriginAndGetHeaders } from '@/lib/widget-service/cors';

export async function GET(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const config = getClientConfig();
    return NextResponse.json({
      companyName: config.companyName,
      branding: config.branding,
      dwellTime: config.dwellTime,
      integrations: {
        cal: config.integrations.cal,
        googleAds: {
          conversionId: config.integrations.googleAds.conversionId,
          conversionLabel: config.integrations.googleAds.conversionLabel
        }
      },
      vapi: {
        assistantId: config.vapi.assistantId,
        publicKey: config.vapi.publicKey
      },
      voice: config.voice
    }, { headers: cors.headers });
  } catch (err) {
    return NextResponse.json({ error: 'Config not available' }, { status: 500, headers: cors.headers });
  }
}

export async function OPTIONS(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: cors.headers });
}
