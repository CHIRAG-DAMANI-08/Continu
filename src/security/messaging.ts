import { z } from 'zod';

/**
 * Message types for communication between content script, background, and popup
 */
export enum MessageType {
  // Content script detection
  DETECT_ADAPTER = 'DETECT_ADAPTER',
  FIND_COMPOSER = 'FIND_COMPOSER',

  // Context operations
  EXTRACT_CONVERSATION = 'EXTRACT_CONVERSATION',
  INSERT_TEXT = 'INSERT_TEXT',
  SUBMIT_TEXT = 'SUBMIT_TEXT',
  GENERATE_CONTEXT = 'GENERATE_CONTEXT',
  DROP_CONTEXT = 'DROP_CONTEXT',
  ARM_CONTEXT = 'ARM_CONTEXT',
  DISARM_CONTEXT = 'DISARM_CONTEXT',

  // Storage operations
  SAVE_CONTEXT = 'SAVE_CONTEXT',
  GET_CONTEXTS = 'GET_CONTEXTS',
  GET_CONTEXT = 'GET_CONTEXT',
  DELETE_CONTEXT = 'DELETE_CONTEXT',

  // Status & Auth
  GET_PAGE_INFO = 'GET_PAGE_INFO',
  CHECK_AUTH = 'CHECK_AUTH',

  // AI Prompt Cooking
  COOK_PROMPT = 'COOK_PROMPT',
  GET_AI_STATUS = 'GET_AI_STATUS',

  // Remote Database Sync
  SYNC_REMOTE = 'SYNC_REMOTE',
}

// Message schemas for validation at trust boundaries
const baseMessageSchema = z.object({
  type: z.nativeEnum(MessageType),
});

export const detectAdapterMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.DETECT_ADAPTER),
});

export const insertTextMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.INSERT_TEXT),
  text: z.string().max(100000),
});

export const submitTextMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.SUBMIT_TEXT),
  text: z.string().max(100000),
});

export const extractConversationMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.EXTRACT_CONVERSATION),
});

export const generateContextMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.GENERATE_CONTEXT),
});

export const dropContextMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.DROP_CONTEXT),
  contextId: z.string().uuid(),
  format: z.enum(['hidden', 'structured', 'full', 'compact']),
});

export const getContextMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.GET_CONTEXT),
  contextId: z.string().uuid(),
});

export const deleteContextMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.DELETE_CONTEXT),
  contextId: z.string().uuid(),
});

export const cookPromptMessageSchema = baseMessageSchema.extend({
  type: z.literal(MessageType.COOK_PROMPT),
  prompt: z.string().max(100000).optional(),
});

/**
 * Validate an incoming message at the trust boundary.
 * Returns the parsed type or null if invalid.
 */
export function validateMessage(message: unknown): { type: MessageType } | null {
  const result = baseMessageSchema.safeParse(message);
  if (!result.success) {
    console.warn('Invalid message received:', result.error.issues);
    return null;
  }
  return result.data;
}

/**
 * Response types
 */
export interface DetectAdapterResponse {
  adapter: string | null;
  platform: string | null;
}

export interface FindComposerResponse {
  found: boolean;
}

export interface ExtractConversationResponse {
  success: boolean;
  conversation?: Array<{ role: string; content: string; timestamp: string }>;
  error?: string;
}

export interface InsertTextResponse {
  success: boolean;
  error?: string;
}

export interface SubmitTextResponse {
  success: boolean;
  error?: string;
}

export interface PageInfoResponse {
  url: string;
  title: string;
  adapter: string | null;
  composerFound: boolean;
}
