import { NextRequest, NextResponse } from 'next/server';
import { recordVoiceUsage } from '@/lib/widget-service/usage';
import { createHubSpotLead } from '@/lib/widget-service/hubspot';
import { getClientConfig } from '@/lib/widget-service/config';

async function extractLeadFromTranscript(transcript: string, companyName: string): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  const prompt = `You are an expert lead parser analyzing a voice call transcript from a company's web voice assistant.
Analyze the transcript below and extract the following contact information. Resolve speech-to-text transcription errors, phonetic spellings, and formatting:
1. Name: Extract the visitor's full name. If they said a phonetic name, correct it to the most standard spelling.
2. Email: Extract and format their work email (e.g. convert "abc at gmail dot com" or "abc at gmail.com" to "abc@gmail.com").
3. Company: Extract the visitor's company name.
4. Role: Extract their job title or role.
5. Problem Statement: Summarize what problem or requirements they described.

Transcript:
"""
${transcript}
"""

Format your response as a valid JSON object with the following keys:
- name: string (empty string if not found)
- email: string (empty string if not found)
- company: string (empty string if not found)
- role: string (empty string if not found)
- problemStatement: string (empty string if not found)

Do NOT include any markdown code blocks, conversational text, or explanation. Return ONLY the JSON object.`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.0,
          responseMimeType: 'application/json'
        }
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(text);
  } catch (err) {
    console.error("[Vapi Webhook] Failed to extract lead from transcript:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const messageType = payload?.message?.type;
    console.log(`[Vapi Webhook] Received webhook event type: ${messageType}`);

    if (messageType === 'end-of-call-report') {
      const rawDuration = payload.message.duration || payload.message.call?.duration || 0;
      
      // Vapi provides duration in seconds inside call object, or minutes in root report.
      // We parse defensively and convert to minutes.
      let minutes = 0;
      if (rawDuration > 1200) {
        // Very large number is likely milliseconds
        minutes = rawDuration / 60000;
      } else if (rawDuration > 20) {
        // Number above 20 is likely seconds
        minutes = rawDuration / 60;
      } else {
        // Otherwise, it is already represented in minutes
        minutes = rawDuration;
      }

      console.log(`[Vapi Webhook] Recording voice usage: ${minutes.toFixed(2)} minutes.`);
      recordVoiceUsage(minutes);

      // Extract lead details and sync to HubSpot CRM
      const call = payload.message.call || {};
      const transcript = payload.message.transcript || call.transcript || '';
      
      if (transcript) {
        console.log(`[Vapi Webhook] Processing end of call transcript for lead extraction...`);
        const config = getClientConfig();
        const companyName = config.companyName || 'Enlight Lab';
        
        const extracted = await extractLeadFromTranscript(transcript, companyName);
        if (extracted && extracted.email && extracted.name) {
          console.log(`[Vapi Webhook] Extracted lead: ${extracted.name} (${extracted.email}). Storing in HubSpot...`);
          
          const leadPayload = {
            name: extracted.name,
            email: extracted.email,
            company: extracted.company || '',
            role: extracted.role || '',
            problemStatement: extracted.problemStatement || '',
            transcript: transcript,
            fitScore: 0,
            isHighFit: false
          };
          
          await createHubSpotLead(leadPayload);
        } else {
          console.log(`[Vapi Webhook] No valid contact details (name and email) extracted from transcript.`);
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Vapi Webhook] Error processing event:", err);
    return NextResponse.json({ error: 'Failed to process webhook event' }, { status: 500 });
  }
}
