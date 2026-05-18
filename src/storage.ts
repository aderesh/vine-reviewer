import { storage } from 'wxt/storage';
import type { ReviewTarget, Settings } from './types';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_QUESTIONS_PROMPT } from './prompts';

// Storage keys (wxt/storage uses "scope:key" format)
const REVIEW_TARGET_KEY = 'local:reviewTarget';
export const SETTINGS_KEY = 'local:settings';

export const DEFAULT_SETTINGS: Settings = {
  apiEndpoint: 'https://api.groq.com/openai/v1',
  openaiApiKey: '',
  openaiModel: 'llama-3.3-70b-versatile',
  reviewCount: 3,
  characteristicsCount: 5,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  reviewPromptTemplate: DEFAULT_REVIEW_PROMPT,
  questionsPromptTemplate: DEFAULT_QUESTIONS_PROMPT,
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
