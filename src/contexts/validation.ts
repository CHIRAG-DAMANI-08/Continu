import { z } from 'zod';
import {
  MAX_NAME_LENGTH,
  MAX_STRING_FIELD_LENGTH,
  MAX_ARRAY_ITEMS,
  MAX_CONVERSATION_TURNS,
  type ContinuContext,
} from './model';

const conversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_STRING_FIELD_LENGTH),
  timestamp: z.string().max(100),
});

export const contextSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  source: z.object({
    platform: z.string().max(100),
    url: z.string().min(1).max(2000),
    title: z.string().max(MAX_NAME_LENGTH),
  }),
  objective: z.string().max(MAX_STRING_FIELD_LENGTH),
  currentState: z.string().max(MAX_STRING_FIELD_LENGTH),
  decisions: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  requirements: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  constraints: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  openQuestions: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  nextActions: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  conversation: z.array(conversationTurnSchema).max(MAX_CONVERSATION_TURNS),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ValidatedContext = z.infer<typeof contextSchema>;

/**
 * Sanitize untrusted text input:
 * 1. Normalize Unicode (NFKC)
 * 2. Remove null bytes (\0)
 * 3. Remove dangerous unprintable ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)
 *    preserving legitimate whitespace (\t, \n, \r)
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKC')
    .replace(/\0/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize all string fields within a context before storage, encryption, or display
 */
export function sanitizeContext<T extends Partial<ContinuContext>>(context: T): T {
  if (!context || typeof context !== 'object') return context;

  const result = { ...context } as any;

  if (typeof result.name === 'string') {
    result.name = sanitizeString(result.name).slice(0, MAX_NAME_LENGTH);
  }

  if (result.source && typeof result.source === 'object') {
    result.source = {
      ...result.source,
      platform: sanitizeString(result.source.platform || '').slice(0, 100),
      url: sanitizeString(result.source.url || '').slice(0, 2000),
      title: sanitizeString(result.source.title || '').slice(0, MAX_NAME_LENGTH),
    };
  }

  if (typeof result.objective === 'string') {
    result.objective = sanitizeString(result.objective).slice(0, MAX_STRING_FIELD_LENGTH);
  }

  if (typeof result.currentState === 'string') {
    result.currentState = sanitizeString(result.currentState).slice(0, MAX_STRING_FIELD_LENGTH);
  }

  const arrayFields = ['decisions', 'requirements', 'constraints', 'openQuestions', 'nextActions'] as const;
  for (const field of arrayFields) {
    if (Array.isArray(result[field])) {
      result[field] = result[field]
        .slice(0, MAX_ARRAY_ITEMS)
        .filter((item: unknown) => typeof item === 'string')
        .map((item: string) => sanitizeString(item).slice(0, MAX_STRING_FIELD_LENGTH));
    }
  }

  if (Array.isArray(result.conversation)) {
    result.conversation = result.conversation
      .slice(0, MAX_CONVERSATION_TURNS)
      .map((turn: any) => ({
        role: turn?.role === 'assistant' ? 'assistant' : 'user',
        content: sanitizeString(turn?.content || '').slice(0, MAX_STRING_FIELD_LENGTH),
        timestamp: sanitizeString(turn?.timestamp || '').slice(0, 100),
      }));
  }

  return result;
}

export function validateContext(input: unknown) {
  return contextSchema.safeParse(input);
}

/**
 * Validate a partial context for import - more lenient on optional fields
 */
export function validatePartialContext(input: unknown) {
  const partialSchema = contextSchema.partial({
    objective: true,
    currentState: true,
    decisions: true,
    requirements: true,
    constraints: true,
    openQuestions: true,
    nextActions: true,
    conversation: true,
  });
  return partialSchema.safeParse(input);
}

