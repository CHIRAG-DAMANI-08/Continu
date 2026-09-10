// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectAIChat,
  isAIChatPage,
  UniversalAIAdapter,
  ChatGPTAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  GenericAdapter,
} from './universal';

describe('Universal AI Detection & Adapter', () => {
  let mockWindow: any;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function createMockWindow(hostname: string, pathname = '/', title = ''): Window {
    return {
      location: {
        hostname,
        pathname,
        href: `https://${hostname}${pathname}`,
      },
      document: {
        title,
        querySelectorAll: (selector: string) => document.querySelectorAll(selector),
        querySelector: (selector: string) => document.querySelector(selector),
        defaultView: { innerHeight: 800 },
      },
    } as unknown as Window;
  }

  describe('Known AI Platforms', () => {
    it('identifies known AI applications immediately by domain', () => {
      expect(detectAIChat(createMockWindow('chatgpt.com')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('claude.ai')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('gemini.google.com')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('perplexity.ai')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('chat.deepseek.com')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('grok.com')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('copilot.microsoft.com')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('chat.mistral.ai')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('poe.com')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('v0.dev')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('huggingface.co', '/chat')).isAI).toBe(true);
    });

    it('identifies self-hosted AI apps by title', () => {
      expect(detectAIChat(createMockWindow('localhost', '/', 'LibreChat - AI Workspace')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('127.0.0.1', ':8080', 'Open WebUI')).isAI).toBe(true);
      expect(detectAIChat(createMockWindow('192.168.1.50', '/', 'Big-AGI Workspace')).isAI).toBe(true);
    });
  });

  describe('Strict Non-AI Website Rejection', () => {
    it('strictly rejects non-AI search, shopping, forum, and social media sites', () => {
      expect(detectAIChat(createMockWindow('google.com', '/search?q=chatgpt')).isAI).toBe(false);
      expect(detectAIChat(createMockWindow('amazon.com', '/help/chat')).isAI).toBe(false);
      expect(detectAIChat(createMockWindow('github.com', '/issues/123')).isAI).toBe(false);
      expect(detectAIChat(createMockWindow('reddit.com', '/r/ChatGPT')).isAI).toBe(false);
      expect(detectAIChat(createMockWindow('twitch.tv', '/streamer/chat')).isAI).toBe(false);
      expect(detectAIChat(createMockWindow('stackoverflow.com', '/questions/123')).isAI).toBe(false);
      expect(detectAIChat(createMockWindow('wikipedia.org', '/wiki/Artificial_intelligence')).isAI).toBe(false);
    });
  });

  describe('Dynamic Detection of Unseen / Uncoded AI Applications', () => {
    it('dynamically detects unknown custom AI website with message turns and prompt composer', () => {
      // Simulate an unseen internal enterprise AI application on a random unknown domain
      const win = createMockWindow('ai.enterprise-internal.net', '/workspace', 'Enterprise Assistant');

      // Inject chat DOM elements: messages and chat prompt box
      document.body.innerHTML = `
        <div class="chat-container">
          <div class="assistant-message" data-role="assistant">
            Hello! How can I assist you with code review today?
          </div>
          <form class="composer-container">
            <textarea placeholder="Ask enterprise AI a question..." style="width: 500px; height: 50px;"></textarea>
            <button type="submit" aria-label="Send message">Send</button>
          </form>
        </div>
      `;

      const result = detectAIChat(win);
      expect(result.isAI).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(40);
    });

    it('dynamically detects unknown local LLM interface with Stop Generating and Model Selector buttons', () => {
      const win = createMockWindow('localhost', ':3000', 'Local AI Client');

      document.body.innerHTML = `
        <div class="app">
          <div class="toolbar">
            <button class="model-selector">Llama-3-70B-Instruct</button>
            <button aria-label="Stop generating">Stop</button>
          </div>
          <div class="messages">
            <div data-testid="chat-message">Sample response</div>
          </div>
          <div class="input-row">
            <textarea placeholder="Type a prompt..." style="width: 400px; height: 40px;"></textarea>
            <button aria-label="Send">Submit</button>
          </div>
        </div>
      `;

      const result = detectAIChat(win);
      expect(result.isAI).toBe(true);
      expect(result.signals).toContain('stop_or_regenerate_button');
    });

    it('dynamically detects unknown AI with Regenerate response button and chat bubbles', () => {
      const win = createMockWindow('custom-ai-tool.io', '/', 'AI Prompt Studio');

      document.body.innerHTML = `
        <main>
          <div class="chat-turn">
            <div class="user-message">Generate a SQL query</div>
            <div class="bot-message">SELECT * FROM users;</div>
            <button aria-label="Regenerate response">Regenerate</button>
          </div>
          <textarea placeholder="Ask anything..."></textarea>
        </main>
      `;

      const result = detectAIChat(win);
      expect(result.isAI).toBe(true);
    });
  });

  describe('UniversalAIAdapter Compatibility', () => {
    it('UniversalAIAdapter detects and functions as a drop-in replacement for all dedicated adapters', () => {
      const adapter = new UniversalAIAdapter();
      expect(typeof adapter.detect).toBe('function');
      expect(typeof adapter.findComposer).toBe('function');
      expect(typeof adapter.extractConversation).toBe('function');
      expect(typeof adapter.insertText).toBe('function');
    });

    it('backward compatibility adapter aliases (ChatGPTAdapter, ClaudeAdapter, etc.) extend UniversalAIAdapter', () => {
      const chatgpt = new ChatGPTAdapter();
      const claude = new ClaudeAdapter();
      const gemini = new GeminiAdapter();
      const generic = new GenericAdapter();

      expect(chatgpt instanceof UniversalAIAdapter).toBe(true);
      expect(claude instanceof UniversalAIAdapter).toBe(true);
      expect(gemini instanceof UniversalAIAdapter).toBe(true);
      expect(generic instanceof UniversalAIAdapter).toBe(true);

      expect(chatgpt.name).toBe('chatgpt');
      expect(claude.name).toBe('claude');
      expect(gemini.name).toBe('gemini');
    });
  });
});
