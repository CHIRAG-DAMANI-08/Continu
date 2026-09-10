import { AdapterManager } from '../src/adapters/manager';
import { UniversalAIAdapter, isAIChatPage } from '../src/adapters/universal';
import { MessageType } from '../src/security/messaging';
import { ComposerIcon } from '../src/content/composer-icon';
import { extractPageChatTitle, dropContextToChat } from '../src/adapters/utils';
import type { AIAdapter } from '../src/adapters/base';


export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // Proactive safety cleanup: restore any elements accidentally hidden by legacy builds
    try {
      const oldStyle = document.getElementById('continu-hidden-transfer-style');
      if (oldStyle) oldStyle.remove();

      document.querySelectorAll('[data-continu-hidden]').forEach(el => {
        el.removeAttribute('data-continu-hidden');
        el.classList.remove('continu-hidden-turn');
        if (el instanceof HTMLElement) {
          el.style.removeProperty('display');
          el.style.removeProperty('visibility');
          el.style.removeProperty('height');
          el.style.removeProperty('min-height');
          el.style.removeProperty('max-height');
          el.style.removeProperty('margin');
          el.style.removeProperty('padding');
          el.style.removeProperty('overflow');
          el.style.removeProperty('opacity');
          el.style.removeProperty('pointer-events');
        }
      });
    } catch {}

    const manager = new AdapterManager();
    // Register single universal AI adapter that dynamically detects and adapts to ANY AI chat app
    manager.register(new UniversalAIAdapter());

    let activeIcon: ComposerIcon | null = null;

    // Handle messages from popup and background
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') {
        return false;
      }

      switch (message.type) {
        case MessageType.DETECT_ADAPTER: {
          const adapter = manager.detect();
          sendResponse({
            adapter: adapter?.name || null,
            platform: adapter?.name || null,
          });
          return false;
        }

        case MessageType.FIND_COMPOSER: {
          const adapter = manager.detect();
          const composer = adapter?.findComposer();
          sendResponse({ found: !!composer });
          return false;
        }

        case MessageType.INSERT_TEXT: {
          const adapter = manager.detect();
          if (adapter && message.text) {
            adapter.insertText(message.text);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No adapter or text provided' });
          }
          return false;
        }

        case MessageType.SUBMIT_TEXT: {
          const adapter = manager.detect();
          if (adapter && message.text) {
            adapter.submitText(message.text)
              .then(success => sendResponse({ success }))
              .catch((err: Error) => sendResponse({ success: false, error: err.message }));
            return true; // asynchronous response
          }
          sendResponse({ success: false, error: 'No adapter or text provided' });
          return false;
        }

        case MessageType.EXTRACT_CONVERSATION: {
          const adapter = manager.detect();
          if (adapter) {
            const conversation = adapter.extractConversation();
            sendResponse({ success: true, conversation });
          } else {
            sendResponse({ success: false, error: 'No adapter found' });
          }
          return false;
        }

        case MessageType.GET_PAGE_INFO: {
          const adapter = manager.detect();
          const composer = adapter?.findComposer();
          const realTitle = extractPageChatTitle(adapter?.name || '');
          const draftText = adapter && typeof (adapter as any).getComposerText === 'function'
            ? (adapter as any).getComposerText()
            : '';
          sendResponse({
            url: window.location.href,
            title: realTitle || document.title,
            adapter: adapter?.name || null,
            composerFound: !!composer,
            draftText,
          });
          return false;
        }


        case MessageType.ARM_CONTEXT: {
          const adapter = manager.detect();
          if (adapter && message.context) {
            if (!activeIcon) {
              activeIcon = new ComposerIcon(adapter);
              activeIcon.init();
            }
            activeIcon.armContext(message.context);
            sendResponse({ success: true, armed: true });
            return false;
          }
          sendResponse({ success: false, error: 'No adapter or context provided' });
          return false;
        }

        case MessageType.DISARM_CONTEXT: {
          if (activeIcon) {
            activeIcon.disarmContext();
            sendResponse({ success: true, disarmed: true });
          } else {
            sendResponse({ success: true, disarmed: false });
          }
          return false;
        }

        case MessageType.DROP_CONTEXT: {
          const adapter = manager.detect();
          if (adapter && message.context) {
            if (message.format === 'hidden') {
              if (!activeIcon) {
                activeIcon = new ComposerIcon(adapter);
                activeIcon.init();
              }
              activeIcon.armContext(message.context);
              sendResponse({ success: true, armed: true });
              return false;
            }
            dropContextToChat(adapter, message.context, message.format || 'structured')
              .then(success => sendResponse({ success }))
              .catch((err: Error) => sendResponse({ success: false, error: err.message }));
            return true;
          }
          sendResponse({ success: false, error: 'No adapter or context provided' });
          return false;
        }

        default:
          return false;
      }
    });

    // Helper to determine if current page is an AI application using dynamic detection
    function isAIChatApp(adapter: AIAdapter | null): boolean {
      if (!adapter) return false;
      return isAIChatPage() || adapter.detect();
    }


    function setupComposerIcon() {
      const adapter = manager.detect();
      if (adapter && isAIChatApp(adapter)) {
        if (!activeIcon) {
          activeIcon = new ComposerIcon(adapter);
          activeIcon.init();
        }
      } else if (activeIcon) {
        activeIcon.destroy();
        activeIcon = null;
      }
    }

    // Initialize inline composer icon
    setupComposerIcon();

    // Re-check on URL / SPA navigation changes (debounced to avoid performance cost on streaming)
    let lastUrl = window.location.href;
    let navDebounce: number | null = null;
    const checkNav = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setupComposerIcon();
      }
    };

    window.addEventListener('popstate', checkNav);
    window.addEventListener('hashchange', checkNav);

    const navObserver = new MutationObserver(() => {
      if (navDebounce !== null) return;
      navDebounce = window.setTimeout(() => {
        navDebounce = null;
        checkNav();
      }, 400);
    });

    const rootTarget = document.documentElement || document.body || document;
    navObserver.observe(rootTarget, { subtree: true, childList: true });
  },
});