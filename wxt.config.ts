import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    esbuild: {
      jsx: 'automatic',
    },
  }),
  runner: {
    disabled: true,
  },

  manifest: {
    name: 'Vine Reviewer',
    description: 'AI-powered Amazon Vine review writing assistant',
    version: '0.1.0',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel', 'tabs'],
    host_permissions: [
      '*://*.amazon.ca/*',
      '*://*.amazon.com/*',
      '*://*.amazon.co.uk/*',
      '*://*.amazon.de/*',
      '*://*.amazon.fr/*',
      '*://*.amazon.es/*',
      '*://*.amazon.it/*',
      '*://*.amazon.com.au/*',
      '*://*.amazon.co.jp/*',
      'https://api.openai.com/*',
      'https://api.groq.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    options_ui: {
      page: 'options/index.html',
      open_in_tab: true,
    },
    action: {
      default_title: 'Open Vine Reviewer',
    },
  },
});
