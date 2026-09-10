import type { ProviderConfig } from './types';

export interface TestResult {
  success: boolean;
  message: string;
  models?: string[];
}

export async function testProviderConnection(config: ProviderConfig): Promise<TestResult> {
  const key = config.apiKey.trim();
  if (!key) {
    return { success: false, message: 'API key is required' };
  }

  const timeoutMs = 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (config.provider) {
      case 'openai': {
        const url = config.customBaseUrl || 'https://api.openai.com/v1/models';
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const list: any[] = data.data || [];
          const chatModels = list
            .map(m => m.id as string)
            .filter(id => {
              const lower = (id || '').toLowerCase();
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
          return {
            success: true,
            message: `Connection successful. Key verified (${chatModels.length} models available).`,
            models: chatModels,
          };
        }
        if (res.status === 401) {
          return { success: false, message: 'Invalid API key.' };
        }
        if (res.status === 429) {
          return { success: false, message: 'Quota exceeded or rate limited.' };
        }
        const text = await res.text().catch(() => '');
        return { success: false, message: `OpenAI returned status ${res.status}: ${text.slice(0, 100)}` };
      }

      case 'gemini': {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models';
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'x-goog-api-key': key,
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const models: any[] = data.models || [];
          const validModels = models
            .filter((m: any) => {
              const methods: string[] = m.supportedGenerationMethods || [];
              return methods.includes('generateContent');
            })
            .map((m: any) => (m.name || '').replace(/^models\//, ''))
            .filter((name: string) => name && !name.includes('embedding') && !name.includes('aqa'));

          return {
            success: true,
            message: `Connection successful. Key verified (${validModels.length} models available).`,
            models: validModels,
          };
        }
        if (res.status === 400 || res.status === 403) {
          return { success: false, message: 'Invalid or restricted API key.' };
        }
        const text = await res.text().catch(() => '');
        return { success: false, message: `Gemini returned status ${res.status}: ${text.slice(0, 100)}` };
      }

      case 'anthropic': {
        // Anthropic requires POST to /v1/messages
        const url = config.customBaseUrl || 'https://api.anthropic.com/v1/messages';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: config.model || 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: controller.signal,
        });

        if (res.ok) {
          return { success: true, message: 'Connection successful. Key verified.' };
        }
        if (res.status === 401) {
          return { success: false, message: 'Invalid API key.' };
        }
        if (res.status === 400) {
          // Bad request might still mean key is authenticated
          const data = await res.json().catch(() => ({}));
          if (data?.error?.type === 'authentication_error') {
            return { success: false, message: 'Invalid API key.' };
          }
          return { success: true, message: 'Key authenticated.' };
        }
        return { success: false, message: `Anthropic returned status ${res.status}` };
      }

      case 'openrouter': {
        const url = config.customBaseUrl || 'https://openrouter.ai/api/v1/auth/key';
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });

        if (res.ok) {
          return { success: true, message: 'Connection successful. Key verified.' };
        }
        if (res.status === 401) {
          return { success: false, message: 'Invalid API key.' };
        }
        return { success: false, message: `OpenRouter returned status ${res.status}` };
      }

      case 'groq': {
        const url = config.customBaseUrl || 'https://api.groq.com/openai/v1/models';
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const list: any[] = data.data || [];
          const models = list
            .map(m => m.id as string)
            .filter(id => id && !id.includes('whisper') && !id.includes('guard'));
          return {
            success: true,
            message: `Connection successful. Key verified (${models.length} models available).`,
            models,
          };
        }
        if (res.status === 401) {
          return { success: false, message: 'Invalid API key.' };
        }
        const text = await res.text().catch(() => '');
        return { success: false, message: `Groq returned status ${res.status}: ${text.slice(0, 100)}` };
      }

      default:
        return { success: false, message: 'Unsupported provider' };
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, message: 'Connection timed out (8s).' };
    }
    return { success: false, message: err?.message || 'Network error connecting to provider.' };
  } finally {
    clearTimeout(timer);
  }
}
