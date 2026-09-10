import React, { useState, useEffect } from 'react';
import {
  PROVIDER_METADATA,
  type ProviderConfig,
  type ProviderType,
} from '../../../src/ai/types';
import {
  getAISettings,
  saveAIProvider,
  removeAIProvider,
  setActiveAIProvider,
  maskApiKey,
  type AISettings,
} from '../../../src/ai/storage';
import { testProviderConnection } from '../../../src/ai/test-provider';
import { fetchAvailableModels } from '../../../src/ai/models';
import { useSupabaseAuth } from '../lib/SupabaseAuthContext';

interface SettingsViewProps {
  onBack: () => void;
  onStatus: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function SettingsView({ onBack, onStatus }: SettingsViewProps) {
  const { user } = useSupabaseAuth();
  const [settings, setSettings] = useState<AISettings>({
    providers: {},
    activeProvider: null,
  });
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>('openai');
  const [inputKey, setInputKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [modelsList, setModelsList] = useState<string[]>(PROVIDER_METADATA.openai.availableModels);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelName, setCustomModelName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load existing settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const data = await getAISettings();
    // Auto-migrate any saved deprecated experimental model to stable
    if (data.providers.gemini?.model === 'gemini-2.0-flash-exp') {
      data.providers.gemini.model = 'gemini-2.0-flash';
      await saveAIProvider(data.providers.gemini);
    }
    setSettings(data);

    // Default selection to active provider or first available
    const active = data.activeProvider || 'openai';
    setSelectedProvider(active);
    syncFormFields(active, data);
  }

  function syncFormFields(provider: ProviderType, currentSettings: AISettings) {
    const existing = currentSettings.providers[provider];
    const defaultModels = PROVIDER_METADATA[provider].availableModels;
    let modelToSet = PROVIDER_METADATA[provider].defaultModel;

    if (existing) {
      setInputKey(existing.apiKey);
      let model = existing.model || modelToSet;
      if (model === 'gemini-2.0-flash-exp') {
        model = 'gemini-2.0-flash';
      }
      modelToSet = model;
      if (!defaultModels.includes(model)) {
        setModelsList([model, ...defaultModels]);
      } else {
        setModelsList(defaultModels);
      }
    } else {
      setInputKey('');
      setModelsList(defaultModels);
    }

    setSelectedModel(modelToSet);
    setIsCustomModel(false);
    setCustomModelName('');
    setModelsFetched(false);
    setTestResult(null);
    setShowKey(false);
  }

  const handleSelectProvider = (prov: ProviderType) => {
    setSelectedProvider(prov);
    syncFormFields(prov, settings);
  };

  const handleFetchModels = async () => {
    const key = inputKey.trim();
    if (!key) {
      onStatus('error', 'Please enter an API key to fetch available models.');
      return;
    }

    setFetchingModels(true);
    try {
      const models = await fetchAvailableModels(selectedProvider, key);
      if (models && models.length > 0) {
        setModelsList(models);
        setModelsFetched(true);
        if (!models.includes(selectedModel)) {
          setSelectedModel(models[0]);
        }
        onStatus('success', `Found ${models.length} available models for ${PROVIDER_METADATA[selectedProvider].name}!`);
      } else {
        onStatus('info', 'No models returned by API. Retained default model list.');
      }
    } catch (err: any) {
      onStatus('error', err?.message || 'Failed to fetch models.');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async () => {
    if (!inputKey.trim()) {
      onStatus('error', 'Please enter a valid API key.');
      return;
    }

    const modelToSave = (isCustomModel ? customModelName.trim() : selectedModel) || PROVIDER_METADATA[selectedProvider].defaultModel;

    const config: ProviderConfig = {
      provider: selectedProvider,
      apiKey: inputKey.trim(),
      model: modelToSave,
      isValidated: testResult?.success || false,
      lastValidatedAt: testResult?.success ? new Date().toISOString() : undefined,
    };

    await saveAIProvider(config);
    const updated = await getAISettings();
    setSettings(updated);
    onStatus('success', `${PROVIDER_METADATA[selectedProvider].name} key saved.`);
  };

  const handleRemove = async () => {
    await removeAIProvider(selectedProvider);
    const updated = await getAISettings();
    setSettings(updated);
    syncFormFields(selectedProvider, updated);
    onStatus('info', `${PROVIDER_METADATA[selectedProvider].name} key removed.`);
  };

  const handleTest = async () => {
    if (!inputKey.trim()) {
      onStatus('error', 'Enter an API key first.');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await testProviderConnection({
        provider: selectedProvider,
        apiKey: inputKey.trim(),
        model: selectedModel || PROVIDER_METADATA[selectedProvider].defaultModel,
      });

      setTestResult(res);
      if (res.success) {
        if (res.models && res.models.length > 0) {
          setModelsList(res.models);
          setModelsFetched(true);
          if (!res.models.includes(selectedModel)) {
            setSelectedModel(res.models[0]);
          }
        }
        onStatus('success', res.message || 'Key verified successfully!');
      } else {
        onStatus('error', res.message);
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Test failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSetActive = async (prov: ProviderType) => {
    await setActiveAIProvider(prov);
    setSettings(prev => ({ ...prev, activeProvider: prov }));
    onStatus('success', `${PROVIDER_METADATA[prov].name} set as active provider.`);
  };

  const meta = PROVIDER_METADATA[selectedProvider];
  const currentSavedConfig = settings.providers[selectedProvider];
  const isCurrentActive = settings.activeProvider === selectedProvider;

  return (
    <div className="settings-view fade-in">
      {/* Settings Top Bar */}
      <div className="settings-header">
        <button
          type="button"
          className="btn-back"
          onClick={onBack}
          aria-label="Back to Contexts"
          title="Back to Contexts"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Contexts</span>
        </button>
        <h2 className="settings-title">Settings</h2>
      </div>

      <div className="settings-scroll-content">
        {/* Section 1: AI Provider Keys (BYOK) */}
        <div className="settings-section">
          <div className="section-title-row">
            <h3 className="section-title">AI Providers (BYOK)</h3>
            <span className="badge-local">Stored Locally</span>
          </div>
          <p className="section-desc">
            Bring your own API keys for prompt refinement and smart extraction. Keys are stored locally on your device.
          </p>

          {/* Provider Pill Selector */}
          <div className="provider-tabs">
            {(Object.keys(PROVIDER_METADATA) as ProviderType[]).map(prov => {
              const hasKey = !!settings.providers[prov]?.apiKey;
              const isActive = settings.activeProvider === prov;
              return (
                <button
                  key={prov}
                  type="button"
                  className={`provider-tab-btn ${selectedProvider === prov ? 'selected' : ''} ${hasKey ? 'has-key' : ''}`}
                  onClick={() => handleSelectProvider(prov)}
                >
                  <span className="prov-name">{PROVIDER_METADATA[prov].name}</span>
                  {isActive && <span className="active-dot" title="Active default provider" />}
                  {hasKey && !isActive && <span className="saved-check" title="Key configured">✓</span>}
                </button>
              );
            })}
          </div>

          {/* Active Provider Card */}
          <div className="provider-card">
            <div className="provider-card-header">
              <div>
                <h4 className="provider-card-title">{meta.name}</h4>
                <div className="provider-card-sub">{meta.description}</div>
              </div>
              <a
                href={meta.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="provider-key-link"
              >
                Get API Key ↗
              </a>
            </div>

            {/* API Key Field */}
            <div className="form-group">
              <label className="form-label" htmlFor="api-key-input">
                API Key
              </label>
              <div className="input-with-action">
                <input
                  id="api-key-input"
                  type={showKey ? 'text' : 'password'}
                  className="form-input"
                  placeholder={meta.keyPlaceholder}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn-toggle-key"
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              {currentSavedConfig?.apiKey && !showKey && (
                <div className="key-hint">
                  Saved key: <code>{maskApiKey(currentSavedConfig.apiKey)}</code>
                </div>
              )}
            </div>

            {/* Model Selector */}
            <div className="form-group">
              <div className="label-row-with-action">
                <label className="form-label" htmlFor="model-select">
                  Default Model
                </label>
                <div className="model-actions-header">
                  {modelsFetched && (
                    <span className="models-count-badge" title="Live models retrieved from API">
                      ✓ {modelsList.length} models
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-fetch-models"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !inputKey.trim()}
                    title="Query provider API to list all models available for your key"
                  >
                    {fetchingModels ? (
                      <span className="fetching-text">
                        <span className="spinner-inline" /> Fetching...
                      </span>
                    ) : (
                      <span>🔄 Fetch Models</span>
                    )}
                  </button>
                </div>
              </div>

              {!isCustomModel ? (
                <select
                  id="model-select"
                  className="form-select"
                  value={selectedModel}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setIsCustomModel(true);
                      setCustomModelName('');
                    } else {
                      setSelectedModel(e.target.value);
                    }
                  }}
                >
                  {modelsList.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="__custom__">➕ Custom model name...</option>
                </select>
              ) : (
                <div className="custom-model-box">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. gemini-1.5-pro or fine-tuned model ID"
                    value={customModelName}
                    onChange={(e) => {
                      setCustomModelName(e.target.value);
                      setSelectedModel(e.target.value);
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn-cancel-custom"
                    onClick={() => {
                      setIsCustomModel(false);
                      setSelectedModel(modelsList[0] || meta.defaultModel);
                    }}
                    title="Return to model list"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Test result status banner */}
            {testResult && (
              <div className={`test-result-banner ${testResult.success ? 'success' : 'error'}`}>
                <span>{testResult.success ? '✓' : '✕'}</span>
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Provider Actions */}
            <div className="provider-card-actions">
              <div className="left-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleTest}
                  disabled={testing || !inputKey.trim()}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSave}
                  disabled={!inputKey.trim()}
                >
                  Save Key
                </button>
              </div>

              {currentSavedConfig && (
                <div className="right-actions">
                  {!isCurrentActive && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSetActive(selectedProvider)}
                    >
                      Set Active
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger-sm"
                    onClick={handleRemove}
                    title="Delete this key"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Account & End-to-End Encryption */}
        <div className="settings-section">
          <h3 className="section-title">Account & Security</h3>
          <div className="account-info-card">
            <div className="account-row">
              <span className="account-label">Signed in as:</span>
              <span className="account-value">{user?.email || 'Authenticated User'}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Security:</span>
              <span className="account-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Zero-Knowledge Client E2EE (AES-256-GCM)
              </span>
            </div>
            <div className="account-row">
              <span className="account-label">Storage:</span>
              <span className="account-text">Local-first with encrypted Supabase backup</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
