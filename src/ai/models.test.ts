// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAvailableModels } from './models';

describe('fetchAvailableModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array when apiKey is empty', async () => {
    const models = await fetchAvailableModels('gemini', '   ');
    expect(models).toEqual([]);
  });

  describe('Gemini models listing', () => {
    it('fetches, filters and formats Gemini models correctly', async () => {
      const mockApiResponse = {
        models: [
          {
            name: 'models/text-embedding-004',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            name: 'models/aqa',
            supportedGenerationMethods: ['generateAnswer'],
          },
          {
            name: 'models/gemini-1.5-pro',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/gemini-1.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.0-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/custom-fine-tuned-model',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockApiResponse,
        })
      );

      const result = await fetchAvailableModels('gemini', 'AIzaSyFakeKey');

      // Check models/ prefix was stripped
      expect(result.some(m => m.startsWith('models/'))).toBe(false);

      // Check embedding and aqa models were excluded
      expect(result).not.toContain('text-embedding-004');
      expect(result).not.toContain('aqa');

      // Check valid generateContent models are included
      expect(result).toContain('gemini-1.5-flash');
      expect(result).toContain('gemini-2.0-flash');
      expect(result).toContain('gemini-1.5-pro');
      expect(result).toContain('custom-fine-tuned-model');

      // Check priority ordering: gemini-2.0-flash, gemini-1.5-flash should be near front
      expect(result[0]).toBe('gemini-2.0-flash');
      expect(result[1]).toBe('gemini-1.5-flash');
    });

    it('throws informative error on non-200 status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => 'API_KEY_INVALID',
        })
      );

      await expect(fetchAvailableModels('gemini', 'bad-key')).rejects.toThrow(
        'Gemini returned status 400'
      );
    });
  });

  describe('OpenAI models listing', () => {
    it('filters out non-chat models', async () => {
      const mockApiResponse = {
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-4o-mini' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'tts-1' },
          { id: 'o1-mini' },
          { id: 'gpt-4o-realtime-preview' },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockApiResponse,
        })
      );

      const result = await fetchAvailableModels('openai', 'sk-test-key');
      expect(result).toContain('gpt-4o');
      expect(result).toContain('gpt-4o-mini');
      expect(result).toContain('o1-mini');
      expect(result).not.toContain('text-embedding-3-small');
      expect(result).not.toContain('whisper-1');
      expect(result).not.toContain('tts-1');
      expect(result).not.toContain('gpt-4o-realtime-preview');
    });
  });

  describe('Groq models listing', () => {
    it('filters out whisper and guard models', async () => {
      const mockApiResponse = {
        data: [
          { id: 'llama-3.3-70b-versatile' },
          { id: 'llama-3.1-8b-instant' },
          { id: 'whisper-large-v3' },
          { id: 'llama-guard-3-8b' },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockApiResponse,
        })
      );

      const result = await fetchAvailableModels('groq', 'gsk-test-key');
      expect(result).toContain('llama-3.3-70b-versatile');
      expect(result).toContain('llama-3.1-8b-instant');
      expect(result).not.toContain('whisper-large-v3');
      expect(result).not.toContain('llama-guard-3-8b');
    });
  });

  describe('Anthropic models listing', () => {
    it('returns curated Claude models', async () => {
      const result = await fetchAvailableModels('anthropic', 'sk-ant-test');
      expect(result).toContain('claude-3-5-sonnet-20241022');
      expect(result).toContain('claude-3-5-haiku-20241022');
    });
  });
});
