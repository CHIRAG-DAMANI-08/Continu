import { getContextsLocal, saveContextLocal, getContextLocal, getActiveUserIdLocal } from '../contexts/storage';
import { saveContextRemote, getContextsRemote, deleteContextRemote } from './contexts';
import { isSupabaseConfigured } from './supabase';

interface SyncQueueItem {
  contextId: string;
  action: 'upsert' | 'delete';
  timestamp: string;
}

const LEGACY_SYNC_QUEUE_KEY = 'continu_sync_queue';

function getSyncQueueKey(userId?: string | null): string {
  return userId ? `continu_u_${userId}_sync_queue` : LEGACY_SYNC_QUEUE_KEY;
}

/**
 * Add an item to the sync queue for a specific user.
 * Items are synced when online and authenticated.
 */
export async function enqueueSync(contextId: string, action: 'upsert' | 'delete', explicitUserId?: string): Promise<void> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  if (!userId) return;

  const queueKey = getSyncQueueKey(userId);
  const result = await chrome.storage.local.get(queueKey);
  const queue: SyncQueueItem[] = result[queueKey] || [];

  // Replace existing entry for same context
  const filtered = queue.filter(item => item.contextId !== contextId);
  filtered.push({
    contextId,
    action,
    timestamp: new Date().toISOString(),
  });

  await chrome.storage.local.set({ [queueKey]: filtered });
}

/**
 * Process the sync queue - upload pending changes to Supabase for the specified user.
 * Requires an authenticated user ID.
 */
export async function processSyncQueue(userId: string): Promise<{ synced: number; errors: string[] }> {
  if (!isSupabaseConfigured()) {
    return { synced: 0, errors: ['Supabase not configured'] };
  }

  const queueKey = getSyncQueueKey(userId);
  const result = await chrome.storage.local.get(queueKey);
  const queue: SyncQueueItem[] = result[queueKey] || [];

  if (queue.length === 0) {
    return { synced: 0, errors: [] };
  }

  let synced = 0;
  const errors: string[] = [];
  const remaining: SyncQueueItem[] = [];

  for (const item of queue) {
    try {
      if (item.action === 'upsert') {
        const contexts = await getContextsLocal(userId);
        const context = contexts.find(c => c.id === item.contextId);
        if (context) {
          await saveContextRemote(context, userId);
          synced++;
        }
      } else if (item.action === 'delete') {
        await deleteContextRemote(item.contextId);
        synced++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      errors.push(`${item.contextId}: ${message}`);
      remaining.push(item); // Keep failed items for retry
    }
  }

  // Update queue with only failed items
  await chrome.storage.local.set({ [queueKey]: remaining });

  return { synced, errors };
}

/**
 * Two-way zero-knowledge sync:
 * 1. Pushes any queued or un-synced local changes (encrypted client-side with user's key)
 * 2. Pulls remote encrypted contexts, decrypts them client-side, and merges newer items into user's local storage
 */
export async function syncContextsWithRemote(
  userId: string,
  _token?: string | null
): Promise<{ uploaded: number; downloaded: number; errors: string[] }> {
  if (!isSupabaseConfigured()) {
    return { uploaded: 0, downloaded: 0, errors: ['Supabase is not configured'] };
  }

  const errors: string[] = [];
  let uploaded = 0;
  let downloaded = 0;

  // 1. Process queued sync items first for this user
  try {
    const queueResult = await processSyncQueue(userId);
    uploaded += queueResult.synced;
    errors.push(...queueResult.errors);
  } catch (err) {
    errors.push(`Queue sync error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Upload any local contexts strictly belonging to this user
  try {
    const localContexts = await getContextsLocal(userId);
    for (const localCtx of localContexts) {
      try {
        await saveContextRemote(localCtx, userId);
        uploaded++;
      } catch (uploadErr) {
        // May already be synced or failed
        errors.push(`Upload error for ${localCtx.id}: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
      }
    }
  } catch (err) {
    errors.push(`Local scan error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Download and decrypt remote contexts for this user
  try {
    const remoteContexts = await getContextsRemote(userId);
    for (const remoteCtx of remoteContexts) {
      const local = await getContextLocal(remoteCtx.id, userId);
      if (!local || new Date(remoteCtx.updatedAt).getTime() > new Date(local.updatedAt).getTime()) {
        await saveContextLocal(remoteCtx, userId);
        downloaded++;
      }
    }
  } catch (downloadErr) {
    errors.push(`Download error: ${downloadErr instanceof Error ? downloadErr.message : String(downloadErr)}`);
  }

  return { uploaded, downloaded, errors };
}

/**
 * Clear the sync queue for a user.
 */
export async function clearSyncQueue(userId?: string): Promise<void> {
  const keys = [LEGACY_SYNC_QUEUE_KEY];
  if (userId) {
    keys.push(getSyncQueueKey(userId));
  }
  await chrome.storage.local.remove(keys);
}

/**
 * Get the current sync queue length for a user.
 */
export async function getSyncQueueLength(explicitUserId?: string): Promise<number> {
  const userId = explicitUserId || await getActiveUserIdLocal();
  const queueKey = getSyncQueueKey(userId);
  const result = await chrome.storage.local.get(queueKey);
  const queue: SyncQueueItem[] = result[queueKey] || [];
  return queue.length;
}
