import { describe, it, expect } from 'vitest';
import {
  deriveKey,
  encrypt,
  decrypt,
  generateRandomBytes,
  bufferToBase64,
  base64ToBuffer,
  deriveUserEncryptionKey,
} from './encryption';

describe('Encryption Module', () => {
  it('encodes and decodes base64 buffers correctly', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const b64 = bufferToBase64(original);
    const decoded = base64ToBuffer(b64);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('generates random bytes of specified length', () => {
    const bytes1 = generateRandomBytes(16);
    const bytes2 = generateRandomBytes(16);
    expect(bytes1.length).toBe(16);
    expect(bytes2.length).toBe(16);
    expect(bytes1).not.toEqual(bytes2);
  });

  it('derives a key and performs round-trip encryption and decryption', async () => {
    const salt = generateRandomBytes(16);
    const secret = 'user_test12345';
    const key = await deriveKey(secret, salt);

    const plaintext = JSON.stringify({
      name: 'Confidential Context',
      decisions: ['Keep it secret', 'Client-side only'],
      objective: 'Zero knowledge sync',
    });

    const encrypted = await encrypt(plaintext, key);

    // Ciphertext must not contain any plaintext fragments
    expect(encrypted.ciphertext).not.toContain('Confidential Context');
    expect(encrypted.ciphertext).not.toContain('Keep it secret');
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.version).toBe(1);

    // Decrypt with the same key
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
    const parsed = JSON.parse(decrypted);
    expect(parsed.name).toBe('Confidential Context');
  });

  it('fails decryption with an incorrect key', async () => {
    const salt = generateRandomBytes(16);
    const key1 = await deriveKey('user_alice', salt);
    const key2 = await deriveKey('user_bob', salt);

    const plaintext = 'Top Secret Data';
    const encrypted = await encrypt(plaintext, key1);

    await expect(decrypt(encrypted, key2)).rejects.toThrow();
  });

  it('generates unique IVs for each encryption call (prevent nonce reuse)', async () => {
    const salt = generateRandomBytes(16);
    const key = await deriveKey('user_alice', salt);

    const plaintext = 'Identical plaintext message';
    const enc1 = await encrypt(plaintext, key);
    const enc2 = await encrypt(plaintext, key);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    // Both decrypt to the same plaintext
    expect(await decrypt(enc1, key)).toBe(plaintext);
    expect(await decrypt(enc2, key)).toBe(plaintext);
  });

  it('derives user encryption key with deriveUserEncryptionKey', async () => {
    const salt = generateRandomBytes(16);
    const key = await deriveUserEncryptionKey('user_2xyz123', salt);
    const plaintext = 'Secret user payload';
    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });
});
