/**
 * review-form.content.ts
 *
 * Injected on Amazon's "Write a Customer Review" page.
 * When a pending fill payload is found in storage (placed there by the
 * background after the user clicks "Fill Review Form →" in the side panel),
 * a non-intrusive banner is shown. Clicking "Fill" populates the form fields.
 *
 * The extension NEVER submits the form — the user always does that manually.
 *
 * Amazon's review form DOM changes periodically. If filling stops working,
 * inspect the live page and update FIELD_SELECTORS below.
 */

import { storage } from 'wxt/storage';
import type { PendingFill } from '../src/types';

// ---------------------------------------------------------------------------
// Selectors — update these if Amazon changes the review form markup
// ---------------------------------------------------------------------------
const FIELD_SELECTORS = {
  // Star rating: Amazon renders these as hidden radio inputs styled as stars.
  // The value attribute matches the star count (1–5).
  starRadio: (n: number) =>
    `input[type="radio"][value="${n}"][name*="star"], input[type="radio"][value="${n}"][id*="star"]`,

  // Fallback: clickable star label elements
  starLabel: (n: number) =>
    `label[for*="star-${n}"], [data-hook="star-${n}"], .a-star-${n}`,

  // Review title input
  title: [
    'input[name="title"]',
    '#dp-review-title',
    'input[id*="title"]',
    'input[placeholder*="headline" i]',
    'input[placeholder*="title" i]',
  ],

  // Review body textarea
  body: [
    'textarea[name="description"]',
    '[data-hook="review-text-area-wrapper"] textarea',
    'textarea[id*="description"]',
    'textarea[placeholder*="review" i]',
    'textarea',
  ],
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default defineContentScript({
  matches: [
    '*://*.amazon.ca/review/create-review*',
    '*://*.amazon.com/review/create-review*',
    '*://*.amazon.co.uk/review/create-review*',
    '*://*.amazon.de/review/create-review*',
    '*://*.amazon.fr/review/create-review*',
    '*://*.amazon.es/review/create-review*',
    '*://*.amazon.it/review/create-review*',
    '*://*.amazon.com.au/review/create-review*',
    '*://*.amazon.co.jp/review/create-review*',
  ],
  runAt: 'document_idle',

  async main() {
    const fill = await storage.getItem<PendingFill>('local:pendingFill');
    if (!fill) return;

    // Wait for the form to be ready (Amazon loads it asynchronously)
    await waitForElement(FIELD_SELECTORS.body[0], 8000);
    showBanner(fill);
  },
});

// ---------------------------------------------------------------------------
// Banner UI
// ---------------------------------------------------------------------------

function showBanner(fill: PendingFill): void {
  const banner = document.createElement('div');
  banner.id = 'vr-banner';
  banner.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'background:#232f3e',
    'color:#fff',
    'padding:10px 16px',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'font-family:Arial,sans-serif',
    'font-size:13px',
    'box-shadow:0 2px 8px rgba(0,0,0,.4)',
  ].join(';');

  banner.innerHTML = `
    <span style="flex:1">🍇 <strong>Vine Reviewer</strong> — review ready to fill</span>
    <button id="vr-fill-btn" style="background:#f90;color:#000;border:none;padding:6px 14px;cursor:pointer;border-radius:3px;font-weight:bold;font-size:13px">Fill Form</button>
    <button id="vr-dismiss-btn" style="background:transparent;color:#fff;border:1px solid #fff;padding:6px 12px;cursor:pointer;border-radius:3px;font-size:13px">Dismiss</button>
  `;

  document.body.prepend(banner);
  // Nudge page content down so the banner doesn't cover the form header
  document.body.style.marginTop = `${banner.offsetHeight + 4}px`;

  document.getElementById('vr-fill-btn')?.addEventListener('click', async () => {
    const errors = fillForm(fill);
    banner.remove();
    document.body.style.marginTop = '';
    await storage.removeItem('local:pendingFill');

    if (errors.length > 0) {
      showToast(
        `Filled with issues:\n• ${errors.join('\n• ')}\nPlease fill remaining fields manually.`,
        'warn',
      );
    } else {
      showToast('Form filled — please review and submit.', 'ok');
    }
  });

  document.getElementById('vr-dismiss-btn')?.addEventListener('click', async () => {
    banner.remove();
    document.body.style.marginTop = '';
    await storage.removeItem('local:pendingFill');
  });
}

// ---------------------------------------------------------------------------
// Form filling
// ---------------------------------------------------------------------------

function fillForm(fill: PendingFill): string[] {
  const errors: string[] = [];

  if (!setStarRating(fill.starRating)) {
    errors.push(`Could not set star rating (${fill.starRating} stars)`);
  }

  if (!setField(FIELD_SELECTORS.title, fill.title)) {
    errors.push('Could not fill review title');
  }

  if (!setField(FIELD_SELECTORS.body, fill.body)) {
    errors.push('Could not fill review body');
  }

  return errors;
}

/**
 * Sets a text input or textarea value in a way that triggers React's
 * synthetic event system (React overrides the native setter).
 */
function setField(selectors: string[], value: string): boolean {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
    if (!el) continue;

    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
    return true;
  }
  return false;
}

/**
 * Attempts to click the correct star on Amazon's review form.
 * Tries radio inputs first, then falls back to clickable label/span elements.
 */
function setStarRating(stars: number): boolean {
  // Radio input approach
  for (const sel of [FIELD_SELECTORS.starRadio(stars)]) {
    const radio = document.querySelector<HTMLInputElement>(sel);
    if (radio) {
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }

  // Label / decorative element approach
  const label = document.querySelector<HTMLElement>(FIELD_SELECTORS.starLabel(stars));
  if (label) {
    label.click();
    return true;
  }

  // Last resort: find all star-related inputs and click the nth one
  const allStarInputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="radio"][name*="star"], input[type="radio"][id*="star"]',
  );
  const target = allStarInputs[stars - 1];
  if (target) {
    target.click();
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function waitForElement(selector: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(); // proceed even if element never appeared
    }, timeoutMs);
  });
}

function showToast(message: string, type: 'ok' | 'warn'): void {
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'z-index:2147483647',
    `background:${type === 'ok' ? '#2e7d32' : '#e65100'}`,
    'color:#fff',
    'padding:10px 16px',
    'border-radius:4px',
    'font-family:Arial,sans-serif',
    'font-size:13px',
    'white-space:pre-line',
    'max-width:360px',
    'box-shadow:0 2px 8px rgba(0,0,0,.4)',
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}
