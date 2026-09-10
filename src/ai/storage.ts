import type { ProviderConfig, ProviderType } from './types';

const AI_STORAGE_KEY = 'continu_ai_settings';

export interface AISettings {
  providers: Partial<Record<ProviderType, ProviderConfig>>;
  activeProvider: ProviderType | null;
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 6);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

function protectKey(rawKey: string): string {
  if (!rawKey) return '';
  if (rawKey.startsWith('enc:v1:')) return rawKey;
  try {
    const encoded = btoa(encodeURIComponent(rawKey.trim()));
    return `enc:v1:${encoded}`;
  } catch {
    return rawKey;
  }
}

function unprotectKey(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith('enc:v1:')) {
    try {
      return decodeURIComponent(atob(stored.slice(7)));
    } catch {
      return stored;
    }
  }
  return stored;
}

export async function getAISettings(): Promise<AISettings> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(AI_STORAGE_KEY);
      const settings = result[AI_STORAGE_KEY] as AISettings | undefined;
      const rawProviders = settings?.providers || {};
      const cleanProviders: Partial<Record<ProviderType, ProviderConfig>> = {};

      for (const [prov, cfg] of Object.entries(rawProviders)) {
        if (cfg) {
          cleanProviders[prov as ProviderType] = {
            ...cfg,
            apiKey: unprotectKey(cfg.apiKey || ''),
          };
        }
      }

      return {
        providers: cleanProviders,
        activeProvider: settings?.activeProvider || null,
      };
    }
  } catch (err) {
    console.warn('Continu: Failed to read AI settings:', err);
  }
  return {
    providers: {},
    activeProvider: null,
  };
}

export async function saveAIProvider(config: ProviderConfig): Promise<void> {
  const current = await getAISettings();
  const nextProviders = {
    ...current.providers,
    [config.provider]: config,
  };

  const nextActive = current.activeProvider || config.provider;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    // Store with protected API keys
    const storageProviders: Record<string, ProviderConfig> = {};
    for (const [prov, cfg] of Object.entries(nextProviders)) {
      if (cfg) {
        storageProviders[prov] = {
          ...cfg,
          apiKey: protectKey(cfg.apiKey),
        };
      }
    }

    await chrome.storage.local.set({
      [AI_STORAGE_KEY]: {
        providers: storageProviders,
        activeProvider: nextActive,
      },
    });
  }
}

export async function removeAIProvider(provider: ProviderType): Promise<void> {
  const current = await getAISettings();
  const nextProviders = { ...current.providers };
  delete nextProviders[provider];

  let nextActive = current.activeProvider;
  if (nextActive === provider) {
    const remaining = Object.keys(nextProviders) as ProviderType[];
    nextActive = remaining.length > 0 ? remaining[0] : null;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({
      [AI_STORAGE_KEY]: {
        providers: nextProviders,
        activeProvider: nextActive,
      },
    });
  }
}

export async function setActiveAIProvider(provider: ProviderType | null): Promise<void> {
  const current = await getAISettings();
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({
      [AI_STORAGE_KEY]: {
        ...current,
        activeProvider: provider,
      },
    });
  }
}
