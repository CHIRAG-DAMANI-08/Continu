import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Continu - Cross-AI Context & Prompt Manager',
    description: 'Capture, sync, and continue AI conversations across ChatGPT, Claude, Gemini, and more with client-side end-to-end encryption.',
    version: '0.1.0',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'tabs', 'identity'],
    host_permissions: [
      '<all_urls>',
      'https://*.supabase.co/*',
    ],
    icons: {
      16: 'icon/16.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'continu',
      default_popup: 'popup.html',
      default_icon: {
        16: 'icon/16.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkYfb2xkbcj+z9D/OAdNv5zT6+OXYgLknHJmKCfVFILcNoxG1leb4fCj6Zlzt2ThK/fiF8fJmecLVTPSu73i1XqUFTNcE6kwhD3QVqAJ5HlBNibsUNHpDqRexMPymU5eKy3X4KmXBOBdQXp+QywtdnD95zpmm3IAxzwYFCTB1UmAIVnnLIvZq+sFo3W5cKOT6HovLFimwDS98Qt+zjGF5rMn86H1+8/GL769mHIyEWjQqFFJmPUAKTdJ3XzkB18UN/k69RYz+3ZitIKX0RB/VLRwngGaAuj0/n8PWqHpWgOSKIs4sL2iROC7kBGRpC+vbYaR3V1nVYVmlBBclfEUYRQIDAQAB',
    web_accessible_resources: [
      {
        resources: ['chunks/*', 'assets/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
  // Build for Chrome by default
  browser: 'chrome',
});