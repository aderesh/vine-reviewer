import { useState, useEffect } from 'react';
import { storage } from 'wxt/storage';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_REVIEW_PROMPT } from '../../src/prompts';
import type { Settings } from '../../src/types';

const PRESETS: Record<string, { endpoint: string; model: string }> = {
  'Groq (free)': {
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  OpenAI: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  Gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
  },
};

const DEFAULT_SETTINGS: Settings = {
  apiEndpoint: 'https://api.groq.com/openai/v1',
  openaiApiKey: '',
  openaiModel: 'llama-3.3-70b-versatile',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  reviewPromptTemplate: DEFAULT_REVIEW_PROMPT,
};

export default function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    storage.getItem<Settings>('local:settings').then((saved) => {
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...saved });
    });
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    try {
      await storage.setItem('local:settings', settings);
      setStatus({ text: 'Settings saved.', ok: true });
    } catch {
      setStatus({ text: 'Failed to save settings.', ok: false });
    }
    setTimeout(() => setStatus(null), 3000);
  }

  async function handleResetPrompts() {
    setConfirmReset(false);
    const next = {
      ...settings,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      reviewPromptTemplate: DEFAULT_REVIEW_PROMPT,
    };
    setSettings(next);
    try {
      await storage.setItem('local:settings', next);
      setStatus({ text: 'Prompts reset and saved.', ok: true });
    } catch {
      setStatus({ text: 'Reset applied but failed to save.', ok: false });
    }
    setTimeout(() => setStatus(null), 3000);
  }

  return (
    <div className="opts">
      <h1>Vine Reviewer — Settings</h1>

      {/* ---- API ---- */}
      <section>
        <h2>AI Provider</h2>

        <div className="field">
          <label>Quick-select provider</label>
          <div className="input-row">
            {Object.entries(PRESETS).map(([name, preset]) => (
              <button
                key={name}
                type="button"
                className="btn-secondary"
                onClick={() => setSettings((prev) => ({
                  ...prev,
                  apiEndpoint: preset.endpoint,
                  openaiModel: preset.model,
                }))}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="api-endpoint">API Endpoint</label>
          <input
            id="api-endpoint"
            type="url"
            value={settings.apiEndpoint}
            onChange={(e) => update('apiEndpoint', e.target.value)}
            placeholder="https://api.groq.com/openai/v1"
            spellCheck={false}
          />
          <p className="hint">
            Groq is free — get a key at{' '}
            <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer">console.groq.com</a>.
          </p>
        </div>

        <div className="field">
          <label htmlFor="api-key">API Key</label>
          <div className="input-row">
            <input
              id="api-key"
              type={showKey ? 'text' : 'password'}
              value={settings.openaiApiKey}
              onChange={(e) => update('openaiApiKey', e.target.value)}
              placeholder="Paste your key here"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn-toggle" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="hint">Stored locally in the browser. Never sent anywhere except the endpoint above.</p>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            type="text"
            value={settings.openaiModel}
            onChange={(e) => update('openaiModel', e.target.value)}
            placeholder="llama-3.3-70b-versatile"
            spellCheck={false}
          />
          <p className="hint">
            Groq models: <code>llama-3.3-70b-versatile</code>, <code>llama-3.1-8b-instant</code>.
            OpenAI models: <code>gpt-4o</code>, <code>gpt-4o-mini</code>.
          </p>
        </div>
      </section>

      {/* ---- Prompts ---- */}
      <section>
        <h2>Prompts</h2>
        <p className="hint">
          Customise how the AI generates reviews. Changes take effect on the next
          generation.
        </p>

        <div className="field">
          <label htmlFor="system-prompt">System Prompt</label>
          <textarea
            id="system-prompt"
            value={settings.systemPrompt}
            onChange={(e) => update('systemPrompt', e.target.value)}
            rows={4}
          />
        </div>

        <div className="field">
          <label htmlFor="review-prompt">Review Prompt Template</label>
          <div className="placeholder-table">
            <div className="placeholder-row placeholder-header">
              <span>Placeholder</span><span>Replaced with</span>
            </div>
            {[
              ['{productTitle}',    'Product name from the Amazon listing'],
              ['{features}',        'Bullet-point feature list from the product page'],
              ['{description}',     'Full product description from the listing'],
              ['{userNotes}',       'Your notes typed in the side panel'],
              ['{characteristics}', 'Buyer insights you checked in the side panel'],
              ['{starRating}',      'Star rating you selected (1–5)'],
            ].map(([ph, desc]) => (
              <div key={ph} className="placeholder-row">
                <code>{ph}</code><span>{desc}</span>
              </div>
            ))}
          </div>
          <textarea
            id="review-prompt"
            value={settings.reviewPromptTemplate}
            onChange={(e) => update('reviewPromptTemplate', e.target.value)}
            rows={18}
          />
        </div>

        {confirmReset ? (
          <span className="reset-confirm">
            Reset both prompts to defaults?{' '}
            <button type="button" className="btn-danger" onClick={handleResetPrompts}>Yes, reset</button>
            {' '}
            <button type="button" className="btn-secondary" onClick={() => setConfirmReset(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setConfirmReset(true)}>
            Reset prompts to defaults
          </button>
        )}
      </section>

      {/* ---- Save ---- */}
      <div className="save-row">
        <button type="button" className="btn-primary" onClick={handleSave}>
          Save Settings
        </button>
        {status && (
          <span className={`save-status ${status.ok ? 'save-ok' : 'save-err'}`}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
