import type { AIAdapter } from './base';

export class AdapterManager {
  private adapters: AIAdapter[] = [];

  register(adapter: AIAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * Detect which adapter matches the current page.
   * Returns the first matching adapter, or null if none match.
   * Generic adapter should be registered last as fallback.
   */
  detect(): AIAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.detect()) {
        return adapter;
      }
    }
    return null;
  }

  getAdapter(name: string): AIAdapter | null {
    return this.adapters.find(a => a.name === name) || null;
  }

  getRegisteredNames(): string[] {
    return this.adapters.map(a => a.name);
  }
}
