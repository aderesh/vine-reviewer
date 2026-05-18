/**
 * vine-orders.content.ts
 *
 * Injected on the Amazon Vine page. Adds "Write Review (AI)" buttons next to
 * every "Review Item" link that leads to the Amazon review creation form.
 *
 * Works on both the Reviews tab (table layout) and the Vine Items tab (tile
 * layout) because it anchors on the review link href rather than a specific
 * container class.
 *
 * If buttons stop appearing: open DevTools on the Vine page, find a
 * "Review Item" link and check whether its href contains "create-review".
 */

const INJECTED_ATTR = 'data-vr-injected';

export default defineContentScript({
  matches: [
    '*://*.amazon.ca/vine/vine-reviews*',
    '*://*.amazon.com/vine/vine-reviews*',
    '*://*.amazon.co.uk/vine/vine-reviews*',
    '*://*.amazon.de/vine/vine-reviews*',
    '*://*.amazon.fr/vine/vine-reviews*',
    '*://*.amazon.es/vine/vine-reviews*',
    '*://*.amazon.it/vine/vine-reviews*',
    '*://*.amazon.com.au/vine/vine-reviews*',
    '*://*.amazon.co.jp/vine/vine-reviews*',
  ],
  runAt: 'document_idle',

  main() {
    injectButtons();
    // The Reviews tab loads / paginates dynamically
    const observer = new MutationObserver(() => injectButtons());
    observer.observe(document.body, { childList: true, subtree: true });
  },
});

// ---------------------------------------------------------------------------

function injectButtons(): void {
  const locale = window.location.hostname.replace(/^www\./, '');

  // Find every "Review Item" link that hasn't been processed yet.
  // Amazon's Vine review links always contain "create-review" in the href.
  document
    .querySelectorAll<HTMLAnchorElement>(`a[href*="create-review"]:not([${INJECTED_ATTR}])`)
    .forEach((link) => {
      // Mark immediately to prevent duplicate injection on rapid mutations
      link.setAttribute(INJECTED_ATTR, 'true');

      const asin = extractAsin(link.href);
      if (!asin) return;

      const title = extractTitle(link);

      const btn = buildButton(() => {
        chrome.runtime.sendMessage({ type: 'OPEN_REVIEW', asin, title, locale });
      });

      // Insert after the outermost Amazon button wrapper (.a-button span),
      // NOT inside .a-button-inner which Amazon clips with overflow:hidden.
      const outerWrapper = link.closest('.a-button') ?? link.parentElement;
      outerWrapper?.insertAdjacentElement('afterend', btn);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAsin(href: string): string | null {
  try {
    const url = new URL(href, location.origin);
    const asin = url.searchParams.get('asin');
    if (asin) return asin;
  } catch {
    // malformed URL — fall through
  }
  const match = href.match(/\/dp\/([A-Z0-9]{10})/i);
  return match?.[1] ?? null;
}

function extractTitle(reviewLink: HTMLAnchorElement): string {
  // Walk up to the nearest table row or list item and look for a product link/title
  const row = reviewLink.closest('tr, li, [class*="item"], [class*="tile"]');
  if (row) {
    // Product links on Amazon go to /dp/ASIN.
    // Use .a-truncate-full to get the clean title — Amazon duplicates the
    // text in an offscreen span + a visible truncated span, so plain
    // textContent would return it twice.
    const productLink = row.querySelector<HTMLAnchorElement>('a[href*="/dp/"]');
    if (productLink) {
      const title =
        productLink.querySelector('.a-truncate-full')?.textContent?.trim() ||
        productLink.textContent?.trim();
      if (title) return title;
    }

    // Fallback: any reasonably long text node in the row
    const candidates = Array.from(row.querySelectorAll('td, span, div'))
      .map((el) => el.childNodes)
      .reduce<Text[]>((acc, nodes) => {
        nodes.forEach((n) => { if (n.nodeType === Node.TEXT_NODE) acc.push(n as Text); });
        return acc;
      }, [])
      .map((t) => t.textContent?.trim() ?? '')
      .filter((t) => t.length > 20);

    if (candidates[0]) return candidates[0];
  }
  return 'Product';
}

function buildButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = '✍ Write Review (AI)';
  btn.setAttribute('type', 'button');
  btn.style.cssText = [
    'background:#232f3e',
    'color:#fff',
    'border:none',
    'padding:5px 11px',
    'cursor:pointer',
    'font-size:12px',
    'font-family:Arial,sans-serif',
    'border-radius:3px',
    'margin:4px 0 0 0',
    'display:inline-block',
    'line-height:1.4',
    'white-space:nowrap',
  ].join(';');

  btn.addEventListener('mouseover', () => { btn.style.background = '#37475a'; });
  btn.addEventListener('mouseout',  () => { btn.style.background = '#232f3e'; });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return btn;
}
