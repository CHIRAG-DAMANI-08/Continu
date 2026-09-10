import { getAISettings } from './storage';
import type { ProviderConfig, ProviderType } from './types';
import { checkRateLimit, recordAttempt, RATE_LIMIT_AI_COOK } from '../security/rate-limiter';
import { logger, redactSensitiveData } from '../utils/logger';

export interface CookPromptResult {
  success: boolean;
  cookedPrompt?: string;
  originalPrompt?: string;
  provider?: ProviderType;
  model?: string;
  error?: string;
  setupInfo?: string;
}

export const COOK_SYSTEM_PROMPT = `You are an expert AI prompt engineer and token optimizer.
Your objective is to transform any user input (a single word, a question, a short sentence, or a long draft) into a high-density, ready-to-use prompt for an AI assistant.

TRANSFORMATION RULES BASED ON INPUT LENGTH & FORM:
1. SINGLE WORD (e.g. "auth", "react", "summarize", "docker"):
   - Expand into a crisp, actionable SINGLE-LINE prompt directing an AI to execute or implement that task clearly.
   - Example input: "auth" -> Example prompt: "Implement a secure authentication system with JWT tokens, refresh tokens, and robust error handling."
2. SINGLE SENTENCE, QUESTION, OR SHORT PHRASE (e.g. "how do i get around thse?", "make a snake game", "why is my query slow"):
   - Expand into a comprehensive, high-density PROMPT PARAGRAPH.
   - Convert questions or casual requests into explicit, authoritative instructions that direct an AI to provide concrete solutions, root causes, workaround architectures, and code snippets.
   - Example input: "how do i get around thse?" -> Example prompt: "Identify the primary bottlenecks, constraints, or blockers causing this issue and provide concrete step-by-step workarounds, alternative implementation patterns, and code examples to resolve them."
3. LARGE OR VERBOSE PROMPT:
   - Aggressively optimize to SAVE TOKENS.
   - Remove conversational filler, pleasantries ("could you please", "I was wondering if"), preamble, and repetition.
   - Retain 100% of the original requirements, technical constraints, context, and expected output format using high semantic density.
4. UNIVERSAL TOKEN OPTIMIZATION:
   - All generated prompts must be token-efficient: fewer words, maximum information density, zero fluff.

STRICT REFUSAL RULES:
- NEVER refuse an input. NEVER say "Please provide a draft prompt", "This is a question, not a prompt", or "I cannot assist with this".
- Treat every input—no matter how short or informal—as the raw seed topic to construct an optimized prompt.

CRITICAL FORMATTING RULES:
1. OUTPUT PLAIN TEXT ONLY.
2. NEVER use markdown bold or italic syntax. Absolutely NO double asterisks (NEVER write **text** or **word**). NO single asterisks (*text*), and NO underscores (__text__).
3. NEVER wrap sentences, sections, or the prompt in quotation marks ("" or '').
4. Do NOT use markdown headings (#, ##, ###). If organizing into parts, use plain capitalized labels without formatting (e.g. GOAL:, CONTEXT:, REQUIREMENTS:).
5. Return ONLY the final improved plain text prompt. No intro ("Here is..."), no commentary, and no markdown code fences.`;

/**
 * Wraps user draft prompt with clear context instructions to guarantee the model
 * optimizes single words, questions, and long drafts without refusing.
 */
export function formatCookingUserMessage(rawPrompt: string): string {
  const trimmed = rawPrompt.trim();
  return `RAW INPUT TO TRANSFORM INTO AN OPTIMIZED PROMPT:
"""
${trimmed}
"""

Instructions:
- If this is a single word: produce a crisp, actionable single-line prompt.
- If this is a short sentence, question, or phrase: produce a structured, high-density prompt paragraph for an AI.
- If this is a long prompt: compress and optimize to save tokens while keeping all requirements and context.
- All outputs must be token-efficient (fewer words, high semantic density).
- Return ONLY the improved plain-text prompt. No bold asterisks, no quotes, no conversational filler. Never refuse.`;
}

/**
 * Detects if the model mistakenly returned a refusal message instead of a prompt.
 */
export function isRefusalResponse(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  const refusalPatterns = [
    'please provide a draft prompt',
    'is a question, not a prompt',
    'is a question and not a prompt',
    'not a prompt to optimize',
    'not a prompt that can be optimized',
    'as an ai language model',
    'i cannot optimize this',
    'please provide a prompt',
    'provide more context to optimize',
  ];
  return refusalPatterns.some((pattern) => lower.includes(pattern));
}

/**
 * Post-processes and sanitizes cooked prompt output:
 * - Strips any markdown bold (**text** or __text__)
 * - Strips italic formatting (*text* or _text_)
 * - Strips markdown headings (#, ##, ###)
 * - Strips wrapping quotes ("..." or '...' or “...”)
 * - Strips code fence wrappers (```...```)
 * Guarantees clean, ready-to-paste plain text.
 */
export function cleanCookedPrompt(text: string): string {
  if (!text) return '';
  let res = text.trim();

  // Strip whole-response markdown code fences if wrapped: e.g. ```text ... ``` or ``` ... ```
  if (res.startsWith('```') && res.endsWith('```')) {
    res = res.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Strip outer quotes if the model wrapped the entire prompt
  if (
    (res.startsWith('"') && res.endsWith('"')) ||
    (res.startsWith("'") && res.endsWith("'")) ||
    (res.startsWith('“') && res.endsWith('”'))
  ) {
    res = res.slice(1, -1).trim();
  }

  // Remove markdown bold-italic and bold syntax:
  // ***text*** -> text
  res = res.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  // **text** -> text
  res = res.replace(/\*\*([^*]+)\*\*/g, '$1');
  // __text__ -> text
  res = res.replace(/__([^_]+)__/g, '$1');
  // Any leftover double asterisks: e.g. ** at boundaries
  res = res.replace(/\*\*/g, '');

  // Strip markdown headers: "### Goal:" -> "Goal:", "# Context" -> "Context"
  res = res.replace(/^#{1,6}\s+/gm, '');

  // Strip line-level surrounding quotes: e.g. "Line text"
  res = res.replace(/^"([^"\n]+)"$/gm, '$1');
  res = res.replace(/^“([^”\n]+)”$/gm, '$1');

  // Strip any remaining outer quotes
  if (
    (res.startsWith('"') && res.endsWith('"')) ||
    (res.startsWith("'") && res.endsWith("'")) ||
    (res.startsWith('“') && res.endsWith('”'))
  ) {
    res = res.slice(1, -1).trim();
  }

  return res.trim();
}

export async function isAiConfigured(): Promise<{ configured: boolean; provider: ProviderType | null; model: string | null; config: ProviderConfig | null }> {
  const settings = await getAISettings();
  const activeType = settings.activeProvider;

  if (activeType && settings.providers[activeType]?.apiKey?.trim()) {
    const config = settings.providers[activeType]!;
    return {
      configured: true,
      provider: activeType,
      model: config.model || null,
      config,
    };
  }

  // Check if any provider has an API key configured
  for (const [type, cfg] of Object.entries(settings.providers)) {
    if (cfg?.apiKey?.trim()) {
      return {
        configured: true,
        provider: type as ProviderType,
        model: cfg.model || null,
        config: cfg,
      };
    }
  }

  return {
    configured: false,
    provider: null,
    model: null,
    config: null,
  };
}

/**
 * Calculate a generous dynamic timeout for prompt cooking.
 * Base 60 seconds. For large prompts, adds 1 second per 100 characters, up to 5 minutes (300s).
 */
export function calculateCookTimeout(charCount: number): number {
  return Math.max(60000, Math.min(300000, 60000 + Math.ceil(charCount / 100) * 1000));
}

export async function cookPrompt(rawPrompt: string): Promise<CookPromptResult> {
  const trimmed = rawPrompt.trim();
  if (!trimmed) {
    return {
      success: false,
      error: 'EMPTY_PROMPT',
      setupInfo: 'Please type a prompt in the chatbox first before cooking.',
    };
  }

  // Rate limiting check
  const rateLimit = await checkRateLimit('ai:cook', RATE_LIMIT_AI_COOK);
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: 'RATE_LIMIT',
      setupInfo: rateLimit.error || `Please wait ${rateLimit.retryAfterSeconds}s before cooking another prompt.`,
    };
  }

  const aiStatus = await isAiConfigured();
  if (!aiStatus.configured || !aiStatus.config) {
    return {
      success: false,
      error: 'NO_PROVIDER',
      setupInfo: 'No AI provider configured. Add an API key in extension Settings (OpenAI, Claude, Gemini, Groq, or OpenRouter) to enable prompt cooking.',
    };
  }

  const config = aiStatus.config;
  const timeoutMs = calculateCookTimeout(trimmed.length);
  const timeoutSec = Math.round(timeoutMs / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const userMessageContent = formatCookingUserMessage(trimmed);

  try {
    let cooked = '';

    switch (config.provider) {
      case 'openai':
      case 'groq':
      case 'openrouter': {
        let url = config.customBaseUrl;
        if (!url) {
          if (config.provider === 'openai') url = 'https://api.openai.com/v1/chat/completions';
          else if (config.provider === 'groq') url = 'https://api.groq.com/openai/v1/chat/completions';
          else url = 'https://openrouter.ai/api/v1/chat/completions';
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        };

        if (config.provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://continu.dev';
          headers['X-Title'] = 'Continu';
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: config.model || (config.provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'),
            messages: [
              { role: 'system', content: COOK_SYSTEM_PROMPT },
              { role: 'user', content: userMessageContent },
            ],
            temperature: 0.2,
            max_tokens: 1200,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`${config.provider} returned status ${res.status}: ${errText.slice(0, 120)}`);
        }

        const data = await res.json();
        cooked = data?.choices?.[0]?.message?.content?.trim() || '';
        break;
      }

      case 'anthropic': {
        const url = config.customBaseUrl || 'https://api.anthropic.com/v1/messages';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey.trim(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: config.model || 'claude-3-5-haiku-20241022',
            max_tokens: 1200,
            temperature: 0.2,
            system: COOK_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessageContent }],
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Anthropic returned status ${res.status}: ${errText.slice(0, 120)}`);
        }

        const data = await res.json();
        cooked = data?.content?.[0]?.text?.trim() || '';
        break;
      }

      case 'gemini': {
        let model = (config.model || 'gemini-2.0-flash').trim().replace(/^models\//, '');
        // Auto-migrate deprecated experimental model name to stable
        if (model === 'gemini-2.0-flash-exp') {
          model = 'gemini-2.0-flash';
        }

        const buildGeminiBody = () => JSON.stringify({
          systemInstruction: {
            parts: [{ text: COOK_SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userMessageContent }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1200,
          },
        });

        let url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

        let res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey.trim(),
          },
          body: buildGeminiBody(),
          signal: controller.signal,
        });

        // If the model was not found (404), automatically fallback to gemini-1.5-flash
        if (!res.ok && res.status === 404 && model !== 'gemini-1.5-flash') {
          logger.warn(`Continu: Gemini model '${model}' returned 404. Falling back to gemini-1.5-flash.`);
          model = 'gemini-1.5-flash';
          url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
          res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey.trim(),
            },
            body: buildGeminiBody(),
            signal: controller.signal,
          });
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Gemini returned status ${res.status}: ${errText.slice(0, 120)}`);
        }

        const data = await res.json();
        cooked = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        break;
      }

      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }

    cooked = cleanCookedPrompt(cooked);

    if (!cooked || isRefusalResponse(cooked)) {
      return {
        success: false,
        error: 'COOK_FAILED',
        setupInfo: 'Could not optimize this input into an actionable prompt. Please try rephrasing.',
      };
    }

    // Record successful cooking attempt for rate limiting
    await recordAttempt('ai:cook', RATE_LIMIT_AI_COOK);

    return {
      success: true,
      cookedPrompt: cooked,
      originalPrompt: trimmed,
      provider: config.provider,
      model: config.model,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'TIMEOUT',
        setupInfo: `The AI request timed out after ${timeoutSec}s. If your prompt is very large, try using a faster model or check your network connection.`,
      };
    }
    return {
      success: false,
      error: 'API_ERROR',
      setupInfo: redactSensitiveData(err?.message || 'Failed to refine prompt with AI provider.'),
    };
  } finally {
    clearTimeout(timer);
  }
}
