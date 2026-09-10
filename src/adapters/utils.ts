import type { AIAdapter } from './base';
import type { ContinuContext } from '../contexts/model';
import { formatContext, type DropFormat } from '../contexts/format';

/**
 * Universally retrieves current text from any AI composer element.
 */
export function getComposerTextFromElement(composer: Element | null): string {
  if (!composer) return '';
  if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
    return (composer as HTMLInputElement | HTMLTextAreaElement).value || '';
  }
  return composer.textContent || '';
}

/**
 * Universally inserts text into any AI composer across web frameworks:
 * - HTMLTextAreaElement / HTMLInputElement (React synthetic event bypass)
 * - ContentEditable elements (ProseMirror in Claude, Quill in Gemini, Lexical/React in ChatGPT)
 */
export function insertTextIntoComposer(composer: Element | null, text: string): void {
  if (!composer) return;

  if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
    const input = composer as HTMLTextAreaElement | HTMLInputElement;
    input.focus();

    // Use native prototype setter to bypass React's synthetic input interceptor
    const proto = composer.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(input, text);
    } else {
      input.value = text;
    }

    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    if (composer.tagName === 'TEXTAREA') {
      (composer as HTMLTextAreaElement).style.height = 'auto';
      (composer as HTMLTextAreaElement).style.height = `${(composer as HTMLTextAreaElement).scrollHeight}px`;
    }
    return;
  }

  // ContentEditable elements (Claude ProseMirror, Gemini Quill, ChatGPT Lexical)
  if (composer.getAttribute('contenteditable') === 'true' || (composer as HTMLElement).isContentEditable) {
    const htmlEl = composer as HTMLElement;
    htmlEl.focus();

    // 1. Select all content inside editable so insertion replaces current content cleanly
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(htmlEl);
      sel.addRange(range);
    }

    // 2. Primary for ProseMirror (Claude) & Rich Text: native ClipboardEvent paste
    // ProseMirror and Lexical natively intercept paste events to construct clean transactions
    let pasted = false;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dt,
      });
      pasted = htmlEl.dispatchEvent(pasteEvt);
    } catch {
      pasted = false;
    }

    // 3. Fallback: document.execCommand('insertText')
    const sample = text.slice(0, Math.min(20, text.length));
    if (!pasted || (sample.length > 0 && !htmlEl.textContent?.includes(sample))) {
      try {
        document.execCommand('insertText', false, text);
      } catch {}
    }

    // 4. Fallback: InputEvent beforeinput
    if (sample.length > 0 && !htmlEl.textContent?.includes(sample)) {
      try {
        const inputEvt = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: text,
        });
        composer.dispatchEvent(inputEvt);
      } catch {}
    }

    composer.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    composer.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
}

/**
 * Utility to trigger submit/send on an AI chat input.
 * Supports dynamic submit button resolution, form submission, and framework commit polling.
 */
export async function triggerSubmit(
  composer: Element | null,
  submitButtonOrGetter?: Element | (() => Element | null) | null,
  delayMs = 60
): Promise<boolean> {
  // Allow frameworks like React/ProseMirror/Quill to register input change
  await new Promise(resolve => setTimeout(resolve, delayMs));

  const getSubmitBtn = (): HTMLElement | null => {
    let btn: Element | null = null;
    if (typeof submitButtonOrGetter === 'function') {
      try {
        btn = submitButtonOrGetter();
      } catch {}
    } else if (submitButtonOrGetter instanceof HTMLElement) {
      btn = submitButtonOrGetter;
    }

    if (!btn || !document.body.contains(btn)) {
      // Dynamic fallback discovery of send button
      btn =
        document.querySelector('button[data-testid="send-button"]') ||
        document.querySelector('button[aria-label*="Send" i]') ||
        document.querySelector('button[aria-label*="submit" i]') ||
        document.querySelector('form button[type="submit"]') ||
        document.querySelector('button[data-testid*="send"]') ||
        document.querySelector('button.send-button');
    }

    return btn instanceof HTMLElement ? btn : null;
  };

  // Poll for up to 1500ms for framework state commit and button activation
  for (let attempt = 0; attempt < 25; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    const btn = getSubmitBtn();
    if (btn) {
      const isDisabled =
        btn.hasAttribute('disabled') ||
        btn.getAttribute('aria-disabled') === 'true' ||
        btn.classList.contains('disabled');

      if (!isDisabled) {
        btn.click();
        return true;
      }
    }

    // Try form.requestSubmit()
    const form = composer?.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit();
        return true;
      } catch {}
    }
  }

  // Fallback: simulate Enter keypress on composer
  if (composer instanceof HTMLElement) {
    composer.focus();

    const enterEventInit: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };

    composer.dispatchEvent(new KeyboardEvent('keydown', enterEventInit));
    composer.dispatchEvent(new KeyboardEvent('keypress', enterEventInit));
    composer.dispatchEvent(new KeyboardEvent('keyup', enterEventInit));
    return true;
  }

  return false;
}

/**
 * Universally submits text through an AI adapter.
 */
export async function submitTextUniversal(
  adapter: AIAdapter,
  text: string
): Promise<boolean> {
  const composer = adapter.findComposer();
  if (!composer) return false;

  adapter.insertText(text);
  return triggerSubmit(composer, () => adapter.findSubmitButton(), 60);
}

/**
 * Drops a context into the active chat session:
 * - If format is 'hidden' (default):
 *   Submits the context payload live into the chat session in real time.
 *   The screen remains 100% visible and interactive (never blanked out or hidden).
 *   Leaves the composer clean (or restores existing user draft), and the AI responds:
 *   "Got the context, let's go! What are we working on?".
 * - If format is 'structured', 'compact', or 'full':
 *   Inserts the formatted markdown text into the composer for manual editing.
 */
export async function dropContextToChat(
  adapter: AIAdapter,
  context: ContinuContext,
  format: DropFormat = 'hidden'
): Promise<boolean> {
  const composer = adapter.findComposer();
  if (!composer) return false;

  if (format === 'hidden') {
    const savedDraft = adapter.getComposerText() || '';
    const payload = formatContext(context, 'hidden');

    // Insert payload live into composer - no screen blanking, no opacity changes
    adapter.insertText(payload);

    // Submit live to the AI model
    const success = await triggerSubmit(composer, () => adapter.findSubmitButton(), 60);

    // If the user had typed a draft prior to drop, restore it; otherwise leave clean
    if (savedDraft) {
      adapter.insertText(savedDraft);
    } else {
      adapter.insertText('');
    }

    return success;
  } else {
    const formatted = formatContext(context, format);
    adapter.insertText(formatted);
    return true;
  }
}

/**
 * Recursively converts a DOM node to structured text, preserving line breaks
 * for block elements (P, DIV, BR, LI, H1-H6, PRE, TR) so words/paragraphs don't run together.
 */
function extractFormattedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') {
    return '\n';
  }

  const isBlock = ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'PRE', 'BLOCKQUOTE', 'SECTION', 'ARTICLE'].includes(tag);
  let result = '';

  for (const child of Array.from(el.childNodes)) {
    result += extractFormattedText(child);
  }

  if (isBlock) {
    if (tag === 'LI') {
      return `\n• ${result.trim()}\n`;
    }
    return `\n${result.trim()}\n`;
  }

  return result;
}

/**
 * Clones a chat message element, strips all UI clutter (buttons, feedback thumbs,
 * action toolbars, tooltips, thinking accordions, citations, suggestion chips, disclaimers),
 * and returns clean, structured text content.
 */
export function cleanMessageElementText(element: Element | null): string {
  if (!element) return '';

  const clone = element.cloneNode(true) as HTMLElement;

  // Comprehensive selectors for elements that represent UI clutter rather than conversational content
  const clutterSelectors = [
    'button',
    'svg',
    'audio',
    'video',
    'canvas',
    '[role="button"]',
    '[role="toolbar"]',
    '[role="tooltip"]',
    '[role="status"]',
    '[role="dialog"]',
    '[role="alert"]',
    '[aria-hidden="true"]',
    '.sr-only',
    '.visually-hidden',
    // Code header and copy actions
    '.copy-button',
    '[data-testid*="copy" i]',
    '[data-testid*="action" i]',
    '[data-testid*="feedback" i]',
    '[class*="action-bar" i]',
    '[class*="action_bar" i]',
    '[class*="actions" i]',
    '[class*="toolbar" i]',
    '[class*="feedback" i]',
    '[class*="copy" i]',
    '[class*="retry" i]',
    '[class*="share" i]',
    '[class*="edit" i]',
    '[class*="thumb" i]',
    '[class*="rating" i]',
    // Author badges & timestamps
    '[class*="avatar" i]',
    '[class*="timestamp" i]',
    'time',
    '[class*="message-time" i]',
    '[class*="msg-time" i]',
    '[data-testid*="time" i]',
    // Chain-of-thought & internal reasoning accordions
    'think',
    'thought',
    'details[class*="think" i]',
    'details[class*="thought" i]',
    '[class*="ds-think" i]',
    '[class*="think" i]',
    '[class*="thought" i]',
    '[class*="reasoning" i]',
    '[data-testid*="thought" i]',
    '[data-testid*="reasoning" i]',
    // Grounding, search citations & sources
    '[class*="citation" i]',
    '[class*="source" i]',
    '[class*="reference" i]',
    '[class*="footnote" i]',
    '[class*="grounding" i]',
    'sup',
    '[data-testid*="citation" i]',
    // Prompt suggestions, related queries & follow-up chips
    '[class*="suggestion" i]',
    '[class*="prompt-chip" i]',
    '[class*="chip" i]',
    '[class*="related" i]',
    '[class*="follow-up" i]',
    '[class*="starter" i]',
    // Disclaimers and notices
    '[class*="disclaimer" i]',
    '[class*="notice" i]',
    // Continu's own UI elements
    '#continu-composer-host',
    '#continu-active-context-badge',
    '[class*="continu-" i]',
  ];

  for (const sel of clutterSelectors) {
    try {
      const items = clone.querySelectorAll(sel);
      items.forEach(el => el.remove());
    } catch {}
  }

  // Extract text with clean block preservation
  let text = extractFormattedText(clone);

  // Normalize consecutive newlines and trim whitespace
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // If this was the pure acknowledgment from context transfer, skip it
  if (
    text === "Context loaded. Let's talk." ||
    text === "Context loaded. Let's talk" ||
    text.toLowerCase().includes("got the context, let's go! what are we working on?") ||
    text.toLowerCase() === "got the context, let's go!"
  ) {
    return '';
  }

  return text;
}

/**
 * Extracts a clean chat title from the current page rather than generic document.title.
 */
export function extractPageChatTitle(adapterName: string): string {
  let title = '';

  switch (adapterName) {
    case 'chatgpt': {
      const activeNav = document.querySelector('nav a[class*="active"] span, nav li[data-active] span');
      if (activeNav && activeNav.textContent) {
        title = activeNav.textContent.trim();
      }
      break;
    }
    case 'claude': {
      const titleBtn = document.querySelector('header [data-testid="chat-title"], header button[data-testid*="title"], header h1');
      if (titleBtn && titleBtn.textContent) {
        title = titleBtn.textContent.trim();
      }
      break;
    }
    case 'gemini': {
      const titleEl = document.querySelector('.conversation-title, [data-test-id="conversation-title"], header .title-text');
      if (titleEl && titleEl.textContent) {
        title = titleEl.textContent.trim();
      }
      break;
    }
    case 'deepseek': {
      const sessionEl = document.querySelector('div[class*="session-name"], div[class*="chat-title"]');
      if (sessionEl && sessionEl.textContent) {
        title = sessionEl.textContent.trim();
      }
      break;
    }
    case 'perplexity': {
      const h1 = document.querySelector('main h1');
      if (h1 && h1.textContent) {
        title = h1.textContent.trim();
      }
      break;
    }
    case 'grok': {
      const heading = document.querySelector('main h2, header h2, [data-testid="chat-title"]');
      if (heading && heading.textContent) {
        title = heading.textContent.trim();
      }
      break;
    }
    case 'copilot': {
      const copilotTitle = document.querySelector('.b_mTitle, header [role="heading"], [class*="topic-title"]');
      if (copilotTitle && copilotTitle.textContent) {
        title = copilotTitle.textContent.trim();
      }
      break;
    }
    case 'mistral': {
      const mistralTitle = document.querySelector('header h1, header h2, [class*="chat-title"]');
      if (mistralTitle && mistralTitle.textContent) {
        title = mistralTitle.textContent.trim();
      }
      break;
    }
    default: {
      const genericTitle = document.querySelector('main h1, header h1, [class*="chat-title" i], [class*="conversation-title" i]');
      if (genericTitle && genericTitle.textContent) {
        title = genericTitle.textContent.trim();
      }
      break;
    }
  }

  if (!title) {
    title = document.title || '';
  }

  // Clean generic platform words and notifications
  title = title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*[-–—|]\s*(ChatGPT|Claude|Gemini|DeepSeek|Perplexity|Grok|Copilot|Mistral|Le Chat|OpenWebUI|LibreChat).*$/i, '')
    .replace(/^(ChatGPT|Claude|Gemini|DeepSeek|Perplexity|Grok|Copilot|Mistral|Le Chat|OpenWebUI|LibreChat)\s*[-–—|]?\s*/i, '')
    .trim();

  const genericTitles = [
    'chatgpt', 'claude', 'gemini', 'deepseek', 'perplexity', 'grok', 'copilot', 'mistral',
    'new chat', 'chat', 'home', 'anthropic', 'assistant', 'openwebui', 'librechat'
  ];
  if (!title || genericTitles.includes(title.toLowerCase())) {
    return '';
  }

  return title;
}

