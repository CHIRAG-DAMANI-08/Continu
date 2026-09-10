import { useState, useCallback, useEffect } from 'react';
import { useSupabaseAuth } from './lib/SupabaseAuthContext';
import { ContextList } from './components/ContextList';
import { ContextDetail } from './components/ContextDetail';
import { ImportExport } from './components/ImportExport';
import { UserAvatarMenu } from './components/UserAvatarMenu';
import { SettingsView } from './components/SettingsView';
import { MessageType } from '../../src/security/messaging';
import type { ContinuContext } from '../../src/contexts/model';
import { syncContextsWithRemote } from '../../src/database/sync';
import { cookPrompt, isAiConfigured } from '../../src/ai/cook';
import './App.css';

type View = 'list' | 'detail' | 'settings';

interface StatusMessage {
  type: 'success' | 'error' | 'info';
  text: string;
}

function App() {
  const { user, signOut } = useSupabaseAuth();
  const userId = user?.id ?? null;

  const [view, setView] = useState<View>('list');
  const [selectedContext, setSelectedContext] = useState<ContinuContext | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [cookingPrompt, setCookingPrompt] = useState(false);
  const [cookedModal, setCookedModal] = useState<{
    original: string;
    cooked: string;
    provider: string;
    model?: string;
  } | null>(null);

  useEffect(() => {
    // Read persisted theme from local storage
    chrome.storage?.local?.get(['continu_theme'], (res) => {
      if (res && (res.continu_theme === 'light' || res.continu_theme === 'dark')) {
        setTheme(res.continu_theme);
        document.documentElement.setAttribute('data-theme', res.continu_theme);
      }
    });

    isAiConfigured().then(res => {
      setAiConfigured(res.configured);
      setAiProvider(res.provider);
    }).catch(() => {});

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local') {
        if (changes.continu_theme) {
          const next = changes.continu_theme.newValue;
          if (next === 'light' || next === 'dark') {
            setTheme(next);
            document.documentElement.setAttribute('data-theme', next);
          }
        }
        if (changes.continu_ai_settings) {
          isAiConfigured().then(res => {
            setAiConfigured(res.configured);
            setAiProvider(res.provider);
          }).catch(() => {});
        }
      }
    };

    chrome.storage?.onChanged?.addListener(handleStorageChange);
    return () => {
      chrome.storage?.onChanged?.removeListener(handleStorageChange);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        chrome.storage?.local?.set({ continu_theme: next });
      } catch (err) {
        console.warn('Continu: failed to persist theme preference', err);
      }
      return next;
    });
  }, []);

  const showStatus = useCallback((type: StatusMessage['type'], text: string) => {
    setStatus({ type, text });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const handleSync = useCallback(async (silent = false) => {
    if (!userId) return;
    setSyncing(true);
    try {
      const res = await syncContextsWithRemote(userId);
      if (!silent) {
        if (res.errors.length > 0 && res.uploaded === 0 && res.downloaded === 0) {
          showStatus('error', `Sync: ${res.errors[0]}`);
        } else {
          showStatus('success', `Encrypted sync: ↑${res.uploaded} ↓${res.downloaded}`);
          setRefreshKey(k => k + 1);
        }
      } else if (res.downloaded > 0) {
        setRefreshKey(k => k + 1);
      }
    } catch (err) {
      if (!silent) {
        showStatus('error', err instanceof Error ? err.message : 'Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  }, [userId, showStatus]);

  // Whenever userId changes (login, logout, account switch), reset view and refresh list
  useEffect(() => {
    setSelectedContext(null);
    setView('list');
    setRefreshKey(k => k + 1);
    if (userId) {
      handleSync(true);
    }
  }, [userId, handleSync]);

  const handleGenerate = useCallback(async () => {
    if (!userId) {
      showStatus('error', 'Please log in to your account first.');
      return;
    }
    setGenerating(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.GENERATE_CONTEXT,
      });

      if (response.success) {
        showStatus('success', 'Context saved.');
        setRefreshKey(k => k + 1);
        // Trigger background sync if authenticated
        if (userId) {
          handleSync(true);
        }
      } else {
        showStatus('error', response.error || 'Generate failed.');
      }
    } catch {
      showStatus('error', 'Could not reach the current tab.');
    } finally {
      setGenerating(false);
    }
  }, [userId, handleSync, showStatus]);

  const handleCookPromptClick = useCallback(async () => {
    if (!aiConfigured) {
      setView('settings');
      showStatus('info', 'Configure an AI API key (OpenAI, Claude, Gemini, Groq, or OpenRouter) below to enable prompt cooking.');
      return;
    }

    setCookingPrompt(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let draftText = '';
      if (tab?.id) {
        try {
          const info: any = await chrome.tabs.sendMessage(tab.id, {
            type: MessageType.GET_PAGE_INFO,
          });
          draftText = info?.draftText || '';
        } catch {}
      }

      if (!draftText.trim()) {
        showStatus('info', 'No prompt draft found in active tab. You can paste or type a prompt below to cook it.');
        setCookedModal({
          original: '',
          cooked: '',
          provider: aiProvider || 'AI',
        });
        return;
      }

      const res = await cookPrompt(draftText);
      if (res.success && res.cookedPrompt) {
        setCookedModal({
          original: draftText,
          cooked: res.cookedPrompt,
          provider: res.provider || aiProvider || 'AI',
          model: res.model,
        });
      } else {
        showStatus('error', res.setupInfo || res.error || 'Failed to cook prompt.');
      }
    } catch (err: any) {
      showStatus('error', err.message || 'Cook prompt error.');
    } finally {
      setCookingPrompt(false);
    }
  }, [aiConfigured, aiProvider, showStatus]);

  const handleSelectContext = useCallback((context: ContinuContext) => {
    setSelectedContext(context);
    setView('detail');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedContext(null);
    setView('list');
    setRefreshKey(k => k + 1);
  }, []);

  const handleContextDeleted = useCallback(() => {
    handleBack();
    showStatus('info', 'Context deleted.');
    if (userId) {
      handleSync(true);
    }
  }, [handleBack, showStatus, userId, handleSync]);

  return (
    <div className={`app ${theme === 'light' ? 'theme-light' : ''}`} data-theme={theme}>
      <header className="app-header">
        <div className="header-brand">
          <h1>continu</h1>
          <span className="e2ee-tag" title="End-to-End Client Encrypted">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            E2EE
          </span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <ImportExport
            onImportComplete={() => {
              setRefreshKey(k => k + 1);
              showStatus('success', 'Contexts imported.');
              if (userId) {
                handleSync(true);
              }
            }}
            onError={(msg) => showStatus('error', msg)}
          />
          {/* Settings Button */}
          <button
            type="button"
            className={`btn-header-action ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView(view === 'settings' ? 'list' : 'settings')}
            title="Settings (BYOK API Keys)"
            aria-label="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {/* User avatar with dropdown menu */}
          <UserAvatarMenu onOpenSettings={() => setView('settings')} />
        </div>
      </header>

      {status && (
        <div className={`status status-${status.type} fade-in`}>
          {status.type === 'success' && '✓ '}
          {status.type === 'error' && '✕ '}
          {status.type === 'info' && 'ℹ '}
          {status.text}
        </div>
      )}

      {view === 'list' && (
        <>
          <div className="toolbar">
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <>
                  <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                  Generating...
                </>
              ) : (
                '+ Generate'
              )}
            </button>

            <button
              className={`btn btn-cook ${!aiConfigured ? 'unconfigured' : ''}`}
              onClick={handleCookPromptClick}
              disabled={cookingPrompt}
              title={aiConfigured ? `Cook prompt using ${(aiProvider || 'AI').toUpperCase()}` : 'Setup AI API Key in Settings to enable'}
            >
              {cookingPrompt ? (
                <>
                  <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                  Cooking...
                </>
              ) : (
                <>
                  <span style={{ fontSize: 13, lineHeight: 1 }}>🍳</span>
                  <span>Cook Prompt</span>
                  {!aiConfigured && <span className="btn-setup-tag">Setup</span>}
                </>
              )}
            </button>

            <button
              className="btn btn-sync"
              onClick={() => handleSync(false)}
              disabled={syncing}
              title="Sync encrypted contexts with Supabase"
            >
              {syncing ? (
                <>
                  <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                  Syncing...
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  Sync
                </>
              )}
            </button>
          </div>
          <main className="app-main">
            <ContextList
              key={refreshKey}
              onSelect={handleSelectContext}
              onGenerate={handleGenerate}
            />
          </main>
        </>
      )}

      {view === 'detail' && selectedContext && (
        <ContextDetail
          context={selectedContext}
          onBack={handleBack}
          onDeleted={handleContextDeleted}
          onStatus={showStatus}
        />
      )}

      {view === 'settings' && (
        <SettingsView
          onBack={() => setView('list')}
          onStatus={showStatus}
        />
      )}

      {cookedModal && (
        <div className="modal-overlay" onClick={() => setCookedModal(null)}>
          <div className="modal-content cook-modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <span style={{ fontSize: 16 }}>🍳</span>
                <h3>Cooked Prompt</h3>
                <span className="badge-provider">{(cookedModal.provider || 'AI').toUpperCase()}</span>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setCookedModal(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="modal-body">
              <div className="cook-section">
                <label className="cook-field-label">ORIGINAL PROMPT</label>
                <textarea
                  className="cook-textarea cook-textarea-original"
                  placeholder="Enter or paste your draft prompt here..."
                  value={cookedModal.original}
                  onChange={(e) => setCookedModal({ ...cookedModal, original: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="cook-section" style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label className="cook-field-label" style={{ marginBottom: 0 }}>IMPROVED PROMPT (EDITABLE)</label>
                  {!cookedModal.cooked && cookedModal.original && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={cookingPrompt}
                      onClick={async () => {
                        setCookingPrompt(true);
                        try {
                          const res = await cookPrompt(cookedModal.original);
                          if (res.success && res.cookedPrompt) {
                            setCookedModal({
                              ...cookedModal,
                              cooked: res.cookedPrompt,
                              provider: res.provider || cookedModal.provider,
                              model: res.model,
                            });
                          } else {
                            showStatus('error', res.setupInfo || res.error || 'Cooking failed');
                          }
                        } catch (err: any) {
                          showStatus('error', err.message || 'Cooking failed');
                        } finally {
                          setCookingPrompt(false);
                        }
                      }}
                    >
                      {cookingPrompt ? 'Cooking...' : 'Cook It!'}
                    </button>
                  )}
                </div>
                <textarea
                  className="cook-textarea"
                  placeholder="Cooked prompt will appear here..."
                  value={cookedModal.cooked}
                  onChange={(e) => setCookedModal({ ...cookedModal, cooked: e.target.value })}
                  rows={6}
                />
              </div>
            </div>

            <div className="modal-actions">
              {cookedModal.cooked && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      try {
                        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (tab?.id) {
                          await chrome.tabs.sendMessage(tab.id, {
                            type: MessageType.INSERT_TEXT,
                            text: cookedModal.cooked,
                          });
                          showStatus('success', 'Inserted prompt into chatbox!');
                        } else {
                          await navigator.clipboard.writeText(cookedModal.cooked);
                          showStatus('success', 'Copied to clipboard (no active tab)!');
                        }
                      } catch {
                        await navigator.clipboard.writeText(cookedModal.cooked);
                        showStatus('success', 'Copied cooked prompt to clipboard!');
                      }
                      setCookedModal(null);
                    }}
                  >
                    Insert in Chatbox
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(cookedModal.cooked);
                      showStatus('success', 'Copied to clipboard!');
                    }}
                  >
                    Copy
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCookedModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;