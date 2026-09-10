import type { ProviderType } from './types';
import { checkRateLimit, recordAttempt, RATE_LIMIT_AI_MODELS } from '../security/rate-limiter';

/**
 * Dynamically queries the provider's API using the user's API key
 * to return all available models for that account.
 */
export async function fetchAvailableModels(
  provider: ProviderType,
  apiKey: string,
  customBaseUrl?: string
): Promise<string[]> {
  const key = apiKey.trim();
  if (!key) return [];

  // Rate limiting check
  const rateLimit = await checkRateLimit(`ai:models:${provider}`, RATE_LIMIT_AI_MODELS);
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.error || `Please wait ${rateLimit.retryAfterSeconds}s before fetching models again.`);
  }

  const timeoutMs = 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let resultModels: string[] = [];

    switch (provider) {
      case 'gemini': {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models';
        const res = await fetch(url, {
          headers: {
            'x-goog-api-key': key,
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Gemini returned status ${res.status}: ${errText.slice(0, 100)}`);
        }
        const data = await res.json();
        const models: any[] = data.models || [];
        // Filter to models supported for content generation
        const validModels = models
          .filter(m => {
            const methods: string[] = m.supportedGenerationMethods || [];
            return methods.includes('generateContent');
          })
          .map(m => m.name.replace(/^models\//, ''))
          .filter(name => !name.includes('embedding') && !name.includes('aqa'));

        resultModels = sortGeminiModels(validModels);
        break;
      }

      case 'openai': {
        const url = customBaseUrl || 'https://api.openai.com/v1/models';
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`OpenAI returned status ${res.status}: ${errText.slice(0, 100)}`);
        }
        const data = await res.json();
        const list: any[] = data.data || [];
        const chatModels = list
          .map(m => m.id as string)
          .filter(id => {
            const lower = id.toLowerCase();
            return (
              (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('chatgpt-')) &&
              !lower.includes('realtime') &&
              !lower.includes('audio') &&
              !lower.includes('transcription') &&
              !lower.includes('tts') &&
              !lower.includes('embedding') &&
              !lower.includes('moderation') &&
              !lower.includes('search')
            );
          });
        resultModels = sortOpenAIModels(chatModels);
        break;
      }

      case 'groq': {
        const url = customBaseUrl || 'https://api.groq.com/openai/v1/models';
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Groq returned status ${res.status}: ${errText.slice(0, 100)}`);
        }
        const data = await res.json();
        const list: any[] = data.data || [];
        const models = list
          .map(m => m.id as string)
          .filter(id => !id.includes('whisper') && !id.includes('guard'));
        resultModels = models.sort();
        break;
      }

      case 'openrouter': {
        const url = customBaseUrl || 'https://openrouter.ai/api/v1/models';
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`OpenRouter returned status ${res.status}: ${errText.slice(0, 100)}`);
        }
        const data = await res.json();
        const list: any[] = data.data || [];
        resultModels = list.map(m => m.id as string).slice(0, 60);
        break;
      }

      case 'anthropic': {
        // Anthropic does not provide an open /models endpoint for client keys
        resultModels = [
          'claude-3-7-sonnet-20250219',
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229',
        ];
        break;
      }

      default:
        resultModels = [];
        break;
    }

    // Record successful model query attempt
    await recordAttempt(`ai:models:${provider}`, RATE_LIMIT_AI_MODELS);
    return resultModels;
  } finally {
    clearTimeout(timer);
  }
}

function sortGeminiModels(models: string[]): string[] {
  const priority = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
  ];
  const prioritySet = new Set(priority);
  const others = models.filter(m => !prioritySet.has(m)).sort();
  const availablePriority = priority.filter(p => models.includes(p));
  return [...availablePriority, ...others];
}

function sortOpenAIModels(models: string[]): string[] {
  const priority = [
    'gpt-4o-mini',
    'gpt-4o',
    'o3-mini',
    'o1',
    'o1-mini',
    'gpt-4-turbo',
  ];
  const prioritySet = new Set(priority);
  const others = models.filter(m => !prioritySet.has(m)).sort();
  const availablePriority = priority.filter(p => models.includes(p));
  return [...availablePriority, ...others];
}
