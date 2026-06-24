import { NextRequest, NextResponse } from 'next/server';
import { recordVoiceUsage } from '@/lib/widget-service/usage';
import { createHubSpotLead } from '@/lib/widget-service/hubspot';
import { getClientConfig } from '@/lib/widget-service/config';

async function extractLeadFromTranscript(transcript: string, companyName: string): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  const prompt = `You are an expert lead parser analyzing a voice call transcript from a company's web voice assistant.
Analyze the transcript below and extract the following contact information. Resolve speech-to-text transcription errors, phonetic spellings, spelling typos, and formatting:
1. Name: Extract the visitor's full name. If they said a phonetic name (e.g., "my name is john s-m-i-t-h" or "shravam"), correct it to the most standard spelling (e.g., "John Smith", "Shravan").
2. Email: Extract and format their work email. Carefully clean up and resolve phonetic spellings (e.g., convert "abc at gmail dot com", "abc at gmail.com", "abc at yahoo dot co dot uk" to "abc@gmail.com" or "abc@yahoo.co.uk").
3. Company: Extract the visitor's company name.
4. Role: Extract their job title or role. Correct spelling typos (e.g., "cto", "vp engineering", "developper").
5. Problem Statement: Summarize what problem or requirements they described.

Multi-Lead Resolution Rule:
If multiple different names or emails are mentioned in the transcript, extract the primary visitor's details (the person who initiated the call/conversation) into the name and email fields. You should note any secondary names or emails mentioned in the problemStatement summary so they are preserved.

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
    console.error("[Retell Webhook] Failed to extract lead from transcript:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const event = payload?.event;
    console.log(`[Retell Webhook] Received webhook event: ${event}`);

    // Retell calls ended event: "call_ended"
    if (event === 'call_ended') {
      const call = payload.call || {};
      const durationMs = call.duration_ms || 0;
      const minutes = durationMs / 60000;

      console.log(`[Retell Webhook] Recording voice usage: ${minutes.toFixed(2)} minutes.`);
      recordVoiceUsage(minutes);

      const transcript = call.transcript || '';
      
      // Edge Case 1: Check if the transcript is actually a conversational call
      const cleanTranscript = transcript.trim().replace(/[.\s]+/g, ' ');
      const isConversational = cleanTranscript.length > 15 && 
        !/^(listening|speaking|connecting|disconnected|no speech detected|hello|hi|yes|no)$/i.test(cleanTranscript.toLowerCase().trim());

      if (transcript && isConversational) {
        console.log(`[Retell Webhook] Processing end of call transcript for lead extraction...`);
        const config = getClientConfig();
        const companyName = config.companyName || 'Enlight Lab';
        
        const extracted = await extractLeadFromTranscript(transcript, companyName);
        
        const hasEmail = !!extracted?.email?.trim();
        const hasName = !!extracted?.name?.trim();

        // Edge Case 2: Accept partial info if at least name or email is captured
        if (extracted && (hasEmail || hasName)) {
          const finalName = hasName ? extracted.name.trim() : 'Voice Assistant Lead';
          const finalEmail = hasEmail ? extracted.email.trim() : '';

          console.log(`[Retell Webhook] Extracted lead: ${finalName} (${finalEmail || 'No Email'}). Storing in HubSpot...`);
          
          const leadPayload = {
            name: finalName,
            email: finalEmail,
            company: extracted.company || '',
            role: extracted.role || '',
            problemStatement: extracted.problemStatement || '',
            transcript: transcript,
            transcriptLink: call.recording_url || undefined, // Store recording link if available
            fitScore: 0,
            isHighFit: false
          };
          
          await createHubSpotLead(leadPayload);
        } else {
          console.log(`[Retell Webhook] No contact details (neither name nor email) could be extracted from transcript.`);
        }
      } else {
        console.log(`[Retell Webhook] Call skipped (empty, silent, or no meaningful conversation detected).`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Retell Webhook] Error processing event:", err);
    return NextResponse.json({ error: 'Failed to process webhook event' }, { status: 500 });
  }
}
