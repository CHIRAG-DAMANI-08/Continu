import type { ContinuContext } from './model';
import { validateContext, validatePartialContext } from './validation';
import { SCHEMA_VERSION } from './model';

/**
 * Export a context as a downloadable .continu JSON file.
 */
export function exportContext(context: ContinuContext): string {
  return JSON.stringify(context, null, 2);
}

/**
 * Export multiple contexts as a .continu JSON file.
 */
export function exportContexts(contexts: ContinuContext[]): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    contexts,
  }, null, 2);
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
