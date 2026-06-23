import fs from 'fs';
import path from 'path';
import { getClientConfig } from './config';

interface UsageData {
  monthlyTokensUsed: number;
  monthlyVoiceMinutesUsed: number;
  lastResetMonth: string; // YYYY-MM
}

// Stored in the project's persistent local directory
const usageFilePath = path.join(process.cwd(), 'data/usage.json');

function getCurrentMonthString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function loadUsage(): UsageData {
  const currentMonth = getCurrentMonthString();
  const defaultUsage: UsageData = {
    monthlyTokensUsed: 0,
    monthlyVoiceMinutesUsed: 0,
    lastResetMonth: currentMonth
  };

  try {
    const dataDir = path.dirname(usageFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(usageFilePath)) {
      fs.writeFileSync(usageFilePath, JSON.stringify(defaultUsage, null, 2), 'utf8');
      return defaultUsage;
    }

    const raw = fs.readFileSync(usageFilePath, 'utf8');
    const usage = JSON.parse(raw) as UsageData;

    // Handle monthly rollover reset
    if (usage.lastResetMonth !== currentMonth) {
      usage.monthlyTokensUsed = 0;
      usage.monthlyVoiceMinutesUsed = 0;
      usage.lastResetMonth = currentMonth;
      fs.writeFileSync(usageFilePath, JSON.stringify(usage, null, 2), 'utf8');
    }

    return usage;
  } catch (err) {
    console.error("Failed to load usage file:", err);
    return defaultUsage;
  }
}

function saveUsage(usage: UsageData) {
  try {
    fs.writeFileSync(usageFilePath, JSON.stringify(usage, null, 2), 'utf8');
  } catch (err) {
    console.error("Failed to save usage file:", err);
  }
}

export function checkBudgetLimit(): { tokenCapExceeded: boolean; voiceCapExceeded: boolean } {
  const config = getClientConfig();
  const usage = loadUsage();
  
  return {
    tokenCapExceeded: usage.monthlyTokensUsed >= config.budget.monthlyTokenCap,
    voiceCapExceeded: usage.monthlyVoiceMinutesUsed >= config.budget.monthlyVoiceMinutesCap
  };
}

export function recordTokenUsage(tokens: number) {
  try {
    const usage = loadUsage();
    usage.monthlyTokensUsed += tokens;
    saveUsage(usage);
  } catch (err) {
    console.error("Failed to record token usage:", err);
  }
}

export function recordVoiceUsage(minutes: number) {
  try {
    const usage = loadUsage();
    usage.monthlyVoiceMinutesUsed += minutes;
    saveUsage(usage);
  } catch (err) {
    console.error("Failed to record voice usage:", err);
  }
}
