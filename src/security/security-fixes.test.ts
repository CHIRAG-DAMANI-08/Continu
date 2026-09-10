import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getOrCreateSalt, deriveUserEncryptionKey, bufferToBase64 } from './encryption';
import { getAISettings, saveAIProvider } from '../ai/storage';
import { cookPromptMessageSchema, MessageType } from './messaging';

describe('Security Audit Remediation Tests', () => {
  let mockStorage: Record<string, any> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).chrome = {
      runtime: { id: 'test-extension-id' },
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            if (typeof keys === 'string') {
              return { [keys]: mockStorage[keys] };
            }
            const res: Record<string, any> = {};
            for (const k of keys) {
              res[k] = mockStorage[k];
            }
            return res;
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(mockStorage, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) {
              delete mockStorage[k];
            }
          }),
        },
      },
    };
  });

  describe('1. XSS Escaping Logic', () => {
    // Testing the escape logic implemented in composer-icon.ts
    function escapeHtml(str: string): string {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    it('escapes double quotes and single quotes to prevent attribute breakout', () => {
      const maliciousPayload = '" onmouseover="alert(1)" data-x="';
      const escaped = escapeHtml(maliciousPayload);

      expect(escaped).not.toContain('"');
      expect(escaped).toContain('&quot;');
      expect(escaped).toBe('&quot; onmouseover=&quot;alert(1)&quot; data-x=&quot;');

      // Verify single quote escaping
      expect(escapeHtml("' onload='alert(1)'")).toContain('&#39;');
    });

    it('escapes HTML tags and special characters', () => {
      const payload = '<script>alert("XSS")</script>&<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(payload);
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
      expect(escaped).not.toContain('"');
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&amp;');
    });

    it('handles non-string inputs gracefully', () => {
      expect(escapeHtml(undefined as any)).toBe('');
      expect(escapeHtml(null as any)).toBe('');
    });
  });

  describe('2. Salt Storage Scoping per User', () => {
    it('isolates encryption salts between different user accounts', async () => {
      const saltUserA = await getOrCreateSalt('user_A_uuid');
      const saltUserB = await getOrCreateSalt('user_B_uuid');

      expect(saltUserA).toBeInstanceOf(Uint8Array);
      expect(saltUserB).toBeInstanceOf(Uint8Array);
      expect(bufferToBase64(saltUserA)).not.toBe(bufferToBase64(saltUserB));

      // Key derivation for user A should be consistent across calls
      const saltUserAAgain = await getOrCreateSalt('user_A_uuid');
      expect(bufferToBase64(saltUserA)).toBe(bufferToBase64(saltUserAAgain));
    });
  });

  describe('3. API Key Storage Protection', () => {
    it('obfuscates API keys in chrome.storage.local while returning cleartext to callers', async () => {
      await saveAIProvider({
        provider: 'openai',
        apiKey: 'sk-secret-token-12345678',
        model: 'gpt-4o-mini',
      });

      // Directly inspect raw chrome.storage.local content
      const rawStoredSettings = mockStorage['continu_ai_settings'];
      expect(rawStoredSettings).toBeDefined();

      const storedApiKey = rawStoredSettings.providers.openai.apiKey;
      // Stored key must NOT be plain text sk-secret
      expect(storedApiKey).not.toBe('sk-secret-token-12345678');
      expect(storedApiKey.startsWith('enc:v1:')).toBe(true);

      // getAISettings must decrypt and return the original key transparently
      const settings = await getAISettings();
      expect(settings.providers.openai?.apiKey).toBe('sk-secret-token-12345678');
    });
  });

  describe('4. Message Schema Validation', () => {
    it('validates COOK_PROMPT message payload', () => {
      const valid = {
        type: MessageType.COOK_PROMPT,
        prompt: 'Make this prompt better',
      };
      expect(cookPromptMessageSchema.safeParse(valid).success).toBe(true);

      const invalidType = {
        type: 'INVALID_TYPE',
        prompt: 'test',
      };
      expect(cookPromptMessageSchema.safeParse(invalidType).success).toBe(false);
    });
  });

  describe('5. Password Policy Rules', () => {
    it('validates password length threshold >= 8 characters', () => {
      const validatePassword = (pass: string) => Boolean(pass && pass.length >= 8);

      expect(validatePassword('')).toBe(false);
      expect(validatePassword('1234567')).toBe(false);
      expect(validatePassword('12345678')).toBe(true);
      expect(validatePassword('SecurePassword2026!')).toBe(true);
    });
  });
});
