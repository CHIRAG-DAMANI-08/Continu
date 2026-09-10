import type { ContinuContext } from './model';
import { validateContext } from './validation';
import { SCHEMA_VERSION } from './model';

interface ImportResult {
  success: boolean;
  contexts: ContinuContext[];
  errors: string[];
}

/**
 * Import contexts from a .continu JSON file content.
 * Validates each context with Zod before accepting.
 */
export function importContexts(jsonString: string): ImportResult {
  const errors: string[] = [];
  const contexts: ContinuContext[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      success: false,
      contexts: [],
      errors: ['Invalid JSON file.'],
    };
  }

  // Check max payload size (10MB)
  if (jsonString.length > 10 * 1024 * 1024) {
    return {
      success: false,
      contexts: [],
      errors: ['File too large. Maximum size is 10MB.'],
    };
  }

  // Handle single context
  if (parsed && typeof parsed === 'object' && 'id' in parsed && 'schemaVersion' in parsed) {
    const result = validateContext(parsed);
    if (result.success) {
      contexts.push(result.data as ContinuContext);
    } else {
      errors.push(`Validation failed: ${result.error.issues.map(i => i.message).join(', ')}`);
    }
    return { success: contexts.length > 0, contexts, errors };
  }

  // Handle export bundle (array of contexts)
  if (parsed && typeof parsed === 'object' && 'contexts' in parsed) {
    const bundle = parsed as { contexts: unknown[] };
    if (!Array.isArray(bundle.contexts)) {
      return {
        success: false,
        contexts: [],
        errors: ['Invalid file format: contexts must be an array.'],
      };
    }

    bundle.contexts.forEach((item, index) => {
      const result = validateContext(item);
      if (result.success) {
        // Generate new IDs on import to avoid conflicts
        const imported: ContinuContext = {
          ...(result.data as ContinuContext),
          id: crypto.randomUUID(),
          updatedAt: new Date().toISOString(),
        };
        contexts.push(imported);
      } else {
        errors.push(
          `Context ${index + 1}: ${result.error.issues.map(i => i.message).join(', ')}`
        );
      }
    });

    return { success: contexts.length > 0, contexts, errors };
  }

  return {
    success: false,
    contexts: [],
    errors: ['Unrecognized file format. Expected a .continu file.'],
  };
}

/**
 * Read a File object and return its text content.
 */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}
