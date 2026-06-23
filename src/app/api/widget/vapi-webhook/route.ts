import { NextRequest, NextResponse } from 'next/server';
import { recordVoiceUsage } from '@/lib/widget-service/usage';

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
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Vapi Webhook] Error processing event:", err);
    return NextResponse.json({ error: 'Failed to process webhook event' }, { status: 500 });
  }
}
