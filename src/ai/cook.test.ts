// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAiConfigured, cookPrompt, calculateCookTimeout, cleanCookedPrompt } from './cook';
import * as storage from './storage';

describe('AI Cook Module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAiConfigured', () => {
    it('returns configured: false when no provider has an API key', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {},
        activeProvider: null,
      });

      const res = await isAiConfigured();
      expect(res.configured).toBe(false);
      expect(res.provider).toBeNull();
    });

    it('returns configured: true when activeProvider has an API key', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {
          openai: {
            provider: 'openai',
            apiKey: 'sk-test12345',
            model: 'gpt-4o-mini',
          },
        },
        activeProvider: 'openai',
      });

      const res = await isAiConfigured();
      expect(res.configured).toBe(true);
      expect(res.provider).toBe('openai');
      expect(res.model).toBe('gpt-4o-mini');
    });

    it('falls back to configured provider if activeProvider is not set', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {
          groq: {
            provider: 'groq',
            apiKey: 'gsk-test123',
            model: 'llama-3.3-70b-versatile',
          },
        },
        activeProvider: null,
      });

      const res = await isAiConfigured();
      expect(res.configured).toBe(true);
      expect(res.provider).toBe('groq');
    });
  });

  describe('cookPrompt', () => {
    it('returns EMPTY_PROMPT error when rawPrompt is empty or whitespace', async () => {
      const res = await cookPrompt('   ');
      expect(res.success).toBe(false);
      expect(res.error).toBe('EMPTY_PROMPT');
      expect(res.setupInfo).toContain('Please type a prompt');
    });

    it('returns NO_PROVIDER error and setupInfo when not configured', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {},
        activeProvider: null,
      });

      const res = await cookPrompt('Write a python script');
      expect(res.success).toBe(false);
      expect(res.error).toBe('NO_PROVIDER');
      expect(res.setupInfo).toContain('No AI provider configured');
    });

    it('successfully refines prompt using OpenAI/Groq API', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {
          openai: {
            provider: 'openai',
            apiKey: 'sk-mock-key',
            model: 'gpt-4o-mini',
          },
        },
        activeProvider: 'openai',
      });

      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Write a robust, production-ready Python script that performs the following steps...',
            },
          },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        })
      );

      const res = await cookPrompt('Write a python script');
      expect(res.success).toBe(true);
      expect(res.cookedPrompt).toContain('Write a robust, production-ready Python script');
      expect(res.provider).toBe('openai');
    });

    it('handles API failure gracefully', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {
          openai: {
            provider: 'openai',
            apiKey: 'sk-invalid-key',
            model: 'gpt-4o-mini',
          },
        },
        activeProvider: 'openai',
      });

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => 'Incorrect API key provided',
        })
      );

      const res = await cookPrompt('Fix my query');
      expect(res.success).toBe(false);
      expect(res.error).toBe('API_ERROR');
      expect(res.setupInfo).toContain('401');
    });

    it('successfully generates refined prompt with Gemini', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {
          gemini: {
            provider: 'gemini',
            apiKey: 'AIzaSyMockKey',
            model: 'gemini-1.5-flash',
          },
        },
        activeProvider: 'gemini',
      });

      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Here is a refined Gemini prompt.' }],
            },
          },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockGeminiResponse,
        })
      );

      const res = await cookPrompt('Make this better');
      expect(res.success).toBe(true);
      expect(res.cookedPrompt).toBe('Here is a refined Gemini prompt.');
      expect(res.provider).toBe('gemini');
    });

    it('automatically recovers when Gemini returns 404 for a model by falling back to gemini-1.5-flash', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {
          gemini: {
            provider: 'gemini',
            apiKey: 'AIzaSyMockKey',
            model: 'gemini-2.0-flash-exp', // deprecated/removed model
          },
        },
        activeProvider: 'gemini',
      });

      const mockGeminiSuccess = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Prompt generated successfully via fallback!' }],
            },
          },
        ],
      };

      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          callCount++;
          // First attempt with deprecated model returns 404
          if (callCount === 1) {
            return {
              ok: false,
              status: 404,
              text: async () => 'models/gemini-2.0-flash-exp is not found for API version v1beta',
            };
          }
          // Second attempt with gemini-1.5-flash fallback succeeds
          expect(url).toContain('gemini-1.5-flash');
          return {
            ok: true,
            json: async () => mockGeminiSuccess,
          };
        })
      );

      const res = await cookPrompt('Help me code');
      expect(res.success).toBe(true);
      expect(res.cookedPrompt).toBe('Prompt generated successfully via fallback!');
      expect(callCount).toBe(2);
    });

    it('handles timeout gracefully when request is aborted', async () => {
      vi.spyOn(storage, 'getAISettings').mockResolvedValue({
        providers: {
          openai: {
            provider: 'openai',
            apiKey: 'sk-test-key',
            model: 'gpt-4o-mini',
          },
        },
        activeProvider: 'openai',
      });

      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';

      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(abortError)
      );

      const res = await cookPrompt('Short prompt');
      expect(res.success).toBe(false);
      expect(res.error).toBe('TIMEOUT');
      expect(res.setupInfo).toContain('timed out');
    });
  });

  describe('calculateCookTimeout', () => {
    it('returns at least 60 seconds (60,000ms) for small prompts', () => {
      expect(calculateCookTimeout(0)).toBe(60000);
      expect(calculateCookTimeout(50)).toBe(61000);
      expect(calculateCookTimeout(200)).toBe(62000);
    });

    it('dynamically scales up timeout for large prompts', () => {
      // 10,000 chars: 60,000 + 100,000 = 160,000ms (160s)
      expect(calculateCookTimeout(10000)).toBe(160000);
      // 20,000 chars: 60,000 + 200,000 = 260,000ms (260s)
      expect(calculateCookTimeout(20000)).toBe(260000);
    });

    it('caps timeout at 300 seconds (5 minutes / 300,000ms) for massive prompts', () => {
      expect(calculateCookTimeout(50000)).toBe(300000);
      expect(calculateCookTimeout(100000)).toBe(300000);
    });
  });

  describe('cleanCookedPrompt', () => {
    it('strips double asterisks (markdown bold) from text', () => {
      const input = '**Role:** Senior engineer.\n**Objective:** Build a fast API.\n- **Constraint 1:** No external deps.';
      const output = cleanCookedPrompt(input);
      expect(output).not.toContain('**');
      expect(output).toBe('Role: Senior engineer.\nObjective: Build a fast API.\n- Constraint 1: No external deps.');
    });

    it('strips outer and line-level quotation marks', () => {
      const input = '"Write an optimized SQL query for Postgres."';
      expect(cleanCookedPrompt(input)).toBe('Write an optimized SQL query for Postgres.');

      const smartQuotes = '“Write a python script.”';
      expect(cleanCookedPrompt(smartQuotes)).toBe('Write a python script.');
    });

    it('strips markdown headings (#, ##, ###) while preserving text', () => {
      const input = '### Goal:\nBuild the user interface.\n## Requirements:\nClean design.';
      const output = cleanCookedPrompt(input);
      expect(output).toBe('Goal:\nBuild the user interface.\nRequirements:\nClean design.');
    });

    it('strips code fences wrapping the response', () => {
      const input = '```markdown\nOptimize this database query.\n```';
      expect(cleanCookedPrompt(input)).toBe('Optimize this database query.');
    });

    it('produces completely plain text from markdown-heavy output', () => {
      const input = `
"**GOAL:** Refactor the auth module.
### INSTRUCTIONS:
- **Step 1:** Use ***argon2id*** hashing.
- **Step 2:** Ensure __no plain text__ is stored.
"`;
      const output = cleanCookedPrompt(input);
      expect(output).not.toContain('**');
      expect(output).not.toContain('***');
      expect(output).not.toContain('__');
      expect(output).not.toContain('###');
      expect(output).not.toContain('"');
      expect(output).toContain('GOAL: Refactor the auth module.');
      expect(output).toContain('Step 1: Use argon2id hashing.');
      expect(output).toContain('Step 2: Ensure no plain text is stored.');
    });
  });
});
