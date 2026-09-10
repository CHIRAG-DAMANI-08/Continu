/**
 * Client-Side Rate Limiter with Sliding Window and Cooldown Support
 * Prevents credential brute-forcing, flood abuse, upstream quota exhaustion,
 * and concurrent state corruption across popup reloads.
 */

export interface RateLimitOptions {
  maxRequests: number; // Maximum attempts allowed within the sliding window
  windowMs: number; // Sliding window duration in milliseconds
  lockoutMs?: number; // Lockout duration when limit is exceeded (defaults to windowMs)
  cooldownMs?: number; // Minimum gap in milliseconds between consecutive calls
  enforceInTest?: boolean; // Force rate limit enforcement during unit tests
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  error?: string;
}

interface ActionRecord {
  timestamps: number[];
  lockoutUntil?: number;
  lastAttempt?: number;
}

const STORAGE_KEY = 'continu_rate_limits';

// In-memory cache for fast sync checks and non-browser/test environments
const memoryCache = new Map<string, ActionRecord>();

async function loadRecords(): Promise<Record<string, ActionRecord>> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const stored = data?.[STORAGE_KEY];
      if (stored && typeof stored === 'object') {
        return stored as Record<string, ActionRecord>;
      }
    }
  } catch {
    // Fall back to in-memory
  }

  const mapObj: Record<string, ActionRecord> = {};
  for (const [key, value] of memoryCache.entries()) {
    mapObj[key] = value;
  }
  return mapObj;
}

async function saveRecords(records: Record<string, ActionRecord>): Promise<void> {
  // Update memory cache
  for (const [key, value] of Object.entries(records)) {
    memoryCache.set(key, value);
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: records });
    }
  } catch {
    // Ignore storage write errors in restricted or test environments
  }
}

/**
 * Check if an action is currently allowed under the rate limit policy.
 * Does NOT record the attempt.
 */
export async function checkRateLimit(
  actionKey: string,
  options: RateLimitOptions,
  now = Date.now()
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === 'test' && !options.enforceInTest) {
    return {
      allowed: true,
      remaining: options.maxRequests,
      retryAfterSeconds: 0,
    };
  }

  const records = await loadRecords();
  const record = records[actionKey] || { timestamps: [] };

  // 1. Check if currently locked out
  if (record.lockoutUntil && record.lockoutUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((record.lockoutUntil - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: retryAfter,
      error: `Too many attempts. Please wait ${retryAfter}s before trying again.`,
    };
  }

  // 2. Check cooldown between consecutive actions
  if (options.cooldownMs && record.lastAttempt) {
    const elapsed = now - record.lastAttempt;
    if (elapsed < options.cooldownMs) {
      const retryAfter = Math.max(1, Math.ceil((options.cooldownMs - elapsed) / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: retryAfter,
        error: `Please wait ${retryAfter}s before retrying.`,
      };
    }
  }

  // 3. Sliding window filter: discard timestamps older than windowMs
  const validTimestamps = (record.timestamps || []).filter(t => now - t < options.windowMs);

  if (validTimestamps.length >= options.maxRequests) {
    const oldestTimestamp = validTimestamps[0];
    const lockout = options.lockoutMs || options.windowMs;
    const retryAfter = Math.max(1, Math.ceil((oldestTimestamp + lockout - now) / 1000));

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: retryAfter,
      error: `Rate limit reached. Try again in ${retryAfter}s.`,
    };
  }

  return {
    allowed: true,
    remaining: options.maxRequests - validTimestamps.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Record an attempt for an action.
 * Updates timestamps and triggers lockout if the threshold is reached.
 */
export async function recordAttempt(
  actionKey: string,
  options: RateLimitOptions,
  now = Date.now()
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === 'test' && !options.enforceInTest) {
    return {
      allowed: true,
      remaining: options.maxRequests,
      retryAfterSeconds: 0,
    };
  }

  const records = await loadRecords();
  const record = records[actionKey] || { timestamps: [] };

  // Purge old timestamps
  const validTimestamps = (record.timestamps || []).filter(t => now - t < options.windowMs);
  validTimestamps.push(now);

  let lockoutUntil: number | undefined = undefined;
  if (options.lockoutMs && validTimestamps.length >= options.maxRequests) {
    lockoutUntil = now + options.lockoutMs;
  }

  records[actionKey] = {
    timestamps: validTimestamps,
    lastAttempt: now,
    lockoutUntil,
  };

  await saveRecords(records);

  const atOrOverLimit = validTimestamps.length >= options.maxRequests;
  let retryAfter = 0;

  if (lockoutUntil) {
    retryAfter = Math.max(1, Math.ceil((lockoutUntil - now) / 1000));
  } else if (atOrOverLimit) {
    const oldest = validTimestamps[0];
    retryAfter = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
  }

  const isExceeded = !!lockoutUntil || atOrOverLimit;

  return {
    allowed: !isExceeded,
    remaining: Math.max(0, options.maxRequests - validTimestamps.length),
    retryAfterSeconds: retryAfter,
    error: isExceeded ? `Rate limit exceeded. Try again in ${retryAfter}s.` : undefined,
  };
}

/**
 * Reset rate limit counter for a specific action (e.g. after successful sign in).
 */
export async function resetRateLimit(actionKey: string): Promise<void> {
  const records = await loadRecords();
  if (records[actionKey]) {
    delete records[actionKey];
    memoryCache.delete(actionKey);
    await saveRecords(records);
  }
}

/**
 * Clear all rate limit records (for testing or complete cache purges).
 */
export async function clearAllRateLimits(): Promise<void> {
  memoryCache.clear();
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove(STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

// Pre-configured rate limiting policies
export const RATE_LIMIT_SIGN_IN: RateLimitOptions = {
  maxRequests: 5,
  windowMs: 60_000,
  lockoutMs: 60_000,
};

export const RATE_LIMIT_SIGN_UP: RateLimitOptions = {
  maxRequests: 3,
  windowMs: 60_000,
  lockoutMs: 60_000,
};

export const RATE_LIMIT_SIGN_OUT: RateLimitOptions = {
  maxRequests: 1,
  windowMs: 3_000,
  cooldownMs: 3_000,
};

export const RATE_LIMIT_AI_COOK: RateLimitOptions = {
  maxRequests: 10,
  windowMs: 60_000,
  cooldownMs: 2_000,
};

export const RATE_LIMIT_AI_MODELS: RateLimitOptions = {
  maxRequests: 10,
  windowMs: 60_000,
  cooldownMs: 1_000,
};
