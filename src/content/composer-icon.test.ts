// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComposerIcon } from './composer-icon';
import type { AIAdapter } from '../adapters/base';

// Mock chrome runtime and storage
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({ success: true, contexts: [] }),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
});

// Helper to mock getBoundingClientRect
function mockRect(el: HTMLElement, rect: { top: number; left: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
}

describe('ComposerIcon Toolbar Clustering & Placement', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.getElementById('continu-composer-host')?.remove();
    vi.clearAllMocks();
  });

  it('correctly places Continu icon before Model selector on ChatGPT layout (Continu -> Model -> Mic -> Audio)', () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <div id="prompt-textarea" role="textbox" contenteditable="true"></div>
        <div class="bottom-toolbar">
          <!-- Left tools -->
          <button class="btn-attach" aria-label="Attach files">+</button>
          <button class="btn-search">Search</button>
          <button class="btn-work">Work</button>
          <!-- Right tools -->
          <button class="btn-model" aria-haspopup="menu">Model</button>
          <button class="btn-mic" data-testid="composer-speech-button" aria-label="Dictate"></button>
          <button class="btn-audio" data-testid="voice-mode-button" aria-label="Voice mode"></button>
        </div>
      </form>
    `;

    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLElement;
    const btnAttach = container.querySelector('.btn-attach') as HTMLElement;
    const btnSearch = container.querySelector('.btn-search') as HTMLElement;
    const btnWork = container.querySelector('.btn-work') as HTMLElement;
    const btnModel = container.querySelector('.btn-model') as HTMLElement;
    const btnMic = container.querySelector('.btn-mic') as HTMLElement;
    const btnAudio = container.querySelector('.btn-audio') as HTMLElement;

    // Set geometries matching modern ChatGPT chatbox (width 800, height 120, top 500)
    mockRect(form, { top: 500, left: 100, width: 800, height: 120 });
    mockRect(composer, { top: 510, left: 120, width: 760, height: 40 });

    // Toolbar row at bottom: top = 570, bottom = 602, height = 32
    mockRect(btnAttach, { top: 570, left: 120, width: 32, height: 32 });
    mockRect(btnSearch, { top: 570, left: 160, width: 70, height: 32 });
    mockRect(btnWork, { top: 570, left: 240, width: 60, height: 32 });

    // Right tools: Model -> Mic -> Audio talking
    mockRect(btnModel, { top: 570, left: 680, width: 65, height: 32 });
    mockRect(btnMic, { top: 570, left: 755, width: 32, height: 32 });
    mockRect(btnAudio, { top: 570, left: 795, width: 36, height: 36 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => null, // empty composer state: no submit button
      findAttachButton: () => btnAttach,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    const host = document.getElementById('continu-composer-host');
    expect(host).not.toBeNull();
    expect(host?.style.display).toBe('block');

    // Continu icon size is min(32, max(26, 32)) = 32
    // Continu icon must be positioned immediately to the left of btnModel:
    // iconLeft = btnModel.left (680) - iconSize (32) - 8 = 640px
    const hostLeft = parseInt(host?.style.left || '0', 10);
    const hostTop = parseInt(host?.style.top || '0', 10);

    expect(hostLeft).toBe(640);
    expect(hostTop).toBe(570); // aligned with btnModel.top

    iconManager.destroy();
  });

  it('places Continu icon before Model selector on Claude layout (Continu -> Model -> Send)', () => {
    container.innerHTML = `
      <div class="composer-container">
        <div class="editable" contenteditable="true"></div>
        <div class="toolbar">
          <button class="attach-btn">+</button>
          <button class="model-dropdown" aria-haspopup="listbox">Claude 3.7 Sonnet</button>
          <button class="send-btn" aria-label="Send message"></button>
        </div>
      </div>
    `;

    const card = container.querySelector('.composer-container') as HTMLElement;
    const composer = container.querySelector('.editable') as HTMLElement;
    const btnAttach = container.querySelector('.attach-btn') as HTMLElement;
    const btnModel = container.querySelector('.model-dropdown') as HTMLElement;
    const btnSend = container.querySelector('.send-btn') as HTMLElement;

    mockRect(card, { top: 400, left: 200, width: 700, height: 100 });
    mockRect(composer, { top: 410, left: 210, width: 680, height: 35 });

    mockRect(btnAttach, { top: 455, left: 210, width: 28, height: 28 });
    mockRect(btnModel, { top: 455, left: 720, width: 110, height: 28 });
    mockRect(btnSend, { top: 455, left: 840, width: 28, height: 28 });

    const adapter: AIAdapter = {
      name: 'claude',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => btnAttach,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    const host = document.getElementById('continu-composer-host');
    expect(host).not.toBeNull();

    // btnModel is at left 720, height 28 -> iconSize 28
    // iconLeft = 720 - 28 - 8 = 684
    const hostLeft = parseInt(host?.style.left || '0', 10);
    expect(hostLeft).toBe(684);

    iconManager.destroy();
  });

  it('places Continu icon before Mic on Gemini layout (Continu -> Mic -> Send)', () => {
    container.innerHTML = `
      <div class="input-area">
        <textarea class="ql-editor"></textarea>
        <div class="actions">
          <button class="tools-btn">Tools</button>
          <button class="mic-btn" aria-label="Voice input"></button>
          <button class="send-btn" aria-label="Send"></button>
        </div>
      </div>
    `;

    const card = container.querySelector('.input-area') as HTMLElement;
    const composer = container.querySelector('.ql-editor') as HTMLElement;
    const btnTools = container.querySelector('.tools-btn') as HTMLElement;
    const btnMic = container.querySelector('.mic-btn') as HTMLElement;
    const btnSend = container.querySelector('.send-btn') as HTMLElement;

    mockRect(card, { top: 600, left: 150, width: 750, height: 90 });
    mockRect(composer, { top: 605, left: 160, width: 730, height: 35 });

    mockRect(btnTools, { top: 650, left: 160, width: 50, height: 30 });
    mockRect(btnMic, { top: 650, left: 810, width: 30, height: 30 });
    mockRect(btnSend, { top: 650, left: 850, width: 30, height: 30 });

    const adapter: AIAdapter = {
      name: 'gemini',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    const host = document.getElementById('continu-composer-host');
    expect(host).not.toBeNull();

    // Leftmost of right cluster is btnMic at 810, height 30 -> iconSize 30
    // iconLeft = 810 - 30 - 8 = 772
    const hostLeft = parseInt(host?.style.left || '0', 10);
    expect(hostLeft).toBe(772);

    iconManager.destroy();
  });

  it('places Continu icon before Send button on generic layout with single submit button', () => {
    container.innerHTML = `
      <form class="custom-chatbox">
        <textarea class="chat-input"></textarea>
        <button type="submit" class="submit-btn" aria-label="Send message">Send</button>
      </form>
    `;

    const form = container.querySelector('form')!;
    const composer = container.querySelector('.chat-input') as HTMLElement;
    const btnSubmit = container.querySelector('.submit-btn') as HTMLElement;

    mockRect(form, { top: 300, left: 100, width: 600, height: 100 });
    mockRect(composer, { top: 305, left: 110, width: 580, height: 45 });
    mockRect(btnSubmit, { top: 360, left: 630, width: 50, height: 30 });

    const adapter: AIAdapter = {
      name: 'generic',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSubmit,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    const host = document.getElementById('continu-composer-host');
    expect(host).not.toBeNull();

    // btnSubmit at left 630, height 30 -> iconSize 30
    // iconLeft = 630 - 30 - 8 = 592
    const hostLeft = parseInt(host?.style.left || '0', 10);
    expect(hostLeft).toBe(592);

    iconManager.destroy();
  });

  it('handles modern ChatGPT layout where <form> wraps ONLY the textarea and toolbar is an external sibling', () => {
    container.innerHTML = `
      <div class="chatbox-wrapper">
        <form class="textarea-form">
          <div id="prompt-textarea" role="textbox" contenteditable="true"></div>
        </form>
        <div class="bottom-toolbar">
          <button class="btn-attach">+</button>
          <button class="btn-search">Search</button>
          <button class="btn-model" aria-haspopup="menu">Model ∨</button>
          <button class="btn-mic" data-testid="composer-speech-button" aria-label="Dictate"></button>
          <button class="btn-audio" data-testid="voice-mode-button" aria-label="Voice mode"></button>
        </div>
      </div>
    `;

    const wrapper = container.querySelector('.chatbox-wrapper') as HTMLElement;
    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLElement;
    const btnAttach = container.querySelector('.btn-attach') as HTMLElement;
    const btnSearch = container.querySelector('.btn-search') as HTMLElement;
    const btnModel = container.querySelector('.btn-model') as HTMLElement;
    const btnMic = container.querySelector('.btn-mic') as HTMLElement;
    const btnAudio = container.querySelector('.btn-audio') as HTMLElement;

    // Form wraps only the textarea (0 buttons inside form!)
    mockRect(wrapper, { top: 500, left: 100, width: 800, height: 120 });
    mockRect(form, { top: 500, left: 100, width: 800, height: 50 });
    mockRect(composer, { top: 505, left: 110, width: 780, height: 40 });

    mockRect(btnAttach, { top: 570, left: 120, width: 32, height: 32 });
    mockRect(btnSearch, { top: 570, left: 160, width: 70, height: 32 });
    mockRect(btnModel, { top: 570, left: 680, width: 65, height: 32 });
    mockRect(btnMic, { top: 570, left: 755, width: 32, height: 32 });
    mockRect(btnAudio, { top: 570, left: 795, width: 36, height: 36 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => null,
      findAttachButton: () => btnAttach,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    const host = document.getElementById('continu-composer-host');
    expect(host).not.toBeNull();
    expect(host?.style.display).toBe('block');

    // Continu icon must ascend to wrapper, find btnModel at left 680, and position at 680 - 32 - 8 = 640
    const hostLeft = parseInt(host?.style.left || '0', 10);
    const hostTop = parseInt(host?.style.top || '0', 10);

    expect(hostLeft).toBe(640);
    expect(hostTop).toBe(570);

    iconManager.destroy();
  });

  it('arms context cleanly via Attach button and bundles context with prompt on Enter (COA 1)', async () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <textarea id="prompt-textarea"></textarea>
        <button class="btn-model">Model</button>
        <button class="btn-send" type="submit">Send</button>
      </form>
    `;

    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const btnModel = container.querySelector('.btn-model') as HTMLElement;
    const btnSend = container.querySelector('.btn-send') as HTMLElement;

    mockRect(form, { top: 500, left: 100, width: 800, height: 100 });
    mockRect(composer, { top: 510, left: 110, width: 780, height: 40 });
    mockRect(btnModel, { top: 560, left: 650, width: 60, height: 30 });
    mockRect(btnSend, { top: 560, left: 720, width: 50, height: 30 });

    let insertedContent = '';

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      getComposerText: () => composer.value,
      insertText: (t: string) => {
        insertedContent = t;
        composer.value = t;
      },
      submitText: async () => false,
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    // Mock loadContexts in iconManager
    vi.spyOn(iconManager as any, 'loadContexts').mockResolvedValue([
      {
        id: 'ctx-test-1',
        name: 'Architecture Decisions',
        objective: 'Refactor auth layer to JWT',
        source: { url: 'https://chatgpt.com', title: 'Auth Chat', platform: 'chatgpt' },
        decisions: ['Use JWT cookies'],
        createdAt: '2026-09-08T12:00:00Z',
        conversation: [],
      },
    ]);

    // Open panel
    await (iconManager as any).openPanel();

    const shadow = (iconManager as any).shadow as ShadowRoot;
    expect(shadow).not.toBeNull();

    // Find the primary action button (default format is 'hidden', so button is 'Attach')
    const actionBtn = shadow.querySelector('.panel-btn-sm-primary') as HTMLButtonElement;
    expect(actionBtn).not.toBeNull();
    expect(actionBtn.textContent).toBe('Attach');

    // Click Attach with default format:
    // It should arm the context badge and keep composer clean
    await actionBtn.click();
    expect(insertedContent).toBe(''); // Textbox is left clean (not pasted into)
    expect(iconManager.getArmedContext()).not.toBeNull();
    expect(iconManager.getArmedContext()?.name).toBe('Architecture Decisions');

    // User types their question into the composer
    composer.value = 'How do we store the refresh token safely?';

    // User hits Enter in the chat
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    // Bundling guarantee: Context reference + User's question are bundled together on submission
    expect(insertedContent).toContain('[Reference Context: Architecture Decisions]');
    expect(insertedContent).toContain('Refactor auth layer to JWT');
    expect(insertedContent).toContain('How do we store the refresh token safely?');

    // Disarmed immediately after submission
    expect(iconManager.getArmedContext()).toBeNull();

    iconManager.destroy();
  });

  it('correctly places Continu before Think icon on ChatGPT layout with Think button (Continu -> Think -> Model -> Mic -> Audio)', () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <div id="prompt-textarea" role="textbox" contenteditable="true"></div>
        <div class="bottom-toolbar">
          <button class="btn-attach" aria-label="Attach files">+</button>
          <button class="btn-search">Search</button>
          <!-- Think icon before Model -->
          <button class="btn-think" aria-label="Think" data-testid="think-button">Think</button>
          <button class="btn-model" aria-haspopup="menu">Model</button>
          <button class="btn-mic" data-testid="composer-speech-button" aria-label="Dictate"></button>
          <button class="btn-audio" data-testid="voice-mode-button" aria-label="Voice mode"></button>
        </div>
      </form>
    `;

    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLElement;
    const btnAttach = container.querySelector('.btn-attach') as HTMLElement;
    const btnSearch = container.querySelector('.btn-search') as HTMLElement;
    const btnThink = container.querySelector('.btn-think') as HTMLElement;
    const btnModel = container.querySelector('.btn-model') as HTMLElement;
    const btnMic = container.querySelector('.btn-mic') as HTMLElement;
    const btnAudio = container.querySelector('.btn-audio') as HTMLElement;

    mockRect(form, { top: 500, left: 100, width: 800, height: 120 });
    mockRect(composer, { top: 510, left: 120, width: 760, height: 40 });
    mockRect(btnAttach, { top: 570, left: 120, width: 32, height: 32 });
    mockRect(btnSearch, { top: 570, left: 160, width: 70, height: 32 });

    // Right cluster: Think (610-660) -> gap 10 -> Model (670-735) -> gap 10 -> Mic (745-777) -> gap 10 -> Audio (787-823)
    mockRect(btnThink, { top: 570, left: 610, width: 50, height: 32 });
    mockRect(btnModel, { top: 570, left: 670, width: 65, height: 32 });
    mockRect(btnMic, { top: 570, left: 745, width: 32, height: 32 });
    mockRect(btnAudio, { top: 570, left: 787, width: 36, height: 36 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => null,
      findAttachButton: () => btnAttach,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    const host = document.getElementById('continu-composer-host');
    expect(host).not.toBeNull();
    expect(host?.style.display).toBe('block');

    const hostLeft = parseInt(host?.style.left || '0', 10);
    // Continu icon size = 32. Must sit to the left of Think button (610):
    // hostLeft = 610 - 32 - 8 = 570px
    // Crucially: MUST NOT OVERLAP Think button [610, 660] or Model button [670, 735]
    expect(hostLeft).toBe(570);
    expect(hostLeft + 32).toBeLessThanOrEqual(610);

    iconManager.destroy();
  });

  it('arms context when a context is dropped onto the chatbox', () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <textarea id="prompt-textarea"></textarea>
        <button class="btn-send" type="submit">Send</button>
      </form>
    `;
    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const btnSend = container.querySelector('.btn-send') as HTMLElement;

    mockRect(form, { top: 500, left: 100, width: 800, height: 100 });
    mockRect(composer, { top: 510, left: 110, width: 780, height: 40 });
    mockRect(btnSend, { top: 560, left: 720, width: 50, height: 30 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    expect(iconManager.getArmedContext()).toBeNull();

    const sampleContext = {
      id: 'ctx-drag-1',
      name: 'Drag and Drop Test',
      objective: 'Verify drop arming',
      source: { url: 'https://chatgpt.com', title: 'Test', platform: 'chatgpt' },
      decisions: [],
      createdAt: '2026-09-08T12:00:00Z',
      conversation: [],
    };

    // Simulate drop on chatbox
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as any;
    dropEvent.clientX = 300;
    dropEvent.clientY = 530;
    dropEvent.dataTransfer = {
      getData: (type: string) => {
        if (type === 'application/x-continu-context') return JSON.stringify(sampleContext);
        return '';
      },
    };

    window.dispatchEvent(dropEvent);

    expect(iconManager.getArmedContext()).not.toBeNull();
    expect(iconManager.getArmedContext()?.name).toBe('Drag and Drop Test');

    iconManager.destroy();
  });

  it('keeps Continu icon pinned to bottom toolbar row when textarea expands with a big block of text', () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <textarea id="prompt-textarea"></textarea>
        <button class="btn-send" type="submit">Send</button>
      </form>
    `;
    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const btnSend = container.querySelector('.btn-send') as HTMLElement;

    // Big block of text: composer is 400px tall! Top = 300, Bottom = 700
    mockRect(form, { top: 300, left: 100, width: 800, height: 460 });
    mockRect(composer, { top: 310, left: 110, width: 780, height: 400 });
    // Toolbar buttons are pinned to bottom of the card at top = 720
    mockRect(btnSend, { top: 720, left: 720, width: 50, height: 32 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    const host = document.getElementById('continu-composer-host');
    expect(host).not.toBeNull();

    const hostTop = parseInt(host?.style.top || '0', 10);
    // Must align vertically with btnSend at top 720, NOT at the top of the text block (310)
    expect(hostTop).toBe(720);

    iconManager.destroy();
  });

  it('ensures dropzone overlay is 100% transparent and non-obscuring so user can see typed text', () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <textarea id="prompt-textarea">User is currently drafting a prompt here...</textarea>
        <button class="btn-send" type="submit">Send</button>
      </form>
    `;
    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const btnSend = container.querySelector('.btn-send') as HTMLElement;

    mockRect(form, { top: 400, left: 100, width: 600, height: 100 });
    mockRect(composer, { top: 410, left: 110, width: 580, height: 60 });
    mockRect(btnSend, { top: 460, left: 640, width: 40, height: 30 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    // Access dropzone host
    const dropzoneHost = document.getElementById('continu-dropzone-host');
    expect(dropzoneHost).not.toBeNull();

    // Verify dropzone styles guarantee transparency & non-obscuration
    const dropzoneStyles = (iconManager as any).getDropzoneStyles();
    expect(dropzoneStyles).toContain('background: transparent !important');
    expect(dropzoneStyles).toContain('backdrop-filter: none !important');
    expect(dropzoneStyles).toContain('border: 2px dashed #3b82f6');
    // Top-docked pill that does not sit in center of textarea
    expect(dropzoneStyles).toContain('position: absolute');
    expect(dropzoneStyles).toContain('top: -14px');

    iconManager.destroy();
  });

  it('toggles between dark and light mode and persists to storage', () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <textarea id="prompt-textarea"></textarea>
        <button class="btn-send" type="submit">Send</button>
      </form>
    `;
    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const btnSend = container.querySelector('.btn-send') as HTMLElement;

    mockRect(form, { top: 400, left: 100, width: 600, height: 100 });
    mockRect(composer, { top: 410, left: 110, width: 580, height: 60 });
    mockRect(btnSend, { top: 460, left: 640, width: 40, height: 30 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    expect(iconManager.currentTheme).toBe('dark');
    const host = document.getElementById('continu-composer-host');
    expect(host?.classList.contains('theme-light')).toBe(false);

    // Toggle theme to light
    iconManager.toggleTheme();
    expect(iconManager.currentTheme).toBe('light');
    expect(host?.classList.contains('theme-light')).toBe(true);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ continu_theme: 'light' });

    // Toggle back to dark
    iconManager.toggleTheme();
    expect(iconManager.currentTheme).toBe('dark');
    expect(host?.classList.contains('theme-light')).toBe(false);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ continu_theme: 'dark' });

    iconManager.destroy();
  });

  it('renders theme switcher in panel header and toggles theme when clicked', async () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <textarea id="prompt-textarea"></textarea>
        <button class="btn-send" type="submit">Send</button>
      </form>
    `;
    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const btnSend = container.querySelector('.btn-send') as HTMLElement;

    mockRect(form, { top: 400, left: 100, width: 600, height: 100 });
    mockRect(composer, { top: 410, left: 110, width: 580, height: 60 });
    mockRect(btnSend, { top: 460, left: 640, width: 40, height: 30 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    // Open panel
    await (iconManager as any).openPanel();
    const panel = (iconManager as any).panel as HTMLElement;
    expect(panel).not.toBeNull();

    const themeToggle = panel.querySelector('.panel-theme-toggle') as HTMLButtonElement;
    expect(themeToggle).not.toBeNull();
    expect(themeToggle.title).toContain('Light Mode');

    // Click theme toggle button
    themeToggle.click();

    expect(iconManager.currentTheme).toBe('light');
    expect(panel.classList.contains('theme-light')).toBe(true);

    iconManager.destroy();
  });

  it('renders wireframe layout with GENERATE on top, Drop Format title and 3 proportional buttons, and Saved Contexts below', async () => {
    container.innerHTML = `
      <form class="chatbox-card">
        <textarea id="prompt-textarea"></textarea>
        <button class="btn-send" type="submit">Send</button>
      </form>
    `;
    const form = container.querySelector('form')!;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const btnSend = container.querySelector('.btn-send') as HTMLElement;

    mockRect(form, { top: 400, left: 100, width: 600, height: 100 });
    mockRect(composer, { top: 410, left: 110, width: 580, height: 60 });
    mockRect(btnSend, { top: 460, left: 640, width: 40, height: 30 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      findSubmitButton: () => btnSend,
      findAttachButton: () => null,
      extractConversation: () => [],
      insertText: () => {},
      submit: () => {},
    };

    (chrome.runtime.sendMessage as any).mockImplementation((msg: any) => {
      if (msg?.type === 'CHECK_AUTH') {
        return Promise.resolve({ authenticated: true });
      }
      return Promise.resolve({ success: true, contexts: [] });
    });

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    await (iconManager as any).openPanel();
    const panel = (iconManager as any).panel as HTMLElement;
    expect(panel).not.toBeNull();

    // 1. Verify GENERATE button in top section
    const generateBtn = panel.querySelector('.panel-btn-generate') as HTMLButtonElement;
    expect(generateBtn).not.toBeNull();
    expect(generateBtn.textContent).toContain('GENERATE');

    // 2. Verify Drop Format section has title on top and 3 proportional buttons below
    const dropFormatSection = panel.querySelector('.drop-format-section') as HTMLElement;
    expect(dropFormatSection).not.toBeNull();

    const dropFormatTitle = dropFormatSection.querySelector('.drop-format-title');
    expect(dropFormatTitle).not.toBeNull();
    expect(dropFormatTitle?.textContent).toBe('Drop Format');

    const formatButtons = dropFormatSection.querySelectorAll('.drop-format-btn');
    expect(formatButtons.length).toBe(3);
    expect(formatButtons[0].textContent).toBe('Attach');
    expect(formatButtons[1].textContent).toBe('Structured');
    expect(formatButtons[2].textContent).toBe('Full');

    // Default active format should be Attach (hidden)
    expect(formatButtons[0].classList.contains('active')).toBe(true);

    // 3. Verify Saved Contexts section is placed below Drop Format section
    const savedContextsSection = panel.querySelector('.saved-contexts-section') as HTMLElement;
    expect(savedContextsSection).not.toBeNull();

    const sections = Array.from(panel.querySelectorAll('.panel-section'));
    const genIndex = sections.indexOf(panel.querySelector('.generate-section') as HTMLElement);
    const dropIndex = sections.indexOf(dropFormatSection);
    const savedIndex = sections.indexOf(savedContextsSection);

    expect(genIndex).toBeLessThan(dropIndex);
    expect(dropIndex).toBeLessThan(savedIndex);

    // 4. Test clicking on format button
    (formatButtons[1] as HTMLButtonElement).click();
    expect(formatButtons[0].classList.contains('active')).toBe(false);
    expect(formatButtons[1].classList.contains('active')).toBe(true);
    expect((iconManager as any).selectedFormat).toBe('structured');

    iconManager.destroy();
  });

  it('renders Cook This Prompt button with setup info when unconfigured, and opens setup guide on click', async () => {
    container.innerHTML = `<textarea id="prompt-textarea"></textarea>`;
    const composer = container.querySelector('#prompt-textarea') as HTMLElement;
    mockRect(composer, { top: 500, left: 100, width: 600, height: 60 });

    const adapter: AIAdapter = {
      name: 'chatgpt',
      detect: () => true,
      findComposer: () => composer,
      insertText: vi.fn(),
      submitText: vi.fn().mockResolvedValue(true),
      extractConversation: () => null,
      getComposerText: () => '',
    };

    (chrome.runtime.sendMessage as any).mockImplementation((msg: any) => {
      if (msg?.type === 'CHECK_AUTH') return Promise.resolve({ authenticated: true });
      return Promise.resolve({ success: true, contexts: [] });
    });

    (chrome.storage.local.get as any).mockResolvedValue({});

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    await (iconManager as any).openPanel();
    const panel = (iconManager as any).panel as HTMLElement;
    expect(panel).not.toBeNull();

    // Verify Cook This Prompt button exists and is in unconfigured state
    const cookBtn = panel.querySelector('.panel-btn-cook') as HTMLButtonElement;
    expect(cookBtn).not.toBeNull();
    expect(cookBtn.classList.contains('unconfigured')).toBe(true);
    expect(cookBtn.textContent).toContain('COOK THIS PROMPT');
    expect(cookBtn.textContent).toContain('Setup Key');
    expect(cookBtn.textContent).toContain('No API key set');

    // Click on unconfigured cook button -> reveals interactive setup guide
    cookBtn.click();
    const setupGuide = panel.querySelector('.cook-setup-guide') as HTMLElement;
    expect(setupGuide).not.toBeNull();
    expect(setupGuide.textContent).toContain('How to Setup AI API Key');
    expect(setupGuide.textContent).toContain('Settings');
    expect(setupGuide.textContent).toContain('OpenAI, Claude, Gemini, Groq, or OpenRouter');

    // Clicking close button removes the guide
    const closeGuideBtn = setupGuide.querySelector('.cook-guide-close') as HTMLButtonElement;
    closeGuideBtn.click();
    expect(panel.querySelector('.cook-setup-guide')).toBeNull();

    iconManager.destroy();
  });

  it('renders Cook This Prompt button with provider badge when configured, and opens preview modal with replace action', async () => {
    container.innerHTML = `<textarea id="prompt-textarea">Draft question about react</textarea>`;
    const composer = container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    composer.value = 'Draft question about react';
    mockRect(composer, { top: 500, left: 100, width: 600, height: 60 });

    const insertTextSpy = vi.fn();
    const adapter: AIAdapter = {
      name: 'claude',
      detect: () => true,
      findComposer: () => composer,
      insertText: insertTextSpy,
      submitText: vi.fn().mockResolvedValue(true),
      extractConversation: () => null,
      getComposerText: () => composer.value,
    };

    (chrome.runtime.sendMessage as any).mockImplementation((msg: any) => {
      if (msg?.type === 'CHECK_AUTH') return Promise.resolve({ authenticated: true });
      return Promise.resolve({ success: true, contexts: [] });
    });

    (chrome.storage.local.get as any).mockImplementation((keys: any) => {
      if (keys === 'continu_ai_settings' || (Array.isArray(keys) && keys.includes('continu_ai_settings'))) {
        return Promise.resolve({
          continu_ai_settings: {
            providers: {
              openai: { provider: 'openai', apiKey: 'sk-test-valid', model: 'gpt-4o-mini' },
            },
            activeProvider: 'openai',
          },
        });
      }
      return Promise.resolve({});
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Polished expert prompt about React internals' } }],
      }),
    }));

    const iconManager = new ComposerIcon(adapter);
    iconManager.init();

    await (iconManager as any).openPanel();
    const panel = (iconManager as any).panel as HTMLElement;
    expect(panel).not.toBeNull();

    // Verify Cook button has configured state and provider badge
    const cookBtn = panel.querySelector('.panel-btn-cook') as HTMLButtonElement;
    expect(cookBtn).not.toBeNull();
    expect(cookBtn.classList.contains('configured')).toBe(true);
    expect(cookBtn.textContent).toContain('COOK THIS PROMPT');
    expect(cookBtn.textContent).toContain('OPENAI');

    // Click to cook prompt
    await (iconManager as any).handleCookPrompt(cookBtn);

    // Verify Cook preview modal overlay appears
    const preview = panel.querySelector('.cook-preview-overlay') as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.textContent).toContain('Cooked Prompt');
    expect(preview.textContent).toContain('Draft question about react');
    expect(preview.textContent).toContain('Polished expert prompt about React internals');

    // Verify actions: Replace in Chatbox, Copy, Cancel
    const replaceBtn = preview.querySelector('.cook-preview-btn-replace') as HTMLButtonElement;
    const copyBtn = preview.querySelector('.cook-preview-btn-copy') as HTMLButtonElement;
    const cancelBtn = preview.querySelector('.cook-preview-btn-cancel') as HTMLButtonElement;
    expect(replaceBtn).not.toBeNull();
    expect(copyBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();

    // Click Replace in Chatbox
    replaceBtn.click();
    expect(insertTextSpy).toHaveBeenCalledWith('Polished expert prompt about React internals');
    // Verify preview is removed and panel is closed
    expect(panel.querySelector('.cook-preview-overlay')).toBeNull();
    expect((iconManager as any).isOpen).toBe(false);

    iconManager.destroy();
  });
});

