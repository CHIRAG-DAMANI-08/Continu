import type { ContinuContext } from './model';

export type DropFormat = 'hidden' | 'structured' | 'full' | 'compact';

/**
 * Format a context for dropping into a composer.
 * Formats:
 * - 'hidden' (default): Full context + ALL conversation turns + directive for "Got the context, let's go!"
 * - 'structured': Markdown sections with headers (Objective, State, Decisions, Requirements, Constraints, Questions, Actions)
 * - 'compact': Essential continuation info for token savings
 * - 'full': Structured context + full conversation transcript
 */
export function formatContext(context: ContinuContext, format: DropFormat): string {
  switch (format) {
    case 'hidden':
      return formatHiddenTransfer(context);
    case 'structured':
      return formatStructured(context);
    case 'full':
      return formatFull(context);
    case 'compact':
      return formatCompact(context);
  }
}

/**
 * Formats a user prompt bundled with an armed context (COA 1).
 * Includes structured context reference along with prior conversation history
 * so the AI answers directly with full memory of earlier turns.
 */
export function formatPromptWithContext(context: ContinuContext, userPrompt: string): string {
  const parts: string[] = [];

  parts.push(`[Reference Context: ${context.name}]`);
  if (context.objective) parts.push(`Goal: ${context.objective}`);
  if (context.currentState) parts.push(`State: ${context.currentState}`);
  if (context.decisions && context.decisions.length > 0) {
    parts.push(`Decisions: ${context.decisions.join('; ')}`);
  }
  if (context.nextActions && context.nextActions.length > 0) {
    parts.push(`Next: ${context.nextActions.join('; ')}`);
  }

  if (context.conversation && context.conversation.length > 0) {
    parts.push('');
    parts.push('[Prior Conversation History]:');
    context.conversation.forEach(turn => {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      parts.push(`${role}: ${turn.content}`);
    });
  }

  const trimmedPrompt = (userPrompt || '').trim();
  const effectivePrompt = trimmedPrompt || 'Please review this context, summarize current status, and advise on next steps.';

  parts.push('');
  parts.push(effectivePrompt);

  return parts.join('\n');
}

/**
 * 1-Click context transfer format:
 * Ingests distilled context (Objective, State, Decisions, Requirements) plus
 * the complete conversation transcript into the receiving model's session memory.
 * Directs the receiving AI to ingest the state and acknowledge: "Got the context, let's go! What are we working on?"
 */
export function formatHiddenTransfer(context: ContinuContext): string {
  const parts: string[] = ['[CONTINU CONTEXT TRANSFER]'];

  parts.push(`Topic: ${context.name}`);
  if (context.source?.platform) {
    parts.push(`Source: ${context.source.platform}`);
  }

  if (context.objective) {
    parts.push(`Goal: ${context.objective}`);
  }

  if (context.currentState) {
    parts.push(`State: ${context.currentState}`);
  }

  if (context.decisions && context.decisions.length > 0) {
    parts.push(`Decisions: ${context.decisions.join('; ')}`);
  }

  if (context.requirements && context.requirements.length > 0) {
    parts.push(`Requirements: ${context.requirements.join('; ')}`);
  }

  if (context.constraints && context.constraints.length > 0) {
    parts.push(`Constraints: ${context.constraints.join('; ')}`);
  }

  if (context.nextActions && context.nextActions.length > 0) {
    parts.push(`Next: ${context.nextActions.join('; ')}`);
  }

  if (context.conversation && context.conversation.length > 0) {
    parts.push('');
    parts.push('[Full Conversation History]:');
    context.conversation.forEach(turn => {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      parts.push(`${role}: ${turn.content}`);
    });
  }

  parts.push('');
  parts.push(
    `[DIRECTIVE: Ingest this entire conversation history and context into session memory. Respond with EXACTLY and ONLY: "Got the context, let's go! What are we working on?" Do not summarize or repeat this context.]`
  );

  return parts.join('\n');
}

/**
 * Structured format: Objective, state, decisions, requirements, constraints, questions, actions, and conversation history.
 */
function formatStructured(context: ContinuContext): string {
  const sections: string[] = [];

  sections.push(`# Context: ${context.name}`);
  sections.push(`Source: ${context.source.platform} (${context.source.title})`);
  sections.push('');

  if (context.objective) {
    sections.push(`## Objective`);
    sections.push(context.objective);
    sections.push('');
  }

  if (context.currentState) {
    sections.push(`## Current State`);
    sections.push(context.currentState);
    sections.push('');
  }

  if (context.decisions && context.decisions.length > 0) {
    sections.push(`## Decisions Made`);
    context.decisions.forEach(d => sections.push(`- ${d}`));
    sections.push('');
  }

  if (context.requirements && context.requirements.length > 0) {
    sections.push(`## Requirements`);
    context.requirements.forEach(r => sections.push(`- ${r}`));
    sections.push('');
  }

  if (context.constraints && context.constraints.length > 0) {
    sections.push(`## Constraints`);
    context.constraints.forEach(c => sections.push(`- ${c}`));
    sections.push('');
  }

  if (context.openQuestions && context.openQuestions.length > 0) {
    sections.push(`## Open Questions`);
    context.openQuestions.forEach(q => sections.push(`- ${q}`));
    sections.push('');
  }

  if (context.nextActions && context.nextActions.length > 0) {
    sections.push(`## Next Actions`);
    context.nextActions.forEach(a => sections.push(`- ${a}`));
    sections.push('');
  }

  if (context.conversation && context.conversation.length > 0) {
    sections.push(`## Conversation History`);
    context.conversation.forEach(turn => {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      sections.push(`**${role}:** ${turn.content}`);
      sections.push('');
    });
  }

  return sections.join('\n');
}

/**
 * Full format: Structured context with complete conversation transcript.
 */
function formatFull(context: ContinuContext): string {
  return formatStructured(context);
}

/**
 * Compact format: Essential continuation context only.
 */
function formatCompact(context: ContinuContext): string {
  const parts: string[] = [];

  parts.push(`Context: ${context.name}`);

  if (context.objective) {
    parts.push(`Goal: ${context.objective}`);
  }

  if (context.currentState) {
    parts.push(`State: ${context.currentState}`);
  }

  if (context.decisions && context.decisions.length > 0) {
    parts.push(`Decisions: ${context.decisions.join('; ')}`);
  }

  if (context.nextActions && context.nextActions.length > 0) {
    parts.push(`Next: ${context.nextActions.join('; ')}`);
  }

  if (context.conversation && context.conversation.length > 0) {
    parts.push('');
    parts.push('Recent Conversation:');
    context.conversation.slice(-8).forEach(turn => {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      const singleLine = turn.content.replace(/\n+/g, ' ').slice(0, 300);
      parts.push(`${role}: ${singleLine}`);
    });
  }

  return parts.join('\n');
}
