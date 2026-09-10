import { useEffect, useState } from 'react';
import { getContextsLocal } from '../../../src/contexts/storage';
import { formatPromptWithContext } from '../../../src/contexts/format';
import type { ContinuContext } from '../../../src/contexts/model';

import { EmptyIllustration } from './EmptyIllustration';

interface ContextListProps {
  onSelect: (context: ContinuContext) => void;
  onGenerate?: () => void;
}

export function ContextList({ onSelect, onGenerate }: ContextListProps) {
  const [contexts, setContexts] = useState<ContinuContext[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContexts();
  }, []);

  async function loadContexts() {
    try {
      const loaded = await getContextsLocal();
      setContexts(loaded);
    } catch (error) {
      console.error('Failed to load contexts:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <span className="loading-text">Loading contexts...</span>
      </div>
    );
  }

  if (contexts.length === 0) {
    return (
      <div className="empty-state fade-in">
        <div className="empty-state-illustration-wrapper">
          <EmptyIllustration width="190" height="128" />
        </div>
        <h3 className="empty-state-title">No contexts yet</h3>
        <p className="empty-state-desc">
          Click Generate to create one now.
        </p>
        {onGenerate && (
          <button
            type="button"
            className="btn btn-primary empty-generate-btn"
            onClick={onGenerate}
          >
            + Generate
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="context-list fade-in">
      {contexts.map(context => (
        <div
          key={context.id}
          className="context-item"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-continu-context', JSON.stringify(context));
            e.dataTransfer.setData('text/plain', formatPromptWithContext(context, ''));
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onSelect(context)}
        >
          <div className="context-item-drag-handle" title="Drag & drop onto chatbox to attach">
            &#8942;&#8942;
          </div>
          <div className="context-item-content">
            <div className="context-item-name">{context.name}</div>
            <div className="context-item-meta">
              <span className="badge">{context.source.platform}</span>
              <span className="timestamp">{formatRelativeTime(context.updatedAt)}</span>
            </div>
            {context.objective && (
              <div className="context-item-objective">{context.objective}</div>
            )}
          </div>
          <div className="context-item-actions">
            <span className="btn-icon" title="View details" style={{ fontSize: '12px' }}>
              &#8250;
            </span>
          </div>
        </div>
      ))}
      <div style={{ padding: '8px 16px', fontSize: '10.5px', color: 'var(--text-tertiary)', textAlign: 'center', borderTop: '1px solid var(--border-subtle)' }}>
        💡 Tip: Drag any context directly onto the chatbox to attach
      </div>
    </div>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
