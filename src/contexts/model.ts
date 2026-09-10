export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ContinuContext {
  id: string;
  schemaVersion: number;
  name: string;
  source: {
    platform: string;
    url: string;
    title: string;
  };
  objective: string;
  currentState: string;
  decisions: string[];
  requirements: string[];
  constraints: string[];
  openQuestions: string[];
  nextActions: string[];
  conversation: ConversationTurn[];
  createdAt: string;
  updatedAt: string;
}

export const SCHEMA_VERSION = 1;
export const MAX_NAME_LENGTH = 500;
export const MAX_STRING_FIELD_LENGTH = 500000;
export const MAX_ARRAY_ITEMS = 1000;
export const MAX_CONVERSATION_TURNS = 500;
