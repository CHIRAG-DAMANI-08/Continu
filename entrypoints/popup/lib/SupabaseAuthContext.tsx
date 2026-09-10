import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../../src/database/supabase';
import { clearAllContextsLocal, purgeAllLegacyUnscopedContexts } from '../../../src/contexts/storage';
import { clearSyncQueue, syncContextsWithRemote } from '../../../src/database/sync';
import { checkRateLimit, recordAttempt, RATE_LIMIT_SIGN_OUT } from '../../../src/security/rate-limiter';
import { logger } from '../../../src/utils/logger';

interface SupabaseAuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextValue>({
  session: null,
  user: null,
  isLoading: true,
  signOut: async () => {},
});

export function useSupabaseAuth() {
  return useContext(SupabaseAuthContext);
}

interface SupabaseAuthProviderProps {
  children: React.ReactNode;
}

export function SupabaseAuthProvider({ children }: SupabaseAuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setIsLoading(false);

      try {
        const currentUserId = currentSession?.user?.id || null;
        const prev = await chrome.storage?.local?.get(['continu_user_id']);
        const prevUserId = prev?.continu_user_id;

        if (!currentUserId) {
          if (prevUserId) {
            await clearAllContextsLocal(prevUserId);
            await clearSyncQueue(prevUserId);
          }
          await purgeAllLegacyUnscopedContexts();
          await clearSyncQueue();
          await chrome.storage?.local?.set({
            continu_user_authenticated: false,
            continu_user_id: null,
          });
        } else if (prevUserId && prevUserId !== currentUserId) {
          // Account switch detected! Purge old user's local contexts
          await clearAllContextsLocal(prevUserId);
          await clearSyncQueue(prevUserId);
          await purgeAllLegacyUnscopedContexts();
          await chrome.storage?.local?.set({
            continu_user_authenticated: true,
            continu_user_id: currentUserId,
          });
          syncContextsWithRemote(currentUserId).catch(err => {
            logger.warn('Continu: Account switch auto-sync error:', err);
          });
        } else {
          await chrome.storage?.local?.set({
            continu_user_authenticated: !!currentUserId,
            continu_user_id: currentUserId,
          });
          syncContextsWithRemote(currentUserId).catch(err => {
            logger.warn('Continu: Init session auto-sync error:', err);
          });
        }
      } catch (err) {
        logger.warn('Continu: Init session storage check error:', err);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        setIsLoading(false);

        try {
          const newUserId = newSession?.user?.id || null;
          const prev = await chrome.storage?.local?.get(['continu_user_id']);
          const prevUserId = prev?.continu_user_id;

          if (event === 'SIGNED_OUT' || !newUserId) {
            if (prevUserId) {
              await clearAllContextsLocal(prevUserId);
              await clearSyncQueue(prevUserId);
            }
            await purgeAllLegacyUnscopedContexts();
            await clearSyncQueue();
            await chrome.storage?.local?.set({
              continu_user_authenticated: false,
              continu_user_id: null,
            });
          } else if (prevUserId && prevUserId !== newUserId) {
            // Account switch detected! Purge previous user's contexts immediately
            await clearAllContextsLocal(prevUserId);
            await clearSyncQueue(prevUserId);
            await purgeAllLegacyUnscopedContexts();
            await chrome.storage?.local?.set({
              continu_user_authenticated: true,
              continu_user_id: newUserId,
            });
            syncContextsWithRemote(newUserId).catch(err => {
              logger.warn('Continu: Auth account switch auto-sync error:', err);
            });
          } else {
            await chrome.storage?.local?.set({
              continu_user_authenticated: !!newUserId,
              continu_user_id: newUserId,
            });
            syncContextsWithRemote(newUserId).catch(err => {
              logger.warn('Continu: Auth state change auto-sync error:', err);
            });
          }
        } catch (err) {
          logger.warn('Continu: Auth state change storage error:', err);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const isSigningOutRef = useRef(false);

  const signOut = async () => {
    if (isSigningOutRef.current) return;

    const rateCheck = await checkRateLimit('auth:signout', RATE_LIMIT_SIGN_OUT);
    if (!rateCheck.allowed) {
      logger.warn(`Continu: Sign-out throttled: wait ${rateCheck.retryAfterSeconds}s.`);
      return;
    }

    isSigningOutRef.current = true;
    const supabase = getSupabaseClient();
    const currentUserId = session?.user?.id;

    try {
      await recordAttempt('auth:signout', RATE_LIMIT_SIGN_OUT);

      if (currentUserId) {
        await clearAllContextsLocal(currentUserId);
        await clearSyncQueue(currentUserId);
      }
      await purgeAllLegacyUnscopedContexts();
      await clearSyncQueue();
      await chrome.storage?.local?.set({
        continu_user_authenticated: false,
        continu_user_id: null,
      });
    } catch (e) {
      logger.warn('Continu: Cleanup during signOut notice:', e);
    } finally {
      try {
        await supabase.auth.signOut();
      } finally {
        setSession(null);
        isSigningOutRef.current = false;
      }
    }
  };

  const value: SupabaseAuthContextValue = {
    session,
    user: session?.user ?? null,
    isLoading,
    signOut,
  };

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}
