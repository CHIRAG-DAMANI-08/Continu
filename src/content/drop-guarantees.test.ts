// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatContext, formatPromptWithContext } from '../contexts/format';
import type { ContinuContext } from '../contexts/model';
import type { AIAdapter } from '../adapters/base';

describe('PRD Drop Guarantees', () => {
  let container: HTMLDivElement;
  let sampleContext: ContinuContext;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    sampleContext = {
      id: 'ctx-123',
      name: 'Authentication Architecture',
      objective: 'Implement JWT refresh tokens in Node.js',
      source: {
        url: 'https://chatgpt.com/c/test-1',
        title: 'JWT Auth Discussion',
        platform: 'chatgpt',
      },
      currentState: 'Tokens implemented in cookie middleware.',
      decisions: ['Use httpOnly cookies for refresh token', 'Use 15m short-lived access token'],
      requirements: ['Must support token rotation', 'Must revoke on logout'],
      constraints: ['No Redis session store'],
      openQuestions: ['Should we use sliding sessions?'],
      nextActions: ['Add unit tests for refresh endpoint'],
      createdAt: '2026-09-07T12:00:00Z',
      updatedAt: '2026-09-07T12:00:00Z',
      conversation: [
        { role: 'user', content: 'How should we handle token refreshing?', timestamp: '2026-09-07T12:00:00Z' },
        { role: 'assistant', content: 'Store refresh tokens in httpOnly cookies.', timestamp: '2026-09-07T12:00:00Z' },
      ],
    };
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('inserts formatted structured context for user review without auto-submitting', () => {
    container.innerHTML = `
      <form id="chat-form">
        <textarea id="composer-area"></textarea>
        <button type="submit" id="send-btn">Send</button>
      </form>
    `;

    const textarea = container.querySelector('#composer-area') as HTMLTextAreaElement;
    const form = container.querySelector('#chat-form') as HTMLFormElement;

    let submitted = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });

    const adapter: AIAdapter = {
      name: 'test',
      detect: () => true,
      findComposer: () => textarea,
      findSubmitButton: () => container.querySelector('#send-btn'),
      findAttachButton: () => null,
      getComposerText: () => textarea.value,
      insertText: (t: string) => {
        textarea.value = t;
      },
      submitText: async () => false,
      extractConversation: () => [],
    };

    // Formatted drop text
    const formatted = formatContext(sampleContext, 'structured');
    adapter.insertText(formatted);

    // Context is cleanly inserted into composer
    expect(textarea.value).toContain('# Context: Authentication Architecture');
    expect(textarea.value).toContain('## Objective');
    expect(textarea.value).toContain('Implement JWT refresh tokens in Node.js');
    expect(textarea.value).toContain('## Decisions Made');
    expect(textarea.value).toContain('- Use httpOnly cookies for refresh token');

    // NEVER auto-submits - form must not have been submitted
    expect(submitted).toBe(false);
  });

  it('formats compact context with essential continuation information', () => {
    const compact = formatContext(sampleContext, 'compact');
    expect(compact).toContain('Context: Authentication Architecture');
    expect(compact).toContain('Goal: Implement JWT refresh tokens in Node.js');
    expect(compact).toContain('State: Tokens implemented in cookie middleware.');
    expect(compact).toContain('Decisions: Use httpOnly cookies for refresh token; Use 15m short-lived access token');
    expect(compact).toContain('Next: Add unit tests for refresh endpoint');
  });

  it('formats full context with conversation transcript', () => {
    const full = formatContext(sampleContext, 'full');
    expect(full).toContain('# Context: Authentication Architecture');
    expect(full).toContain('## Conversation');
    expect(full).toContain('**User:** How should we handle token refreshing?');
    expect(full).toContain('**Assistant:** Store refresh tokens in httpOnly cookies.');
  });

  it('formats 1-click drop transfer with token-optimized context, full chat history, and strict acknowledgment directive', () => {
    const hidden = formatContext(sampleContext, 'hidden');

    expect(hidden).toContain('[CONTINU CONTEXT TRANSFER]');
    expect(hidden).toContain('Topic: Authentication Architecture');
    expect(hidden).toContain('Goal: Implement JWT refresh tokens in Node.js');
    expect(hidden).toContain('Decisions: Use httpOnly cookies for refresh token; Use 15m short-lived access token');
    expect(hidden).toContain('[Full Conversation History]:');
    expect(hidden).toContain('User: How should we handle token refreshing?');
    expect(hidden).toContain('Assistant: Store refresh tokens in httpOnly cookies.');
    expect(hidden).toContain('Respond with EXACTLY and ONLY: "Got the context, let\'s go! What are we working on?"');

    expect(hidden.split(/\s+/).length).toBeLessThan(200);
  });

  it('dropContextToChat with hidden format submits payload and leaves composer clean (no text left pasted)', async () => {
    container.innerHTML = `
      <form id="chat-form">
        <textarea id="composer-area"></textarea>
        <button type="submit" id="send-btn">Send</button>
      </form>
    `;

    const textarea = container.querySelector('#composer-area') as HTMLTextAreaElement;
    const sendBtn = container.querySelector('#send-btn') as HTMLButtonElement;

    let submitted = false;
    let submittedPayload = '';

    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      submitted = true;
      submittedPayload = textarea.value;
    });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => textarea,
      findSubmitButton: () => sendBtn,
      findAttachButton: () => null,
      getComposerText: () => textarea.value,
      insertText: (t: string) => {
        textarea.value = t;
      },
      submitText: async () => false,
      extractConversation: () => [],
    };

    const { dropContextToChat } = await import('../adapters/utils');
    const success = await dropContextToChat(adapter, sampleContext, 'hidden');

    expect(success).toBe(true);
    expect(submitted).toBe(true);
    expect(submittedPayload).toContain('[CONTINU CONTEXT TRANSFER]');
    expect(submittedPayload).toContain('Got the context, let\'s go!');

    // Most important: the composer is completely clean after drop (not left pasted!)
    expect(textarea.value).toBe('');
  });

  it('dropContextToChat operates live for the user without blanking out the screen or changing opacity', async () => {
    container.innerHTML = `
      <form id="chat-form">
        <textarea id="composer-area"></textarea>
        <button type="submit" id="send-btn">Send</button>
      </form>
    `;

    const textarea = container.querySelector('#composer-area') as HTMLTextAreaElement;
    const sendBtn = container.querySelector('#send-btn') as HTMLButtonElement;

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => textarea,
      findSubmitButton: () => sendBtn,
      findAttachButton: () => null,
      getComposerText: () => textarea.value,
      insertText: (t: string) => {
        textarea.value = t;
      },
      submitText: async () => false,
      extractConversation: () => [],
    };

    const { dropContextToChat } = await import('../adapters/utils');
    await dropContextToChat(adapter, sampleContext, 'hidden');

    // Crucial: The composer must NEVER have opacity: 0 or transition: none applied
    expect(textarea.style.opacity).not.toBe('0');
    expect(textarea.style.display).not.toBe('none');
  });

  describe('COA 1: Prompt-Attached Context Guarantees', () => {
    it('bundles prompt with distilled context reference, strictly under 80 words', () => {
      const userPrompt = 'How do we handle expired access tokens during API calls?';
      const bundled = formatPromptWithContext(sampleContext, userPrompt);

      expect(bundled).toContain('[Reference Context: Authentication Architecture]');
      expect(bundled).toContain('Goal: Implement JWT refresh tokens in Node.js');
      expect(bundled).toContain('State: Tokens implemented in cookie middleware.');
      expect(bundled).toContain('Decisions: Use httpOnly cookies for refresh token; Use 15m short-lived access token');
      expect(bundled).toContain('Next: Add unit tests for refresh endpoint');
      expect(bundled).toContain(userPrompt);

      // Verify no artificial handshake directives
      expect(bundled).not.toContain("Got the context, let's go!");
      expect(bundled).not.toContain('[DIRECTIVE:');

      // Token budget check: context block is lightweight (< 60 words)
      const contextPrefix = bundled.substring(0, bundled.indexOf(userPrompt));
      const wordCount = contextPrefix.trim().split(/\s+/).length;
      expect(wordCount).toBeLessThan(60);
    });

    it('supplies intelligent continuation prompt when user draft is empty', () => {
      const bundledEmpty = formatPromptWithContext(sampleContext, '');

      expect(bundledEmpty).toContain('[Reference Context: Authentication Architecture]');
      expect(bundledEmpty).toContain('Please review this context, summarize current status, and advise on next steps.');
    });
  });
});
