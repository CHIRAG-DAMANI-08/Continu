import type { AIAdapter } from './base';
import type { ConversationTurn } from '../contexts/model';
import {
  triggerSubmit,
  insertTextIntoComposer,
  getComposerTextFromElement,
  cleanMessageElementText,
  submitTextUniversal,
} from './utils';

/**
 * Result of AI chat page detection.
 */
export interface AIDetectionResult {
  isAI: boolean;
  platform: string;
  confidence: number;
  signals: string[];
}

/**
 * Strict domain and path exclusions for non-AI websites.
 * Prevents search bars, social media comment boxes, forums, and shopping sites from triggering.
 */
const NON_AI_EXCLUSIONS: { hostSuffix: string; pathPrefix?: string }[] = [
  { hostSuffix: 'google.com', pathPrefix: '/search' },
  { hostSuffix: 'google.com', pathPrefix: '/webhp' },
  { hostSuffix: 'google.com', pathPrefix: '/maps' },
  { hostSuffix: 'amazon.com' },
  { hostSuffix: 'amazon.co.uk' },
  { hostSuffix: 'ebay.com' },
  { hostSuffix: 'wikipedia.org' },
  { hostSuffix: 'reddit.com' },
  { hostSuffix: 'youtube.com' },
  { hostSuffix: 'twitch.tv' },
  { hostSuffix: 'twitter.com' },
  { hostSuffix: 'x.com', pathPrefix: '/home' },
  { hostSuffix: 'facebook.com' },
  { hostSuffix: 'instagram.com' },
  { hostSuffix: 'stackoverflow.com' },
  { hostSuffix: 'github.com', pathPrefix: '/issues' },
  { hostSuffix: 'github.com', pathPrefix: '/pull' },
  { hostSuffix: 'gitlab.com' },
];

/**
 * Common known AI domains for instant zero-latency detection.
 */
const KNOWN_AI_PLATFORMS: Record<string, string> = {
  'chatgpt.com': 'chatgpt',
  'openai.com': 'chatgpt',
  'claude.ai': 'claude',
  'gemini.google.com': 'gemini',
  'perplexity.ai': 'perplexity',
  'deepseek.com': 'deepseek',
  'grok.com': 'grok',
  'copilot.microsoft.com': 'copilot',
  'mistral.ai': 'mistral',
  'poe.com': 'poe',
  'v0.dev': 'v0',
  'huggingface.co': 'huggingchat',
  'qwenlm.ai': 'qwen',
  'kimi.moonshot.cn': 'kimi',
  'doubao.com': 'doubao',
  'typingmind.com': 'typingmind',
  'phind.com': 'phind',
  'you.com': 'you',
  'bolt.new': 'bolt',
};

/**
 * Model architecture / family keywords commonly found in AI chat model selectors.
 */
const MODEL_NAME_KEYWORDS = [
  'gpt', 'claude', 'gemini', 'llama', 'deepseek', 'mistral',
  'qwen', 'phi', 'sonnet', 'haiku', 'opus', 'flash', 'groq',
  'command-r', 'o1', 'o3', 'codestral', 'mixtral'
];

/**
 * Evaluates whether the current page is an AI chat / assistant application.
 * Combines fast-path domain matching with comprehensive dynamic DOM heuristics
 * so that ANY unknown, self-hosted, or new AI web app is dynamically detected.
 */
export function detectAIChat(win: Window = window): AIDetectionResult {
  const host = (win.location?.hostname || '').toLowerCase();
  const path = (win.location?.pathname || '').toLowerCase();
  const title = (win.document?.title || '').toLowerCase();

  const signals: string[] = [];
  let confidence = 0;
  let detectedPlatform = 'ai-chat';

  // 1. Strict Exclusions: Immediately reject known non-AI web platforms
  for (const excl of NON_AI_EXCLUSIONS) {
    if (host === excl.hostSuffix || host.endsWith('.' + excl.hostSuffix)) {
      if (!excl.pathPrefix || path.startsWith(excl.pathPrefix)) {
        // Special case: x.com/i/grok is Grok AI
        if (host.includes('x.com') && (path.startsWith('/i/grok') || path.startsWith('/grok'))) {
          break;
        }
        // Special case: HuggingFace chat
        if (host.includes('huggingface.co') && path.startsWith('/chat')) {
          break;
        }
        // Special case: Google Gemini
        if (host === 'gemini.google.com') {
          break;
        }
        return { isAI: false, platform: '', confidence: 0, signals: ['excluded_domain'] };
      }
    }
  }

  // 2. Fast-path: Known AI platform domains
  for (const [domain, platform] of Object.entries(KNOWN_AI_PLATFORMS)) {
    if (host === domain || host.endsWith('.' + domain)) {
      if (domain === 'huggingface.co' && !path.startsWith('/chat')) {
        continue;
      }
      signals.push(`known_domain:${domain}`);
      return {
        isAI: true,
        platform,
        confidence: 100,
        signals,
      };
    }
  }

  // 3. Known self-hosted or open-source AI web UIs
  if (
    title.includes('open webui') ||
    title.includes('librechat') ||
    title.includes('big-agi') ||
    title.includes('ollama') ||
    title.includes('lm studio') ||
    title.includes('jan ai') ||
    title.includes('chatbot ui')
  ) {
    const platformName = title.includes('open webui')
      ? 'open-webui'
      : title.includes('librechat')
      ? 'librechat'
      : title.includes('big-agi')
      ? 'big-agi'
      : 'self-hosted-ai';
    signals.push(`self_hosted_title:${platformName}`);
    return {
      isAI: true,
      platform: platformName,
      confidence: 95,
      signals,
    };
  }

  // 4. Dynamic Heuristic Detection for ANY Unknown or New AI Application:
  // Inspect DOM features characteristic of conversational AI interfaces
  const doc = win.document;
  if (!doc) {
    return { isAI: false, platform: '', confidence: 0, signals };
  }

  // Signal A: Chat message turns in DOM (+35 points)
  const messageTurns = doc.querySelectorAll(
    '[data-message-author-role], [data-role="assistant"], [data-role="user"], ' +
    '[data-author="assistant"], [data-author="user"], [data-author="bot"], ' +
    '[data-testid*="conversation-turn" i], [data-testid*="chat-message" i], ' +
    '[data-testid*="assistant-message" i], [data-testid*="user-message" i], ' +
    '[class*="assistant-message" i], [class*="user-message" i], ' +
    '[class*="chat-bubble" i], [class*="message-bubble" i], ' +
    '[class*="ai-message" i], [class*="bot-message" i], [class*="chat-turn" i]'
  );
  if (messageTurns.length > 0) {
    confidence += 35;
    signals.push(`chat_turns:${messageTurns.length}`);
  }

  // Signal B: AI-specific action controls (+30 points)
  // Stop generating or Regenerate buttons
  const stopOrRegenBtn = doc.querySelector(
    'button[aria-label*="stop" i], button[aria-label*="regenerate" i], ' +
    'button[aria-label*="retry" i], [data-testid*="stop" i], [data-testid*="regenerate" i]'
  );
  if (stopOrRegenBtn) {
    confidence += 30;
    signals.push('stop_or_regenerate_button');
  }

  // Model selector button / badge
  const modelSelector = doc.querySelector(
    '[data-testid*="model-selector" i], [class*="model-selector" i], ' +
    '[aria-haspopup="menu"][class*="model" i], button[aria-label*="model" i]'
  );
  if (modelSelector) {
    confidence += 25;
    signals.push('model_selector');
  } else {
    // Check if any button or badge mentions a known model family
    const allButtons = Array.from(doc.querySelectorAll('button, [role="button"]')).slice(0, 30);
    const mentionsModel = allButtons.some(b => {
      const text = (b.textContent || '').toLowerCase();
      return MODEL_NAME_KEYWORDS.some(kw => text.includes(kw));
    });
    if (mentionsModel) {
      confidence += 20;
      signals.push('model_name_button');
    }
  }

  // Signal C: AI Chat Composer (+25 points)
  const composer = findChatComposer(doc);
  if (composer) {
    confidence += 25;
    signals.push('chat_composer_found');
  }

  // Signal D: Page context / URL / Title (+15 points)
  if (
    host.startsWith('chat.') ||
    host.startsWith('ai.') ||
    host.startsWith('llm.') ||
    path.startsWith('/chat') ||
    path.startsWith('/c/') ||
    path.startsWith('/conversation') ||
    title.includes('chat') ||
    title.includes('ai') ||
    title.includes('assistant') ||
    title.includes('prompt')
  ) {
    confidence += 15;
    signals.push('url_or_title_context');
  }

  // Threshold: >= 40 points with a composer present confirms an AI chat app!
  const isAI = confidence >= 40 && !!composer;

  if (isAI) {
    // Extract a clean platform name from the title or host
    const rawBrand = title.split(/[-–—:|]/)[0]?.trim() || host.split('.')[0] || 'ai-chat';
    detectedPlatform = rawBrand.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 20) || 'ai-chat';
  }

  return {
    isAI,
    platform: isAI ? detectedPlatform : '',
    confidence,
    signals,
  };
}

/**
 * Public helper to check if the current page is an AI chat app.
 */
export function isAIChatPage(win: Window = window): boolean {
  return detectAIChat(win).isAI;
}

/**
 * Universal chat composer finder.
 */
function findChatComposer(doc: Document): Element | null {
  // 1. Primary selectors from major platforms
  const primary =
    doc.querySelector('#prompt-textarea') ||
    doc.querySelector('div.ProseMirror[contenteditable="true"]') ||
    doc.querySelector('rich-textarea textarea') ||
    doc.querySelector('rich-textarea [contenteditable="true"]') ||
    doc.querySelector('textarea#chat-input') ||
    doc.querySelector('textarea#userInput') ||
    doc.querySelector('textarea[data-id]') ||
    doc.querySelector('form textarea');

  if (primary && isElementVisible(primary)) {
    return primary;
  }

  // 2. Scored candidate discovery
  const candidates: { element: Element; score: number }[] = [];
  const textareas = doc.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');

  textareas.forEach(el => {
    if (!isElementVisible(el)) return;
    if (el.closest('header, nav, [role="navigation"], [role="search"]')) return;
    if (el.getAttribute('type') === 'search') return;

    let score = 0;
    const rect = el.getBoundingClientRect();

    // Located in bottom half of screen
    if (rect.top > (doc.defaultView?.innerHeight || 600) * 0.4) {
      score += 20;
    }

    // Proportions
    if (rect.width > 120 && rect.height >= 26) {
      score += 15;
    }

    const placeholder = (
      el.getAttribute('placeholder') ||
      el.getAttribute('aria-label') ||
      ''
    ).toLowerCase();

    const chatKeywords = [
      'ask', 'prompt', 'message', 'chat', 'type', 'what', 'how',
      'reply', 'send', 'talk', 'question', 'help', 'say', 'instruct'
    ];

    if (chatKeywords.some(kw => placeholder.includes(kw))) {
      score += 30;
    }

    const container = el.closest('form') || el.parentElement;
    if (container) {
      const sendBtn = container.querySelector(
        'button[type="submit"], button[aria-label*="send" i], button[aria-label*="submit" i], button:has(svg)'
      );
      if (sendBtn) score += 20;
    }

    candidates.push({ element: el, score });
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].score >= 20 ? candidates[0].element : null;
}

function isElementVisible(element: Element): boolean {
  try {
    const win = element.ownerDocument?.defaultView || window;
    const style = win.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  } catch {
    return true;
  }
}

/**
 * Universal AI Adapter: A single adapter class that dynamically adapts to
 * ANY AI chat application (ChatGPT, Claude, Gemini, DeepSeek, or any custom/unseen AI).
 */
export class UniversalAIAdapter implements AIAdapter {
  name: string;

  constructor(customName?: string) {
    this.name = customName || 'universal';
  }

  detect(): boolean {
    const detection = detectAIChat();
    if (detection.isAI && this.name === 'universal') {
      this.name = detection.platform;
    }
    return detection.isAI;
  }

  findComposer(): Element | null {
    return findChatComposer(document);
  }

  findSubmitButton(): Element | null {
    const composer = this.findComposer();
    if (!composer) return null;

    // 1. Common platform submit buttons
    const primary =
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('button[aria-label="Send Message"]') ||
      document.querySelector('button[aria-label="Send"]') ||
      document.querySelector('button[aria-label="Submit"]') ||
      document.querySelector('button[data-testid="submit-button"]') ||
      document.querySelector('button[data-testid="sendMessageButton"]');

    if (primary && isElementVisible(primary)) return primary;

    // 2. Search within composer's enclosing form or container
    const container =
      composer.closest('form') ||
      composer.closest('[class*="input" i]') ||
      composer.parentElement;

    if (container) {
      const btn =
        container.querySelector('button[type="submit"]') ||
        container.querySelector('button[aria-label*="send" i]') ||
        container.querySelector('button[aria-label*="submit" i]') ||
        container.querySelector('button[data-testid*="send" i]') ||
        container.querySelector('button:has(svg)');
      if (btn && isElementVisible(btn)) return btn;
    }

    return null;
  }

  getComposerText(): string {
    return getComposerTextFromElement(this.findComposer());
  }

  insertText(text: string): void {
    insertTextIntoComposer(this.findComposer(), text);
  }

  async submitText(text: string): Promise<boolean> {
    return submitTextUniversal(this, text);
  }

  /**
   * Universal conversation turn extraction.
   * Handles ChatGPT, Claude, Gemini, DeepSeek, and ANY unknown AI chat interface.
   */
  extractConversation(): ConversationTurn[] {
    const turns: ConversationTurn[] = [];

    // Locate active conversation container
    const container =
      document.querySelector('main, [role="main"], [class*="chat-history" i], [class*="chat-container" i], [class*="messages-container" i], [class*="conversation" i]') ||
      document.body;

    // Strategy 1: Explicit data-testid turns (ChatGPT article format or Claude message format)
    const chatgptArticles = Array.from(
      container.querySelectorAll('article[data-testid*="conversation-turn"]')
    );
    if (chatgptArticles.length > 0) {
      for (const article of chatgptArticles) {
        const isUser =
          article.querySelector('[data-message-author-role="user"]') ||
          article.textContent?.includes('You said:') ||
          article.querySelector('h5')?.textContent?.includes('You said');

        const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';
        const contentEl =
          article.querySelector('.whitespace-pre-wrap, .markdown, div[class*="text-message"]') ||
          article;
        const text = cleanMessageElementText(contentEl);
        if (text) {
          turns.push({ role, content: text, timestamp: new Date().toISOString() });
        }
      }
      if (turns.length > 0) return turns;
    }

    // Strategy 2: Claude chat-message format
    const claudeMessages = Array.from(
      container.querySelectorAll('[data-testid*="chat-message"]')
    );
    if (claudeMessages.length > 0) {
      for (const msg of claudeMessages) {
        const userChild = msg.querySelector('[data-testid="user-message"]');
        const assistantChild = msg.querySelector('[data-testid="assistant-message"]');

        if (userChild) {
          const text = cleanMessageElementText(userChild);
          if (text) turns.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
        } else if (assistantChild) {
          const text = cleanMessageElementText(assistantChild);
          if (text) turns.push({ role: 'assistant', content: text, timestamp: new Date().toISOString() });
        } else {
          const isUser = msg.querySelector('[data-is-streaming="false"]') === null;
          const text = cleanMessageElementText(msg);
          if (text) turns.push({ role: isUser ? 'user' : 'assistant', content: text, timestamp: new Date().toISOString() });
        }
      }
      if (turns.length > 0) return turns;
    }

    // Strategy 3: Author / Role attributes
    const roleElements = Array.from(
      container.querySelectorAll(
        '[data-message-author-role], [data-role="user"], [data-role="assistant"], [data-author="user"], [data-author="assistant"]'
      )
    ).filter(el => !el.closest('nav, aside, header, footer, form, [role="navigation"]'));

    if (roleElements.length > 0) {
      for (const el of roleElements) {
        const roleAttr = (
          el.getAttribute('data-message-author-role') ||
          el.getAttribute('data-role') ||
          el.getAttribute('data-author') ||
          ''
        ).toLowerCase();

        const role: 'user' | 'assistant' = roleAttr.includes('user') ? 'user' : 'assistant';
        const text = cleanMessageElementText(el);
        if (text) {
          turns.push({ role, content: text, timestamp: new Date().toISOString() });
        }
      }
      if (turns.length > 0) return turns;
    }

    // Strategy 4: Universal message bubble classes
    const bubbleElements = Array.from(
      container.querySelectorAll(
        '[class*="user-message" i], [class*="assistant-message" i], [class*="bot-message" i], [class*="ai-message" i], [class*="chat-bubble" i]'
      )
    ).filter(el => !el.closest('nav, aside, header, footer, form, [role="navigation"]'));

    if (bubbleElements.length > 0) {
      const leafElements = bubbleElements.filter(
        (el, i) => !bubbleElements.some((other, j) => i !== j && el.contains(other))
      );

      for (const el of leafElements) {
        const cls = (el.className || '').toLowerCase();
        const role: 'user' | 'assistant' =
          cls.includes('user') ? 'user' : 'assistant';
        const text = cleanMessageElementText(el);
        if (text) {
          turns.push({ role, content: text, timestamp: new Date().toISOString() });
        }
      }
      if (turns.length > 0) return turns;
    }

    return turns;
  }
}

/**
 * Backwards compatibility aliases for dedicated adapters.
 * All delegate directly to UniversalAIAdapter with their preset name.
 */
export class ChatGPTAdapter extends UniversalAIAdapter {
  constructor() {
    super('chatgpt');
  }
}

export class ClaudeAdapter extends UniversalAIAdapter {
  constructor() {
    super('claude');
  }
}

export class GeminiAdapter extends UniversalAIAdapter {
  constructor() {
    super('gemini');
  }
}

export class PerplexityAdapter extends UniversalAIAdapter {
  constructor() {
    super('perplexity');
  }
}

export class DeepSeekAdapter extends UniversalAIAdapter {
  constructor() {
    super('deepseek');
  }
}

export class GrokAdapter extends UniversalAIAdapter {
  constructor() {
    super('grok');
  }
}

export class CopilotAdapter extends UniversalAIAdapter {
  constructor() {
    super('copilot');
  }
}

export class MistralAdapter extends UniversalAIAdapter {
  constructor() {
    super('mistral');
  }
}

export class GenericAdapter extends UniversalAIAdapter {
  constructor() {
    super('generic');
  }
}
