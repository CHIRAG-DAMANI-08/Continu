import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizeContext, validateContext } from './validation';

describe('Input Sanitization', () => {
  it('strips null bytes from text', () => {
    const dirty = 'Hello\0World\0!\0';
    expect(sanitizeString(dirty)).toBe('HelloWorld!');
  });

  it('strips ASCII control characters but preserves tabs and newlines', () => {
    const dirty = 'Line 1\nLine 2\r\n\tTabbed\x00\x07\x08\x1B\x7F';
    expect(sanitizeString(dirty)).toBe('Line 1\nLine 2\r\n\tTabbed');
  });

  it('normalizes unicode characters using NFKC', () => {
    // \uFB01 is 'fi' ligature, NFKC expands to 'f' + 'i'
    const ligature = '\uFB01le';
    expect(sanitizeString(ligature)).toBe('file');
  });

  it('sanitizes all fields of a ContinuContext', () => {
    const malicious = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      schemaVersion: 1,
      name: 'Test\0 Context\x07',
      source: {
        platform: 'claude\0',
        url: 'https://claude.ai\0/chat',
        title: 'Title\x1F',
      },
      objective: 'Objective\0 with null',
      currentState: 'State\x08 with backspace',
      decisions: ['Decision 1\0', 'Decision 2\x1B'],
      requirements: ['Req\0'],
      constraints: ['Constraint\0'],
      openQuestions: ['Question\0'],
      nextActions: ['Action\0'],
      conversation: [
        { role: 'user' as const, content: 'User msg\0\x07', timestamp: '2026-09-08\0' },
        { role: 'assistant' as const, content: 'AI msg\0', timestamp: '2026-09-08' },
      ],
      createdAt: '2026-09-08T12:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    };

    const sanitized = sanitizeContext(malicious);

    expect(sanitized.name).toBe('Test Context');
    expect(sanitized.source.platform).toBe('claude');
    expect(sanitized.source.url).toBe('https://claude.ai/chat');
    expect(sanitized.source.title).toBe('Title');
    expect(sanitized.objective).toBe('Objective with null');
    expect(sanitized.currentState).toBe('State with backspace');
    expect(sanitized.decisions).toEqual(['Decision 1', 'Decision 2']);
    expect(sanitized.conversation[0].content).toBe('User msg');
    expect(sanitized.conversation[0].timestamp).toBe('2026-09-08');

    // Make sure sanitized context validates with schema
    const validation = validateContext(sanitized);
    expect(validation.success).toBe(true);
  });
});
