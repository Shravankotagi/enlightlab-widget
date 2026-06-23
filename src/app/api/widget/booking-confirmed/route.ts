import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, resolveEnvKey } from '@/lib/widget-service/config';
import { verifyOriginAndGetHeaders } from '@/lib/widget-service/cors';
import fs from 'fs';
import path from 'path';

const leadsFilePath = path.join(process.cwd(), 'data/leads.json');

async function findContactIdByEmail(email: string, accessToken: string): Promise<string | null> {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email
              }
            ]
          }
        ]
      })
    });

    if (!res.ok) {
      console.error(`[HubSpot Search] Contact search failed with status: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.results?.[0]?.id || null;
  } catch (err) {
    console.error("[HubSpot Search] Contact search failed:", err);
    return null;
  }
}

async function attachBookingNoteToHubSpot(contactId: string, accessToken: string): Promise<boolean> {
  const url = 'https://api.hubapi.com/crm/v3/objects/notes';
  try {
    const body = {
      properties: {
        hs_note_body: `<h3>Cal.com Booking Confirmed</h3>
<p>The lead has successfully booked a diagnostic consultation session via the in-widget scheduler.</p>
<p><strong>Status:</strong> Scheduled & Confirmed</p>`,
        hs_timestamp: new Date().toISOString()
      },
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: 202 // Note to Contact
            }
          ]
        }
      ]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error(`[HubSpot Note] Note attachment failed with status: ${res.status}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[HubSpot Note] Note attachment failed:", err);
    return false;
  }
}

function updateLocalLeadBooking(email: string) {
  try {
    if (!fs.existsSync(leadsFilePath)) return;
    
    const raw = fs.readFileSync(leadsFilePath, 'utf8');
    const leads = JSON.parse(raw) as any[];

    const updated = leads.map(lead => {
      if (lead.email?.toLowerCase() === email.toLowerCase()) {
        return {
          ...lead,
          bookedConsultation: true,
          bookedAt: new Date().toISOString()
        };
      }
      return lead;
    });

    fs.writeFileSync(leadsFilePath, JSON.stringify(updated, null, 2), 'utf8');
    console.log(`[Local DB] Updated booking status for: ${email}`);
  } catch (err) {
    console.error("[Local DB] Failed to update lead booking:", err);
  }
}

export async function POST(req: NextRequest) {
  const cors = verifyOriginAndGetHeaders(req);
  if (!cors.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400, headers: cors.headers });
    }

    // 1. Update local database record
    updateLocalLeadBooking(email);

    // 2. Update HubSpot CRM if token is configured
    const config = getClientConfig();
    const tokenEnvName = config.integrations.hubspot.accessTokenEnv;
    const accessToken = resolveEnvKey(tokenEnvName);

    if (accessToken) {
      const contactId = await findContactIdByEmail(email, accessToken);
      if (contactId) {
        const attached = await attachBookingNoteToHubSpot(contactId, accessToken);
        if (attached) {
          console.log(`[HubSpot CRM] Successfully logged booking note for contact: ${contactId}`);
        }
      } else {
        console.warn(`[HubSpot CRM] Could not find contact with email ${email} to attach booking note.`);
      }
    }

    return NextResponse.json({ ok: true }, { headers: cors.headers });

  } catch (err) {
    console.error("[Booking Confirmed API] Error confirming booking:", err);
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
