import { describe, it, expect } from 'vitest';
import { redactSensitiveData } from './logger';

describe('Safe Logger Redaction', () => {
  it('redacts OpenAI API keys from strings', () => {
    const raw = 'Error communicating with sk-proj-1234567890abcdef1234567890';
    const redacted = redactSensitiveData(raw);
    expect(redacted).not.toContain('sk-proj-1234567890abcdef1234567890');
    expect(redacted).toContain('[REDACTED_API_KEY]');
  });

  it('redacts Google Gemini keys from strings', () => {
    const raw = 'https://generativelanguage.googleapis.com/?key=AIzaSyA1234567890123456789012345678901';
    const redacted = redactSensitiveData(raw);
    expect(redacted).not.toContain('AIzaSyA1234567890123456789012345678901');
    expect(redacted).toContain('[REDACTED_GEMINI_KEY]');
  });

  it('redacts Anthropic keys', () => {
    const raw = 'Failed key sk-ant-api03-1234567890abcdef12345678';
    const redacted = redactSensitiveData(raw);
    expect(redacted).not.toContain('sk-ant-api03-1234567890abcdef12345678');
    expect(redacted).toContain('[REDACTED_ANTHROPIC_KEY]');
  });

  it('redacts Groq keys', () => {
    const raw = 'Failed key gsk_1234567890abcdef1234567890abcdef';
    const redacted = redactSensitiveData(raw);
    expect(redacted).not.toContain('gsk_1234567890abcdef1234567890abcdef');
    expect(redacted).toContain('[REDACTED_GROQ_KEY]');
  });

  it('redacts Bearer authorization tokens', () => {
    const raw = 'Header was Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
    const redacted = redactSensitiveData(raw);
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz');
    expect(redacted).toContain('Bearer [REDACTED_TOKEN]');
  });

  it('redacts Error objects containing keys in message and stack', () => {
    const err = new Error('HTTP 401 with sk-1234567890abcdef1234567890');
    const cleanErr = redactSensitiveData(err);
    expect(cleanErr.message).not.toContain('sk-1234567890abcdef1234567890');
    expect(cleanErr.message).toContain('[REDACTED_API_KEY]');
  });

  it('redacts object properties containing sensitive keys', () => {
    const obj = {
      apiKey: 'secret-key-1234',
      token: 'jwt-token-999',
      username: 'johndoe',
    };
    const cleanObj = redactSensitiveData(obj);
    expect(cleanObj.apiKey).toBe('[REDACTED]');
    expect(cleanObj.token).toBe('[REDACTED]');
    expect(cleanObj.username).toBe('johndoe');
  });
});
