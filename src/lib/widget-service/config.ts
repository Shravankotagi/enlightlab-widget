import fs from 'fs';
import path from 'path';

export interface ClientConfig {
  clientName: string;
  companyName: string;
  founderName: string;
  founderEmail: string;
  allowedOrigins: string[];
  dwellTime: number;
  branding: {
    primaryColor: string;
    textColor: string;
    assistantName: string;
    welcomeMessage: string;
    logoUrl: string;
  };
  llm: {
    provider: string;
    model: string;
    systemPrompt: string;
  };
  embeddings: {
    provider: string;
    model: string;
    similarityThreshold: number;
  };
  integrations: {
    hubspot: {
      accessTokenEnv: string;
      fitScoreThreshold: number;
    };
    cal: {
      eventLink: string;
    };
    googleAds: {
      conversionId: string;
      conversionLabel?: string;
    };
  };
  vapi: {
    assistantId: string;
    apiKeyEnv: string;
    publicKey: string;
  };
  voice?: {
    provider: 'vapi' | 'retell';
    agentId?: string;
    apiKeyEnv?: string;
  };
  budget: {
    monthlyTokenCap: number;
    monthlyVoiceMinutesCap: number;
  };
}

let cachedConfig: ClientConfig | null = null;

export function getClientConfig(): ClientConfig {
  if (cachedConfig) return cachedConfig;
  try {
    // Relative to process.cwd() at runtime in Next.js
    const configPath = path.join(process.cwd(), 'config/client.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    cachedConfig = JSON.parse(raw) as ClientConfig;
    return cachedConfig;
  } catch (err) {
    console.error("Failed to load client config:", err);
    throw new Error("Client configuration not loaded");
  }
}

export function resolveEnvKey(envKeyName: string): string {
  if (!envKeyName) return '';
  return process.env[envKeyName] || '';
}
