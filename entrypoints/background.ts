import { fetchProductHtml, fetchReviewsHtml } from '../src/scraper';
import { generateReview } from '../src/openai';
import { setReviewTarget } from '../src/storage';
import type { AppMessage } from '../src/types';

export default defineBackground(() => {
  // Open side panel when user clicks the extension action button
  chrome.runtime.onInstalled.addListener(() => {
    if ('sidePanel' in chrome) {
      (chrome.sidePanel as chrome.sidePanel.Static).setPanelBehavior({
        openPanelOnActionClick: true,
      });
    }
    migrateSettings();
  });

  // Also run on startup so reloads pick up the migration too
  chrome.runtime.onStartup.addListener(migrateSettings);

  // Handle all messages from content scripts and the side panel
  chrome.runtime.onMessage.addListener(
    (message: AppMessage, sender, sendResponse) => {
      handleMessage(message, sender)
        .then(sendResponse)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ error: msg });
        });
      return true; // keep the channel open for async responses
    },
  );
});

async function handleMessage(
  message: AppMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'OPEN_REVIEW': {
      // Open the side panel FIRST — sidePanel.open() requires the user-gesture
      // token, which is only valid synchronously at the start of the handler.
      // Any await before this call will consume the gesture and open() will fail.
      if ('sidePanel' in chrome && sender.tab?.id != null) {
        (chrome.sidePanel as chrome.sidePanel.Static).open({
          tabId: sender.tab.id,
        });
      }

      // Store the target so the side panel can read it once it opens
      await setReviewTarget({
        asin: message.asin,
        title: message.title,
        locale: message.locale,
      });

      return { ok: true };
    }

    case 'FETCH_PRODUCT': {
      // Only fetch raw HTML here — DOMParser is not available in MV3 service workers.
      // Parsing is done in the side panel (a real browser context).
      const html = await fetchProductHtml(message.asin, message.locale);
      return { html };
    }

    case 'FETCH_REVIEWS': {
      const reviews = await fetchReviewsHtml(message.asin, message.locale);
      return reviews;
    }

    case 'GENERATE_REVIEW': {
      const review = await generateReview(
        message.product,
        message.userNotes,
        message.starRating,
        message.checkedCharacteristics,
      );
      return { review };
    }

    case 'FILL_REVIEW_FORM': {
      // Navigate the active tab to the Amazon review creation page.
      // Use www. explicitly (content script pattern requires a subdomain).
      // Include channel=vine-portal so Amazon renders the Vine-flavoured form.
      const reviewUrl =
        `https://www.${message.locale}/review/create-review` +
        `?channel=vine-portal&asin=${message.asin}`;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) {
        const updatedTab = await chrome.tabs.update(tab.id, { url: reviewUrl });
        return { ok: true, tabId: updatedTab?.id };
      }
      return { ok: false, error: 'No active tab found' };
    }

    default: {
      const _exhaustive: never = message;
      throw new Error(`Unknown message type: ${(_exhaustive as AppMessage).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Settings migration — patches stored prompts that predate a feature addition.
// Safe to re-run: skips if the placeholder is already present.
// ---------------------------------------------------------------------------
async function migrateSettings() {
  const SETTINGS_KEY = 'local:settings';
  const CHARS_PLACEHOLDER = '{characteristics}';
  const CHARS_SECTION =
    '\n\nCharacteristics I agree with from other buyer reviews ' +
    '(mention each one naturally in the review):\n{characteristics}';

  try {
    const saved = await storage.getItem<Record<string, unknown>>(SETTINGS_KEY);
    if (!saved) return;

    const template = saved.reviewPromptTemplate as string | undefined;
    if (!template || template.includes(CHARS_PLACEHOLDER)) return;

    // Insert the section right after {userNotes}
    const patched = template.includes('{userNotes}')
      ? template.replace('{userNotes}', `{userNotes}${CHARS_SECTION}`)
      : template + CHARS_SECTION;

    await storage.setItem(SETTINGS_KEY, { ...saved, reviewPromptTemplate: patched });
    console.log('[VineReviewer] Migrated reviewPromptTemplate to include {characteristics}.');
  } catch (err) {
    console.warn('[VineReviewer] Migration failed:', err);
  }
}
