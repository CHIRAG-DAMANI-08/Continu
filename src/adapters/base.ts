import type { ConversationTurn } from '../contexts/model';

export interface AIAdapter {
  /** Unique adapter name (e.g. 'chatgpt', 'claude') */
  name: string;

  /** Returns true if this adapter matches the current page */
  detect(): boolean;

  /** Find the composer/input element on the page */
  findComposer(): Element | null;

  /** Find the submit/send button for the composer */
  findSubmitButton(): Element | null;

  /** Find the attachment/upload button in the composer toolbar if present */
  findAttachButton?(): Element | null;

  /** Find the file upload input element on the page */
  findFileInput?(): HTMLInputElement | null;

  /** Extract conversation turns from the page DOM */
  extractConversation(): ConversationTurn[];

  /** Get current text in the composer */
  getComposerText(): string;

  /** Insert text into the composer */
  insertText(text: string): void;

  /** Insert text and immediately trigger submit/send */
  submitText(text: string): Promise<boolean>;
}
