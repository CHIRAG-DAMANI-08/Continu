import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContinuContext } from '../contexts/model';
import { deriveUserEncryptionKey, encrypt } from '../security/encryption';

// Mock Supabase client
const mockUpsert = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockDelete = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === 'profiles') {
    return {
      upsert: mockUpsert.mockResolvedValue({ error: null }),
    };
  }
  if (table === 'continu_contexts') {
    return {
      upsert: mockUpsert.mockResolvedValue({ error: null }),
      select: mockSelect.mockReturnValue({
        order: mockOrder,
        eq: mockEq.mockReturnValue({
          single: mockSingle,
        }),
      }),
      delete: mockDelete.mockReturnValue({
        eq: mockEq.mockResolvedValue({ error: null }),
      }),
    };
  }
  return {};
});

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
    rest: { headers: {} },
  }),
  isSupabaseConfigured: () => true,
  setSupabaseAuth: vi.fn(),
}));

import { saveContextRemote, getContextsRemote, deleteContextRemote } from './contexts';

describe('Encrypted Database Contexts', () => {
  const sampleContext: ContinuContext = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    schemaVersion: 1,
    name: 'Top Secret Research',
    source: {
      platform: 'chatgpt',
      url: 'https://chatgpt.com/c/123',
      title: 'Confidential Thread',
    },
    objective: 'Build proprietary quantum algorithms',
    currentState: 'Implementing proof-of-concept',
    decisions: ['Use client-side AES-256-GCM', 'Zero-knowledge database storage'],
    requirements: ['Never store plaintext in database', 'Only user can decrypt'],
    constraints: ['No unencrypted leakage'],
    openQuestions: ['How fast is PBKDF2?'],
    nextActions: ['Deploy to production'],
    conversation: [
      { role: 'user', content: 'What is the secret formula?', timestamp: '2026-09-08T12:00:00.000Z' },
      { role: 'assistant', content: 'Here is the formula...', timestamp: '2026-09-08T12:00:01.000Z' },
    ],
    createdAt: '2026-09-08T12:00:00.000Z',
    updatedAt: '2026-09-08T12:00:00.000Z',
  };

  const testUserId = 'user_supabase_test_999';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves context as encrypted ciphertext and NEVER sends plaintext to Supabase', async () => {
    await saveContextRemote(sampleContext, testUserId);

    // Profile upsert was called
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: testUserId,
      })
    );

    // Context upsert was called
    expect(mockFrom).toHaveBeenCalledWith('continu_contexts');
    
    // Find the call for continu_contexts
    const contextUpsertArgs = mockUpsert.mock.calls.find(call => call[0].id === sampleContext.id)?.[0];
    expect(contextUpsertArgs).toBeDefined();

    // Verify critical zero-knowledge properties
    expect(contextUpsertArgs.id).toBe(sampleContext.id);
    expect(contextUpsertArgs.user_id).toBe(testUserId);
    expect(contextUpsertArgs.encrypted_payload).toBeDefined();
    expect(typeof contextUpsertArgs.encrypted_payload).toBe('string');
    expect(contextUpsertArgs.encryption_iv).toBeDefined();
    expect(contextUpsertArgs.encryption_version).toBe(1);

    // CRITICAL: Plaintext content must NOT appear anywhere in the saved DB row
    expect(contextUpsertArgs.encrypted_payload).not.toContain('Top Secret Research');
    expect(contextUpsertArgs.encrypted_payload).not.toContain('proprietary quantum algorithms');
    expect(contextUpsertArgs.encrypted_payload).not.toContain('What is the secret formula?');
    expect(contextUpsertArgs.name).toBeUndefined();
    expect(contextUpsertArgs.payload).toBeUndefined();
    expect(contextUpsertArgs.source_platform).toBeUndefined();
    expect(contextUpsertArgs.source_url).toBeUndefined();
  });

  it('fetches encrypted rows and decrypts them back to original plaintext contexts', async () => {
    // Encrypt sample context
    const key = await deriveUserEncryptionKey(testUserId);
    const enc = await encrypt(JSON.stringify(sampleContext), key);

    // Mock remote database response
    mockOrder.mockResolvedValue({
      data: [
        {
          id: sampleContext.id,
          encrypted_payload: enc.ciphertext,
          encryption_iv: enc.iv,
          encryption_version: enc.version,
        },
      ],
      error: null,
    });

    const results = await getContextsRemote(testUserId);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Top Secret Research');
    expect(results[0].objective).toBe('Build proprietary quantum algorithms');
    expect(results[0].decisions).toEqual(['Use client-side AES-256-GCM', 'Zero-knowledge database storage']);
    expect(results[0].conversation[0].content).toBe('What is the secret formula?');
  });

  it('deletes context by ID from Supabase', async () => {
    await deleteContextRemote(sampleContext.id);
    expect(mockFrom).toHaveBeenCalledWith('continu_contexts');
    expect(mockDelete).toHaveBeenCalled();
  });
});
