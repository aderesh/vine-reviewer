import { fetchProductHtml } from '../src/scraper';
import { generateReview } from '../src/openai';
import { setReviewTarget, setPendingFill } from '../src/storage';
import type { AppMessage } from '../src/types';

export default defineBackground(() => {
  // Open side panel when user clicks the extension action button
  chrome.runtime.onInstalled.addListener(() => {
    if ('sidePanel' in chrome) {
      (chrome.sidePanel as chrome.sidePanel.Static).setPanelBehavior({
        openPanelOnActionClick: true,
      });
    }
  });

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

    case 'GENERATE_REVIEW': {
      const review = await generateReview(
        message.product,
        message.userNotes,
        message.starRating,
      );
      return { review };
    }

    case 'FILL_REVIEW_FORM': {
      // Persist the fill payload so the review-form content script can read it
      await setPendingFill({
        asin: message.asin,
        locale: message.locale,
        title: message.title,
        body: message.body,
        starRating: message.starRating,
      });

      // Navigate the active tab to the Amazon review creation page
      const reviewUrl = `https://${message.locale}/review/create-review/?asin=${message.asin}`;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) {
        await chrome.tabs.update(tab.id, { url: reviewUrl });
      }
      return { ok: true };
    }

    default: {
      const _exhaustive: never = message;
      throw new Error(`Unknown message type: ${(_exhaustive as AppMessage).type}`);
    }
  }
}
