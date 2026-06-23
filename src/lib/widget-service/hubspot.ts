import fs from 'fs';
import path from 'path';
import { getClientConfig, resolveEnvKey } from './config';

export interface LeadPayload {
  name: string;
  email: string;
  company: string;
  role: string;
  problemStatement: string;
  fitScore?: number;
  isHighFit?: boolean;
  transcript?: string;
  transcriptLink?: string;
}

const leadsFilePath = path.join(process.cwd(), 'data/leads.json');

function saveLeadLocally(lead: LeadPayload) {
  try {
    const dataDir = path.dirname(leadsFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    let leads: LeadPayload[] = [];
    if (fs.existsSync(leadsFilePath)) {
      const raw = fs.readFileSync(leadsFilePath, 'utf8');
      leads = JSON.parse(raw) as LeadPayload[];
    }

    leads.push({
      ...lead,
      // Record timestamp
      fitScore: lead.fitScore || 0,
      isHighFit: lead.isHighFit || false
    });

    fs.writeFileSync(leadsFilePath, JSON.stringify(leads, null, 2), 'utf8');
    console.log("[HubSpot Service] Lead saved locally inside data/leads.json");
  } catch (err) {
    console.error("[HubSpot Service] Failed to save lead locally:", err);
  }
}

export async function createHubSpotLead(lead: LeadPayload): Promise<boolean> {
  const config = getClientConfig();
  const tokenEnvName = config.integrations.hubspot.accessTokenEnv;
  const accessToken = resolveEnvKey(tokenEnvName);

  // Always back up lead locally first for reliability
  saveLeadLocally(lead);

  if (!accessToken) {
    console.warn(`[HubSpot Service] HubSpot API token variable '${tokenEnvName}' is not set. Skipping CRM push.`);
    return true; // Return true as we successfully captured the lead locally
  }

  // Parse first and last name from name
  const nameParts = lead.name.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || 'Lead';

  try {
    // 1. Create HubSpot Contact
    const contactUrl = 'https://api.hubapi.com/crm/v3/objects/contacts';
    const contactBody = {
      properties: {
        firstname: firstName,
        lastname: lastName,
        email: lead.email,
        company: lead.company,
        jobtitle: lead.role
      }
    };

    console.log(`[HubSpot Service] Pushing contact to HubSpot CRM: ${lead.email}`);
    const contactRes = await fetch(contactUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contactBody)
    });

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      console.error(`[HubSpot Service] HubSpot contact creation failed (${contactRes.status}):`, errText);
      return false;
    }

    const contactData = await contactRes.json();
    const contactId = contactData.id;
    console.log(`[HubSpot Service] Contact successfully created with ID: ${contactId}`);

    // 2. Create Note with Transcript and Associate to Contact
    if (lead.transcript || lead.transcriptLink || lead.problemStatement) {
      const noteUrl = 'https://api.hubapi.com/crm/v3/objects/notes';
      const noteBody = {
        properties: {
          hs_note_body: `<h3>AI Assistant Conversation Note</h3>
<p><strong>Fit Score:</strong> ${lead.fitScore || 0} / 5</p>
<p><strong>Is High Fit:</strong> ${lead.isHighFit ? 'YES' : 'NO'}</p>
<p><strong>Problem Statement:</strong> ${lead.problemStatement || 'Not provided'}</p>
${lead.transcriptLink ? `<p><strong>Full Transcript Link:</strong> <a href="${lead.transcriptLink}" target="_blank">View Audio Transcript</a></p>` : ''}
<hr />
<p><strong>Transcript Content:</strong></p>
<pre>${lead.transcript || 'No transcript text available.'}</pre>`,
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

      console.log(`[HubSpot Service] Attaching transcript note to contact: ${contactId}`);
      const noteRes = await fetch(noteUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(noteBody)
      });

      if (!noteRes.ok) {
        const errText = await noteRes.text();
        console.error(`[HubSpot Service] HubSpot note creation failed (${noteRes.status}):`, errText);
      } else {
        console.log("[HubSpot Service] Transcript note successfully attached in HubSpot.");
      }
    }

    return true;
  } catch (err) {
    console.error("[HubSpot Service] HubSpot lead push failed:", err);
    return false;
  }
}
