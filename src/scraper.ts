import type { ProductInfo } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getText(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const text = doc.querySelector(sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

function getAll(doc: Document, selector: string): string[] {
  return Array.from(doc.querySelectorAll(selector))
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

/**
 * Fetches the raw HTML of an Amazon product page.
 * Safe to call from the background service worker (no CORS restriction, no DOM APIs needed).
 *
 * NOTE: Amazon's DOM changes periodically. If extraction stops working, update
 * the selectors in parseProductHtml below.
 */
export async function fetchProductHtml(asin: string, locale: string): Promise<string> {
  const url = `https://${locale}/dp/${asin}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-CA,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch product page (${response.status}): ${url}`);
  }

  return response.text();
}

/**
 * Parses a raw Amazon product page HTML string into a ProductInfo object.
 * Must be called in a browser context (side panel / content script) because it
 * uses DOMParser — which is not available in MV3 service workers.
 */
export function parseProductHtml(html: string, asin: string, locale: string): ProductInfo {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Title
  const title = getText(doc, [
    '#productTitle',
    '#title span',
    'h1.a-spacing-none span',
  ]) || `Product ${asin}`;

  // Bullet features
  const features = getAll(doc, '#feature-bullets .a-list-item')
    .filter((t) => t.length > 2 && !/make sure this fits/i.test(t))
    .slice(0, 10);

  // Description (prefer short form, fall back to full)
  const description = getText(doc, [
    '#productDescription p',
    '#productDescription',
    '[data-feature-name="productDescription"] p',
    '#aplus p',
  ]);

  // Average rating (e.g. "4.3 out of 5 stars")
  const ratingText = getText(doc, [
    '#acrPopover .a-size-medium.a-color-base',
    '#averageCustomerReviews .a-icon-alt',
    '[data-hook="rating-out-of-text"]',
  ]);
  const avgRating = parseFloat(ratingText) || null;

  // Total review count
  const countText = getText(doc, [
    '#acrCustomerReviewText',
    '[data-hook="total-review-count"]',
  ]);
  const reviewCount = parseInt(countText.replace(/[^\d]/g, ''), 10) || null;

  return { asin, locale, title, features, description, avgRating, reviewCount };
}
