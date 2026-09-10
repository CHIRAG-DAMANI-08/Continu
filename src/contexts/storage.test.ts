import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveContextLocal,
  getContextLocal,
  getContextsLocal,
  deleteContextLocal,
  updateContextLocal,
  clearAllContextsLocal,
  purgeAllLegacyUnscopedContexts,
  getActiveUserIdLocal,
} from './storage';
import { enqueueSync, clearSyncQueue, getSyncQueueLength } from '../database/sync';
import type { ContinuContext } from './model';

describe('User-Scoped Storage & Account Isolation', () => {
  let mockStorage: Record<string, any> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            if (typeof keys === 'string') {
              return { [keys]: mockStorage[keys] };
            }
            const result: Record<string, any> = {};
            for (const k of keys) {
              if (mockStorage[k] !== undefined) {
                result[k] = mockStorage[k];
              }
            }
            return result;
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(mockStorage, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const keyList = Array.isArray(keys) ? keys : [keys];
            for (const k of keyList) {
              delete mockStorage[k];
            }
          }),
        },
      },
    };
  });

  const createContext = (id: string, name: string): ContinuContext => ({
    id,
    schemaVersion: 1,
    name,
    source: { platform: 'chatgpt', url: 'https://chatgpt.com', title: 'Test' },
    objective: 'Test Objective',
    currentState: 'In progress',
    decisions: [],
    requirements: [],
    constraints: [],
    openQuestions: [],
    nextActions: [],
    conversation: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('returns empty array when user is unauthenticated', async () => {
    // No continu_user_id or continu_user_authenticated in storage
    const contexts = await getContextsLocal();
    expect(contexts).toEqual([]);
  });

  it('correctly resolves active user ID when authenticated in storage', async () => {
    mockStorage['continu_user_authenticated'] = true;
    mockStorage['continu_user_id'] = 'user_alpha_123';

    const userId = await getActiveUserIdLocal();
    expect(userId).toBe('user_alpha_123');
  });

  it('strictly isolates contexts between two different user accounts', async () => {
    const userA = 'user_account_A';
    const userB = 'user_account_B';

    const ctxA1 = createContext('ctx-a1', 'Account A Secret Context 1');
    const ctxA2 = createContext('ctx-a2', 'Account A Secret Context 2');
    const ctxB1 = createContext('ctx-b1', 'Account B Work Context 1');

    // Save under User A
    await saveContextLocal(ctxA1, userA);
    await saveContextLocal(ctxA2, userA);

    // Save under User B
    await saveContextLocal(ctxB1, userB);

    // Verify User A only sees A1 and A2
    const contextsA = await getContextsLocal(userA);
    expect(contextsA.length).toBe(2);
    expect(contextsA.map(c => c.id).sort()).toEqual(['ctx-a1', 'ctx-a2']);

    // Verify User B only sees B1
    const contextsB = await getContextsLocal(userB);
    expect(contextsB.length).toBe(1);
    expect(contextsB[0].id).toBe('ctx-b1');

    // Cross-access check: User B cannot fetch ctx-a1
    const crossFetch = await getContextLocal('ctx-a1', userB);
    expect(crossFetch).toBeNull();
  });

  it('uses active user from storage when explicitUserId is omitted', async () => {
    mockStorage['continu_user_authenticated'] = true;
    mockStorage['continu_user_id'] = 'user_active_999';

    const ctx = createContext('ctx-active', 'Active User Context');
    await saveContextLocal(ctx);

    const loaded = await getContextsLocal();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe('Active User Context');
  });

  it('wipes user contexts and sync queue on sign out without affecting other users', async () => {
    const userA = 'user_to_logout';
    const userB = 'user_staying_logged_in';

    await saveContextLocal(createContext('ctx-logout', 'Logout user data'), userA);
    await enqueueSync('ctx-logout', 'upsert', userA);

    await saveContextLocal(createContext('ctx-keep', 'Keep user data'), userB);
    await enqueueSync('ctx-keep', 'upsert', userB);

    expect(await getSyncQueueLength(userA)).toBe(1);
    expect(await getSyncQueueLength(userB)).toBe(1);

    // Sign out user A: clear contexts and sync queue
    await clearAllContextsLocal(userA);
    await clearSyncQueue(userA);

    // User A should now have 0 contexts and 0 queued sync items
    expect(await getContextsLocal(userA)).toEqual([]);
    expect(await getSyncQueueLength(userA)).toBe(0);

    // User B data is completely unharmed
    const contextsB = await getContextsLocal(userB);
    expect(contextsB.length).toBe(1);
    expect(contextsB[0].id).toBe('ctx-keep');
    expect(await getSyncQueueLength(userB)).toBe(1);
  });

  it('purges legacy unscoped context keys from storage', async () => {
    mockStorage['continu_context_legacy1'] = { id: 'legacy1' };
    mockStorage['continu_contexts_index'] = ['legacy1'];
    mockStorage['continu_active_context_id'] = 'legacy1';

    await purgeAllLegacyUnscopedContexts();

    expect(mockStorage['continu_context_legacy1']).toBeUndefined();
    expect(mockStorage['continu_contexts_index']).toBeUndefined();
    expect(mockStorage['continu_active_context_id']).toBeUndefined();
  });
});
