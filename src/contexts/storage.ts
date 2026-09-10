import type { ContinuContext } from './model';

const LEGACY_STORAGE_KEY_PREFIX = 'continu_context_';
const LEGACY_STORAGE_INDEX_KEY = 'continu_contexts_index';
export const ACTIVE_CONTEXT_KEY = 'continu_active_context_id';
const LEGACY_ACTIVE_CONTEXT_KEY = ACTIVE_CONTEXT_KEY;

/**
 * Resolves the currently authenticated user ID from chrome.storage.local.
 * Returns null if the user is unauthenticated or signed out.
 */
export async function getActiveUserIdLocal(): Promise<string | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(['continu_user_authenticated', 'continu_user_id']);
      if (res.continu_user_authenticated && res.continu_user_id) {
        return res.continu_user_id;
      }
    }
  } catch {}
  return null;
}

function getStorageKeyPrefix(userId: string): string {
  return `continu_u_${userId}_context_`;
}

function getStorageIndexKey(userId: string): string {
  return `continu_u_${userId}_contexts_index`;
}

export function getActiveContextKey(userId?: string | null): string {
  return userId ? `continu_u_${userId}_active_context_id` : ACTIVE_CONTEXT_KEY;
}

/**
 * Saves a context strictly scoped to a specific user.
 * If explicitUserId is not provided, defaults to the currently authenticated user.
 */
export async function saveContextLocal(context: ContinuContext, explicitUserId?: string): Promise<void> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  if (!userId) {
    console.warn('Continu: Cannot save context locally — no authenticated user found.');
    return;
  }

  const prefix = getStorageKeyPrefix(userId);
  const indexKey = getStorageIndexKey(userId);
  const key = `${prefix}${context.id}`;

  // Save context data
  await chrome.storage.local.set({ [key]: context });

  // Update index
  const result = await chrome.storage.local.get(indexKey);
  const index: string[] = result[indexKey] || [];

  if (!index.includes(context.id)) {
    index.push(context.id);
    await chrome.storage.local.set({ [indexKey]: index });
  }
}

/**
 * Retrieves a context by ID for the given user.
 */
export async function getContextLocal(id: string, explicitUserId?: string): Promise<ContinuContext | null> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  if (!userId) {
    return null;
  }

  const prefix = getStorageKeyPrefix(userId);
  const key = `${prefix}${id}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

/**
 * Retrieves all contexts for the authenticated user, sorted most recent first.
 * Strictly returns [] if unauthenticated or no userId is found.
 */
export async function getContextsLocal(explicitUserId?: string): Promise<ContinuContext[]> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  if (!userId) {
    return [];
  }

  const indexKey = getStorageIndexKey(userId);
  const result = await chrome.storage.local.get(indexKey);
  const index: string[] = result[indexKey] || [];

  const contexts: ContinuContext[] = [];

  for (const id of index) {
    const context = await getContextLocal(id, userId);
    if (context) {
      contexts.push(context);
    }
  }

  // Sort by most recent first
  contexts.sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return contexts;
}

/**
 * Deletes a context from the user's storage.
 */
export async function deleteContextLocal(id: string, explicitUserId?: string): Promise<void> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  if (!userId) return;

  const prefix = getStorageKeyPrefix(userId);
  const indexKey = getStorageIndexKey(userId);
  const key = `${prefix}${id}`;

  // Remove context data
  await chrome.storage.local.remove([key]);

  // Update index
  const result = await chrome.storage.local.get(indexKey);
  const index: string[] = result[indexKey] || [];
  const newIndex = index.filter(contextId => contextId !== id);
  await chrome.storage.local.set({ [indexKey]: newIndex });
}

/**
 * Updates a context in the user's storage.
 */
export async function updateContextLocal(context: ContinuContext, explicitUserId?: string): Promise<void> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  if (!userId) {
    throw new Error('User is not authenticated');
  }

  const existing = await getContextLocal(context.id, userId);
  if (!existing) {
    throw new Error(`Context ${context.id} not found for user`);
  }

  const prefix = getStorageKeyPrefix(userId);
  const key = `${prefix}${context.id}`;
  const updated = {
    ...context,
    updatedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({ [key]: updated });
}

/**
 * Clears all contexts for a user (or the current user).
 * Also cleans legacy unpartitioned keys so no stale data remains.
 */
export async function clearAllContextsLocal(explicitUserId?: string): Promise<void> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  const keysToRemove: string[] = [];

  if (userId) {
    const indexKey = getStorageIndexKey(userId);
    const result = await chrome.storage.local.get(indexKey);
    const index: string[] = result[indexKey] || [];
    const prefix = getStorageKeyPrefix(userId);

    keysToRemove.push(...index.map(id => `${prefix}${id}`));
    keysToRemove.push(indexKey);
    keysToRemove.push(getActiveContextKey(userId));
  }

  // Also purge all legacy unpartitioned keys
  await purgeAllLegacyUnscopedContexts();

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

/**
 * Purges any legacy unpartitioned contexts and indexes from storage.
 */
export async function purgeAllLegacyUnscopedContexts(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(LEGACY_STORAGE_INDEX_KEY);
    const index: string[] = result[LEGACY_STORAGE_INDEX_KEY] || [];
    const legacyKeys = index.map(id => `${LEGACY_STORAGE_KEY_PREFIX}${id}`);
    legacyKeys.push(LEGACY_STORAGE_INDEX_KEY);
    legacyKeys.push(LEGACY_ACTIVE_CONTEXT_KEY);
    await chrome.storage.local.remove(legacyKeys);
  } catch (err) {
    console.warn('Continu: Failed to purge legacy contexts', err);
  }
}

export async function setActiveContextIdLocal(id: string | null, explicitUserId?: string): Promise<void> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  const key = getActiveContextKey(userId);
  if (id) {
    await chrome.storage.local.set({ [key]: id });
  } else {
    await chrome.storage.local.remove(key);
  }
}

export async function getActiveContextIdLocal(explicitUserId?: string): Promise<string | null> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  const key = getActiveContextKey(userId);
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

export async function getActiveContextLocal(explicitUserId?: string): Promise<ContinuContext | null> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  const id = await getActiveContextIdLocal(userId);
  if (!id) return null;
  return getContextLocal(id, userId);
}
