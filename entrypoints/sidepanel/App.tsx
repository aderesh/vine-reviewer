import { useState, useEffect, useCallback } from 'react';
import { storage } from 'wxt/storage';
import type { ProductInfo, GeneratedReview, ReviewTarget, ReviewCharacteristic } from '../../src/types';
import { parseProductHtml, parseReviewTexts } from '../../src/scraper';
import { extractCharacteristics } from '../../src/openai';

// ---------------------------------------------------------------------------
// Form-fill injector — runs inside the Amazon review page via executeScript.
// Must be COMPLETELY SELF-CONTAINED: no imports, no closures over module scope.
// ---------------------------------------------------------------------------

function fillReviewFormInPage(data: { title: string; body: string; stars: number }) {
  const { title, body, stars } = data;

  // Trigger React's synthetic events by using the native value setter from
  // HTMLInputElement / HTMLTextAreaElement prototype (works from MAIN world).
  function setReact(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = Object.getPrototypeOf(el) as HTMLInputElement;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  function findFirst<T extends Element>(selectors: string[]): T | null {
    for (const sel of selectors) {
      try {
        const el = document.querySelector<T>(sel);
        if (el) return el;
      } catch { /* ignore invalid selectors */ }
    }
    return null;
  }

  // Log everything — open DevTools on the review page to see these
  console.log('[VineReviewer] inject → page:', location.href);
  console.log('[VineReviewer] text inputs:',
    [...document.querySelectorAll<HTMLInputElement>('input[type="text"]')]
      .map(e => `#${e.id} name=${e.name} placeholder="${e.placeholder}"`).join(' | ') || 'none');
  console.log('[VineReviewer] textareas:',
    [...document.querySelectorAll<HTMLTextAreaElement>('textarea')]
      .map(e => `#${e.id} name=${e.name} placeholder="${e.placeholder}"`).join(' | ') || 'none');
  console.log('[VineReviewer] radio inputs:',
    [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .map(e => `name=${e.name} value=${e.value} id=${e.id}`).join(' | ') || 'none');
  // Log anything star/rating shaped
  console.log('[VineReviewer] star/rating elements:',
    [...document.querySelectorAll('[class*="star"],[class*="rating"],[data-hook*="star"],[data-testid*="star"],[data-testid*="rating"],[aria-label*="star" i],[aria-label*="rating" i]')]
      .map(e => `${e.tagName}#${(e as HTMLElement).id} class="${e.className}" aria="${e.getAttribute('aria-label')}" data-value="${e.getAttribute('data-value')}" data-rating="${e.getAttribute('data-rating')}"`)
      .join('\n') || 'none');

  const filled: string[] = [];
  const failed: string[] = [];

  // ---- Stars — try many approaches in sequence ----
  function fillStars(n: number): string | null {
    // 1. radio[value="N"] (most common)
    let el: Element | null = document.querySelector(`input[type="radio"][value="${n}"]`);
    if (el) { (el as HTMLElement).click(); return `radio[value="${n}"]`; }

    // 2. numeric comparison (value might be "5.0" etc.)
    el = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find(r => parseFloat(r.value) === n) ?? null;
    if (el) { (el as HTMLElement).click(); return 'radio by numeric value'; }

    // 3. label[for] associated with a star radio
    const starLabels = [...document.querySelectorAll<HTMLLabelElement>('label[for*="star" i], label[for*="rating" i]')];
    // labels are usually ordered 1→5; click the Nth
    if (starLabels.length >= n) {
      starLabels[n - 1].click();
      return `label[for*=star] index ${n - 1}`;
    }

    // 4. aria-label = "N stars" / "N star"
    el = document.querySelector(`[aria-label="${n} star"], [aria-label="${n} stars"], [aria-label="${n} out of 5 stars"]`);
    if (el) { (el as HTMLElement).click(); return `aria-label="${n} stars"`; }

    // 5. data-rating / data-value attribute
    el = document.querySelector(`[data-rating="${n}"], [data-value="${n}"]`);
    if (el) { (el as HTMLElement).click(); return `data-rating="${n}"`; }

    // 6. Nth interactive element inside a star/rating container
    const container = document.querySelector(
      '[class*="star-rating"], [class*="starRating"], [class*="rating-widget"], ' +
      '[data-hook*="star-rating"], [data-testid*="star"], [data-testid*="rating"]'
    );
    if (container) {
      const items = [...container.querySelectorAll<HTMLElement>('button, label, a, [role="radio"], [tabindex="0"]')];
      if (items.length >= n) { items[n - 1].click(); return `Nth(${n}) in star container`; }
    }

    // 7. Any clickable element with a star class, by order
    const byCls = [...document.querySelectorAll<HTMLElement>('[class*="a-star"] a, [class*="star"] button, [class*="star"] label')];
    if (byCls.length >= n) { byCls[n - 1].click(); return `Nth(${n}) star element by class`; }

    // 8. ALL radio inputs ordered — click the Nth one (absolute last resort)
    const allRadios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    if (allRadios.length >= n) { allRadios[n - 1].click(); return `Nth(${n}) radio input`; }

    return null;
  }

  const starResult = fillStars(stars);
  if (starResult) filled.push(`${stars} stars (${starResult})`);
  else failed.push(`stars: all strategies failed for value ${stars}`);

  // ---- Title ----
  const titleEl = findFirst<HTMLInputElement>([
    '#scarface-review-title',
    'input[id*="title" i]',
    'input[name*="title" i]',
    'input[id*="headline" i]',
    'input[name*="headline" i]',
    'input[placeholder*="headline" i]',
    'input[placeholder*="title" i]',
    'input[aria-label*="headline" i]',
    'input[aria-label*="title" i]',
    'main input[type="text"]',
    'form input[type="text"]',
    'input[type="text"]',
  ]);
  if (titleEl) {
    setReact(titleEl, title);
    filled.push('title');
  } else {
    failed.push('title (no input found)');
  }

  // ---- Body ----
  const bodyEl = findFirst<HTMLTextAreaElement>([
    '#scarface-review-body',
    'textarea[id*="review" i]',
    'textarea[id*="body" i]',
    'textarea[id*="description" i]',
    'textarea[id*="text" i]',
    'textarea[name*="review" i]',
    'textarea[name*="description" i]',
    '[data-hook*="review-text"] textarea',
    '[data-testid*="review"] textarea',
    'main textarea',
    'form textarea',
    'textarea',
  ]);
  if (bodyEl) {
    setReact(bodyEl, body);
    filled.push('body');
  } else {
    failed.push('body (no textarea found)');
  }

  if (failed.length) {
    console.warn('[VineReviewer] failed to fill:', failed.join('; '));
  }
  return { ok: failed.length === 0, filled, failed };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage =
  | { type: 'idle' }
  | { type: 'loading'; title: string }
  | { type: 'form'; product: ProductInfo }
  | { type: 'generating' }
  | { type: 'review'; product: ProductInfo }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [stage, setStage] = useState<Stage>({ type: 'idle' });
  const [userNotes, setUserNotes] = useState('');
  const [starRating, setStarRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [fillStatus, setFillStatus] = useState('');
  const [fillTabId, setFillTabId] = useState<number | null>(null);
  const [currentProduct, setCurrentProduct] = useState<ProductInfo | null>(null);
  const [characteristics, setCharacteristics] = useState<ReviewCharacteristic[]>([]);
  const [checkedChars, setCheckedChars] = useState<Set<string>>(new Set());
  const [charsStatus, setCharsStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  // ------------------------------------------------------------------
  // Side-effect: listen for a review target being set in storage
  // (triggered by the vine-orders content script via the background)
  // ------------------------------------------------------------------
  const handleTarget = useCallback(async (target: ReviewTarget) => {
    await storage.removeItem('local:reviewTarget');
    setUserNotes('');
    setStarRating(5);
    setFillStatus('');
    setFillTabId(null);
    setCharacteristics([]);
    setCheckedChars(new Set());
    setCharsStatus('idle');
    setStage({ type: 'loading', title: target.title });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_PRODUCT',
        asin: target.asin,
        locale: target.locale,
      }) as { html?: string; error?: string };

      if (response?.error) throw new Error(response.error);
      if (!response?.html) throw new Error('No HTML returned from product page.');

      const product = parseProductHtml(response.html, target.asin, target.locale);
      setCurrentProduct(product);
      setStage({ type: 'form', product });

      // Load characteristics asynchronously — does not block the form UI
      setCharsStatus('loading');
      (async () => {
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'FETCH_REVIEWS',
            asin: target.asin,
            locale: target.locale,
          }) as { positiveHtml?: string; criticalHtml?: string; error?: string };
          const posTexts = parseReviewTexts(resp?.positiveHtml ?? '');
          const critTexts = parseReviewTexts(resp?.criticalHtml ?? '');
          if (posTexts.length || critTexts.length) {
            const chars = await extractCharacteristics(posTexts, critTexts);
            setCharacteristics(chars);
          }
          setCharsStatus('done');
        } catch {
          setCharsStatus('error');
        }
      })();
    } catch (err) {
      setStage({ type: 'error', message: toMessage(err) });
    }
  }, []);

  useEffect(() => {
    // Check for a target that was set before the panel opened
    storage.getItem<ReviewTarget>('local:reviewTarget').then((target) => {
      if (target) handleTarget(target);
    });

    // Watch for future targets
    const unwatch = storage.watch<ReviewTarget | null>(
      'local:reviewTarget',
      (target) => { if (target) handleTarget(target); },
    );
    return unwatch;
  }, [handleTarget]);

  // ------------------------------------------------------------------
  // Generate
  // ------------------------------------------------------------------
  async function handleGenerate() {
    if (stage.type !== 'form') return;
    if (!userNotes.trim()) {
      alert('Please describe your experience with the product first.');
      return;
    }
    const product = stage.product;
    setStage({ type: 'generating' });

    const checked = characteristics
      .filter((c) => checkedChars.has(c.text))
      .map((c) => `${c.text} (${c.sentiment})`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_REVIEW',
        product,
        userNotes,
        starRating,
        checkedCharacteristics: checked,
      }) as { review?: GeneratedReview; error?: string };

      if (response?.error) throw new Error(response.error);
      if (!response?.review) throw new Error('No review returned.');

      setReviewTitle(response.review.title);
      setReviewBody(response.review.body);
      setCurrentProduct(product);
      setStage({ type: 'review', product });
    } catch (err) {
      setStage({ type: 'error', message: toMessage(err) });
    }
  }

  // ------------------------------------------------------------------
  // Open the review form (navigate the current tab)
  // ------------------------------------------------------------------
  async function handleFill() {
    if (!currentProduct) return;
    setFillStatus('Opening review form…');
    setFillTabId(null);

    const response = await chrome.runtime.sendMessage({
      type: 'FILL_REVIEW_FORM',
      asin: currentProduct.asin,
      locale: currentProduct.locale,
    }) as { ok?: boolean; tabId?: number; error?: string };

    if (response?.error) {
      setFillStatus(`Error: ${response.error}`);
    } else if (response?.tabId) {
      setFillTabId(response.tabId);
      setFillStatus('');
    }
  }

  // ------------------------------------------------------------------
  // Inject filler directly into the review-form tab via executeScript
  // ------------------------------------------------------------------
  async function handleExecuteFill() {
    if (fillTabId == null) return;
    setFillStatus('Filling…');

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: fillTabId },
        world: 'MAIN',
        func: fillReviewFormInPage,
        args: [{ title: reviewTitle, body: reviewBody, stars: starRating }],
      });

      const result = results?.[0]?.result as { ok: boolean; filled: string[]; failed: string[] } | undefined;
      if (!result) {
        setFillStatus('No response from page — is the review form loaded?');
      } else if (result.ok) {
        setFillStatus(`✓ Filled: ${result.filled.join(', ')}`);
      } else {
        setFillStatus(
          `⚠ Partial — could not fill: ${result.failed.join(', ')}. ` +
          `Check DevTools console on the Amazon tab for element info.`
        );
      }
    } catch (err) {
      setFillStatus(`Error: ${toMessage(err)}`);
    }
  }

  function handleRegenerate() {
    if (stage.type !== 'review' || !currentProduct) return;
    setStage({ type: 'form', product: currentProduct });
  }

  const wordCount = reviewBody.trim().split(/\s+/).filter(Boolean).length;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="app">
      <header className="header">
        <span className="header-title">🍇 Vine Reviewer</span>
        <button
          className="link-btn"
          onClick={() => chrome.runtime.openOptionsPage()}
          title="Open settings"
        >
          Settings
        </button>
      </header>

      <main className="body">
        {/* ---- IDLE ---- */}
        {stage.type === 'idle' && (
          <div className="state-idle">
            <p>
              Go to your{' '}
              <a
                href="https://www.amazon.ca/vine/vine-reviews"
                target="_blank"
                rel="noreferrer"
              >
                Vine orders page
              </a>{' '}
              and click <strong>Write Review (AI)</strong> next to a product.
            </p>
          </div>
        )}

        {/* ---- LOADING ---- */}
        {stage.type === 'loading' && (
          <div className="state-center">
            <div className="spinner" />
            <p>Loading product info…</p>
            <p className="muted">{stage.title}</p>
          </div>
        )}

        {/* ---- FORM ---- */}
        {stage.type === 'form' && (
          <div className="state-form">
            <div className="product-card">
              <div className="product-title">{stage.product.title}</div>
              {stage.product.avgRating != null && (
                <div className="product-meta">
                  {'★'.repeat(Math.round(stage.product.avgRating))}
                  {'☆'.repeat(5 - Math.round(stage.product.avgRating))}
                  {' '}
                  {stage.product.avgRating.toFixed(1)}
                  {stage.product.reviewCount != null &&
                    ` · ${stage.product.reviewCount.toLocaleString()} reviews`}
                </div>
              )}
              {stage.product.features.length > 0 && (
                <details className="features-details">
                  <summary>Product features</summary>
                  <ul className="features-list">
                    {stage.product.features.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* ---- CHARACTERISTICS ---- */}
            <div className="field">
              <label>Insights from other buyers</label>
              {charsStatus === 'loading' && (
                <p className="muted chars-loading">Analysing existing reviews…</p>
              )}
              {charsStatus === 'done' && characteristics.length === 0 && (
                <p className="muted">No existing reviews found.</p>
              )}
              {characteristics.length > 0 && (
                <div className="char-list">
                  {characteristics.map((c) => {
                    const on = checkedChars.has(c.text);
                    return (
                      <label
                        key={c.text}
                        className={`char-item char-${c.sentiment}${on ? ' char-on' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            setCheckedChars((prev) => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(c.text) : next.delete(c.text);
                              return next;
                            })
                          }
                        />
                        <span className="char-text">{c.text}</span>
                        <span className="char-badge">{c.count}×</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="user-notes">Your experience with this product</label>
              <textarea
                id="user-notes"
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                placeholder="Write anything — what you liked, what didn't work, who it's good for, quirks. The AI will structure it."
                rows={7}
              />
            </div>

            <div className="field">
              <label>Your rating</label>
              <StarPicker value={starRating} onChange={setStarRating} />
            </div>

            <button className="btn-primary" onClick={handleGenerate}>
              Generate Review
            </button>
          </div>
        )}

        {/* ---- GENERATING ---- */}
        {stage.type === 'generating' && (
          <div className="state-center">
            <div className="spinner" />
            <p>Generating review…</p>
          </div>
        )}

        {/* ---- REVIEW ---- */}
        {stage.type === 'review' && (
          <div className="state-review">
            <div className="review-toolbar">
              <span className={`word-count ${wordCount < 200 || wordCount > 400 ? 'word-count-warn' : ''}`}>
                {wordCount} words
              </span>
              <button className="btn-secondary" onClick={handleRegenerate}>
                ↩ Regenerate
              </button>
            </div>

            <div className="field">
              <label htmlFor="review-title">Title</label>
              <input
                id="review-title"
                type="text"
                value={reviewTitle}
                onChange={(e) => setReviewTitle(e.target.value)}
                maxLength={120}
              />
              <div className="char-count">{reviewTitle.length}/120</div>
            </div>

            <div className="field">
              <label htmlFor="review-body">Review</label>
              <textarea
                id="review-body"
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                rows={12}
              />
            </div>

            <div className="field">
              <label>Your rating</label>
              <StarPicker value={starRating} onChange={setStarRating} />
            </div>

            {fillTabId == null ? (
              <button className="btn-primary" onClick={handleFill}>
                Open Review Form →
              </button>
            ) : (
              <div className="fill-ready">
                <p className="fill-hint">
                  Switch to the Amazon tab and wait for the form to load, then click:
                </p>
                <button className="btn-primary" onClick={handleExecuteFill}>
                  ✓ Fill Form Now
                </button>
                <button className="btn-secondary btn-small" onClick={() => { setFillTabId(null); setFillStatus(''); }}>
                  ← Back
                </button>
              </div>
            )}
            {fillStatus && <p className="fill-status">{fillStatus}</p>}
          </div>
        )}

        {/* ---- ERROR ---- */}
        {stage.type === 'error' && (
          <div className="state-error">
            <p className="error-msg">⚠ {stage.message}</p>
            <button className="btn-secondary" onClick={() => setStage({ type: 'idle' })}>
              Start over
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Star picker
// ---------------------------------------------------------------------------

function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="star-picker" role="group" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${n <= value ? 'star-on' : 'star-off'}`}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          title={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
