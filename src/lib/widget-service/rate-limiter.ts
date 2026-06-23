import { NextRequest } from 'next/server';

interface RateLimitTracker {
  count: number;
  resetTime: number;
}

const ipLimits = new Map<string, RateLimitTracker>();
const sessionLimits = new Map<string, RateLimitTracker>();

const IP_WINDOW_MS = 60 * 1000;      // 1 minute window
const IP_MAX_REQUESTS = 60;          // 60 requests per minute per IP

const SESSION_WINDOW_MS = 60 * 1000; // 1 minute window
const SESSION_MAX_REQUESTS = 30;     // 30 requests per minute per session

function cleanExpiredLimits(map: Map<string, RateLimitTracker>) {
  const now = Date.now();
  for (const [key, limit] of map.entries()) {
    if (now > limit.resetTime) {
      map.delete(key);
    }
  }
}

export function isRateLimited(req: NextRequest, sessionId: string): boolean {
  const now = Date.now();
  
  // Prune expired entries to maintain bounds on memory growth
  cleanExpiredLimits(ipLimits);
  cleanExpiredLimits(sessionLimits);

  // 1. IP Address Rate Limiting
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || (req as any).ip || 'unknown';
  let ipLimit = ipLimits.get(ip);
  
  if (!ipLimit || now > ipLimit.resetTime) {
    ipLimit = { count: 0, resetTime: now + IP_WINDOW_MS };
    ipLimits.set(ip, ipLimit);
  }
  
  ipLimit.count++;
  if (ipLimit.count > IP_MAX_REQUESTS) {
    console.warn(`[Rate Limiter] Limit exceeded for IP: ${ip}`);
    return true;
  }

  // 2. Session ID Rate Limiting
  if (sessionId) {
    let sessionLimit = sessionLimits.get(sessionId);
    if (!sessionLimit || now > sessionLimit.resetTime) {
      sessionLimit = { count: 0, resetTime: now + SESSION_WINDOW_MS };
      sessionLimits.set(sessionId, sessionLimit);
    }
    
    sessionLimit.count++;
    if (sessionLimit.count > SESSION_MAX_REQUESTS) {
      console.warn(`[Rate Limiter] Limit exceeded for Session ID: ${sessionId}`);
      return true;
    }
  }

  return false;
}
