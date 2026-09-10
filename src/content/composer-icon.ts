import { MessageType } from '../security/messaging';
import type { ContinuContext, ConversationTurn } from '../contexts/model';
import type { AIAdapter } from '../adapters/base';
import { formatContext, formatPromptWithContext, type DropFormat } from '../contexts/format';
import { generateContext, generateMinimalContext } from '../contexts/generate';
import { saveContextLocal, getContextsLocal } from '../contexts/storage';
import { extractPageChatTitle, dropContextToChat, triggerSubmit } from '../adapters/utils';
import { cookPrompt, isAiConfigured, isRefusalResponse } from '../ai/cook';
import { logger, redactSensitiveData } from '../utils/logger';

const DEFAULT_ICON_SIZE = 28;
const PANEL_WIDTH = 340;

/**
 * Injects an interactive continu icon into the AI composer's toolbar strictly on the right side,
 * positioned immediately before (to the left of) all the other chat app bundled icons (Model, Mic, Audio/Send).
 * Clicking it opens a dropdown panel to capture or drop saved contexts into the chatbox without pasting.
 */
export class ComposerIcon {
  private adapter: AIAdapter;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private panel: HTMLElement | null = null;
  private icon: HTMLElement | null = null;
  private badgeHost: HTMLElement | null = null;
  private badgeShadow: ShadowRoot | null = null;
  private armedContext: ContinuContext | null = null;
  private armedOutlineHost: HTMLElement | null = null;
  private armedOutlineShadow: ShadowRoot | null = null;
  private dropzoneHost: HTMLElement | null = null;
  private dropzoneShadow: ShadowRoot | null = null;
  private isDropzoneVisible = false;
  private boundDragEnter: ((e: DragEvent) => void) | null = null;
  private boundDragOver: ((e: DragEvent) => void) | null = null;
  private boundDragLeave: ((e: DragEvent) => void) | null = null;
  private boundDrop: ((e: DragEvent) => void) | null = null;
  private isIntercepting = false;
  private boundKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private observer: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private boundUpdatePosition: () => void;
  private isOpen = false;
  private contexts: ContinuContext[] = [];
  private selectedFormat: DropFormat = 'hidden';
  private searchQuery = '';
  private observerDebounce: number | null = null;
  public currentTheme: 'dark' | 'light' = 'dark';
  private boundStorageChangeHandler: ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void) | null = null;
  private isAuthenticated = false;
  private aiConfigured = false;
  private aiProvider: string | null = null;
  private aiModel: string | null = null;

  constructor(adapter: AIAdapter) {
    this.adapter = adapter;
    this.boundUpdatePosition = this.updatePosition.bind(this);
  }

  private async isUserAuthenticated(): Promise<boolean> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.CHECK_AUTH,
      });
      if (response && typeof response.authenticated === 'boolean') {
        return response.authenticated;
      }
    } catch {}

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const res = await chrome.storage.local.get(['continu_user_authenticated', 'continu_user_id']);
        if (res.continu_user_authenticated && res.continu_user_id) {
          return true;
        }
      }
    } catch {}

    return false;
  }

  private async loadContexts(): Promise<ContinuContext[]> {
    if (!this.isAuthenticated) {
      const authed = await this.isUserAuthenticated();
      this.isAuthenticated = authed;
      if (!authed) {
        return [];
      }
    }

    try {
      const local = await getContextsLocal();
      if (local && local.length > 0) {
        return local;
      }
    } catch {}

    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.GET_CONTEXTS,
      });
      if (response?.success && Array.isArray(response.contexts)) {
        return response.contexts;
      }
    } catch {}

    return [];
  }

  /**
   * Initialize: inject icon into chatbox toolbar, start observing DOM.
   */
  init(): void {
    this.injectIcon();
    this.startObserver();

    // Load persisted theme and listen for storage changes
    try {
      chrome.storage?.local?.get(['continu_theme'], (res) => {
        if (res && (res.continu_theme === 'light' || res.continu_theme === 'dark')) {
          this.setTheme(res.continu_theme);
        }
      });

      isAiConfigured().then((status) => {
        this.aiConfigured = status.configured;
        this.aiProvider = status.provider;
        this.aiModel = status.model;
      }).catch(() => {});

      // Check initial authentication and pre-load contexts
      this.isUserAuthenticated().then(async (authed) => {
        this.isAuthenticated = authed;
        if (authed) {
          this.contexts = await this.loadContexts();
        }
      }).catch(() => {});

      this.boundStorageChangeHandler = (changes, areaName) => {
        if (areaName === 'local') {
          if (changes.continu_theme) {
            const next = changes.continu_theme.newValue;
            if (next === 'light' || next === 'dark') {
              this.setTheme(next);
            }
          }
          const hasContextChanges = Object.keys(changes).some(k =>
            k.startsWith('continu_u_') || k.includes('context') || k.includes('index')
          );
          if (changes.continu_user_authenticated || changes.continu_user_id || hasContextChanges) {
            this.isUserAuthenticated().then(async (authed) => {
              this.isAuthenticated = authed;
              this.contexts = await this.loadContexts();
              if (!authed && this.armedContext) {
                this.disarmContext();
              }
              if (this.isOpen) {
                this.renderPanel();
              }
            }).catch(() => {});
          }
          if (changes.continu_ai_settings) {
            isAiConfigured().then((status) => {
              this.aiConfigured = status.configured;
              this.aiProvider = status.provider;
              this.aiModel = status.model;
              if (this.isOpen) {
                this.renderPanel();
              }
            }).catch(() => {});
          }
        }
      };
      chrome.storage?.onChanged?.addListener(this.boundStorageChangeHandler);
    } catch {
      // Storage unavailable in isolated environments
    }

    // Reposition on scroll, window resize, and typing/input in composer
    window.addEventListener('scroll', this.boundUpdatePosition, { passive: true, capture: true });
    window.addEventListener('resize', this.boundUpdatePosition);
    window.addEventListener('input', this.boundUpdatePosition, { passive: true, capture: true });
    window.addEventListener('keyup', this.boundUpdatePosition, { passive: true, capture: true });

    // Setup drag-and-drop context arming
    this.setupDragAndDrop();

    // Close panel on outside click
    document.addEventListener('mousedown', (e) => {
      if (this.isOpen && this.host && !e.composedPath().includes(this.host)) {
        this.closePanel();
      }
    });

    // Close panel on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.closePanel();
      }
    });
  }

  /**
   * Sets the active theme ('dark' | 'light') and updates all shadow hosts & components.
   */
  setTheme(theme: 'dark' | 'light'): void {
    this.currentTheme = theme;
    const isLight = theme === 'light';

    if (this.host) {
      this.host.classList.toggle('theme-light', isLight);
    }
    if (this.icon) {
      this.icon.classList.toggle('theme-light', isLight);
    }
    if (this.panel) {
      this.panel.classList.toggle('theme-light', isLight);
    }
    if (this.badgeHost) {
      this.badgeHost.classList.toggle('theme-light', isLight);
    }
    if (this.badgeShadow) {
      const badge = this.badgeShadow.querySelector('.continu-armed-badge');
      badge?.classList.toggle('theme-light', isLight);
    }
    if (this.dropzoneHost) {
      this.dropzoneHost.classList.toggle('theme-light', isLight);
    }
    if (this.dropzoneShadow) {
      const overlay = this.dropzoneShadow.querySelector('.continu-dropzone-overlay');
      overlay?.classList.toggle('theme-light', isLight);
    }
    if (this.armedOutlineHost) {
      this.armedOutlineHost.classList.toggle('theme-light', isLight);
    }
    if (this.armedOutlineShadow) {
      const outline = this.armedOutlineShadow.querySelector('.continu-armed-outline');
      outline?.classList.toggle('theme-light', isLight);
    }
    if (this.isOpen) {
      this.renderPanel();
    }
  }

  /**
   * Toggles theme between dark and light, persisting preference to chrome.storage.local.
   */
  toggleTheme(): void {
    const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme);
    try {
      chrome.storage?.local?.set({ continu_theme: nextTheme });
    } catch (err) {
      logger.warn('Continu: failed to save theme preference', err);
    }
  }

  /**
   * Clean up icon, observers, and listeners.
   */
  destroy(): void {
    if (this.observerDebounce !== null) {
      clearTimeout(this.observerDebounce);
      this.observerDebounce = null;
    }
    if (this.boundStorageChangeHandler && chrome.storage?.onChanged) {
      try {
        chrome.storage.onChanged.removeListener(this.boundStorageChangeHandler);
      } catch {}
      this.boundStorageChangeHandler = null;
    }
    window.removeEventListener('scroll', this.boundUpdatePosition, true);
    window.removeEventListener('resize', this.boundUpdatePosition);
    window.removeEventListener('input', this.boundUpdatePosition, true);
    window.removeEventListener('keyup', this.boundUpdatePosition, true);
    this.teardownDragAndDrop();
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.panel = null;
    this.icon = null;
    this.isOpen = false;
    this.badgeHost?.remove();
    this.badgeHost = null;
    this.badgeShadow = null;
    this.armedOutlineHost?.remove();
    this.armedOutlineHost = null;
    this.armedOutlineShadow = null;
    this.disarmContext();
  }

  private injectIcon(): void {
    const composer = this.adapter.findComposer();
    if (!composer) return;

    // If host exists and is attached, just update position
    if (this.host && document.body.contains(this.host)) {
      this.updatePosition();
      return;
    }

    this.host?.remove();

    // Create shadow DOM host attached to body for non-clipped positioning
    this.host = document.createElement('div');
    this.host.id = 'continu-composer-host';
    if (this.currentTheme === 'light') {
      this.host.classList.add('theme-light');
    }
    this.host.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      display: none;
    `;
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    // Create icon button
    this.icon = document.createElement('button');
    this.icon.className = 'continu-icon' + (this.currentTheme === 'light' ? ' theme-light' : '');
    this.icon.type = 'button';
    this.icon.title = 'continu - Context Manager';
    this.icon.setAttribute('aria-label', 'continu context manager');
    this.icon.innerHTML = this.getSvgIcon();
    this.icon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.togglePanel();
    });
    this.shadow.appendChild(this.icon);

    // Create panel (hidden initially)
    this.panel = document.createElement('div');
    this.panel.className = 'continu-panel hidden' + (this.currentTheme === 'light' ? ' theme-light' : '');
    this.shadow.appendChild(this.panel);

    document.body.appendChild(this.host);

    // Create armed badge host (floats above chatbox when a context is armed)
    if (!this.badgeHost || !document.body.contains(this.badgeHost)) {
      this.badgeHost?.remove();
      this.badgeHost = document.createElement('div');
      this.badgeHost.id = 'continu-armed-badge-host';
      if (this.currentTheme === 'light') {
        this.badgeHost.classList.add('theme-light');
      }
      this.badgeHost.style.cssText = `
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        display: none;
      `;
      this.badgeShadow = this.badgeHost.attachShadow({ mode: 'closed' });
      const badgeStyle = document.createElement('style');
      badgeStyle.textContent = this.getBadgeStyles();
      this.badgeShadow.appendChild(badgeStyle);
      document.body.appendChild(this.badgeHost);
    }

    // Observe composer and chatbox for size changes
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.updatePosition());
    this.resizeObserver.observe(composer);

    const chatbox = this.findChatboxContainer(composer);
    if (chatbox && chatbox !== composer) {
      this.resizeObserver.observe(chatbox);
    }

    this.updatePosition();
    requestAnimationFrame(() => this.updatePosition());
    setTimeout(() => this.updatePosition(), 100);
  }

  /**
   * Locates the chatbox card/container enclosing the composer input and its bottom toolbar.
   */
  private findChatboxContainer(composer: Element): HTMLElement {
    // 1. Ascend parent hierarchy looking for the true chatbox card enclosing both composer and toolbar buttons
    let curr: HTMLElement | null = composer.parentElement;
    let fallback: HTMLElement = (composer.parentElement as HTMLElement) || (composer as HTMLElement);
    let bestContainer: HTMLElement | null = null;
    let depth = 0;

    while (curr && curr !== document.body && curr !== document.documentElement && depth < 8) {
      // Never ascend into chat history threads, message lists, or outer page sections
      if (
        curr.tagName === 'MAIN' ||
        curr.tagName === 'SECTION' ||
        curr.getAttribute('role') === 'log' ||
        curr.getAttribute('role') === 'feed' ||
        curr.classList.contains('chat-window') ||
        curr.classList.contains('messages') ||
        curr.querySelector('[data-message-author-role], [data-testid^="conversation-turn-"], [data-testid^="chat-message-"]')
      ) {
        break;
      }

      const btns = curr.querySelectorAll('button, [role="button"], [role="combobox"]');
      if (btns.length >= 2) {
        bestContainer = curr;
        // Check if the next parent up has even more toolbar buttons without leaving the composer card
        const parent = curr.parentElement;
        if (
          parent &&
          parent !== document.body &&
          parent !== document.documentElement &&
          parent.tagName !== 'MAIN' &&
          !parent.querySelector('[data-message-author-role], [data-testid^="conversation-turn-"]')
        ) {
          const parentBtns = parent.querySelectorAll('button, [role="button"], [role="combobox"]');
          if (parentBtns.length > btns.length && parentBtns.length <= 15) {
            bestContainer = parent;
          }
        }
        return bestContainer;
      } else if (btns.length === 1) {
        const b = btns[0];
        const tid = (b.getAttribute('data-testid') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase();
        if (
          tid.includes('send') ||
          tid.includes('voice') ||
          tid.includes('speech') ||
          tid.includes('model') ||
          aria.includes('send') ||
          aria.includes('mic') ||
          aria.includes('voice') ||
          text.includes('model')
        ) {
          bestContainer = curr;
        }
      }

      curr = curr.parentElement;
      depth++;
    }

    if (bestContainer) return bestContainer;

    // 2. Check enclosing form if it has buttons
    const form = composer.closest('form');
    if (form && form instanceof HTMLElement) {
      const formBtns = form.querySelectorAll('button, [role="button"], [role="combobox"]');
      if (formBtns.length > 0) {
        return form;
      }
      if (form.parentElement && form.parentElement !== document.body && form.parentElement.tagName !== 'MAIN') {
        return form.parentElement;
      }
    }

    // 3. Fallback to standard composer wrappers
    const wrapper = composer.closest(
      '[class*="composer" i], [class*="chat-input" i], [class*="input-area" i], [class*="prompt-container" i], [role="presentation"], fieldset'
    );
    if (wrapper && wrapper instanceof HTMLElement && wrapper !== document.body) {
      return wrapper;
    }

    return fallback;
  }

  /**
   * Detects whether an interactive element is a Model selector / switcher.
   */
  private isModelElement(el: HTMLElement): boolean {
    const text = (el.textContent || '').trim().toLowerCase();
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    const id = (el.id || '').toLowerCase();

    if (
      testId.includes('model') ||
      ariaLabel.includes('model') ||
      className.includes('model') ||
      id.includes('model')
    ) {
      return true;
    }

    // Text starting with or matching "model" (e.g. "Model", "Model v", "Model\n")
    if (/^model\b/i.test(text) || text === 'model' || text.startsWith('model')) {
      return true;
    }

    // Known model names across AI platforms (Claude, ChatGPT, Gemini, DeepSeek, Perplexity, etc.)
    const modelKeywords = [
      'gpt-', 'gpt 4', 'gpt-4o', 'chatgpt',
      'claude', 'sonnet', 'opus', 'haiku',
      'gemini', 'deepseek', 'o1-', 'o3-', 'flash', 'pro'
    ];
    if (modelKeywords.some(kw => text.includes(kw) || ariaLabel.includes(kw))) {
      return true;
    }

    // Dropdown / combobox with model popup
    const popup = el.getAttribute('aria-haspopup');
    if ((popup === 'menu' || popup === 'listbox') && (text.length < 30 || ariaLabel.includes('model'))) {
      if (text.length > 0 && !text.includes('attach') && !text.includes('search') && !text.includes('work')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detects whether an interactive element is a Dictation / Mic button.
   */
  private isMicElement(el: HTMLElement): boolean {
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();

    if (
      testId.includes('voice') ||
      testId.includes('speech') ||
      testId.includes('mic') ||
      testId.includes('dictat') ||
      ariaLabel.includes('voice') ||
      ariaLabel.includes('dictat') ||
      ariaLabel.includes('speech') ||
      ariaLabel.includes('mic') ||
      title.includes('voice') ||
      title.includes('dictat') ||
      title.includes('mic')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detects whether an interactive element is a Voice mode / Audio talking or Send button.
   */
  private isAudioOrSendElement(el: HTMLElement): boolean {
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

    if (
      testId.includes('send') ||
      testId.includes('speech') ||
      ariaLabel.includes('send') ||
      ariaLabel.includes('speech') ||
      ariaLabel.includes('submit')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Finds the cluster of native chat toolbar icons on the right side of the composer.
   * Specifically identifies the target element before which Continu should sit,
   * guaranteeing placement immediately to the left of the entire right cluster:
   * [Continu Icon] -> [Think / Reasoning] -> [Model selector] -> [Mic icon] -> [Audio talking / Send icon].
   */
  private findRightToolbarCluster(): { targetElement: HTMLElement; iconSize: number; allToolbarButtons: HTMLElement[] } | null {
    const composer = this.adapter.findComposer();
    if (!composer) return null;

    const chatbox = this.findChatboxContainer(composer);
    const chatboxRect = chatbox.getBoundingClientRect();

    // Query all potential interactive elements within the chatbox
    const selector = [
      'button',
      '[role="button"]',
      '[role="combobox"]',
      '[data-testid*="button"]',
      '[data-testid*="dropdown"]',
      '[data-testid*="speech"]',
      '[data-testid*="voice"]',
      '[data-testid*="send"]',
      '[data-testid*="model"]',
      '[aria-haspopup="menu"]',
      '[aria-haspopup="listbox"]'
    ].join(', ');

    const allButtons = Array.from(chatbox.querySelectorAll(selector))
      .filter((el): el is HTMLElement => {
        if (!(el instanceof HTMLElement)) return false;
        if (this.host && this.host.contains(el)) return false;
        if (!this.isElementVisible(el)) return false;

        const r = el.getBoundingClientRect();
        // Ignore zero-size, tiny, or excessively large wrapper containers
        if (r.width < 14 || r.height < 14 || r.width > 450 || r.height > 200) {
          return false;
        }

        return true;
      });

    // Deduplicate: remove elements that are nested inside another matched element
    const deduplicated = allButtons.filter((el) => {
      return !allButtons.some((other) => other !== el && other.contains(el));
    });

    if (deduplicated.length === 0) return null;

    // Filter to buttons on the bottom toolbar row (near the lowest bottom coordinate)
    const bottoms = deduplicated.map((el) => el.getBoundingClientRect().bottom);
    const maxBottom = Math.max(...bottoms);

    const toolbarButtons = deduplicated.filter((el) => {
      const r = el.getBoundingClientRect();
      // Within 28px of the lowest toolbar row
      return Math.abs(r.bottom - maxBottom) <= 28;
    });

    if (toolbarButtons.length === 0) return null;

    // Sort buttons horizontally from left to right
    toolbarButtons.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    // Identify right-side buttons (x >= left + width * 0.32)
    const rightSideCutoff = chatboxRect.left + chatboxRect.width * 0.32;
    const rightSideButtons = toolbarButtons.filter(
      (btn) => btn.getBoundingClientRect().left >= rightSideCutoff
    );

    if (rightSideButtons.length === 0) {
      const rightmost = toolbarButtons[toolbarButtons.length - 1];
      const r = rightmost.getBoundingClientRect();
      const iconSize = Math.min(32, Math.max(26, Math.round(r.height)));
      return { targetElement: rightmost, iconSize, allToolbarButtons: toolbarButtons };
    }

    // Step backwards from rightmost button to find the leftmost button of the contiguous right tool cluster
    let clusterStartIndex = rightSideButtons.length - 1;
    for (let i = rightSideButtons.length - 2; i >= 0; i--) {
      const curr = rightSideButtons[i];
      const next = rightSideButtons[i + 1];
      const currRect = curr.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const gap = nextRect.left - currRect.right;
      // Buttons in the right toolbar cluster (Think, Model, Mic, Voice, Send) sit close together (gap <= 24px)
      if (gap <= 24) {
        clusterStartIndex = i;
      } else {
        // Wider gap indicates we reached left-aligned tools (like Attach or Search)
        break;
      }
    }

    const targetElement = rightSideButtons[clusterStartIndex];
    const r = targetElement.getBoundingClientRect();
    const iconSize = Math.min(32, Math.max(26, Math.round(r.height)));

    return { targetElement, iconSize, allToolbarButtons: toolbarButtons };
  }

  private isElementVisible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  private updatePosition(): void {
    if (!this.host || !this.icon) return;

    const composer = this.adapter.findComposer();
    if (!composer) {
      this.host.style.display = 'none';
      return;
    }

    const composerRect = composer.getBoundingClientRect();

    // Hidden, zero-size, or off-screen
    if (
      composerRect.width === 0 ||
      composerRect.height === 0 ||
      composerRect.bottom <= 0 ||
      composerRect.top >= window.innerHeight
    ) {
      this.host.style.display = 'none';
      return;
    }

    this.host.style.display = 'block';

    const rightCluster = this.findRightToolbarCluster();
    let iconTop = 0;
    let iconLeft = 0;
    let iconSize = DEFAULT_ICON_SIZE;

    const chatbox = this.findChatboxContainer(composer);
    const chatboxRect = chatbox.getBoundingClientRect();

    if (rightCluster) {
      const targetEl = rightCluster.targetElement;
      const targetRect = targetEl.getBoundingClientRect();
      iconSize = rightCluster.iconSize;

      // Position immediately to the left of the leftmost button of the right-side cluster
      iconLeft = targetRect.left - iconSize - 8;
      iconTop = targetRect.top + (targetRect.height - iconSize) / 2;

      // Collision avoidance: ensure iconLeft does not overlap ANY button in the toolbar row
      for (const btn of rightCluster.allToolbarButtons) {
        if (btn === targetEl) continue;
        const bRect = btn.getBoundingClientRect();
        // If Continu overlaps button [bRect.left - 4, bRect.right + 4] horizontally
        if (iconLeft < bRect.right + 4 && iconLeft + iconSize > bRect.left - 4) {
          iconLeft = bRect.left - iconSize - 8;
        }
      }

      // Keep within chatbox horizontal bounds
      if (iconLeft < chatboxRect.left + 8) {
        iconLeft = chatboxRect.left + 8;
      }

      this.icon.style.width = `${iconSize}px`;
      this.icon.style.height = `${iconSize}px`;

      const refComputed = window.getComputedStyle(targetEl);
      if (refComputed.borderRadius && refComputed.borderRadius !== '0px') {
        this.icon.style.borderRadius = refComputed.borderRadius;
      }
    } else {
      // Fallback: inside bottom-right of chatbox container
      iconSize = DEFAULT_ICON_SIZE;
      iconLeft = chatboxRect.right - iconSize - 16;
      iconTop = chatboxRect.bottom - iconSize - 12;
      this.icon.style.width = `${iconSize}px`;
      this.icon.style.height = `${iconSize}px`;
    }

    this.host.style.top = `${Math.round(iconTop)}px`;
    this.host.style.left = `${Math.round(iconLeft)}px`;

    // Position armed badge if active
    if (this.badgeHost && this.armedContext) {
      const badgeTop = chatboxRect.top - 16;
      const badgeLeft = chatboxRect.left + 14;
      this.badgeHost.style.top = `${Math.max(4, Math.round(badgeTop))}px`;
      this.badgeHost.style.left = `${Math.round(badgeLeft)}px`;
      this.badgeHost.style.display = 'block';
    } else if (this.badgeHost) {
      this.badgeHost.style.display = 'none';
    }

    // Position armed outline around chatbox if active (like Image 2)
    if (this.armedOutlineHost && this.armedContext) {
      this.armedOutlineHost.style.top = `${Math.round(chatboxRect.top)}px`;
      this.armedOutlineHost.style.left = `${Math.round(chatboxRect.left)}px`;
      this.armedOutlineHost.style.width = `${Math.round(chatboxRect.width)}px`;
      this.armedOutlineHost.style.height = `${Math.round(chatboxRect.height)}px`;
      const computed = window.getComputedStyle(chatbox);
      const radius = computed.borderRadius && computed.borderRadius !== '0px' ? computed.borderRadius : '16px';
      if (this.armedOutlineShadow) {
        const outlineEl = this.armedOutlineShadow.querySelector('.continu-armed-outline') as HTMLElement;
        if (outlineEl) {
          outlineEl.style.borderRadius = radius;
        }
      }
      this.armedOutlineHost.style.display = 'block';
    } else if (this.armedOutlineHost) {
      this.armedOutlineHost.style.display = 'none';
    }

    // Adjust panel position if open
    if (this.panel && this.isOpen) {
      this.adjustPanelOrientation(composerRect);
    }
  }

  /**
   * Sets up HTML5 Drag-and-Drop detection on the chatbox to allow dropping contexts to arm.
   * Keeps the textbox 100% visible and unobstructed with zero overlay covering the input.
   */
  private setupDragAndDrop(): void {
    if (!this.dropzoneHost || !document.body.contains(this.dropzoneHost)) {
      this.dropzoneHost?.remove();
      this.dropzoneHost = document.createElement('div');
      this.dropzoneHost.id = 'continu-dropzone-host';
      this.dropzoneHost.style.cssText = `
        position: fixed;
        z-index: 2147483645;
        pointer-events: none;
        display: none;
      `;
      this.dropzoneShadow = this.dropzoneHost.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = this.getDropzoneStyles();
      this.dropzoneShadow.appendChild(style);

      const overlay = document.createElement('div');
      overlay.className = 'continu-dropzone-overlay' + (this.currentTheme === 'light' ? ' theme-light' : '');
      this.dropzoneShadow.appendChild(overlay);
      document.body.appendChild(this.dropzoneHost);
    }

    this.boundDragEnter = (e: DragEvent) => {
      if (this.hasContextData(e)) {
        e.preventDefault();
        e.stopPropagation();
        this.checkDragTarget(e);
      }
    };

    this.boundDragOver = (e: DragEvent) => {
      if (this.hasContextData(e)) {
        e.preventDefault();
        e.stopPropagation();
        this.checkDragTarget(e);
      }
    };

    this.boundDragLeave = (e: DragEvent) => {
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight ||
        !this.isOverChatbox(e)
      ) {
        this.hideDropzone();
      }
    };

    this.boundDrop = (e: DragEvent) => {
      const wasOver = this.isOverChatbox(e);
      this.hideDropzone();

      if (!wasOver) return;

      const raw = e.dataTransfer?.getData('application/x-continu-context');
      if (raw) {
        try {
          const ctx = JSON.parse(raw);
          if (ctx && ctx.id && ctx.name) {
            e.preventDefault();
            e.stopPropagation();
            this.armContext(ctx);
            if (this.isOpen) this.closePanel();
          }
        } catch (err) {
          logger.warn('Continu: failed to parse dropped context', err);
        }
      }
    };

    window.addEventListener('dragenter', this.boundDragEnter, true);
    window.addEventListener('dragover', this.boundDragOver, true);
    window.addEventListener('dragleave', this.boundDragLeave, true);
    window.addEventListener('drop', this.boundDrop, true);
  }

  private teardownDragAndDrop(): void {
    if (this.boundDragEnter) window.removeEventListener('dragenter', this.boundDragEnter, true);
    if (this.boundDragOver) window.removeEventListener('dragover', this.boundDragOver, true);
    if (this.boundDragLeave) window.removeEventListener('dragleave', this.boundDragLeave, true);
    if (this.boundDrop) window.removeEventListener('drop', this.boundDrop, true);
    this.dropzoneHost?.remove();
    this.dropzoneHost = null;
    this.dropzoneShadow = null;
  }

  private hasContextData(e: DragEvent): boolean {
    if (!e.dataTransfer) return false;
    return e.dataTransfer.types.includes('application/x-continu-context');
  }

  private isOverChatbox(e: DragEvent): boolean {
    const composer = this.adapter.findComposer();
    if (!composer) return false;
    const chatbox = this.findChatboxContainer(composer);
    const rect = chatbox.getBoundingClientRect();
    return (
      e.clientX >= rect.left - 20 &&
      e.clientX <= rect.right + 20 &&
      e.clientY >= rect.top - 20 &&
      e.clientY <= rect.bottom + 20
    );
  }

  private checkDragTarget(e: DragEvent): void {
    if (this.isOverChatbox(e)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      this.showDropzone();
    } else {
      this.hideDropzone();
    }
  }

  private showDropzone(): void {
    const composer = this.adapter.findComposer();
    if (!composer || !this.dropzoneHost) return;
    const chatbox = this.findChatboxContainer(composer);
    const rect = chatbox.getBoundingClientRect();

    this.dropzoneHost.style.top = `${Math.round(rect.top)}px`;
    this.dropzoneHost.style.left = `${Math.round(rect.left)}px`;
    this.dropzoneHost.style.width = `${Math.round(rect.width)}px`;
    this.dropzoneHost.style.height = `${Math.round(rect.height)}px`;
    this.dropzoneHost.style.overflow = 'visible';
    this.dropzoneHost.style.display = 'block';
    this.isDropzoneVisible = true;

    if (this.dropzoneShadow) {
      const overlay = this.dropzoneShadow.querySelector('.continu-dropzone-overlay') as HTMLElement;
      if (overlay) {
        overlay.classList.toggle('theme-light', this.currentTheme === 'light');
        const computed = window.getComputedStyle(chatbox);
        if (computed.borderRadius && computed.borderRadius !== '0px') {
          overlay.style.borderRadius = computed.borderRadius;
        }
      }
    }
  }

  private hideDropzone(): void {
    if (this.dropzoneHost) {
      this.dropzoneHost.style.display = 'none';
    }
    this.isDropzoneVisible = false;
  }

  private getDropzoneStyles(): string {
    return `
      .continu-dropzone-overlay {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        border-radius: 16px;
        background: transparent !important;
        backdrop-filter: none !important;
        border: 2px dashed #3b82f6;
        box-shadow: 0 0 14px rgba(59, 130, 246, 0.3), inset 0 0 8px rgba(59, 130, 246, 0.08);
        position: relative;
        pointer-events: none;
        animation: dropzonePulse 1.8s ease-in-out infinite alternate;
      }

      .continu-dropzone-overlay.theme-light,
      :host(.theme-light) .continu-dropzone-overlay {
        border-color: #2563eb;
        box-shadow: 0 0 12px rgba(37, 99, 235, 0.25), inset 0 0 8px rgba(37, 99, 235, 0.06);
      }

      @keyframes dropzonePulse {
        0% {
          border-color: #3b82f6;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.25), inset 0 0 6px rgba(59, 130, 246, 0.06);
        }
        100% {
          border-color: #60a5fa;
          box-shadow: 0 0 16px rgba(59, 130, 246, 0.45), inset 0 0 10px rgba(59, 130, 246, 0.12);
        }
      }
    `;
  }

  /**
   * Arms a context to be bundled with the user's next prompt (COA 1).
   * Renders the floating context badge above the chatbox, renders the glowing outline around
   * the chatbox container (Image 2), and attaches submission interceptors.
   */
  armContext(context: ContinuContext): void {
    this.armedContext = context;
    this.renderArmedBadge();
    this.renderArmedOutline();
    this.attachSubmissionInterception();
    this.updatePosition();

    // Focus composer so user can immediately type their question
    const composer = this.adapter.findComposer();
    if (composer instanceof HTMLElement) {
      composer.focus();
    }
  }

  /**
   * Disarms the active context, removing the badge, outline, and detaching interceptors.
   */
  disarmContext(): void {
    this.armedContext = null;
    this.removeSubmissionInterception();
    if (this.badgeHost) {
      this.badgeHost.style.display = 'none';
    }
    if (this.badgeShadow) {
      const badge = this.badgeShadow.querySelector('.continu-armed-badge');
      badge?.remove();
    }
    if (this.armedOutlineHost) {
      this.armedOutlineHost.style.display = 'none';
    }
  }

  getArmedContext(): ContinuContext | null {
    return this.armedContext;
  }

  private renderArmedBadge(): void {
    if (!this.badgeShadow || !this.armedContext) return;
    const existing = this.badgeShadow.querySelector('.continu-armed-badge');
    existing?.remove();

    const badge = document.createElement('div');
    badge.className = 'continu-armed-badge' + (this.currentTheme === 'light' ? ' theme-light' : '');
    badge.innerHTML = `
      <span class="badge-icon">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </span>
      <span class="badge-label">ARMED:</span>
      <span class="badge-title" title="${this.escapeHtml(this.armedContext.name)}">${this.escapeHtml(this.armedContext.name)}</span>
      <button class="badge-close" type="button" title="Detach context" aria-label="Detach context">&times;</button>
    `;

    badge.querySelector('.badge-close')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.disarmContext();
    });

    this.badgeShadow.appendChild(badge);
    if (this.badgeHost) {
      this.badgeHost.style.display = 'block';
    }
  }

  /**
   * Renders or shows the sleek outline wrapper around the chatbox card when armed (matching Image 2).
   */
  private renderArmedOutline(): void {
    if (!this.armedOutlineHost || !document.body.contains(this.armedOutlineHost)) {
      this.armedOutlineHost?.remove();
      this.armedOutlineHost = document.createElement('div');
      this.armedOutlineHost.id = 'continu-armed-outline-host';
      if (this.currentTheme === 'light') {
        this.armedOutlineHost.classList.add('theme-light');
      }
      this.armedOutlineHost.style.cssText = `
        position: fixed;
        z-index: 2147483644;
        pointer-events: none;
        display: none;
      `;
      this.armedOutlineShadow = this.armedOutlineHost.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = this.getArmedOutlineStyles();
      this.armedOutlineShadow.appendChild(style);

      const outline = document.createElement('div');
      outline.className = 'continu-armed-outline' + (this.currentTheme === 'light' ? ' theme-light' : '');
      this.armedOutlineShadow.appendChild(outline);
      document.body.appendChild(this.armedOutlineHost);
    }
  }

  private getArmedOutlineStyles(): string {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      .continu-armed-outline {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        pointer-events: none;
        border: 1.5px solid #3b82f6;
        box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.4), 0 0 16px rgba(59, 130, 246, 0.2);
        border-radius: 16px;
        transition: border-color 150ms ease, box-shadow 150ms ease;
        animation: armedGlowPulse 2.5s ease-in-out infinite alternate;
      }

      .continu-armed-outline.theme-light,
      :host(.theme-light) .continu-armed-outline {
        border-color: #2563eb;
        box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.35), 0 0 14px rgba(37, 99, 235, 0.16);
      }

      @keyframes armedGlowPulse {
        0% {
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35), 0 0 12px rgba(59, 130, 246, 0.15);
        }
        100% {
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.55), 0 0 20px rgba(59, 130, 246, 0.3);
        }
      }
    `;
  }

  private attachSubmissionInterception(): void {
    if (this.isIntercepting) return;
    this.isIntercepting = true;

    this.boundKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && this.armedContext) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.processArmedSubmission();
      }
    };

    this.boundClickHandler = (e: MouseEvent) => {
      if (this.armedContext) {
        const target = e.target as HTMLElement;
        const submitBtn = this.adapter.findSubmitButton();
        if (submitBtn && (submitBtn === target || submitBtn.contains(target))) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.processArmedSubmission();
        }
      }
    };

    window.addEventListener('keydown', this.boundKeydownHandler, true);
    window.addEventListener('click', this.boundClickHandler, true);
  }

  private removeSubmissionInterception(): void {
    if (!this.isIntercepting) return;
    if (this.boundKeydownHandler) {
      window.removeEventListener('keydown', this.boundKeydownHandler, true);
      this.boundKeydownHandler = null;
    }
    if (this.boundClickHandler) {
      window.removeEventListener('click', this.boundClickHandler, true);
      this.boundClickHandler = null;
    }
    this.isIntercepting = false;
  }

  private async processArmedSubmission(): Promise<void> {
    if (!this.armedContext) return;
    const ctx = this.armedContext;
    const composer = this.adapter.findComposer();
    const draft = this.adapter.getComposerText() || '';
    const combined = formatPromptWithContext(ctx, draft);

    this.disarmContext();
    this.adapter.insertText(combined);

    if (composer) {
      await triggerSubmit(composer, () => this.adapter.findSubmitButton(), 60);
    }
  }

  private adjustPanelOrientation(composerRect: DOMRect): void {
    if (!this.panel) return;

    if (composerRect.top < 380) {
      this.panel.classList.add('position-below');
      this.panel.classList.remove('position-above');
    } else {
      this.panel.classList.add('position-above');
      this.panel.classList.remove('position-below');
    }

    // Align to the right unless icon is too close to left viewport edge
    const hostLeft = parseFloat(this.host?.style.left || '0');
    if (hostLeft < PANEL_WIDTH + 20) {
      this.panel.classList.add('align-left');
      this.panel.classList.remove('align-right');
    } else {
      this.panel.classList.add('align-right');
      this.panel.classList.remove('align-left');
    }
  }

  private startObserver(): void {
    this.observer = new MutationObserver(() => {
      if (this.observerDebounce !== null) return;
      this.observerDebounce = window.setTimeout(() => {
        this.observerDebounce = null;
        const composer = this.adapter.findComposer();
        if (composer) {
          if (!this.host || !document.body.contains(this.host)) {
            this.injectIcon();
          } else {
            this.updatePosition();
          }
        } else if (this.host) {
          this.host.style.display = 'none';
        }
      }, 100);
    });

    const target = document.body || document.documentElement;
    if (target) {
      this.observer.observe(target, {
        childList: true,
        subtree: true,
      });
    }
  }

  private async togglePanel(): Promise<void> {
    if (this.isOpen) {
      this.closePanel();
    } else {
      await this.openPanel();
    }
  }

  private async openPanel(): Promise<void> {
    if (!this.panel || !this.icon) return;

    this.isOpen = true;
    this.icon.classList.add('active');

    const composer = this.adapter.findComposer();
    if (composer) {
      this.adjustPanelOrientation(composer.getBoundingClientRect());
    }


    // 1. Resolve auth status first to guarantee loadContexts does not abort prematurely
    this.isAuthenticated = await this.isUserAuthenticated();

    // 2. Fetch AI status and contexts concurrently with confirmed auth
    const [aiStatus, contexts] = await Promise.all([
      isAiConfigured().catch(() => ({ configured: false, provider: null, model: null, config: null })),
      this.loadContexts(),
    ]);

    this.aiConfigured = aiStatus.configured;
    this.aiProvider = aiStatus.provider;
    this.aiModel = aiStatus.model;
    this.contexts = contexts;

    this.renderPanel();
    this.panel.classList.remove('hidden');
  }

  private closePanel(): void {
    if (!this.panel || !this.icon) return;
    this.isOpen = false;
    this.icon.classList.remove('active');
    this.panel.classList.add('hidden');
  }

  private renderPanel(): void {
    if (!this.panel) return;

    this.panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `
      <div class="panel-brand">
        <span class="panel-logo">${this.getSvgIcon(16)}</span>
        <span class="panel-title">continu</span>
        <span class="panel-platform-badge">${this.escapeHtml(this.adapter.name)}</span>
      </div>
      <div class="panel-header-actions">
        <button class="panel-theme-toggle" type="button" title="${this.currentTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}" aria-label="Toggle theme">
          ${this.currentTheme === 'dark' ? this.getSunIconSvg() : this.getMoonIconSvg()}
        </button>
        <button class="panel-close" title="Close (Esc)">&times;</button>
      </div>
    `;
    header.querySelector('.panel-theme-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleTheme();
    });
    header.querySelector('.panel-close')?.addEventListener('click', () => this.closePanel());
    this.panel.appendChild(header);

    // 1. Generate section (bigger button on top)
    const generateSection = document.createElement('div');
    generateSection.className = 'panel-section generate-section';

    if (!this.isAuthenticated) {
      const authNotice = document.createElement('div');
      authNotice.className = 'panel-auth-notice';
      authNotice.innerHTML = `
        <div class="panel-auth-title">🔒 Sign In Required</div>
        <div class="panel-auth-text">Please log in to the Continu extension to capture and sync contexts.</div>
      `;
      generateSection.appendChild(authNotice);
    } else {
      const generateBtn = document.createElement('button');
      generateBtn.className = 'panel-btn-generate';
      generateBtn.type = 'button';
      generateBtn.innerHTML = `
        <svg class="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span>GENERATE</span>
      `;
      generateBtn.addEventListener('click', () => this.handleGenerate(generateBtn));
      generateSection.appendChild(generateBtn);
    }

    // Cook This Prompt button
    const cookBtn = document.createElement('button');
    cookBtn.className = `panel-btn-cook ${this.aiConfigured ? 'configured' : 'unconfigured'}`;
    cookBtn.type = 'button';
    cookBtn.setAttribute('data-testid', 'btn-cook-prompt');

    if (this.aiConfigured) {
      cookBtn.innerHTML = `
        <div class="cook-btn-row">
          <div class="cook-btn-left">
            <span class="cook-icon">🍳</span>
            <span class="cook-label">COOK THIS PROMPT</span>
          </div>
          <span class="cook-provider-badge">${this.escapeHtml((this.aiProvider || 'AI').toUpperCase())}</span>
        </div>
        <div class="cook-subtext">✨ Refine & elevate draft prompt before sending</div>
      `;
      cookBtn.addEventListener('click', () => this.handleCookPrompt(cookBtn));
    } else {
      cookBtn.innerHTML = `
        <div class="cook-btn-row">
          <div class="cook-btn-left">
            <span class="cook-icon">🍳</span>
            <span class="cook-label">COOK THIS PROMPT</span>
          </div>
          <span class="cook-badge-setup">Setup Key</span>
        </div>
        <div class="cook-subtext cook-subtext-warn">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
          </svg>
          <span>No API key set — Click for instructions</span>
        </div>
      `;
      cookBtn.addEventListener('click', () => this.toggleCookSetupGuide());
    }

    generateSection.appendChild(cookBtn);
    this.panel.appendChild(generateSection);

    // 2. Drop Format section (Text on top, 3 proportional buttons below)
    const dropFormatSection = document.createElement('div');
    dropFormatSection.className = 'panel-section drop-format-section';

    const dropFormatTitle = document.createElement('div');
    dropFormatTitle.className = 'drop-format-title';
    dropFormatTitle.textContent = 'Drop Format';
    dropFormatSection.appendChild(dropFormatTitle);

    const dropFormatGroup = document.createElement('div');
    dropFormatGroup.className = 'drop-format-group';

    // 3 proportional buttons: Attach, Structured, Full
    const formats: { id: DropFormat; label: string; hint: string }[] = [
      { id: 'hidden', label: 'Attach', hint: '⚡ Arms context above chatbox — hit Enter in chat to send' },
      { id: 'structured', label: 'Structured', hint: '📋 Inserts structured markdown context into chatbox' },
      { id: 'full', label: 'Full', hint: '💬 Inserts complete conversation transcript into chatbox' },
    ];

    const currentHint = document.createElement('div');
    currentHint.className = 'drop-format-hint';
    const activeFormatObj = formats.find(f => f.id === this.selectedFormat) || formats[0];
    currentHint.textContent = activeFormatObj.hint;

    formats.forEach(f => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `drop-format-btn ${this.selectedFormat === f.id ? 'active' : ''}`;
      btn.setAttribute('data-format', f.id);
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        this.selectedFormat = f.id;
        dropFormatGroup.querySelectorAll('.drop-format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentHint.textContent = f.hint;
        this.renderContextList(savedContextsSection);
      });
      dropFormatGroup.appendChild(btn);
    });

    dropFormatSection.appendChild(dropFormatGroup);
    dropFormatSection.appendChild(currentHint);
    this.panel.appendChild(dropFormatSection);

    // Divider
    const divider = document.createElement('div');
    divider.className = 'panel-divider';
    this.panel.appendChild(divider);

    // 3. Saved Contexts section (Below Drop Format)
    const savedContextsSection = document.createElement('div');
    savedContextsSection.className = 'panel-section saved-contexts-section';

    const listHeader = document.createElement('div');
    listHeader.className = 'panel-label-row';
    listHeader.innerHTML = `
      <span class="panel-label">SAVED CONTEXTS</span>
      <span class="panel-count">${this.contexts.length} saved</span>
    `;
    savedContextsSection.appendChild(listHeader);

    // Search bar if contexts > 2
    if (this.contexts.length > 2) {
      const searchWrapper = document.createElement('div');
      searchWrapper.className = 'panel-search-wrapper';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'panel-search-input';
      searchInput.placeholder = 'Filter contexts...';
      searchInput.value = this.searchQuery;
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        this.renderContextList(savedContextsSection);
      });
      searchWrapper.appendChild(searchInput);
      savedContextsSection.appendChild(searchWrapper);
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'context-list-container';
    savedContextsSection.appendChild(listContainer);

    this.renderContextList(savedContextsSection);

    const dragHint = document.createElement('div');
    dragHint.className = 'panel-drag-hint';
    dragHint.innerHTML = `<span>💡 <strong>Tip:</strong> Drag any context onto the chatbox to attach</span>`;
    savedContextsSection.appendChild(dragHint);

    this.panel.appendChild(savedContextsSection);
  }

  private renderContextList(container: HTMLElement): void {
    const listContainer = container.querySelector('.context-list-container') as HTMLElement;
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const filtered = this.searchQuery
      ? this.contexts.filter(c =>
          c.name.toLowerCase().includes(this.searchQuery) ||
          c.source.platform.toLowerCase().includes(this.searchQuery) ||
          c.tags.some(t => t.toLowerCase().includes(this.searchQuery))
        )
      : this.contexts;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'panel-empty';
      empty.textContent = this.contexts.length === 0
        ? 'No saved contexts yet. Click GENERATE above to create your first context.'
        : 'No matching contexts found.';
      listContainer.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'panel-list';

    const isAttach = this.selectedFormat === 'hidden';

    filtered.slice(0, 8).forEach(ctx => {
      const item = document.createElement('div');
      item.className = 'panel-item draggable-item';
      item.draggable = true;

      // Drag grip handle
      const grip = document.createElement('span');
      grip.className = 'panel-drag-grip';
      grip.title = 'Drag onto chatbox to arm';
      grip.innerHTML = `
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2"/>
          <circle cx="6" cy="2" r="1.2"/>
          <circle cx="2" cy="7" r="1.2"/>
          <circle cx="6" cy="7" r="1.2"/>
          <circle cx="2" cy="12" r="1.2"/>
          <circle cx="6" cy="12" r="1.2"/>
        </svg>
      `;
      item.appendChild(grip);

      item.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        // Crucial: Only attach application/x-continu-context. Never attach text/plain!
        // Attaching text/plain triggers native chat web app drop overlays (like ChatGPT's "Drop text here.")
        // which completely covers and obstructs the user's textbox.
        e.dataTransfer.setData('application/x-continu-context', JSON.stringify(ctx));
        e.dataTransfer.effectAllowed = 'copy';
        item.classList.add('is-dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging');
        this.hideDropzone();
      });

      const info = document.createElement('div');
      info.className = 'panel-item-info';
      info.title = `${ctx.name}\n${ctx.summary || ''}`;
      info.innerHTML = `
        <div class="panel-item-name">${this.escapeHtml(ctx.name)}</div>
        <div class="panel-item-meta">
          <span class="panel-badge">${this.escapeHtml(ctx.source.platform)}</span>
          <span class="panel-time">${this.formatTimeAgo(ctx.updatedAt || ctx.createdAt)}</span>
          ${(ctx as any).turnCount ? `<span class="panel-turns">${this.escapeHtml(String((ctx as any).turnCount))} turns</span>` : ''}
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'panel-item-actions';

      const actionBtn = document.createElement('button');
      actionBtn.className = 'panel-btn-sm panel-btn-sm-primary';
      actionBtn.type = 'button';
      actionBtn.textContent = isAttach ? 'Attach' : 'Insert';
      actionBtn.title = isAttach
        ? 'Arms context above chatbox — type your question and press Enter to send directly'
        : 'Inserts formatted context into active composer for your review';

      actionBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isAttach) {
          this.armContext(ctx);
          actionBtn.textContent = '✓ Armed';
          actionBtn.classList.add('success');
          setTimeout(() => this.closePanel(), 300);
        } else {
          actionBtn.textContent = 'Inserting...';
          actionBtn.classList.add('disabled');

          try {
            const success = await dropContextToChat(this.adapter, ctx, this.selectedFormat);
            if (success) {
              actionBtn.textContent = '✓ Inserted';
              actionBtn.classList.add('success');
              setTimeout(() => this.closePanel(), 500);
            } else {
              actionBtn.textContent = 'Error';
              actionBtn.classList.add('error');
              setTimeout(() => {
                actionBtn.textContent = 'Insert';
                actionBtn.classList.remove('error', 'disabled');
              }, 1500);
            }
          } catch {
            actionBtn.textContent = 'Error';
            actionBtn.classList.add('error');
            setTimeout(() => {
              actionBtn.textContent = 'Insert';
              actionBtn.classList.remove('error', 'disabled');
            }, 1500);
          }
        }
      });
      actions.appendChild(actionBtn);

      item.appendChild(info);
      item.appendChild(actions);
      list.appendChild(item);
    });

    listContainer.appendChild(list);

    if (filtered.length > 8) {
      const more = document.createElement('div');
      more.className = 'panel-more';
      more.textContent = `+${filtered.length - 8} more in extension popup`;
      listContainer.appendChild(more);
    }
  }

  private async handleGenerate(btn: HTMLButtonElement): Promise<void> {
    const isAuthed = await this.isUserAuthenticated();
    if (!isAuthed) {
      this.isAuthenticated = false;
      btn.innerHTML = `<span>🔒 Please sign in first</span>`;
      btn.classList.add('error');
      setTimeout(() => {
        this.renderPanel();
      }, 2000);
      return;
    }
    this.isAuthenticated = true;

    const originalContent = btn.innerHTML;
    btn.innerHTML = `
      <div class="spinner"></div>
      <span>Extracting & saving...</span>
    `;
    btn.classList.add('disabled');

    try {
      // 1. Direct in-page extraction
      let conversation: ConversationTurn[] = [];
      try {
        conversation = this.adapter.extractConversation() || [];
      } catch (err) {
        logger.warn('Continu: Extraction warning:', err);
      }

      const url = window.location.href || 'https://continu.local';
      const cleanTitle = extractPageChatTitle(this.adapter.name);
      const title = cleanTitle || document.title || `${this.adapter.name} conversation`;
      const platform = this.adapter.name;

      const context = (conversation && conversation.length > 0)
        ? generateContext({ url, title, platform, conversation })
        : generateMinimalContext(url, title, platform);

      // 2. Multi-tier save: save locally and notify background to enqueue and upload to remote DB
      let saved = false;
      try {
        await saveContextLocal(context);
        saved = true;
      } catch (localErr) {
        logger.warn('Continu: Direct local save fallback to background:', localErr);
      }

      // Always notify background to enqueue and sync to Supabase
      try {
        const resp = await chrome.runtime.sendMessage({
          type: MessageType.SAVE_CONTEXT,
          context,
        });
        if (!saved && resp?.success) {
          saved = true;
        }
      } catch (msgErr) {
        logger.warn('Continu: Background message save notice:', msgErr);
      }

      if (!saved) {
        // Fallback: ask background to generate and save
        try {
          const resp = await chrome.runtime.sendMessage({
            type: MessageType.GENERATE_CONTEXT,
          });
          if (resp?.success && resp.context) {
            saved = true;
          }
        } catch (genErr) {
          logger.warn('Continu: Background generate notice:', genErr);
        }
      }

      if (saved) {
        btn.innerHTML = `<span>✓ Context saved!</span>`;
        btn.classList.add('success');

        // 3. Refresh contexts list
        this.contexts = await this.loadContexts();

        setTimeout(() => {
          this.renderPanel();
        }, 800);
      } else {
        throw new Error('All storage mechanisms failed');
      }
    } catch (error) {
      logger.error('Continu: Error generating context:', error);
      btn.innerHTML = `<span>Could not generate</span>`;
      btn.classList.add('error');
      setTimeout(() => {
        btn.innerHTML = originalContent;
        btn.classList.remove('error', 'disabled');
      }, 2200);
    }
  }

  private toggleCookSetupGuide(): void {
    const existing = this.panel?.querySelector('.cook-setup-guide');
    if (existing) {
      existing.remove();
      return;
    }

    const guide = document.createElement('div');
    guide.className = 'cook-setup-guide fade-in';
    guide.innerHTML = `
      <div class="cook-guide-header">
        <span class="cook-guide-title">⚙️ How to Setup AI API Key</span>
        <button class="cook-guide-close" type="button" aria-label="Close setup guide">&times;</button>
      </div>
      <div class="cook-guide-steps">
        <div class="cook-step">
          <span class="step-num">1</span>
          <span>Open the <strong>Continu extension popup</strong> from your browser toolbar.</span>
        </div>
        <div class="cook-step">
          <span class="step-num">2</span>
          <span>Click the <strong>⚙️ Settings</strong> button in the popup header.</span>
        </div>
        <div class="cook-step">
          <span class="step-num">3</span>
          <span>Choose your provider: <strong>OpenAI, Claude, Gemini, Groq, or OpenRouter</strong>.</span>
        </div>
        <div class="cook-step">
          <span class="step-num">4</span>
          <span>Paste your API key and click <strong>Save Configuration</strong>.</span>
        </div>
      </div>
      <div class="cook-guide-tip">
        💡 <strong>Tip:</strong> Free/instant keys are available at <em>console.groq.com</em> and <em>aistudio.google.com</em>.
      </div>
    `;

    guide.querySelector('.cook-guide-close')?.addEventListener('click', () => guide.remove());

    const generateSec = this.panel?.querySelector('.generate-section');
    if (generateSec) {
      generateSec.appendChild(guide);
    }
  }

  private async handleCookPrompt(btn: HTMLButtonElement): Promise<void> {
    const draftText = this.adapter.getComposerText?.()?.trim() || '';
    if (!draftText) {
      const originalSub = btn.querySelector('.cook-subtext')?.innerHTML || '';
      btn.classList.add('error');
      const sub = btn.querySelector('.cook-subtext');
      if (sub) {
        sub.innerHTML = `⚠️ Type a prompt in chatbox first!`;
      }
      setTimeout(() => {
        btn.classList.remove('error');
        if (sub) sub.innerHTML = originalSub;
      }, 2500);
      return;
    }

    const originalContent = btn.innerHTML;
    btn.classList.add('loading', 'disabled');
    btn.innerHTML = `
      <div class="cook-btn-row">
        <div class="cook-btn-left">
          <span class="spinner" style="width: 13px; height: 13px; border-width: 1.5px;"></span>
          <span class="cook-label">Cooking with ${(this.aiProvider || 'AI').toUpperCase()}...</span>
        </div>
      </div>
      <div class="cook-subtext">${draftText.length > 2000 ? `Cooking large prompt (${(draftText.length / 1000).toFixed(1)}k chars)...` : 'Applying prompt engineering principles'}</div>
    `;

    try {
      const result = await cookPrompt(draftText);
      if (result.success && result.cookedPrompt && !isRefusalResponse(result.cookedPrompt)) {
        btn.classList.remove('loading', 'disabled');
        btn.innerHTML = originalContent;
        this.renderCookPreview(draftText, result.cookedPrompt, result.provider || this.aiProvider || 'AI', result.model || this.aiModel || '');
      } else {
        throw new Error(result.setupInfo || result.error || 'Failed to cook prompt');
      }
    } catch (err: any) {
      logger.error('Continu: Error cooking prompt:', err);
      btn.classList.remove('loading');
      btn.classList.add('error');
      const safeMessage = redactSensitiveData(err.message || 'Please check your API key');
      btn.innerHTML = `
        <div class="cook-btn-row">
          <div class="cook-btn-left">
            <span class="cook-label">⚠️ Cooking Failed</span>
          </div>
        </div>
        <div class="cook-subtext">${this.escapeHtml(safeMessage)}</div>
      `;
      setTimeout(() => {
        btn.classList.remove('error', 'disabled');
        btn.innerHTML = originalContent;
      }, 3000);
    }
  }

  private renderCookPreview(original: string, cooked: string, provider: string, model: string): void {
    if (!this.panel) return;

    // Remove any existing preview
    this.panel.querySelector('.cook-preview-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'cook-preview-overlay';
    overlay.innerHTML = `
      <div class="cook-preview-header">
        <div class="cook-preview-title">
          <span>🍳 Cooked Prompt</span>
          <span class="cook-provider-badge">${this.escapeHtml(provider.toUpperCase())}${model ? ` (${this.escapeHtml(model)})` : ''}</span>
        </div>
        <button class="cook-guide-close cook-preview-close" type="button" title="Close preview">&times;</button>
      </div>

      <div class="cook-preview-section">
        <div class="cook-preview-label">Original Prompt (${original.length} chars)</div>
        <div class="cook-preview-box cook-preview-original">${this.escapeHtml(original)}</div>
      </div>

      <div class="cook-preview-section" style="flex: 1; display: flex; flex-direction: column;">
        <div class="cook-preview-label">Improved Prompt (Editable)</div>
        <textarea class="cook-preview-textarea">${this.escapeHtml(cooked)}</textarea>
      </div>

      <div class="cook-preview-actions">
        <button class="cook-preview-btn-replace" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14h6v6"/><path d="M20 10V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M10 14L21 3"/>
          </svg>
          <span>Replace in Chatbox</span>
        </button>
        <div class="cook-preview-btn-row">
          <button class="cook-preview-btn-copy" type="button">📋 Copy</button>
          <button class="cook-preview-btn-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;

    const textarea = overlay.querySelector('.cook-preview-textarea') as HTMLTextAreaElement;
    const replaceBtn = overlay.querySelector('.cook-preview-btn-replace') as HTMLButtonElement;
    const copyBtn = overlay.querySelector('.cook-preview-btn-copy') as HTMLButtonElement;
    const cancelBtn = overlay.querySelector('.cook-preview-btn-cancel') as HTMLButtonElement;
    const closeBtn = overlay.querySelector('.cook-preview-close') as HTMLButtonElement;

    closeBtn?.addEventListener('click', () => overlay.remove());
    cancelBtn?.addEventListener('click', () => overlay.remove());

    copyBtn?.addEventListener('click', async () => {
      const textToCopy = textarea ? textarea.value : cooked;
      try {
        await navigator.clipboard.writeText(textToCopy);
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          copyBtn.textContent = '📋 Copy';
        }, 2000);
      } catch {
        copyBtn.textContent = 'Copy failed';
      }
    });

    replaceBtn?.addEventListener('click', () => {
      const finalText = textarea ? textarea.value : cooked;
      this.adapter.insertText(finalText);
      overlay.remove();
      this.closePanel();
    });

    this.panel.appendChild(overlay);
  }


  private escapeHtml(str: string): string {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatTimeAgo(dateStr: string): string {
    try {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  }

  private getSvgIcon(size = 18): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.178 8c5.096 0 5.096 8 0 8-2.67 0-4.634-2.667-6.178-5.333C10.456 8 8.492 8 5.822 8 0.726 8 0.726 16 5.822 16c2.67 0 4.634-2.667 6.178-5.333C13.544 8 15.508 8 18.178 8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  private getSunIconSvg(): string {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
  }

  private getMoonIconSvg(): string {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
  }

  private getStyles(): string {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
      }

      .continu-icon {
        width: ${DEFAULT_ICON_SIZE}px;
        height: ${DEFAULT_ICON_SIZE}px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(26, 26, 30, 0.9);
        color: #9ca3af;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 140ms ease;
        backdrop-filter: blur(8px);
        padding: 0;
        pointer-events: auto;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
        position: relative;
      }

      .continu-icon:hover {
        background: rgba(35, 35, 44, 0.98);
        color: #ffffff;
        border-color: rgba(74, 158, 255, 0.4);
        transform: scale(1.04);
      }

      .continu-icon.active {
        background: #222228;
        color: #4a9eff;
        border-color: #4a9eff;
        box-shadow: 0 0 8px rgba(74, 158, 255, 0.25);
      }

      .continu-panel {
        position: absolute;
        width: ${PANEL_WIDTH}px;
        max-height: 440px;
        background: #141416;
        border: 1px solid #27272a;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        animation: panelFadeIn 140ms ease-out forwards;
      }

      .continu-panel.position-above {
        bottom: ${DEFAULT_ICON_SIZE + 10}px;
      }

      .continu-panel.position-below {
        top: ${DEFAULT_ICON_SIZE + 10}px;
      }

      .continu-panel.align-right {
        right: 0;
      }

      .continu-panel.align-left {
        left: 0;
      }

      @keyframes panelFadeIn {
        from {
          opacity: 0;
          transform: translateY(4px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .continu-panel.hidden {
        display: none;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid #222226;
        background: #18181c;
      }

      .panel-brand {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .panel-logo {
        display: flex;
        align-items: center;
        color: #4a9eff;
      }

      .panel-title {
        font-size: 13px;
        font-weight: 600;
        color: #f4f4f5;
        letter-spacing: -0.01em;
      }

      .panel-platform-badge {
        font-size: 10px;
        font-weight: 500;
        color: #a1a1aa;
        background: #27272a;
        padding: 1px 6px;
        border-radius: 4px;
        text-transform: capitalize;
      }

      .panel-close {
        width: 22px;
        height: 22px;
        border: none;
        background: transparent;
        color: #71717a;
        cursor: pointer;
        border-radius: 4px;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 120ms ease;
      }

      .panel-close:hover {
        background: #27272a;
        color: #f4f4f5;
      }

      .panel-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .panel-theme-toggle {
        width: 22px;
        height: 22px;
        border: none;
        background: transparent;
        color: #a1a1aa;
        cursor: pointer;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 120ms ease;
      }

      .panel-theme-toggle:hover {
        background: #27272a;
        color: #f4f4f5;
      }

      .panel-section {
        padding: 10px 14px;
      }

      .generate-section {
        background: #141416;
      }

      .panel-auth-notice {
        background: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 8px;
        padding: 10px 12px;
        text-align: center;
      }

      .panel-auth-title {
        font-weight: 600;
        font-size: 11.5px;
        color: #f87171;
        margin-bottom: 4px;
        letter-spacing: 0.2px;
      }

      .panel-auth-text {
        font-size: 11px;
        color: #94a3b8;
        line-height: 1.4;
      }

      .continu-panel.theme-light .panel-auth-notice,
      :host(.theme-light) .panel-auth-notice {
        background: rgba(239, 68, 68, 0.05);
        border-color: rgba(239, 68, 68, 0.2);
      }

      .continu-panel.theme-light .panel-auth-title,
      :host(.theme-light) .panel-auth-title {
        color: #dc2626;
      }

      .continu-panel.theme-light .panel-auth-text,
      :host(.theme-light) .panel-auth-text {
        color: #64748b;
      }

      .generate-section {
        padding: 12px 14px 8px 14px;
      }

      .panel-btn-generate,
      .panel-btn-primary {
        width: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 42px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        border: 1px solid #3b82f6;
        border-radius: 8px;
        background: #2563eb;
        color: #ffffff;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
        transition: all 140ms ease;
      }

      .panel-btn-generate:hover,
      .panel-btn-primary:hover {
        background: #1d4ed8;
        border-color: #2563eb;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
        transform: translateY(-1px);
      }

      .panel-btn-generate:active,
      .panel-btn-primary:active {
        transform: translateY(0);
      }

      .panel-btn-generate.disabled,
      .panel-btn-primary.disabled {
        opacity: 0.65;
        pointer-events: none;
      }

      .panel-btn-generate.success,
      .panel-btn-primary.success {
        background: #16a34a;
        border-color: #16a34a;
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(22, 163, 74, 0.3);
      }

      .panel-btn-generate.error,
      .panel-btn-primary.error {
        background: #dc2626;
        border-color: #dc2626;
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
      }

      /* Cook Prompt Button */
      .panel-btn-cook {
        width: 100%;
        box-sizing: border-box;
        margin-top: 8px;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid #7c3aed;
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.16) 0%, rgba(99, 102, 241, 0.1) 100%);
        color: #e0e7ff;
        cursor: pointer;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 3px;
        transition: all 140ms ease;
        box-shadow: 0 1px 4px rgba(124, 58, 237, 0.15);
      }

      .panel-btn-cook:hover {
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.26) 0%, rgba(99, 102, 241, 0.18) 100%);
        border-color: #8b5cf6;
        box-shadow: 0 3px 10px rgba(124, 58, 237, 0.25);
        transform: translateY(-1px);
      }

      .panel-btn-cook:active {
        transform: translateY(0);
      }

      .panel-btn-cook.unconfigured {
        border: 1px dashed rgba(245, 158, 11, 0.55);
        background: rgba(245, 158, 11, 0.08);
        color: #fbbf24;
      }

      .panel-btn-cook.unconfigured:hover {
        border-color: #f59e0b;
        background: rgba(245, 158, 11, 0.15);
      }

      .panel-btn-cook.disabled {
        opacity: 0.7;
        pointer-events: none;
      }

      .panel-btn-cook.error {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.15);
        color: #fca5a5;
      }

      .cook-btn-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
      }

      .cook-btn-left {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .cook-icon {
        font-size: 13px;
        line-height: 1;
      }

      .cook-label {
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .cook-provider-badge {
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        background: #4f46e5;
        color: #ffffff;
        letter-spacing: 0.04em;
      }

      .cook-badge-setup {
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        background: #d97706;
        color: #ffffff;
        letter-spacing: 0.04em;
      }

      .cook-subtext {
        font-size: 10px;
        color: #a5b4fc;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .cook-subtext-warn {
        color: #fcd34d;
      }

      /* Cook Setup Guide */
      .cook-setup-guide {
        margin-top: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        background: #18181b;
        border: 1px solid #3f3f46;
        font-size: 11px;
        color: #d4d4d8;
        display: flex;
        flex-direction: column;
        gap: 8px;
        animation: fadeIn 150ms ease;
      }

      .cook-guide-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: 600;
        color: #fafafa;
      }

      .cook-guide-close {
        background: transparent;
        border: none;
        color: #a1a1aa;
        font-size: 16px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
      }

      .cook-guide-close:hover {
        color: #fff;
      }

      .cook-guide-steps {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .cook-step {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        line-height: 1.35;
      }

      .step-num {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #3b82f6;
        color: #fff;
        font-size: 9.5px;
        font-weight: 700;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .cook-guide-tip {
        font-size: 10px;
        color: #94a3b8;
        border-top: 1px solid #27272a;
        padding-top: 6px;
        line-height: 1.3;
      }

      /* Cook Preview Overlay */
      .cook-preview-overlay {
        position: absolute;
        inset: 0;
        background: rgba(9, 9, 11, 0.95);
        backdrop-filter: blur(8px);
        border-radius: 12px;
        z-index: 100;
        display: flex;
        flex-direction: column;
        padding: 14px;
        animation: fadeIn 140ms ease;
        box-sizing: border-box;
        overflow-y: auto;
      }

      .cook-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }

      .cook-preview-title {
        font-size: 13px;
        font-weight: 700;
        color: #f4f4f5;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .cook-preview-section {
        margin-bottom: 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .cook-preview-label {
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #a1a1aa;
        text-transform: uppercase;
      }

      .cook-preview-box {
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 11.5px;
        line-height: 1.45;
      }

      .cook-preview-original {
        background: #18181b;
        border: 1px solid #27272a;
        color: #a1a1aa;
        max-height: 65px;
        overflow-y: auto;
      }

      .cook-preview-textarea {
        background: #18181b;
        border: 1px solid #4f46e5;
        color: #f4f4f5;
        width: 100%;
        min-height: 95px;
        max-height: 130px;
        resize: vertical;
        border-radius: 6px;
        padding: 8px 10px;
        font-family: inherit;
        font-size: 11.5px;
        line-height: 1.45;
        box-sizing: border-box;
      }

      .cook-preview-textarea:focus {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
      }

      .cook-preview-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: auto;
        padding-top: 6px;
      }

      .cook-preview-btn-replace {
        width: 100%;
        padding: 8px 12px;
        border-radius: 6px;
        background: #2563eb;
        color: #fff;
        border: 1px solid #3b82f6;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 120ms ease;
      }

      .cook-preview-btn-replace:hover {
        background: #1d4ed8;
      }

      .cook-preview-btn-row {
        display: flex;
        gap: 6px;
      }

      .cook-preview-btn-copy,
      .cook-preview-btn-cancel {
        flex: 1;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid #3f3f46;
        background: #27272a;
        color: #d4d4d8;
        transition: all 120ms ease;
      }

      .cook-preview-btn-copy:hover,
      .cook-preview-btn-cancel:hover {
        background: #3f3f46;
        color: #fff;
      }

      .btn-icon {
        flex-shrink: 0;
      }

      .panel-subtext {
        font-size: 10.5px;
        color: #71717a;
        margin-top: 6px;
        line-height: 1.35;
      }

      .panel-divider {
        height: 1px;
        background: #222226;
        margin: 0;
      }

      /* Drop format section: text on top, 3 proportional buttons */
      .drop-format-section {
        padding: 8px 14px 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .drop-format-title {
        font-size: 10px;
        font-weight: 600;
        color: #71717a;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .drop-format-group {
        display: flex;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        background: #18181c;
        padding: 4px;
        border-radius: 8px;
        border: 1px solid #27272a;
      }

      .drop-format-btn {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        padding: 7px 6px;
        font-size: 11.5px;
        font-weight: 500;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: #a1a1aa;
        cursor: pointer;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: all 120ms ease;
      }

      .drop-format-btn:hover {
        color: #f4f4f5;
        background: rgba(255, 255, 255, 0.06);
      }

      .drop-format-btn.active {
        background: #2563eb;
        border-color: #3b82f6;
        color: #ffffff;
        font-weight: 600;
        box-shadow: 0 1px 4px rgba(37, 99, 235, 0.3);
      }

      .drop-format-hint {
        font-size: 10px;
        color: #71717a;
        line-height: 1.35;
        padding: 2px 2px 0 2px;
      }

      /* Saved contexts section below Drop Format */
      .saved-contexts-section,
      .drop-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        padding: 10px 14px 12px 14px;
      }

      .panel-label-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .panel-label {
        font-size: 10px;
        font-weight: 600;
        color: #71717a;
        letter-spacing: 0.05em;
      }

      .panel-count {
        font-size: 10px;
        color: #52525b;
      }

      .panel-search-wrapper {
        margin-bottom: 8px;
      }

      .panel-search-input {
        width: 100%;
        padding: 5px 8px;
        font-size: 11px;
        background: #1c1c20;
        border: 1px solid #27272a;
        border-radius: 5px;
        color: #e4e4e7;
        outline: none;
        transition: border-color 120ms ease;
      }

      .panel-search-input:focus {
        border-color: #3b82f6;
      }

      .context-list-container {
        flex: 1;
        overflow-y: auto;
        max-height: 200px;
      }

      .context-list-container::-webkit-scrollbar {
        width: 4px;
      }

      .context-list-container::-webkit-scrollbar-thumb {
        background: #27272a;
        border-radius: 2px;
      }

      .panel-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .panel-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        background: #18181c;
        border: 1px solid #222226;
        transition: all 120ms ease;
      }

      .panel-item.draggable-item {
        cursor: grab;
      }

      .panel-item.draggable-item:active {
        cursor: grabbing;
      }

      .panel-item.is-dragging {
        opacity: 0.45;
        border-style: dashed;
        border-color: #4a9eff;
      }

      .panel-drag-grip {
        display: flex;
        align-items: center;
        color: #52525b;
        cursor: grab;
        flex-shrink: 0;
        transition: color 120ms ease;
      }

      .panel-item:hover .panel-drag-grip {
        color: #a1a1aa;
      }

      .panel-drag-hint {
        margin-top: 8px;
        padding: 5px 8px;
        border-radius: 5px;
        background: rgba(74, 158, 255, 0.07);
        border: 1px solid rgba(74, 158, 255, 0.18);
        text-align: center;
        color: #93c5fd;
        font-size: 10px;
        line-height: 1.3;
      }

      .panel-item:hover {
        background: #202026;
        border-color: #2e2e36;
      }

      .panel-item-info {
        flex: 1;
        min-width: 0;
      }

      .panel-item-name {
        font-size: 11.5px;
        font-weight: 500;
        color: #e4e4e7;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .panel-item-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
      }

      .panel-badge {
        font-size: 9.5px;
        font-weight: 500;
        color: #60a5fa;
        background: rgba(59, 130, 246, 0.12);
        padding: 0 4px;
        border-radius: 3px;
        text-transform: capitalize;
      }

      .panel-time {
        font-size: 9.5px;
        color: #71717a;
      }

      .panel-turns {
        font-size: 9.5px;
        color: #52525b;
      }

      .panel-item-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }

      .panel-btn-sm {
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 500;
        border: 1px solid #333338;
        border-radius: 4px;
        background: #222228;
        color: #a1a1aa;
        cursor: pointer;
        transition: all 120ms ease;
        white-space: nowrap;
      }

      .panel-btn-sm:hover {
        background: #2a2a32;
        border-color: #3b82f6;
        color: #ffffff;
      }

      .panel-btn-sm-primary {
        background: rgba(59, 130, 246, 0.15);
        border-color: rgba(59, 130, 246, 0.4);
        color: #93c5fd;
        font-weight: 600;
      }

      .panel-btn-sm-primary:hover {
        background: #2563eb;
        border-color: #2563eb;
        color: #ffffff;
      }

      .panel-btn-sm.disabled {
        opacity: 0.5;
        pointer-events: none;
      }

      .panel-btn-sm.success {
        border-color: #22c55e;
        color: #22c55e;
        background: rgba(34, 197, 94, 0.1);
      }

      .panel-btn-sm.error {
        border-color: #ef4444;
        color: #ef4444;
        background: rgba(239, 68, 68, 0.1);
      }

      .panel-empty {
        font-size: 11px;
        color: #71717a;
        text-align: center;
        padding: 18px 10px;
        line-height: 1.4;
      }

      .panel-more {
        font-size: 10.5px;
        color: #52525b;
        text-align: center;
        padding: 6px 0 2px;
      }

      .spinner {
        width: 12px;
        height: 12px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: spin 600ms linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* Light mode styles */
      .continu-icon.theme-light,
      :host(.theme-light) .continu-icon {
        border: 1px solid #cbd5e1;
        background: rgba(255, 255, 255, 0.95);
        color: #475569;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      }

      .continu-icon.theme-light:hover,
      :host(.theme-light) .continu-icon:hover {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #3b82f6;
      }

      .continu-icon.theme-light.active,
      :host(.theme-light) .continu-icon.active {
        background: #eff6ff;
        color: #2563eb;
        border-color: #2563eb;
        box-shadow: 0 0 8px rgba(37, 99, 235, 0.25);
      }

      .continu-panel.theme-light,
      :host(.theme-light) .continu-panel {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
      }

      .continu-panel.theme-light .panel-header,
      :host(.theme-light) .panel-header {
        border-bottom: 1px solid #e2e8f0;
        background: #f8fafc;
      }

      .continu-panel.theme-light .panel-title,
      :host(.theme-light) .panel-title {
        color: #0f172a;
      }

      .continu-panel.theme-light .panel-platform-badge,
      :host(.theme-light) .panel-platform-badge {
        color: #475569;
        background: #e2e8f0;
      }

      .continu-panel.theme-light .panel-theme-toggle,
      :host(.theme-light) .panel-theme-toggle {
        color: #64748b;
      }

      .continu-panel.theme-light .panel-theme-toggle:hover,
      :host(.theme-light) .panel-theme-toggle:hover {
        background: #e2e8f0;
        color: #0f172a;
      }

      .continu-panel.theme-light .panel-close,
      :host(.theme-light) .panel-close {
        color: #64748b;
      }

      .continu-panel.theme-light .panel-close:hover,
      :host(.theme-light) .panel-close:hover {
        background: #e2e8f0;
        color: #0f172a;
      }

      .continu-panel.theme-light .generate-section,
      :host(.theme-light) .generate-section {
        background: #ffffff;
      }

      .continu-panel.theme-light .panel-btn-cook,
      :host(.theme-light) .panel-btn-cook {
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%);
        border: 1px solid #8b5cf6;
        color: #4338ca;
        box-shadow: 0 1px 4px rgba(124, 58, 237, 0.08);
      }

      .continu-panel.theme-light .panel-btn-cook:hover,
      :host(.theme-light) .panel-btn-cook:hover {
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.15) 0%, rgba(99, 102, 241, 0.08) 100%);
        border-color: #7c3aed;
        box-shadow: 0 2px 8px rgba(124, 58, 237, 0.15);
      }

      .continu-panel.theme-light .panel-btn-cook.unconfigured,
      :host(.theme-light) .panel-btn-cook.unconfigured {
        background: #fffbeb;
        border: 1px dashed #d97706;
        color: #b45309;
      }

      .continu-panel.theme-light .cook-subtext,
      :host(.theme-light) .cook-subtext {
        color: #6366f1;
      }

      .continu-panel.theme-light .cook-subtext-warn,
      :host(.theme-light) .cook-subtext-warn {
        color: #b45309;
      }

      .continu-panel.theme-light .cook-setup-guide,
      :host(.theme-light) .cook-setup-guide {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        color: #1e293b;
      }

      .continu-panel.theme-light .cook-guide-header,
      :host(.theme-light) .cook-guide-header {
        color: #0f172a;
      }

      .continu-panel.theme-light .cook-guide-close,
      :host(.theme-light) .cook-guide-close {
        color: #64748b;
      }

      .continu-panel.theme-light .cook-guide-tip,
      :host(.theme-light) .cook-guide-tip {
        border-top: 1px solid #e2e8f0;
        color: #64748b;
      }

      .continu-panel.theme-light .cook-preview-overlay,
      :host(.theme-light) .cook-preview-overlay {
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid #e2e8f0;
      }

      .continu-panel.theme-light .cook-preview-title,
      :host(.theme-light) .cook-preview-title {
        color: #0f172a;
      }

      .continu-panel.theme-light .cook-preview-original,
      :host(.theme-light) .cook-preview-original {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #475569;
      }

      .continu-panel.theme-light .cook-preview-textarea,
      :host(.theme-light) .cook-preview-textarea {
        background: #ffffff;
        border: 1px solid #8b5cf6;
        color: #0f172a;
      }

      .continu-panel.theme-light .cook-preview-btn-copy,
      .continu-panel.theme-light .cook-preview-btn-cancel,
      :host(.theme-light) .cook-preview-btn-copy,
      :host(.theme-light) .cook-preview-btn-cancel {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #334155;
      }

      .continu-panel.theme-light .cook-preview-btn-copy:hover,
      .continu-panel.theme-light .cook-preview-btn-cancel:hover,
      :host(.theme-light) .cook-preview-btn-copy:hover,
      :host(.theme-light) .cook-preview-btn-cancel:hover {
        background: #e2e8f0;
        color: #0f172a;
      }

      .continu-panel.theme-light .panel-subtext,
      :host(.theme-light) .panel-subtext {
        color: #64748b;
      }

      .continu-panel.theme-light .panel-divider,
      :host(.theme-light) .panel-divider {
        background: #e2e8f0;
      }

      .continu-panel.theme-light .panel-label,
      :host(.theme-light) .panel-label {
        color: #64748b;
      }

      .continu-panel.theme-light .panel-count,
      :host(.theme-light) .panel-count {
        color: #94a3b8;
      }

      .continu-panel.theme-light .drop-format-title,
      :host(.theme-light) .drop-format-title {
        color: #64748b;
      }

      .continu-panel.theme-light .drop-format-group,
      :host(.theme-light) .drop-format-group {
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
      }

      .continu-panel.theme-light .drop-format-btn,
      :host(.theme-light) .drop-format-btn {
        color: #64748b;
      }

      .continu-panel.theme-light .drop-format-btn:hover,
      :host(.theme-light) .drop-format-btn:hover {
        color: #0f172a;
        background: rgba(0, 0, 0, 0.04);
      }

      .continu-panel.theme-light .drop-format-btn.active,
      :host(.theme-light) .drop-format-btn.active {
        background: #2563eb;
        border-color: #2563eb;
        color: #ffffff;
      }

      .continu-panel.theme-light .drop-format-hint,
      :host(.theme-light) .drop-format-hint {
        color: #64748b;
      }

      .continu-panel.theme-light .panel-search-input,
      :host(.theme-light) .panel-search-input {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        color: #0f172a;
      }

      .continu-panel.theme-light .context-list-container::-webkit-scrollbar-thumb,
      :host(.theme-light) .context-list-container::-webkit-scrollbar-thumb {
        background: #cbd5e1;
      }

      .continu-panel.theme-light .panel-item,
      :host(.theme-light) .panel-item {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }

      .continu-panel.theme-light .panel-item:hover,
      :host(.theme-light) .panel-item:hover {
        background: #f1f5f9;
        border-color: #cbd5e1;
      }

      .continu-panel.theme-light .panel-drag-grip,
      :host(.theme-light) .panel-drag-grip {
        color: #94a3b8;
      }

      .continu-panel.theme-light .panel-item:hover .panel-drag-grip,
      :host(.theme-light) .panel-item:hover .panel-drag-grip {
        color: #475569;
      }

      .continu-panel.theme-light .panel-drag-hint,
      :host(.theme-light) .panel-drag-hint {
        background: rgba(37, 99, 235, 0.06);
        border: 1px solid rgba(37, 99, 235, 0.15);
        color: #2563eb;
      }

      .continu-panel.theme-light .panel-item-name,
      :host(.theme-light) .panel-item-name {
        color: #0f172a;
      }

      .continu-panel.theme-light .panel-badge,
      :host(.theme-light) .panel-badge {
        color: #2563eb;
        background: rgba(37, 99, 235, 0.1);
      }

      .continu-panel.theme-light .panel-time,
      :host(.theme-light) .panel-time {
        color: #64748b;
      }

      .continu-panel.theme-light .panel-turns,
      :host(.theme-light) .panel-turns {
        color: #94a3b8;
      }

      .continu-panel.theme-light .panel-btn-sm,
      :host(.theme-light) .panel-btn-sm {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #475569;
      }

      .continu-panel.theme-light .panel-btn-sm:hover,
      :host(.theme-light) .panel-btn-sm:hover {
        background: #f1f5f9;
        border-color: #2563eb;
        color: #0f172a;
      }

      .continu-panel.theme-light .panel-btn-sm-primary,
      :host(.theme-light) .panel-btn-sm-primary {
        background: rgba(37, 99, 235, 0.1);
        border-color: rgba(37, 99, 235, 0.35);
        color: #2563eb;
      }

      .continu-panel.theme-light .panel-btn-sm-primary:hover,
      :host(.theme-light) .panel-btn-sm-primary:hover {
        background: #2563eb;
        border-color: #2563eb;
        color: #ffffff;
      }

      .continu-panel.theme-light .panel-empty,
      :host(.theme-light) .panel-empty {
        color: #64748b;
      }

      .continu-panel.theme-light .panel-more,
      :host(.theme-light) .panel-more {
        color: #94a3b8;
      }
    `;
  }

  private getBadgeStyles(): string {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
      }

      .continu-armed-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #18181c;
        border: 1px solid rgba(74, 158, 255, 0.45);
        border-radius: 8px;
        padding: 5px 10px;
        font-size: 11px;
        color: #e4e4e7;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(74, 158, 255, 0.2);
        pointer-events: auto;
        backdrop-filter: blur(8px);
        animation: badgeIn 150ms ease-out forwards;
      }

      .continu-armed-badge .badge-icon {
        display: flex;
        align-items: center;
        color: #4a9eff;
      }

      .continu-armed-badge .badge-label {
        color: #71717a;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.5px;
      }

      .continu-armed-badge .badge-title {
        color: #f4f4f5;
        font-weight: 500;
        max-width: 220px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .continu-armed-badge .badge-close {
        background: transparent;
        border: none;
        color: #71717a;
        cursor: pointer;
        padding: 2px 4px;
        margin-left: 2px;
        font-size: 11px;
        line-height: 1;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 120ms ease;
      }

      .continu-armed-badge .badge-close:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.15);
      }

      .continu-armed-badge.theme-light,
      :host(.theme-light) .continu-armed-badge {
        background: #ffffff;
        border: 1px solid rgba(37, 99, 235, 0.45);
        color: #0f172a;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(37, 99, 235, 0.2);
      }

      .continu-armed-badge.theme-light .badge-icon,
      :host(.theme-light) .continu-armed-badge .badge-icon {
        color: #2563eb;
      }

      .continu-armed-badge.theme-light .badge-label,
      :host(.theme-light) .continu-armed-badge .badge-label {
        color: #64748b;
      }

      .continu-armed-badge.theme-light .badge-title,
      :host(.theme-light) .continu-armed-badge .badge-title {
        color: #0f172a;
      }

      .continu-armed-badge.theme-light .badge-close,
      :host(.theme-light) .continu-armed-badge .badge-close {
        color: #64748b;
      }

      .continu-armed-badge.theme-light .badge-close:hover,
      :host(.theme-light) .continu-armed-badge .badge-close:hover {
        color: #0f172a;
        background: rgba(0, 0, 0, 0.08);
      }

      @keyframes badgeIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
  }
}
