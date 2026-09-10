import { MessageType } from '../src/security/messaging';
import { generateContext, generateMinimalContext } from '../src/contexts/generate';
import { saveContextLocal, getContextsLocal, getContextLocal, deleteContextLocal } from '../src/contexts/storage';
import { formatContext, type DropFormat } from '../src/contexts/format';
import { enqueueSync, processSyncQueue, syncContextsWithRemote } from '../src/database/sync';
import { cookPrompt, isAiConfigured } from '../src/ai/cook';
import { logger } from '../src/utils/logger';
import { checkRateLimit, recordAttempt, RATE_LIMIT_AI_COOK } from '../src/security/rate-limiter';

export default defineBackground(() => {
  logger.debug('continu background service initialized');

  // Listen for login and user changes in storage to trigger immediate remote sync
  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.continu_user_authenticated?.newValue && changes.continu_user_id?.newValue) {
          const newUserId = changes.continu_user_id.newValue;
          syncContextsWithRemote(newUserId).catch(err => {
            logger.warn('Continu: Background auto-sync on login failed:', err);
          });
        }
      }
    });
  } catch (err) {
    logger.warn('Continu: Background storage listener error:', err);
  }

  // Handle messages from popup and content scripts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return false;
    }

    // Verify sender identity
    if (sender.id && sender.id !== chrome.runtime.id) {
      logger.warn('Continu: Rejected message from unauthorized sender ID:', sender.id);
      return false;
    }

    switch (message.type) {
      case MessageType.GENERATE_CONTEXT: {
        handleGenerate(sender, sendResponse);
        return true; // async response
      }

      case MessageType.SAVE_CONTEXT: {
        if (!message.context) {
          sendResponse({ success: false, error: 'No context provided' });
          return false;
        }
        checkUserAuthenticated()
          .then(async auth => {
            if (!auth.authenticated || !auth.userId) {
              sendResponse({ success: false, error: 'Please sign in first' });
              return;
            }
            await saveContextLocal(message.context, auth.userId);
            await enqueueSync(message.context.id, 'upsert', auth.userId).catch(err => {
              logger.warn('Continu: Background sync upsert enqueue error:', err);
            });
            // Process queue immediately so context is uploaded to Supabase
            processSyncQueue(auth.userId).catch(err => {
              logger.warn('Continu: Background processSyncQueue error:', err);
            });
            sendResponse({ success: true });
          })
          .catch((error: Error) => sendResponse({ success: false, error: error.message }));
        return true;
      }

      case MessageType.GET_CONTEXTS: {
        checkUserAuthenticated()
          .then(async auth => {
            if (!auth.authenticated || !auth.userId) {
              sendResponse({ success: true, contexts: [] });
              return;
            }
            let contexts = await getContextsLocal(auth.userId);
            if (contexts.length === 0) {
              // Automatically sync with remote Supabase to pull down existing contexts
              try {
                await syncContextsWithRemote(auth.userId);
                contexts = await getContextsLocal(auth.userId);
              } catch (syncErr) {
                logger.warn('Continu: Background auto-sync during GET_CONTEXTS:', syncErr);
              }
            }
            sendResponse({ success: true, contexts });
          })
          .catch((error: Error) => sendResponse({ success: false, error: error.message }));
        return true;
      }

      case MessageType.GET_CONTEXT: {
        if (!message.contextId) {
          sendResponse({ success: false, error: 'No context ID provided' });
          return false;
        }
        checkUserAuthenticated()
          .then(async auth => {
            if (!auth.authenticated || !auth.userId) {
              sendResponse({ success: false, error: 'Not authenticated' });
              return;
            }
            const context = await getContextLocal(message.contextId, auth.userId);
            sendResponse({ success: true, context });
          })
          .catch((error: Error) => sendResponse({ success: false, error: error.message }));
        return true;
      }

      case MessageType.DELETE_CONTEXT: {
        if (!message.contextId) {
          sendResponse({ success: false, error: 'No context ID provided' });
          return false;
        }
        checkUserAuthenticated()
          .then(async auth => {
            if (!auth.authenticated || !auth.userId) {
              sendResponse({ success: false, error: 'Not authenticated' });
              return;
            }
            await deleteContextLocal(message.contextId, auth.userId);
            await enqueueSync(message.contextId, 'delete', auth.userId).catch(err => {
              logger.warn('Continu: Background sync delete enqueue error:', err);
            });
            sendResponse({ success: true });
          })
          .catch((error: Error) => sendResponse({ success: false, error: error.message }));
        return true;
      }

      case MessageType.ARM_CONTEXT: {
        if (message.contextId) {
          handleArm(sender, message.contextId, sendResponse);
          return true;
        }
        sendResponse({ success: false, error: 'Missing contextId' });
        return false;
      }

      case MessageType.DISARM_CONTEXT: {
        handleDisarm(sender, sendResponse);
        return true;
      }

      case MessageType.DROP_CONTEXT: {
        if (message.contextId && message.format) {
          handleDrop(sender, message.contextId, message.format, sendResponse);
          return true;
        }
        sendResponse({ success: false, error: 'Missing contextId or format' });
        return false;
      }

      case MessageType.GET_PAGE_INFO: {
        return false;
      }

      case MessageType.CHECK_AUTH: {
        checkUserAuthenticated()
          .then(auth => sendResponse(auth))
          .catch(() => sendResponse({ authenticated: false, userId: null }));
        return true;
      }

      case MessageType.GET_AI_STATUS: {
        isAiConfigured()
          .then(status => sendResponse({ success: true, ...status }))
          .catch(err => sendResponse({ success: false, configured: false, error: err.message }));
        return true;
      }

      case MessageType.COOK_PROMPT: {
        handleCookPrompt(message, sender, sendResponse);
        return true;
      }

      case MessageType.SYNC_REMOTE: {
        checkUserAuthenticated()
          .then(async auth => {
            if (!auth.authenticated || !auth.userId) {
              sendResponse({ success: false, error: 'Not authenticated' });
              return;
            }
            const res = await syncContextsWithRemote(auth.userId);
            sendResponse({ success: true, ...res });
          })
          .catch((error: Error) => sendResponse({ success: false, error: error.message }));
        return true;
      }

      default:
        return false;
    }
  });
});

async function checkUserAuthenticated(): Promise<{ authenticated: boolean; userId: string | null }> {
  try {
    const { isSupabaseConfigured, getSupabaseClient } = await import('../src/database/supabase');
    if (!isSupabaseConfigured()) {
      // Fallback for offline/test environments where Supabase credentials are not configured
      const res = await chrome.storage.local.get(['continu_user_authenticated', 'continu_user_id']);
      if (res.continu_user_authenticated && res.continu_user_id) {
        return { authenticated: true, userId: res.continu_user_id };
      }
      return { authenticated: false, userId: null };
    }

    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    const user = session?.user;

    if (user?.id) {
      if (session.expires_at && session.expires_at * 1000 < Date.now()) {
        logger.warn('Continu: Supabase session expired.');
        await chrome.storage.local.set({ continu_user_authenticated: false, continu_user_id: null });
        return { authenticated: false, userId: null };
      }
      return { authenticated: true, userId: user.id };
    }

    // Configured Supabase returned no active session: purge stale local markers
    await chrome.storage.local.set({ continu_user_authenticated: false, continu_user_id: null });
  } catch (err) {
    logger.warn('Continu: Auth check in background failed:', err);
  }

  return { authenticated: false, userId: null };
}

async function getTargetTab(
  sender?: chrome.runtime.MessageSender
): Promise<{ id?: number; url?: string; title?: string } | undefined> {
  if (sender?.tab?.id) {
    return sender.tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Handle Generate: extract conversation from active tab, create context, save locally.
 */
async function handleGenerate(
  sender: chrome.runtime.MessageSender | undefined,
  sendResponse: (response: unknown) => void
) {
  try {
    const auth = await checkUserAuthenticated();
    if (!auth.authenticated) {
      sendResponse({
        success: false,
        error: 'Please log in to your account first.',
        requireLogin: true,
      });
      return;
    }

    const tab = await getTargetTab(sender);
    if (!tab?.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    // Ask content script for page info
    let pageInfo: any = null;
    try {
      pageInfo = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.GET_PAGE_INFO,
      });
    } catch (e) {
      logger.warn('Continu: GET_PAGE_INFO fallback:', e);
    }

    // Ask content script to extract conversation
    let extraction: any = null;
    try {
      extraction = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.EXTRACT_CONVERSATION,
      });
    } catch (e) {
      logger.warn('Continu: EXTRACT_CONVERSATION fallback:', e);
    }

    const url = pageInfo?.url || tab.url || 'https://continu.local';
    const title = pageInfo?.title || tab.title || 'Captured Context';
    const platform = pageInfo?.adapter || 'chat';

    let context;
    if (extraction?.success && extraction.conversation && extraction.conversation.length > 0) {
      context = generateContext({
        url,
        title,
        platform,
        conversation: extraction.conversation,
      });
    } else {
      context = generateMinimalContext(url, title, platform);
    }

    // Save locally scoped to authenticated user
    await saveContextLocal(context, auth.userId);
    await enqueueSync(context.id, 'upsert', auth.userId).catch(err => {
      logger.warn('Continu: Background generate sync enqueue error:', err);
    });
    processSyncQueue(auth.userId).catch(err => {
      logger.warn('Continu: Background processSyncQueue error:', err);
    });

    sendResponse({ success: true, context });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generate failed';
    logger.error('Generate error:', error);
    sendResponse({ success: false, error: message });
  }
}

/**
 * Handle Drop: format context and send to active tab's composer.
 */
async function handleDrop(
  sender: chrome.runtime.MessageSender | undefined,
  contextId: string,
  format: DropFormat,
  sendResponse: (response: unknown) => void
) {
  // In COA 1, 'hidden' format corresponds to Arming the active tab's composer
  if (format === 'hidden') {
    return handleArm(sender, contextId, sendResponse);
  }

  try {
    const context = await getContextLocal(contextId);
    if (!context) {
      sendResponse({ success: false, error: 'Context not found' });
      return;
    }

    const formatted = formatContext(context, format);

    const tab = await getTargetTab(sender);
    if (!tab?.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    // Send DROP_CONTEXT to content script on active tab
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.DROP_CONTEXT,
      context,
      format,
    });

    sendResponse({
      success: result?.success ?? false,
      error: result?.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Drop failed';
    logger.error('Drop error:', error);
    sendResponse({ success: false, error: message });
  }
}

/**
 * Handle Arm: arms the composer on the active tab with the context (COA 1).
 */
async function handleArm(
  sender: chrome.runtime.MessageSender | undefined,
  contextId: string,
  sendResponse: (response: unknown) => void
) {
  try {
    const context = await getContextLocal(contextId);
    if (!context) {
      sendResponse({ success: false, error: 'Context not found' });
      return;
    }

    const tab = await getTargetTab(sender);
    if (!tab?.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.ARM_CONTEXT,
      context,
    });

    sendResponse({
      success: result?.success ?? false,
      armed: true,
      error: result?.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Arm failed';
    logger.error('Arm error:', error);
    sendResponse({ success: false, error: message });
  }
}

/**
 * Handle Disarm: disarms the composer on the active tab (COA 1).
 */
async function handleDisarm(
  sender: chrome.runtime.MessageSender | undefined,
  sendResponse: (response: unknown) => void
) {
  try {
    const tab = await getTargetTab(sender);
    if (!tab?.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.DISARM_CONTEXT,
    });

    sendResponse({
      success: result?.success ?? false,
      disarmed: true,
      error: result?.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Disarm failed';
    logger.error('Disarm error:', error);
    sendResponse({ success: false, error: message });
  }
}

/**
 * Handle Cook Prompt: refines user's draft prompt using configured AI provider.
 */
async function handleCookPrompt(
  message: any,
  sender: chrome.runtime.MessageSender | undefined,
  sendResponse: (response: unknown) => void
) {
  try {
    const auth = await checkUserAuthenticated();
    if (!auth.authenticated) {
      sendResponse({
        success: false,
        error: 'AUTH_REQUIRED',
        setupInfo: 'Please sign in to your Continu account to cook prompts.',
      });
      return;
    }

    const limitCheck = await checkRateLimit('ai:cook', RATE_LIMIT_AI_COOK);
    if (!limitCheck.allowed) {
      sendResponse({
        success: false,
        error: 'RATE_LIMIT',
        setupInfo: limitCheck.error || `Too many prompt cooking requests. Please wait ${limitCheck.retryAfterSeconds}s.`,
      });
      return;
    }
    await recordAttempt('ai:cook', RATE_LIMIT_AI_COOK);

    let prompt = message?.prompt;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      const tab = await getTargetTab(sender);
      if (tab?.id) {
        try {
          const pageInfo: any = await chrome.tabs.sendMessage(tab.id, {
            type: MessageType.GET_PAGE_INFO,
          });
          prompt = pageInfo?.draftText || '';
        } catch {}
      }
    }

    if (!prompt || !prompt.trim()) {
      sendResponse({
        success: false,
        error: 'EMPTY_PROMPT',
        setupInfo: 'Please type a draft prompt in the chatbox first before cooking.',
      });
      return;
    }

    const result = await cookPrompt(prompt);
    sendResponse(result);
  } catch (err: any) {
    sendResponse({
      success: false,
      error: 'COOK_ERROR',
      setupInfo: err?.message || 'Failed to cook prompt.',
    });
  }
}