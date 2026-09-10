import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAISettings,
  saveAIProvider,
  removeAIProvider,
  setActiveAIProvider,
  maskApiKey,
} from './storage';
import type { ProviderConfig } from './types';

describe('AI Storage & Key Management', () => {
  let mockStorage: Record<string, any> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            return { [key]: mockStorage[key] };
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(mockStorage, items);
          }),
        },
      },
    };
  });

  it('masks API keys securely', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('12345678')).toBe('••••••••');
    expect(maskApiKey('sk-proj-1234567890abcdef')).toBe('sk-pro...cdef');
    expect(maskApiKey('AIzaSyABCD1234567890')).toBe('AIzaSy...7890');
  });

  it('saves and retrieves provider configuration', async () => {
    const config: ProviderConfig = {
      provider: 'openai',
      apiKey: 'sk-proj-test1234567890abcdef',
      model: 'gpt-4o-mini',
      isValidated: true,
    };

    await saveAIProvider(config);
    const settings = await getAISettings();

    expect(settings.providers.openai).toBeDefined();
    expect(settings.providers.openai?.apiKey).toBe('sk-proj-test1234567890abcdef');
    expect(settings.providers.openai?.model).toBe('gpt-4o-mini');
    expect(settings.activeProvider).toBe('openai');
  });

  it('removes provider configuration and falls back active provider', async () => {
    await saveAIProvider({
      provider: 'openai',
      apiKey: 'sk-openai-key-12345678',
      model: 'gpt-4o',
    });

    await saveAIProvider({
      provider: 'gemini',
      apiKey: 'AIzaSy-gemini-key-1234',
      model: 'gemini-1.5-flash',
    });

    await setActiveAIProvider('openai');
    let settings = await getAISettings();
    expect(settings.activeProvider).toBe('openai');

    await removeAIProvider('openai');
    settings = await getAISettings();

    expect(settings.providers.openai).toBeUndefined();
    expect(settings.providers.gemini).toBeDefined();
    expect(settings.activeProvider).toBe('gemini');
  });
});
