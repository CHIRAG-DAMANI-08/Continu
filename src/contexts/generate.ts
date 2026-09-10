import type { ContinuContext, ConversationTurn } from './model';
import { SCHEMA_VERSION } from './model';
import { validateContext } from './validation';

interface GenerateInput {
  url: string;
  title: string;
  platform: string;
  conversation: ConversationTurn[];
}

/**
 * Parses an envelope or bundled message (e.g. [Prior Conversation History]: or [Full Conversation History]:)
 * into discrete previous ConversationTurn items, and extracts the trailing user prompt.
 */
function unrollHistoryFromContent(
  rawContent: string,
  turnTimestamp: string
): { unrolledTurns: ConversationTurn[]; prompt: string } {
  const lines = rawContent.split('\n');
  const unrolledTurns: ConversationTurn[] = [];
  const promptLines: string[] = [];
  let inHistory = false;
  let currentRole: 'user' | 'assistant' | null = null;
  let currentContentLines: string[] = [];
  let hasEnvelopeHeader = false;

  const flushCurrentTurn = () => {
    if (currentRole && currentContentLines.length > 0) {
      const turnText = currentContentLines.join('\n').trim();
      if (turnText) {
        unrolledTurns.push({
          role: currentRole,
          content: turnText,
          timestamp: turnTimestamp,
        });
      }
      currentRole = null;
      currentContentLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const upper = trimmed.toUpperCase();

    // Recognize and skip Continu transfer headers (case-insensitive)
    if (
      upper.startsWith('[CONTINU CONTEXT TRANSFER]') ||
      upper.startsWith('[CONTINU CONTEXT INGESTION]') ||
      upper.startsWith('[REFERENCE CONTEXT:') ||
      upper.startsWith('TOPIC:') ||
      upper.startsWith('SOURCE:') ||
      upper.startsWith('GOAL:') ||
      upper.startsWith('STATE:') ||
      upper.startsWith('DECISIONS:') ||
      upper.startsWith('REQUIREMENTS:') ||
      upper.startsWith('CONSTRAINTS:') ||
      upper.startsWith('NEXT:') ||
      trimmed === '---'
    ) {
      hasEnvelopeHeader = true;
      continue;
    }

    // Skip automated injection directives
    if (upper.startsWith('[DIRECTIVE:')) {
      continue;
    }

    // Check for conversation history section headers
    if (
      trimmed === '[Prior Conversation History]:' ||
      trimmed === '[Full Conversation History]:' ||
      trimmed === '## Conversation History'
    ) {
      inHistory = true;
      hasEnvelopeHeader = true;
      continue;
    }

    if (inHistory) {
      const isUserHeader = trimmed.startsWith('User:') || trimmed.startsWith('**User:**');
      const isAssistantHeader = trimmed.startsWith('Assistant:') || trimmed.startsWith('**Assistant:**');

      if (isUserHeader) {
        flushCurrentTurn();
        currentRole = 'user';
        const prefix = trimmed.startsWith('**User:**') ? '**User:**' : 'User:';
        const rest = trimmed.slice(prefix.length).trim();
        if (rest) currentContentLines.push(rest);
        continue;
      } else if (isAssistantHeader) {
        flushCurrentTurn();
        currentRole = 'assistant';
        const prefix = trimmed.startsWith('**Assistant:**') ? '**Assistant:**' : 'Assistant:';
        const rest = trimmed.slice(prefix.length).trim();
        if (rest) currentContentLines.push(rest);
        continue;
      }

      if (currentRole) {
        // If an empty line is followed by the actual trailing prompt (not another User/Assistant turn)
        if (
          trimmed.length === 0 &&
          i + 1 < lines.length &&
          !lines[i + 1].trim().startsWith('User:') &&
          !lines[i + 1].trim().startsWith('Assistant:') &&
          !lines[i + 1].trim().startsWith('**User:**') &&
          !lines[i + 1].trim().startsWith('**Assistant:**') &&
          !lines[i + 1].trim().startsWith('[DIRECTIVE:')
        ) {
          flushCurrentTurn();
          inHistory = false;
          continue;
        }
        currentContentLines.push(line);
        continue;
      }
    }

    // Trailing prompt lines
    if (hasEnvelopeHeader) {
      if (trimmed.length > 0 || promptLines.length > 0) {
        promptLines.push(line);
      }
    } else {
      promptLines.push(line);
    }
  }

  flushCurrentTurn();

  return {
    unrolledTurns,
    prompt: promptLines.join('\n').trim(),
  };
}

/**
 * Clean and filter turns to ensure full, continuous chat memory across all turns and sessions.
 * Automatically unrolls historical envelopes and prevents dropping older conversation turns.
 */
function sanitizeTurns(raw: ConversationTurn[]): ConversationTurn[] {
  const now = new Date().toISOString();
  const output: ConversationTurn[] = [];

  for (const turn of (raw || [])) {
    const rawContent = (turn.content || '').trim();
    if (!rawContent) continue;

    const timestamp = turn.timestamp || now;

    // Check if turn contains prior/full conversation envelope or Continu transfer envelope
    if (
      rawContent.includes('[Prior Conversation History]:') ||
      rawContent.includes('[Full Conversation History]:') ||
      rawContent.includes('[CONTINU CONTEXT TRANSFER]') ||
      rawContent.includes('[CONTINU CONTEXT INGESTION]') ||
      rawContent.includes('[Reference Context:')
    ) {
      const { unrolledTurns, prompt } = unrollHistoryFromContent(rawContent, timestamp);

      // Append all unrolled prior turns in chronological order
      for (const prior of unrolledTurns) {
        output.push({
          role: prior.role,
          content: prior.content.slice(0, 500000),
          timestamp: prior.timestamp || timestamp,
        });
      }

      // If there was a trailing user prompt attached to this turn, include it
      if (prompt && prompt.length > 0) {
        output.push({
          role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: prompt.slice(0, 500000),
          timestamp,
        });
      }
    } else {
      output.push({
        role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: rawContent.slice(0, 500000),
        timestamp,
      });
    }
  }

  // Filter out pure automated handshake acknowledgments
  return output.filter(turn => {
    if (!turn.content || turn.content.length === 0) return false;
    const lower = turn.content.trim().toLowerCase();
    return !(
      lower === "context loaded. let's talk." ||
      lower === "context loaded. let's talk" ||
      lower === "got the context, let's go! what are we working on?" ||
      lower === "got the context, let's go!" ||
      lower.startsWith("got the context, let's go!")
    );
  });
}

/**
 * Heuristically extracts bullet points or sentences matching specific patterns.
 */
function extractMatchingPoints(turns: ConversationTurn[], pattern: RegExp, maxItems = 4): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const turn of turns) {
    const lines = turn.content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.replace(/^[-*•\d.)\s]+/, '').trim();
      if (line.length >= 10 && line.length <= 250 && pattern.test(line)) {
        const normalized = line.toLowerCase();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          results.push(line);
          if (results.length >= maxItems) return results;
        }
      }
    }
  }

  return results;
}

/**
 * Generate a ContinuContext from raw extraction data.
 * Produces accurate, high-fidelity context representing the current chat session.
 */
export function generateContext(input: GenerateInput): ContinuContext {
  const now = new Date().toISOString();
  const sanitizedConversation = sanitizeTurns(input.conversation);

  // Safely derive valid URL
  const validUrl = (input.url && typeof input.url === 'string' && input.url.trim().length > 0)
    ? input.url.trim()
    : 'https://continu.local';

  // Derive meaningful objective from the first substantive user message
  const userTurns = sanitizedConversation.filter(t => t.role === 'user');
  const substantiveUserTurn =
    userTurns.find(t => t.content.length > 12 && !/^(hi|hello|hey|ok|okay|thanks|thank you)\b/i.test(t.content)) ||
    userTurns[0];

  const objective = substantiveUserTurn
    ? truncate(substantiveUserTurn.content.split('\n')[0] || substantiveUserTurn.content, 400)
    : `Context from ${input.platform || 'chat'}`;

  // Derive title/name
  let derivedName = (input.title || '').trim();
  const genericTitles = ['chatgpt', 'claude', 'gemini', 'deepseek', 'perplexity', 'new chat', 'chat', 'home', 'anthropic'];
  if (!derivedName || genericTitles.includes(derivedName.toLowerCase())) {
    if (substantiveUserTurn) {
      let cleanPrompt = substantiveUserTurn.content
        .split('\n')[0]
        .replace(/^(can\s+you\s+(?:please\s+)?|how\s+(?:do|can)\s+(?:i|we)\s+|please\s+|we\s+need\s+to\s+|i\s+need\s+to\s+|i\s+want\s+to\s+|could\s+you\s+)/i, '')
        .trim();
      if (cleanPrompt.length > 0) {
        cleanPrompt = cleanPrompt.charAt(0).toUpperCase() + cleanPrompt.slice(1);
      }
      derivedName = truncate(cleanPrompt || substantiveUserTurn.content, 100);
    } else {
      derivedName = `${input.platform || 'chat'} conversation`;
    }
  }
  const name = truncate(derivedName, 200);

  // Derive current state from the latest assistant turn
  const assistantTurns = sanitizedConversation.filter(t => t.role === 'assistant');
  const lastAssistantMessage = assistantTurns[assistantTurns.length - 1];
  let currentState = 'Conversation in progress.';
  if (lastAssistantMessage) {
    const firstParagraph = lastAssistantMessage.content.split('\n\n')[0] || lastAssistantMessage.content;
    currentState = truncate(firstParagraph.trim(), 400);
  }

  // Extract genuine decisions, requirements, constraints, and next actions from conversation
  const decisions = extractMatchingPoints(
    sanitizedConversation,
    /(?:we\s+(?:have\s+)?decided\s+to|decided\s+(?:to|on)|agreed\s+(?:to|on)|opted\s+for|chosen\s+to|selected\s+(?:to|as)|recommend\s+using)\b/i,
    4
  );

  const requirements = extractMatchingPoints(
    sanitizedConversation,
    /(?:requirement\s*[:is]+|must\s+(?:have|be|maintain|support|ensure|handle)|needs?\s+to\s+(?:maintain|support|ensure|handle)|required\s+to)\b/i,
    4
  );

  const constraints = extractMatchingPoints(
    sanitizedConversation,
    /(?:constraint\s*[:is]+|limitation\s*[:is]+|strictly\s+required|must\s+not\s+(?:exceed|modify|break|use)|cannot\s+exceed|limited\s+to)\b/i,
    3
  );

  const nextActions = extractMatchingPoints(
    assistantTurns,
    /(?:next\s+steps?\s*[:is]+|next\s+actions?\s*[:is]+|todo\s*[:is]+|remaining\s+tasks?\s*[:is]+|to\s+proceed\s*[:is]+)\b/i,
    4
  );

  // Extract genuine open questions (filtering out code syntax, ternaries, and conversational fillers)
  const openQuestions: string[] = [];
  const questionRegex = /([^.!?\n]+(?:\?))/g;
  for (const turn of sanitizedConversation) {
    const matches = turn.content.match(questionRegex);
    if (matches) {
      for (const q of matches) {
        const trimmed = q.trim().replace(/^[-*•\s]+/, '');
        // Must be between 20 and 180 chars, start with a question word, and not be code
        if (
          trimmed.length >= 20 &&
          trimmed.length <= 180 &&
          /^(?:how|what|why|where|when|which|who|can|could|should|would|is|are|will|do|does)\b/i.test(trimmed) &&
          !/[{}();=>]/.test(trimmed) &&
          !openQuestions.includes(trimmed)
        ) {
          openQuestions.push(trimmed);
          if (openQuestions.length >= 3) break;
        }
      }
    }
    if (openQuestions.length >= 3) break;
  }

  // Derive tags
  const tags: string[] = [input.platform || 'chat'];
  const fullText = sanitizedConversation.map(t => t.content).join(' ').toLowerCase();
  const keywordTags = ['react', 'vue', 'python', 'database', 'sql', 'postgres', 'api', 'docker', 'auth', 'design', 'bug', 'test'];
  for (const kw of keywordTags) {
    if (fullText.includes(kw) && !tags.includes(kw)) {
      tags.push(kw);
      if (tags.length >= 4) break;
    }
  }

  const context: ContinuContext = {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    name,
    summary: `${name} (${sanitizedConversation.length} turns on ${input.platform || 'chat'})`,
    source: {
      platform: truncate(input.platform || 'chat', 100),
      url: truncate(validUrl, 2000),
      title: truncate(input.title?.trim() || name, 500),
    },
    objective,
    currentState,
    decisions,
    requirements,
    constraints,
    openQuestions,
    nextActions,
    tags,
    turnCount: sanitizedConversation.length,
    conversation: sanitizedConversation.slice(0, 500),
    createdAt: now,
    updatedAt: now,
  };

  const result = validateContext(context);
  if (!result.success) {
    console.warn('Continu: Context validation notice:', result.error.issues);
  }

  return context;
}

export function generateMinimalContext(url: string, title: string, platform: string): ContinuContext {
  return generateContext({
    url,
    title,
    platform,
    conversation: [],
  });
}

function truncate(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) return str || '';
  const sub = str.slice(0, maxLength - 3);
  const lastSpace = sub.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.6) {
    return sub.slice(0, lastSpace) + '...';
  }
  return sub + '...';
}

