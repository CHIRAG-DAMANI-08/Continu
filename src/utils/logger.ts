/**
 * Safe Logger for Chrome Extension Contexts
 * Redacts sensitive tokens (API keys, authorization headers, passwords, emails)
 * and suppresses verbose/debug output in production.
 */

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Anthropic sk-ant- keys (order before generic sk-)
  { pattern: /sk-ant-[a-zA-Z0-9_\-]{20,}/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  // OpenAI & generic sk- keys
  { pattern: /sk-[a-zA-Z0-9_\-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  // Google Gemini AIza keys (39 chars total, typically 35 chars after AIza)
  { pattern: /AIza[0-9A-Za-z_\-]{30,40}/g, replacement: '[REDACTED_GEMINI_KEY]' },
  // Groq gsk_ keys
  { pattern: /gsk_[a-zA-Z0-9_\-]{20,}/g, replacement: '[REDACTED_GROQ_KEY]' },
  // Bearer tokens in headers or strings
  { pattern: /Bearer\s+[a-zA-Z0-9_\-\.]+/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // Emails (privacy protection)
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
];

export function redactSensitiveData(input: any): any {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    let result = input;
    for (const { pattern, replacement } of REDACTION_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  if (input instanceof Error) {
    const cleanErr = new Error(redactSensitiveData(input.message));
    if (input.stack) {
      cleanErr.stack = redactSensitiveData(input.stack);
    }
    return cleanErr;
  }

  if (Array.isArray(input)) {
    return input.map(item => redactSensitiveData(item));
  }

  if (typeof input === 'object') {
    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(input)) {
      if (/key|token|auth|password|secret/i.test(key) && typeof val === 'string') {
        cleanObj[key] = '[REDACTED]';
      } else {
        cleanObj[key] = redactSensitiveData(val);
      }
    }
    return cleanObj;
  }

  return input;
}

const isProduction = process.env.NODE_ENV === 'production';

export const logger = {
  debug(...args: any[]): void {
    if (!isProduction) {
      console.debug(...args.map(redactSensitiveData));
    }
  },

  info(...args: any[]): void {
    if (!isProduction) {
      console.info(...args.map(redactSensitiveData));
    }
  },

  warn(...args: any[]): void {
    console.warn(...args.map(redactSensitiveData));
  },

  error(...args: any[]): void {
    console.error(...args.map(redactSensitiveData));
  },
};
