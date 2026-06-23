import { NextRequest, NextResponse } from 'next/server';
import { verifyOriginAndGetHeaders } from '@/lib/widget-service/cors';
import { createHubSpotLead, LeadPayload } from '@/lib/widget-service/hubspot';

const THROWAWAY_DOMAINS = [
  'mailinator.com',
  'tempmail.com',
  '10minutemail.com',
  'throwawaymail.com',
  'yopmail.com',
  'guerrillamail.com',
  'getnada.com',
  'sharklasers.com'
];

function isThrowawayEmail(email: string): boolean {
  if (!email || !email.includes('@')) return true;
  const domain = email.trim().split('@')[1]?.toLowerCase() || '';
  return THROWAWAY_DOMAINS.includes(domain);
}

export async function POST(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const lead = (await req.json()) as LeadPayload;

    if (!lead.name || !lead.email || !lead.company || !lead.role) {
      return NextResponse.json(
        { error: 'Missing required contact fields' },
        { status: 400, headers: cors.headers }
      );
    }

    // Soft email validation: Reject throwaway domains
    if (isThrowawayEmail(lead.email)) {
      return NextResponse.json(
        { error: 'Please enter a valid work email address (no throwaway domains).' },
        { status: 400, headers: cors.headers }
      );
    }

    // Push the manually captured contact to HubSpot
    const success = await createHubSpotLead({
      ...lead,
      fitScore: lead.fitScore || 0,
      isHighFit: lead.isHighFit || false,
      transcript: lead.transcript || '[Manual Form Submission] User filled out the fallback lead capture form.'
    });

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to record lead in CRM' },
        { status: 500, headers: cors.headers }
      );
    }

    return NextResponse.json({ ok: true }, { headers: cors.headers });

  } catch (err) {
    console.error("[Lead Capture API] Error submitting form:", err);
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
