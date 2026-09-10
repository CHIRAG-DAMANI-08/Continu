import { Prompt } from '../types';

export function optimizePrompt(input: string): Prompt {
  if (typeof input !== 'string') {
    return { error: 'Invalid input' };
  }

  const wordCount = input.split(/\s+/).filter(word => word).length;

  if (wordCount <= 1) {
    // Single-word → concise line (max 20 tokens)
    return {
      prompt: `${input.trim()}: Please expand this into a concise single-line response (max 20 tokens).`,
    };
  }
  else if (input.length < 100) {
    // Short line → paragraph
    return {
      prompt: `Expand this into a 3-5 sentence paragraph: "${input}"`,
    };
  }
  else {
    // Long prompt → compressed
    const compressed = input
      .replace(/\s+/g, ' ')
      .replace(/(\.|\?|\!)\s+/g, '$1 ')
      .trim();
    return {
      prompt: compressed,
    };
  }
}