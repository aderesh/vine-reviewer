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
// Selectors — ordered from most to least specific.
// If filling stops working, open DevTools on the review page and check
// what id/name/data-hook attributes the title input and body textarea have,
// then add them at the TOP of the appropriate list below.
// ---------------------------------------------------------------------------
const FIELD_SELECTORS = {
  // Star rating radio inputs (value = star count)
  starRadio: (n: number) =>
    `input[type="radio"][value="${n}"][name*="star"], ` +
    `input[type="radio"][value="${n}"][id*="star"], ` +
    `input[type="radio"][value="${n}"][name*="rating"], ` +
    `input[type="radio"][value="${n}"][name*="Rating"]`,

  // Clickable star label / decorative elements (fallback)
  starLabel: (n: number) =>
    `label[for*="star-${n}"], label[for*="rating-${n}"], ` +
    `[data-hook="star-${n}"], .a-star-${n} a, ` +
    `[id*="star-${n}"], [id*="rating-${n}"]`,

  // Review headline / title
  title: [
    // Amazon's most common review title IDs
    '#dp-review-title',
    'input[name="title"]',
    'input[id*="title"]',
    'input[id*="Title"]',
    'input[id*="headline"]',
    'input[data-hook*="title"]',
    'input[placeholder*="headline" i]',
    'input[placeholder*="title" i]',
    'input[aria-label*="headline" i]',
    'input[aria-label*="title" i]',
    // Generic fallback: first visible text input in the page body
    'main input[type="text"]',
    'form input[type="text"]',
    'input[type="text"]',
  ],

  // Review body textarea
  body: [
    'textarea[name="description"]',
    'textarea[id*="description"]',
    'textarea[id*="review"]',
    'textarea[id*="Review"]',
    'textarea[id*="body"]',
    'textarea[id*="text"]',
    '[data-hook="review-text-area-wrapper"] textarea',
    '[data-testid*="review"] textarea',
    '[data-testid*="body"] textarea',
    'textarea[placeholder*="review" i]',
    'textarea[aria-label*="review" i]',
    // Generic fallback: first visible textarea
    'main textarea',
    'form textarea',
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

    // Wait for ANY textarea — the form is loaded asynchronously by React.
    // Try the most specific selector first, then fall back to any textarea.
    await waitForAnyElement(
      [...FIELD_SELECTORS.body, 'textarea', 'input[type="text"]'],
      10_000,
    );

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
      // Log what inputs/textareas ARE on the page so the developer can update selectors
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'))
        .map((el) => `input: id="${el.id}" name="${(el as HTMLInputElement).name}" placeholder="${(el as HTMLInputElement).placeholder}"`)
        .join('\n');
      const textareas = Array.from(document.querySelectorAll('textarea'))
        .map((el) => `textarea: id="${el.id}" name="${(el as HTMLTextAreaElement).name}" placeholder="${(el as HTMLTextAreaElement).placeholder}"`)
        .join('\n');
      console.warn('[Vine Reviewer] Fill failed. Inputs found on page:\n' + inputs + '\n' + textareas);

      showToast(
        `Partial fill — could not set:\n• ${errors.join('\n• ')}\n\nCheck DevTools console for selectors.`,
        'warn',
        8000,
      );
    } else {
      showToast('Form filled — please review and submit.', 'ok', 4000);
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

/** Resolves as soon as any selector from the list matches, or after timeout. */
function waitForAnyElement(selectors: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => selectors.some((s) => document.querySelector(s));
    if (check()) { resolve(); return; }

    const observer = new MutationObserver(() => {
      if (check()) { observer.disconnect(); resolve(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(); }, timeoutMs);
  });
}

function showToast(message: string, type: 'ok' | 'warn', durationMs = 5000): void {
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
    'max-width:380px',
    'box-shadow:0 2px 8px rgba(0,0,0,.4)',
    'cursor:pointer',
  ].join(';');
  toast.textContent = message;
  toast.title = 'Click to dismiss';
  toast.addEventListener('click', () => toast.remove());
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}
