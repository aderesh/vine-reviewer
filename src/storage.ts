import { storage } from 'wxt/storage';
import type { ReviewTarget, Settings } from './types';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_REVIEW_PROMPT } from './prompts';

// Storage keys (wxt/storage uses "scope:key" format)
const REVIEW_TARGET_KEY = 'local:reviewTarget';
const SETTINGS_KEY = 'local:settings';

export const DEFAULT_SETTINGS: Settings = {
  apiEndpoint: 'https://api.groq.com/openai/v1',
  openaiApiKey: '',
  openaiModel: 'llama-3.3-70b-versatile',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  reviewPromptTemplate: DEFAULT_REVIEW_PROMPT,
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  const saved = await storage.getItem<Settings>(SETTINGS_KEY);
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS;
}

// ---------------------------------------------------------------------------
// Review target (content script → side panel handoff)
// ---------------------------------------------------------------------------

export async function setReviewTarget(target: ReviewTarget): Promise<void> {
  await storage.setItem(REVIEW_TARGET_KEY, target);
}
