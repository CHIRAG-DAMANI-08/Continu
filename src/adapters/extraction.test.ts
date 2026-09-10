// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { cleanMessageElementText, extractPageChatTitle } from './utils';
import { GenericAdapter } from './generic';
import { ChatGPTAdapter } from './chatgpt';
import { ClaudeAdapter } from './claude';
import { formatContext } from '../contexts/format';
import type { ContinuContext } from '../contexts/model';

describe('Clean Message Element & Extraction', () => {
  it('strips thinking accordions, copy buttons, timestamps, and citations', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="header">
        <span class="avatar">AI</span>
        <span class="timestamp">12:34 PM</span>
      </div>
      <div class="ds-think">
        Thinking process: I should verify JWT tokens with jsonwebtoken.
      </div>
      <p>Here is the solution to validate JWT tokens in Node.js:</p>
      <pre><code>function verify(token) { return jwt.verify(token, secret); }</code></pre>
      <div class="action-bar">
        <button class="copy-button">Copy code</button>
        <button aria-label="Good response"><svg></svg></button>
      </div>
      <div class="sources-list">
        <span class="citation">[1] jsonwebtoken npm</span>
      </div>
      <div class="disclaimer">ChatGPT can make mistakes.</div>
    `;

    const cleaned = cleanMessageElementText(div);

    expect(cleaned).toContain('Here is the solution to validate JWT tokens in Node.js:');
    expect(cleaned).toContain('function verify(token)');
    // Must NOT contain clutter
    expect(cleaned).not.toContain('Thinking process');
    expect(cleaned).not.toContain('Copy code');
    expect(cleaned).not.toContain('12:34 PM');
    expect(cleaned).not.toContain('jsonwebtoken npm');
    expect(cleaned).not.toContain('ChatGPT can make mistakes');
  });

  it('preserves line breaks between paragraphs and list items rather than running them together', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <p>First paragraph.</p>
      <p>Second paragraph.</p>
      <ul>
        <li>First item</li>
        <li>Second item</li>
      </ul>
    `;

    const cleaned = cleanMessageElementText(div);
    expect(cleaned).toContain('First paragraph.');
    expect(cleaned).toContain('Second paragraph.');
    expect(cleaned).toContain('• First item');
    expect(cleaned).toContain('• Second item');
    expect(cleaned).not.toContain('First paragraph.Second paragraph.');
  });

  it('extractPageChatTitle cleans generic platform titles and notifications', () => {
    document.title = '(2) Build an E-commerce API | ChatGPT';
    const title = extractPageChatTitle('chatgpt');
    expect(title).toBe('Build an E-commerce API');
  });

  it('GenericAdapter extracts conversation turns and ignores sidebar navigation', () => {
    document.body.innerHTML = `
      <nav class="sidebar">
        <a href="/chat/1">Old chat about Python</a>
        <a href="/chat/2">Old chat about React</a>
      </nav>
      <main class="chat-container">
        <div class="message-bubble user-message" data-message-author-role="user">
          <p>How do I connect to Postgres using Prisma?</p>
        </div>
        <div class="message-bubble assistant-message" data-message-author-role="assistant">
          <div class="markdown">
            <p>To connect to Postgres, define your datasource in schema.prisma.</p>
          </div>
          <button class="copy-btn">Copy</button>
        </div>
      </main>
      <form class="composer">
        <textarea placeholder="Type a message..."></textarea>
      </form>
    `;

    const adapter = new GenericAdapter();
    const turns = adapter.extractConversation();

    expect(turns.length).toBe(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('How do I connect to Postgres using Prisma?');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toContain('To connect to Postgres, define your datasource');
    // Must NOT contain sidebar text
    expect(turns.map(t => t.content).join(' ')).not.toContain('Old chat about Python');
  });

  it('formatFull includes full conversation transcript when turns are present', () => {
    const sampleContext: ContinuContext = {
      id: 'digest-test',
      name: 'Auth Implementation',
      summary: 'Auth discussion',
      objective: 'Implement OAuth2 login with Google',
      currentState: 'Configured client ID, implementing callback',
      decisions: ['Use passport-google-oauth20'],
      requirements: ['Must support refresh tokens'],
      constraints: ['HTTPS only in production'],
      openQuestions: [],
      nextActions: ['Deploy to staging'],
      source: {
        platform: 'claude',
        url: 'https://claude.ai/chat/123',
        title: 'Auth Implementation',
      },
      tags: ['auth'],
      turnCount: 2,
      conversation: [
        { role: 'user', content: 'How do I setup Google OAuth?', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Use passport-google-oauth20 and register your callback URL.', timestamp: new Date().toISOString() },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const formatted = formatContext(sampleContext, 'full');
    expect(formatted).toContain('## Conversation');
    expect(formatted).toContain('**User:** How do I setup Google OAuth?');
    expect(formatted).toContain('**Assistant:** Use passport-google-oauth20 and register your callback URL.');
  });

  it('GenericAdapter preserves all turns when messages are inside a list wrapper', () => {
    document.body.innerHTML = `
      <main>
        <div class="chat-messages-container">
          <div class="message-bubble user-message">
            <p>Turn 1: Can we use AES-GCM?</p>
          </div>
          <div class="message-bubble assistant-message">
            <p>Turn 2: Yes, Web Crypto API supports AES-GCM.</p>
          </div>
          <div class="message-bubble user-message">
            <p>Turn 3: What about 256-bit keys?</p>
          </div>
          <div class="message-bubble assistant-message">
            <p>Turn 4: 256-bit keys are standard and recommended.</p>
          </div>
        </div>
      </main>
    `;

    const adapter = new GenericAdapter();
    const turns = adapter.extractConversation();

    expect(turns.length).toBe(4);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('Turn 1: Can we use AES-GCM?');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toContain('Turn 2: Yes, Web Crypto API supports AES-GCM.');
    expect(turns[2].role).toBe('user');
    expect(turns[2].content).toContain('Turn 3: What about 256-bit keys?');
    expect(turns[3].role).toBe('assistant');
    expect(turns[3].content).toContain('Turn 4: 256-bit keys are standard and recommended.');
  });

  it('ChatGPTAdapter extracts full conversation history across multiple article turns', () => {
    document.body.innerHTML = `
      <main>
        <article data-testid="conversation-turn-1">
          <h5>You said:</h5>
          <div class="whitespace-pre-wrap">Hello, can you help with auth?</div>
        </article>
        <article data-testid="conversation-turn-2">
          <h5>ChatGPT said:</h5>
          <div class="markdown">Sure, I can help you with authentication.</div>
        </article>
        <article data-testid="conversation-turn-3">
          <h5>You said:</h5>
          <div class="whitespace-pre-wrap">Let's use Supabase.</div>
        </article>
        <article data-testid="conversation-turn-4">
          <h5>ChatGPT said:</h5>
          <div class="markdown">Supabase Auth works great with PostgreSQL.</div>
        </article>
      </main>
    `;

    const adapter = new ChatGPTAdapter();
    const turns = adapter.extractConversation();

    expect(turns.length).toBe(4);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('Hello, can you help with auth?');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toContain('Sure, I can help you with authentication.');
    expect(turns[2].role).toBe('user');
    expect(turns[2].content).toContain("Let's use Supabase.");
    expect(turns[3].role).toBe('assistant');
    expect(turns[3].content).toContain('Supabase Auth works great with PostgreSQL.');
  });

  it('ClaudeAdapter extracts full conversation history with chat-message testids', () => {
    document.body.innerHTML = `
      <main>
        <div class="chat-window">
          <div data-testid="chat-message-0">
            <div data-testid="user-message">
              <div class="whitespace-pre-wrap">How do we design our database schema?</div>
            </div>
          </div>
          <div data-testid="chat-message-1">
            <div data-testid="assistant-message">
              <div class="standard-markdown">Here is a normalized schema with users and contexts.</div>
            </div>
          </div>
          <div data-testid="chat-message-2">
            <div data-testid="user-message">
              <div class="whitespace-pre-wrap">Add an encrypted_payload column.</div>
            </div>
          </div>
          <div data-testid="chat-message-3">
            <div data-testid="assistant-message">
              <div class="standard-markdown">Added encrypted_payload BYTEA with nonce.</div>
            </div>
          </div>
        </div>
      </main>
    `;

    const adapter = new ClaudeAdapter();
    const turns = adapter.extractConversation();

    expect(turns.length).toBe(4);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('How do we design our database schema?');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toContain('Here is a normalized schema with users and contexts.');
    expect(turns[2].role).toBe('user');
    expect(turns[2].content).toContain('Add an encrypted_payload column.');
    expect(turns[3].role).toBe('assistant');
    expect(turns[3].content).toContain('Added encrypted_payload BYTEA with nonce.');
  });
});
