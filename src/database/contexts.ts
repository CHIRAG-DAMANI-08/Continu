import type { ContinuContext } from '../contexts/model';
import { sanitizeContext } from '../contexts/validation';
import { encrypt, decrypt, deriveUserEncryptionKey } from '../security/encryption';
import { getSupabaseClient } from './supabase';

/**
 * Save a context to Supabase with end-to-end client-side encryption.
 * The context content is NEVER sent in plaintext to the database.
 * Requires authenticated Supabase client and user ID.
 */
export async function saveContextRemote(context: ContinuContext, userId: string): Promise<void> {
  if (!userId) {
    throw new Error('User ID is required to encrypt and save context');
  }

  const supabase = getSupabaseClient();

  // 1. Ensure user profile exists (required by foreign key)
  try {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        updated_at: new Date().toISOString(),
      });

    if (profileError && !profileError.message?.includes('duplicate key')) {
      console.warn(`Continu: Profile initialization notice: ${profileError.message}`);
    }
  } catch (profileErr) {
    console.warn('Continu: Profile upsert error:', profileErr);
  }

  // 2. Sanitize context input
  const cleanContext = sanitizeContext(context);

  // 3. Derive user's client-side encryption key
  const key = await deriveUserEncryptionKey(userId);

  // 4. Encrypt full context JSON payload with AES-256-GCM
  const encrypted = await encrypt(JSON.stringify(cleanContext), key);

  // 5. Store ONLY encrypted ciphertext in Supabase
  const { error } = await supabase
    .from('continu_contexts')
    .upsert({
      id: cleanContext.id,
      user_id: userId,
      encrypted_payload: encrypted.ciphertext,
      encryption_iv: encrypted.iv,
      encryption_version: encrypted.version,
      created_at: cleanContext.createdAt,
      updated_at: cleanContext.updatedAt,
    });

  if (error) {
    throw new Error(`Failed to save encrypted context: ${error.message}`);
  }
}

/**
 * Get all contexts for the authenticated user and decrypt them client-side.
 */
export async function getContextsRemote(userId: string): Promise<ContinuContext[]> {
  if (!userId) {
    throw new Error('User ID is required to fetch and decrypt contexts');
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('continu_contexts')
    .select('id, encrypted_payload, encryption_iv, encryption_version')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch contexts: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  const key = await deriveUserEncryptionKey(userId);
  const contexts: ContinuContext[] = [];

  for (const row of data) {
    try {
      if (row.encrypted_payload && row.encryption_iv) {
        const plaintext = await decrypt(
          {
            iv: row.encryption_iv,
            ciphertext: row.encrypted_payload,
            version: row.encryption_version,
          },
          key
        );
        contexts.push(JSON.parse(plaintext) as ContinuContext);
      } else if ((row as any).payload) {
        // Fallback for any legacy unencrypted rows
        const raw = typeof (row as any).payload === 'string' ? JSON.parse((row as any).payload) : (row as any).payload;
        contexts.push(raw as ContinuContext);
      }
    } catch (decryptErr) {
      console.warn(`Continu: unable to decrypt context ${row.id}`, decryptErr);
    }
  }

  return contexts;
}

/**
 * Get a single context by ID and decrypt client-side.
 */
export async function getContextRemote(id: string, userId: string): Promise<ContinuContext | null> {
  if (!userId) {
    throw new Error('User ID is required to fetch and decrypt context');
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('continu_contexts')
    .select('id, encrypted_payload, encryption_iv, encryption_version')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to fetch context: ${error.message}`);
  }

  if (!data) return null;

  const key = await deriveUserEncryptionKey(userId);
  const plaintext = await decrypt(
    {
      iv: data.encryption_iv,
      ciphertext: data.encrypted_payload,
      version: data.encryption_version,
    },
    key
  );

  return JSON.parse(plaintext) as ContinuContext;
}

/**
 * Delete a context by ID.
 */
export async function deleteContextRemote(id: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('continu_contexts')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete context: ${error.message}`);
  }
}
