import { storage } from 'wxt/storage';
import type { ReviewTarget, PendingFill, Settings } from './types';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_REVIEW_PROMPT } from './prompts';

// Storage keys (wxt/storage uses "scope:key" format)
const REVIEW_TARGET_KEY = 'local:reviewTarget';
const PENDING_FILL_KEY = 'local:pendingFill';
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

export async function saveSettings(settings: Settings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, settings);
}

// ---------------------------------------------------------------------------
// Review target (content script → side panel handoff)
// ---------------------------------------------------------------------------

export async function getReviewTarget(): Promise<ReviewTarget | null> {
  return storage.getItem<ReviewTarget>(REVIEW_TARGET_KEY);
}

export async function setReviewTarget(target: ReviewTarget): Promise<void> {
  await storage.setItem(REVIEW_TARGET_KEY, target);
}

export async function clearReviewTarget(): Promise<void> {
  await storage.removeItem(REVIEW_TARGET_KEY);
}

export function watchReviewTarget(
  cb: (target: ReviewTarget | null) => void,
): () => void {
  return storage.watch<ReviewTarget | null>(REVIEW_TARGET_KEY, cb);
}

// ---------------------------------------------------------------------------
// Pending form fill (side panel → review-form content script handoff)
// ---------------------------------------------------------------------------

export async function getPendingFill(): Promise<PendingFill | null> {
  return storage.getItem<PendingFill>(PENDING_FILL_KEY);
}

export async function setPendingFill(fill: PendingFill): Promise<void> {
  await storage.setItem(PENDING_FILL_KEY, fill);
}

export async function clearPendingFill(): Promise<void> {
  await storage.removeItem(PENDING_FILL_KEY);
}
