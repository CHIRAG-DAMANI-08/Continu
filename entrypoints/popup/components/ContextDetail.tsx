import { useState, useMemo } from 'react';
import { deleteContextLocal } from '../../../src/contexts/storage';
import { formatContext, type DropFormat } from '../../../src/contexts/format';
import { exportContext, downloadFile } from '../../../src/contexts/export';
import { MessageType } from '../../../src/security/messaging';
import type { ContinuContext } from '../../../src/contexts/model';


interface ContextDetailProps {
  context: ContinuContext;
  onBack: () => void;
  onDeleted: () => void;
  onStatus: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function ContextDetail({ context, onBack, onDeleted, onStatus }: ContextDetailProps) {
  const [dropFormat, setDropFormat] = useState<DropFormat>('hidden');
  const [showPreview, setShowPreview] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [showConversation, setShowConversation] = useState(true);

  const formattedPreview = useMemo(
    () => formatContext(context, dropFormat),
    [context, dropFormat]
  );

  async function handleDrop() {
    setDropping(true);
    try {
      if (dropFormat === 'hidden') {
        const response = await chrome.runtime.sendMessage({
          type: MessageType.ARM_CONTEXT,
          contextId: context.id,
        });

        if (response.success) {
          onStatus('success', 'Context armed! Type your prompt or hit Enter in chat.');
        } else {
          onStatus('error', response.error || 'Could not arm context.');
        }
      } else {
        const response = await chrome.runtime.sendMessage({
          type: MessageType.DROP_CONTEXT,
          contextId: context.id,
          format: dropFormat,
        });

        if (response.success) {
          onStatus('success', 'Context inserted. Review before submitting.');
        } else {
          onStatus('error', response.error || 'Could not drop context.');
        }
      }
    } catch {
      onStatus('error', 'Could not reach the current tab.');
    } finally {
      setDropping(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formattedPreview);
      onStatus('success', 'Copied to clipboard.');
    } catch {
      onStatus('error', 'Failed to copy.');
    }
  }


  async function handleExport() {
    const json = exportContext(context);
    const filename = `${context.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}.continu`;
    downloadFile(json, filename);
    onStatus('info', 'Context exported.');
  }

  async function handleDelete() {
    try {
      await deleteContextLocal(context.id);
      onDeleted();
    } catch {
      onStatus('error', 'Failed to delete context.');
    }
  }

  return (
    <div className="context-detail fade-in">
      <div className="context-detail-header">
        <button className="btn-icon" onClick={onBack} title="Back">
          &#8249;
        </button>
        <h2>{context.name}</h2>
        <button className="btn-icon" onClick={handleExport} title="Export">
          &#8595;
        </button>
        <button className="btn-icon btn-danger" onClick={handleDelete} title="Delete">
          &#10005;
        </button>
      </div>

      <div className="context-detail-body app-main">
        <div className="detail-section">
          <div className="detail-section-label">Source</div>
          <div className="detail-section-content">
            <span className="badge">{context.source.platform}</span>
            {' '}
            <span className="timestamp">{context.source.title}</span>
          </div>
        </div>

        {context.objective && (
          <div className="detail-section">
            <div className="detail-section-label">Objective</div>
            <div className="detail-section-content">{context.objective}</div>
          </div>
        )}

        {context.currentState && (
          <div className="detail-section">
            <div className="detail-section-label">Current State</div>
            <div className="detail-section-content">{context.currentState}</div>
          </div>
        )}

        {context.decisions.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-label">Decisions</div>
            <ul className="detail-list">
              {context.decisions.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}

        {context.requirements.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-label">Requirements</div>
            <ul className="detail-list">
              {context.requirements.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}

        {context.constraints.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-label">Constraints</div>
            <ul className="detail-list">
              {context.constraints.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}

        {context.openQuestions.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-label">Open Questions</div>
            <ul className="detail-list">
              {context.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        )}

        {context.nextActions.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-label">Next Actions</div>
            <ul className="detail-list">
              {context.nextActions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}

        {context.conversation.length > 0 && (
          <div className="detail-section detail-conversation-section">
            <div
              className="detail-section-label detail-conversation-header"
              onClick={() => setShowConversation(!showConversation)}
            >
              <span>Conversation ({context.conversation.length} turns)</span>
              <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>
                {showConversation ? 'Hide ▲' : 'Show All ▼'}
              </span>
            </div>
            {showConversation && (
              <div className="conversation-turns-list fade-in">
                {context.conversation.map((turn, idx) => (
                  <div key={idx} className={`turn-item turn-${turn.role}`}>
                    <div className="turn-header">
                      <span className={`turn-role-badge badge-${turn.role}`}>
                        {turn.role === 'user' ? 'You' : 'AI'}
                      </span>
                      {turn.timestamp && (
                        <span className="turn-time">
                          {new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <div className="turn-content">
                      {turn.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="drop-panel">
        <h4>Drop into chat</h4>
        <div className="format-selector">
          {(['hidden', 'structured', 'compact', 'full'] as DropFormat[]).map(fmt => (
            <button
              key={fmt}
              className={`format-option ${dropFormat === fmt ? 'active' : ''}`}
              onClick={() => setDropFormat(fmt)}
            >
              {fmt === 'hidden' ? '⚡ Attach (COA 1)' : fmt.charAt(0).toUpperCase() + fmt.slice(1)}
            </button>
          ))}
        </div>

        <button
          className="btn btn-sm"
          onClick={() => setShowPreview(!showPreview)}
          style={{ marginBottom: 'var(--space-sm)', width: '100%' }}
        >
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </button>

        {showPreview && (
          <div className="preview fade-in">
            {formattedPreview}
          </div>
        )}

        <div className="drop-actions">
          <button
            className="btn btn-primary"
            onClick={handleDrop}
            disabled={dropping}
          >
            {dropping
              ? (dropFormat === 'hidden' ? 'Attaching...' : 'Inserting...')
              : (dropFormat === 'hidden' ? '⚡ Attach to Active Chat' : 'Insert Text')}
          </button>
          <button className="btn" onClick={handleCopy}>
            Copy
          </button>
        </div>

        <div style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', marginTop: '6px', textAlign: 'center' }}>
          {dropFormat === 'hidden'
            ? "Arms chat with context — clean chatbox, zero artificial setup messages. Bundles context into Turn 1 with your prompt!"
            : "Inserts formatted markdown context into composer for manual review"}
        </div>
      </div>
    </div>
  );
}
