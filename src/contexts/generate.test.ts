import { describe, it, expect } from 'vitest';
import { generateContext, generateMinimalContext } from './generate';
import { validateContext } from './validation';
import type { ConversationTurn } from './model';

describe('Context Generation & Validation', () => {
  it('generates a valid context from normal conversation', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'How do I optimize React components?', timestamp: new Date().toISOString() },
      { role: 'assistant', content: 'You can use useMemo, useCallback, and React.memo.', timestamp: new Date().toISOString() },
    ];

    const ctx = generateContext({
      url: 'https://chatgpt.com/c/12345',
      title: 'React Optimization - ChatGPT',
      platform: 'chatgpt',
      conversation: turns,
    });

    expect(ctx.id).toBeDefined();
    expect(ctx.name).toBe('React Optimization - ChatGPT');
    expect(ctx.source.platform).toBe('chatgpt');
    expect(ctx.conversation.length).toBe(2);

    const validation = validateContext(ctx);
    expect(validation.success).toBe(true);
  });

  it('filters pleasantries and extracts meaningful objective, decisions, and next steps', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'hi', timestamp: new Date().toISOString() },
      { role: 'assistant', content: 'Hello! How can I help you today?', timestamp: new Date().toISOString() },
      { role: 'user', content: 'We need to migrate our database from MySQL to PostgreSQL with zero downtime.', timestamp: new Date().toISOString() },
      {
        role: 'assistant',
        content: `Here is the plan:
- We decided to use Supabase as our managed PostgreSQL provider.
- Requirement: Must maintain 99.9% uptime during the cutover.
- Constraint: Cannot exceed 2 hours maintenance window.
- Next steps: Set up shadow replication and run latency tests.`,
        timestamp: new Date().toISOString(),
      },
    ];

    const ctx = generateContext({
      url: 'https://claude.ai/chat/123',
      title: 'Claude', // Generic title should be replaced by substantive prompt
      platform: 'claude',
      conversation: turns,
    });

    expect(ctx.name.toLowerCase()).toContain('migrate our database from mysql to postgresql');
    expect(ctx.objective.toLowerCase()).toContain('migrate our database from mysql to postgresql');

    expect(ctx.decisions.length).toBeGreaterThan(0);
    expect(ctx.decisions[0]).toContain('use Supabase');
    expect(ctx.requirements.length).toBeGreaterThan(0);
    expect(ctx.nextActions.length).toBeGreaterThan(0);
    expect(ctx.tags).toContain('database');
  });

  it('ignores previous Continu injection envelopes and 1-line acknowledgments', () => {
    const turns: ConversationTurn[] = [
      {
        role: 'user',
        content: `[CONTINU CONTEXT INGESTION]
TOPIC: Old Topic
[DIRECTIVE: Ingest this context into session memory. Respond with EXACTLY and ONLY this single sentence: "Context loaded. Let's talk."]`,
        timestamp: new Date().toISOString(),
      },
      { role: 'assistant', content: "Context loaded. Let's talk.", timestamp: new Date().toISOString() },
      { role: 'user', content: 'Can you implement a JWT authentication middleware in Express?', timestamp: new Date().toISOString() },
      { role: 'assistant', content: 'Here is the JWT middleware using jsonwebtoken library...', timestamp: new Date().toISOString() },
    ];

    const ctx = generateContext({
      url: 'https://chat.deepseek.com',
      title: '',
      platform: 'deepseek',
      conversation: turns,
    });

    expect(ctx.conversation.length).toBe(2);
    expect(ctx.objective).toContain('JWT authentication middleware');
    expect(ctx.name).toContain('JWT authentication middleware');
  });

  it('handles empty titles, unusual URLs, and long messages without throwing', () => {
    const longCode = 'const x = ' + 'a'.repeat(25000) + ';';
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Write a large script', timestamp: new Date().toISOString() },
      { role: 'assistant', content: longCode, timestamp: new Date().toISOString() },
    ];

    const ctx = generateContext({
      url: 'about:blank',
      title: '',
      platform: 'chatgpt',
      conversation: turns,
    });

    expect(ctx.id).toBeDefined();
    expect(ctx.name).toBe('Write a large script');
    expect(ctx.conversation.length).toBe(2);
    expect(ctx.conversation[1].content.length).toBe(25011);

    const validation = validateContext(ctx);
    expect(validation.success).toBe(true);
  });

  it('generates minimal context when conversation is empty', () => {
    const ctx = generateMinimalContext('https://chatgpt.com', 'ChatGPT', 'chatgpt');
    expect(ctx.id).toBeDefined();
    expect(ctx.name).toBe('chatgpt conversation'); // "ChatGPT" is generic, falls back gracefully
    expect(ctx.conversation.length).toBe(0);

    const validation = validateContext(ctx);
    expect(validation.success).toBe(true);
  });

  it('unrolls prior conversation history from transfer envelopes to retain 100% full chat memory', () => {
    const transferredMessage = `[Reference Context: Web App Setup]
Goal: Build a full-stack React app
State: In progress with Vite

[Prior Conversation History]:
User: How do I initialize a React app with Vite?
Assistant: Run npm create vite@latest my-app -- --template react-ts.
User: What CSS framework should we use?
Assistant: Tailwind CSS is recommended for flexibility.

Now how do I configure Tailwind CSS with Vite?`;

    const turns: ConversationTurn[] = [
      { role: 'user', content: transferredMessage, timestamp: '2026-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'Install tailwindcss and @tailwindcss/vite plugins.', timestamp: '2026-01-01T00:01:00.000Z' },
    ];

    const ctx = generateContext({
      url: 'https://claude.ai/chat/abc',
      title: 'Full Stack App',
      platform: 'claude',
      conversation: turns,
    });

    // Must have unrolled the 2 prior user turns + 2 prior assistant turns + the new user turn + new assistant turn = 6 turns!
    expect(ctx.conversation.length).toBe(6);
    expect(ctx.conversation[0].role).toBe('user');
    expect(ctx.conversation[0].content).toBe('How do I initialize a React app with Vite?');
    expect(ctx.conversation[1].role).toBe('assistant');
    expect(ctx.conversation[1].content).toBe('Run npm create vite@latest my-app -- --template react-ts.');
    expect(ctx.conversation[2].role).toBe('user');
    expect(ctx.conversation[2].content).toBe('What CSS framework should we use?');
    expect(ctx.conversation[3].role).toBe('assistant');
    expect(ctx.conversation[3].content).toBe('Tailwind CSS is recommended for flexibility.');
    expect(ctx.conversation[4].role).toBe('user');
    expect(ctx.conversation[4].content).toBe('Now how do I configure Tailwind CSS with Vite?');
    expect(ctx.conversation[5].role).toBe('assistant');
    expect(ctx.conversation[5].content).toBe('Install tailwindcss and @tailwindcss/vite plugins.');

    // Nothing from older turns is forgotten
    expect(ctx.conversation.map(t => t.content).join(' ')).toContain('How do I initialize a React app');
    expect(ctx.conversation.map(t => t.content).join(' ')).toContain('Install tailwindcss');
  });
});
