import { useRef } from 'react';
import { importContexts, readFile } from '../../../src/contexts/import';
import { exportContexts, downloadFile } from '../../../src/contexts/export';
import { saveContextLocal, getContextsLocal } from '../../../src/contexts/storage';

interface ImportExportProps {
  onImportComplete: () => void;
  onError: (message: string) => void;
}

export function ImportExport({ onImportComplete, onError }: ImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await readFile(file);
      const result = importContexts(content);

      if (!result.success) {
        onError(result.errors[0] || 'Import failed.');
        return;
      }

      // Save imported contexts locally
      for (const context of result.contexts) {
        await saveContextLocal(context);
      }

      onImportComplete();

      if (result.errors.length > 0) {
        console.warn('Import warnings:', result.errors);
      }
    } catch {
      onError('Failed to read file.');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleExportAll() {
    try {
      const contexts = await getContextsLocal();
      if (contexts.length === 0) {
        onError('No contexts to export.');
        return;
      }

      const json = exportContexts(contexts);
      const date = new Date().toISOString().split('T')[0];
      downloadFile(json, `continu-export-${date}.continu`);
    } catch {
      onError('Export failed.');
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".continu,.json"
        className="file-input"
        onChange={handleImport}
      />
      <button
        className="btn-icon"
        onClick={() => fileInputRef.current?.click()}
        title="Import .continu file"
      >
        &#8593;
      </button>
      <button
        className="btn-icon"
        onClick={handleExportAll}
        title="Export all contexts"
      >
        &#8595;
      </button>
    </>
  );
}
