import { useState, useEffect, useCallback } from 'react';
import { storage } from 'wxt/storage';
import type { ProductInfo, GeneratedReview, ReviewTarget } from '../../src/types';
import { parseProductHtml } from '../../src/scraper';

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
  const [currentProduct, setCurrentProduct] = useState<ProductInfo | null>(null);

  // ------------------------------------------------------------------
  // Side-effect: listen for a review target being set in storage
  // (triggered by the vine-orders content script via the background)
  // ------------------------------------------------------------------
  const handleTarget = useCallback(async (target: ReviewTarget) => {
    await storage.removeItem('local:reviewTarget');
    setUserNotes('');
    setStarRating(5);
    setFillStatus('');
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

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_REVIEW',
        product,
        userNotes,
        starRating,
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
  // Fill review form
  // ------------------------------------------------------------------
  async function handleFill() {
    if (!currentProduct) return;
    setFillStatus('Opening review form…');

    const response = await chrome.runtime.sendMessage({
      type: 'FILL_REVIEW_FORM',
      asin: currentProduct.asin,
      locale: currentProduct.locale,
      title: reviewTitle,
      body: reviewBody,
      starRating,
    }) as { ok?: boolean; error?: string };

    if (response?.error) {
      setFillStatus(`Error: ${response.error}`);
    } else {
      setFillStatus('Review form opening — click "Fill Form" in the banner on the Amazon page.');
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

            <button className="btn-primary" onClick={handleFill}>
              Fill Review Form →
            </button>
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
