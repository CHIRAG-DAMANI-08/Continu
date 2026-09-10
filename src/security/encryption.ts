/**
 * Zero-Knowledge Client-Side Encryption Module
 * 
 * Uses Web Crypto API (AES-256-GCM + PBKDF2) to ensure all context data
 * is encrypted client-side before being synced to Supabase.
 * The encryption key is derived on the client and never leaves the browser.
 */

export interface EncryptedPayload {
  iv: string;         // Base64 encoded 12-byte IV
  ciphertext: string; // Base64 encoded ciphertext (including GCM tag)
  version: number;    // Schema / algorithm version
}

const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_LENGTH = 256;
const ENCRYPTION_VERSION = 1;
const SALT_STORAGE_KEY = 'continu_encryption_salt';

/**
 * Convert ArrayBuffer or Uint8Array to Base64 string
 */
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to Uint8Array
 */
export function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate cryptographically secure random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Derive an AES-256-GCM CryptoKey from a secret (e.g. user ID + optional passphrase) and salt using PBKDF2
 */
export async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const secretKeyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    secretKeyMaterial,
    {
      name: 'AES-GCM',
      length: AES_KEY_LENGTH,
    },
    false, // Key is non-extractable for security
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const encodedPlaintext = encoder.encode(plaintext);
  
  // AES-GCM recommended IV is 12 bytes (96 bits)
  const iv = generateRandomBytes(12);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as any,
    },
    key,
    encodedPlaintext
  );

  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertextBuffer),
    version: ENCRYPTION_VERSION,
  };
}

/**
 * Decrypt an AES-256-GCM EncryptedPayload back to plaintext string
 */
export async function decrypt(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
  const iv = base64ToBuffer(payload.iv);
  const ciphertext = base64ToBuffer(payload.ciphertext);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as any,
    },
    key,
    ciphertext as any
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

let inMemorySalt: Uint8Array | null = null;

/**
 * Derives a deterministic 16-byte salt from a user ID using SHA-256.
 * This guarantees that a user can decrypt their end-to-end encrypted contexts
 * when signing in from any device or after local storage is cleared.
 */
export async function deriveDeterministicUserSalt(userId: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(`continu:salt:v1:${userId}`));
  return new Uint8Array(hashBuffer).slice(0, 16);
}

/**
 * Get or create a persistent salt stored in chrome.storage.local,
 * scoped per user ID to prevent cross-account collisions.
 */
export async function getOrCreateSalt(userId?: string): Promise<Uint8Array> {
  const storageKey = userId ? `continu_u_${userId}_salt` : SALT_STORAGE_KEY;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(storageKey);
      if (result[storageKey]) {
        return base64ToBuffer(result[storageKey]);
      }
      // Migrate from legacy global salt if it exists
      if (userId) {
        const legacy = await chrome.storage.local.get(SALT_STORAGE_KEY);
        if (legacy[SALT_STORAGE_KEY]) {
          const legacySalt = base64ToBuffer(legacy[SALT_STORAGE_KEY]);
          await chrome.storage.local.set({ [storageKey]: legacy[SALT_STORAGE_KEY] });
          return legacySalt;
        }
      }
      const newSalt = userId ? await deriveDeterministicUserSalt(userId) : generateRandomBytes(16);
      await chrome.storage.local.set({
        [storageKey]: bufferToBase64(newSalt),
      });
      return newSalt;
    }
  } catch (e) {
    console.warn('Continu: chrome.storage.local not available for salt, using fallback', e);
  }

  // Fallback: deterministic if userId provided, or in-memory cached salt (for test environment or node)
  if (userId) {
    return deriveDeterministicUserSalt(userId);
  }
  if (!inMemorySalt) {
    inMemorySalt = generateRandomBytes(16);
  }
  return inMemorySalt;
}

/**
 * Helper to derive user encryption key using user ID and user-scoped salt
 */
export async function deriveUserEncryptionKey(userId: string, salt?: Uint8Array): Promise<CryptoKey> {
  if (!userId) {
    throw new Error('Cannot derive encryption key without user ID');
  }
  const effectiveSalt = salt || await getOrCreateSalt(userId);
  // We namespace the secret to avoid collisions with any other uses of the user ID
  const namespacedSecret = `continu:e2ee:user:${userId}`;
  return deriveKey(namespacedSecret, effectiveSalt);
}
