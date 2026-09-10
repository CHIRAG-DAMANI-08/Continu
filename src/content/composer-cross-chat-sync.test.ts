// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComposerIcon } from './composer-icon';
import type { AIAdapter } from '../adapters/base';
import { deriveDeterministicUserSalt, deriveUserEncryptionKey, encrypt, decrypt } from '../security/encryption';
import type { ContinuContext } from '../contexts/model';

describe('Cross-Chat & DB Data Sync Guarantees', () => {
  let mockStorage: Record<string, any> = {};
  let storageListeners: Array<(changes: Record<string, any>, areaName: string) => void> = [];

  beforeEach(() => {
    mockStorage = {
      continu_user_authenticated: true,
      continu_user_id: 'user_test_uuid_456',
    };
    storageListeners = [];

    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-ext-id',
        sendMessage: vi.fn().mockImplementation((msg: any) => {
          if (msg?.type === 'CHECK_AUTH') {
            return Promise.resolve({
              authenticated: !!mockStorage.continu_user_authenticated,
              userId: mockStorage.continu_user_id,
            });
          }
          if (msg?.type === 'GET_CONTEXTS') {
            return Promise.resolve({
              success: true,
              contexts: mockStorage.test_remote_contexts || [],
            });
          }
          if (msg?.type === 'SAVE_CONTEXT') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({ success: true });
        }),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn().mockImplementation((keys: string | string[]) => {
            if (typeof keys === 'string') return Promise.resolve({ [keys]: mockStorage[keys] });
            const res: Record<string, any> = {};
            for (const k of keys) res[k] = mockStorage[k];
            return Promise.resolve(res);
          }),
          set: vi.fn().mockImplementation((items: Record<string, any>) => {
            Object.assign(mockStorage, items);
            return Promise.resolve();
          }),
          remove: vi.fn().mockImplementation((keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) delete mockStorage[k];
            return Promise.resolve();
          }),
        },
        onChanged: {
          addListener: vi.fn().mockImplementation((cb: any) => {
            storageListeners.push(cb);
          }),
          removeListener: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    document.getElementById('continu-composer-host')?.remove();
    vi.clearAllMocks();
  });

  const mockAdapter: AIAdapter = {
    name: 'claude',
    detect: () => true,
    findComposer: () => {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => ({
        top: 100, left: 100, width: 400, height: 50, right: 500, bottom: 150, x: 100, y: 100, toJSON: () => ({}),
      });
      return el;
    },
    findSubmitButton: () => null,
    findAttachButton: () => null,
    extractConversation: () => [],
    insertText: () => {},
    submit: () => {},
  };

  it('eliminates openPanel race condition by properly checking auth before loading contexts in a fresh tab', async () => {
    const icon = new ComposerIcon(mockAdapter);
    // On fresh instance creation, private isAuthenticated is false
    expect((icon as any).isAuthenticated).toBe(false);

    icon.init();

    // Prepare a mock context that should be loaded when panel opens
    const sampleContext: ContinuContext = {
      id: 'ctx-111-222',
      schemaVersion: 1,
      name: 'Synced Claude Context',
      source: { platform: 'claude', url: 'https://claude.ai', title: 'Research' },
      objective: 'Verify fix',
      currentState: 'Active',
      decisions: [],
      requirements: [],
      constraints: [],
      openQuestions: [],
      nextActions: [],
      conversation: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Stored under user-scoped key
    const prefix = 'continu_u_user_test_uuid_456_context_';
    const indexKey = 'continu_u_user_test_uuid_456_contexts_index';
    mockStorage[indexKey] = ['ctx-111-222'];
    mockStorage[`${prefix}ctx-111-222`] = sampleContext;

    // Call openPanel
    await (icon as any).openPanel();

    // After openPanel, isAuthenticated must be true and contexts must contain the saved context
    expect((icon as any).isAuthenticated).toBe(true);
    expect((icon as any).contexts.length).toBe(1);
    expect((icon as any).contexts[0].name).toBe('Synced Claude Context');

    icon.destroy();
  });

  it('cross-tab synchronization: reloads contexts when another tab adds or updates a context', async () => {
    const icon = new ComposerIcon(mockAdapter);
    icon.init();

    // Initially 0 contexts
    expect((icon as any).contexts.length).toBe(0);

    // Another tab creates and saves a context to chrome.storage.local
    const newContext: ContinuContext = {
      id: 'ctx-cross-tab-999',
      schemaVersion: 1,
      name: 'Created in ChatGPT tab',
      source: { platform: 'chatgpt', url: 'https://chatgpt.com', title: 'Brainstorm' },
      objective: 'Cross-tab test',
      currentState: 'Active',
      decisions: [],
      requirements: [],
      constraints: [],
      openQuestions: [],
      nextActions: [],
      conversation: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const prefix = 'continu_u_user_test_uuid_456_context_';
    const indexKey = 'continu_u_user_test_uuid_456_contexts_index';
    mockStorage[indexKey] = ['ctx-cross-tab-999'];
    mockStorage[`${prefix}ctx-cross-tab-999`] = newContext;

    // Simulate storage change event fired by Chrome
    for (const listener of storageListeners) {
      listener({
        [indexKey]: { oldValue: [], newValue: ['ctx-cross-tab-999'] },
      }, 'local');
    }

    // Allow microtasks to complete
    await new Promise(r => setTimeout(r, 50));

    expect((icon as any).contexts.length).toBe(1);
    expect((icon as any).contexts[0].name).toBe('Created in ChatGPT tab');

    icon.destroy();
  });

  it('deterministic user salt: derives identical salt and key across devices for the same user ID', async () => {
    const userId = '380d3ce3-66aa-4712-921d-92751c142c67';

    // Device A creates salt
    const saltDeviceA = await deriveDeterministicUserSalt(userId);
    // Device B creates salt
    const saltDeviceB = await deriveDeterministicUserSalt(userId);

    expect(saltDeviceA).toBeInstanceOf(Uint8Array);
    expect(saltDeviceA.length).toBe(16);
    expect(Array.from(saltDeviceA)).toEqual(Array.from(saltDeviceB));

    // Device A encrypts context
    const keyDeviceA = await deriveUserEncryptionKey(userId, saltDeviceA);
    const plaintext = JSON.stringify({ secret: 'Top secret context payload across devices' });
    const encrypted = await encrypt(plaintext, keyDeviceA);

    // Device B decrypts context with independently derived key
    const keyDeviceB = await deriveUserEncryptionKey(userId, saltDeviceB);
    const decrypted = await decrypt(encrypted, keyDeviceB);

    expect(decrypted).toBe(plaintext);
  });
});
