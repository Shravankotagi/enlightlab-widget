import { NextRequest } from 'next/server';
import { getClientConfig } from './config';

export interface CorsResult {
  allowed: boolean;
  headers: Record<string, string>;
}

export function verifyOriginAndGetHeaders(req: NextRequest): CorsResult {
  const config = getClientConfig();
  const origin = req.headers.get('origin');
  
  // If there's no Origin header (e.g., direct curl request or internal fetch),
  // we still require allowedOrigins check if Referer header is present.
  // Standard browsers send Origin for CORS requests.
  if (!origin) {
    const referer = req.headers.get('referer');
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const isAllowed = config.allowedOrigins.some(allowed => {
          return refererUrl.host === allowed || refererUrl.host.endsWith('.' + allowed);
        });
        if (!isAllowed) {
          return { allowed: false, headers: {} };
        }
      } catch {
        return { allowed: false, headers: {} };
      }
    }
    
    return {
      allowed: true,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };
  }

  let originHost = origin;
  try {
    const originUrl = new URL(origin);
    originHost = originUrl.host; // e.g. "enlightlab.com" or "localhost:3000"
  } catch {}

  const isAllowed = config.allowedOrigins.some(allowed => {
    return originHost === allowed || originHost.endsWith('.' + allowed);
  });

  if (!isAllowed) {
    console.warn(`[CORS Guard] Blocked request from non-whitelisted origin: ${originHost}`);
    return { allowed: false, headers: {} };
  }

  return {
    allowed: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true'
    }
  };
}
