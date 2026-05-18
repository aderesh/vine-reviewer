import type { ProductInfo } from './types';

// Shared fetch headers — used for both product page and reviews page
const FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-CA,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

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

  const response = await fetch(url, { headers: FETCH_HEADERS });

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

// ---------------------------------------------------------------------------
// Reviews scraper (for characteristics analysis)
// ---------------------------------------------------------------------------

/**
 * Fetches raw HTML for the top positive and critical review pages.
 * Runs from the background service worker (no CORS restriction).
 * Returns empty strings on failure so characteristics load gracefully degrades.
 */
export async function fetchReviewsHtml(
  asin: string,
  locale: string,
): Promise<{ positiveHtml: string; criticalHtml: string }> {
  const base = `https://${locale}/product-reviews/${asin}?sortBy=helpful&reviewerType=all_reviews&pageNumber=1`;

  const [posRes, critRes] = await Promise.allSettled([
    fetch(`${base}&filterByStar=positive`, { headers: FETCH_HEADERS }),
    fetch(`${base}&filterByStar=critical`, { headers: FETCH_HEADERS }),
  ]);

  const positiveHtml =
    posRes.status === 'fulfilled' && posRes.value.ok
      ? await posRes.value.text()
      : '';
  const criticalHtml =
    critRes.status === 'fulfilled' && critRes.value.ok
      ? await critRes.value.text()
      : '';

  return { positiveHtml, criticalHtml };
}

/**
 * Parses review body texts out of a raw Amazon reviews page HTML.
 * Must be called in a browser context (side panel) — uses DOMParser.
 */
export function parseReviewTexts(html: string, locale: string): { text: string; url: string | null }[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const results: { text: string; url: string | null }[] = [];
  for (const container of doc.querySelectorAll('[data-hook="review"]')) {
    const text = container.querySelector('[data-hook="review-body"] span')?.textContent?.trim() ?? '';
    if (text.length <= 30) continue;
    const reviewId = container.getAttribute('id')?.match(/customer_review_([A-Z0-9]+)/i)?.[1] ?? null;
    const path = reviewId ? `/gp/customer-reviews/${reviewId}` : (
      container.querySelector<HTMLAnchorElement>('a[data-hook="review-title"]')?.getAttribute('href') ??
      container.querySelector<HTMLAnchorElement>('[data-hook="review-title"] a')?.getAttribute('href') ??
      container.querySelector<HTMLAnchorElement>('a[href*="customer-reviews"]')?.getAttribute('href') ??
      null
    );
    results.push({ text, url: path ? `https://www.${locale}${path}` : null });
    if (results.length >= 10) break;
  }
  return results;
}
