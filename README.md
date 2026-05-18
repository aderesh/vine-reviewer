# Vine Reviewer — Browser Extension

A browser extension for Brave/Chrome/Firefox that streamlines writing Amazon Vine reviews using the OpenAI API.

---

## Purpose

Amazon Vine reviewers receive free products in exchange for honest reviews. Writing a thorough, useful review for every product is time-consuming. This extension automates the boilerplate: it pulls product context from Amazon, accepts a short freeform note from the user, and uses ChatGPT to produce a fully structured, insightful review that meets Amazon's quality standards — then fills it in for you.

---

## Core User Flow

```
1. Visit amazon.ca/vine/vine-reviews (or any Amazon locale's Vine page)
       │
       ▼
2. Extension injects a [Write Review] button next to each pending item
       │
       ▼
3. Click [Write Review] → Side Panel opens
       │
       ├─ Extension auto-fetches product details via ASIN:
       │    • Product name, bullet features, full description
       │    • Current avg star rating + review count
       │    • Top 3–5 existing customer reviews (for AI context)
       │
       ▼
4. User sees product info summary + a single feedback field:
       "Tell me about your experience with this product"
       (freeform — AI extracts pros/cons/sentiment)
       + Star rating selector (1–5, required separate field on Amazon)
       │
       ▼
5. [Generate Review] →  OpenAI API call (via background worker)
       │
       ▼
6. Generated review appears:
       • Review title (required by Amazon)
       • Review body (200–400 words, pros/cons structure)
       • Word count badge
       • [Edit inline] [Regenerate] [Fill Review Form →]
       │
       ▼
7. [Fill Review Form →]
       • Opens the Amazon "Write a Customer Review" page for this product
       • Extension fills title + body with simulated human typing
       • User reviews the filled form and submits manually
```

---

## Review Quality Criteria

The AI is instructed to produce a review that:

- Is **200–400 words**
- Uses a **pros / cons structure** (inferred from freeform user input)
- Is **useful and insightful** — explains *why* something is good or bad, not just that it is
- Avoids promotional language, superlatives, and marketing fluff
- Is honest — includes real negatives if the user mentioned any
- Generates a **concise, descriptive title** (not clickbait)

---

## Design Decisions

### Browser Target
- **Primary**: Brave (Chromium-based — Chrome MV3 extensions work natively, no special handling required)
- **Also supported**: Chrome, Firefox (MV3)
- Minimum versions: Chrome/Brave 114+, Firefox 131+ (for Side Panel API)

### Locale Handling
- Extension reads the Amazon locale from the **active tab's URL** at runtime
- Supports all `amazon.*` domains (`.ca`, `.com`, `.co.uk`, `.de`, `.com.au`, etc.)
- **No hardcoded default** — always follows whichever Amazon the user has open
- Vine orders URL pattern: `https://www.amazon.{tld}/vine/vine-reviews`
- Review form URL pattern: `https://www.amazon.{tld}/review/create-review/...`

### Manifest Version
- **Manifest V3** — current standard, required for Chrome Web Store
- Uses `chrome.sidePanel` API
- Background: service worker (not persistent background page)

### UI Surface — Side Panel
- Stays open alongside the Amazon page; no popup-closes-on-click problem
- Single panel handles the full flow: product info → feedback → generated review

### Input Form — Single Field
- One `<textarea>`: *"Tell me about your experience with this product"*
- User writes anything — bullet points, sentences, fragments — AI decides structure
- **Plus** a 1–5 star selector: kept as a discrete control because (a) it is a required Amazon field, (b) star ratings are hard to infer reliably from natural language, and (c) a 5-star click takes 1 second

### Bot Detection Mitigation (Review Form Fill)
The goal is reliable form filling without triggering bot-detection heuristics:

- Fill is **always user-initiated** via button click — never automatic on page load
- Fields are set using **React-compatible direct value injection**: native `HTMLInputElement`/`HTMLTextAreaElement` value setter invoked via `Object.getOwnPropertyDescriptor`, followed by `input` and `change` events with `bubbles: true`
- This correctly triggers React's synthetic event system without simulating keystrokes
- No character-by-character typing simulation — no artificial delays
- The review submission itself is always done **manually by the user** — the extension never clicks Submit
- If Amazon changes its form structure, fill gracefully degrades with a clear error message; user can always copy-paste from the side panel

### Options Page
The options page exposes:
- **OpenAI API key** (stored securely, show/hide toggle)
- **Model selection** (gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo)
- **System prompt** — editable textarea with the AI's persona/role
- **Review prompt template** — editable textarea with `{productTitle}`, `{features}`, `{description}`, `{userNotes}`, `{starRating}` placeholders; "Reset to defaults" button

All settings survive browser restarts via `browser.storage.local`.

### API Key Handling
- User enters their OpenAI API key in the **extension Options page**
- Stored in `browser.storage.local` (encrypted at rest by the browser profile)
- Key is **only accessed from the background service worker** — never passed to content scripts or the DOM
- Content scripts communicate with the background via `chrome.runtime.sendMessage`

### Data Fetching — No External APIs
- Product data is scraped from the Amazon product page (fetched server-side by the background worker using the ASIN)
- No Amazon Product API, no third-party services, no authentication beyond OpenAI
- Scraping is done via a background `fetch` (not a content script) to keep it clean and avoid CORS issues

### OpenAI Integration
- Model: `gpt-4o` (configurable in Options, defaults to `gpt-4o`)
- Called directly via `fetch` to `https://api.openai.com/v1/chat/completions`
- No OpenAI SDK — avoids the dependency and bundle size

### Tech Stack — Minimal Dependencies

| Layer | Choice | Reason |
|---|---|---|
| Build | **WXT** + Vite | Purpose-built extension framework; HMR for all pages and content scripts; auto-reloads extension on changes; unified Chrome/Firefox build |
| UI | React + TypeScript | User preference |
| Styling | Plain CSS (no framework) | Zero design dependencies |
| State | React `useState` / `useContext` | No extra library needed for this scope |
| API | `fetch` directly to OpenAI | Avoids OpenAI SDK |
| Storage | `wxt/storage` | Typed wrapper included with WXT; no extra dependency |
| Cross-browser | WXT + `wxt/browser` | WXT bundles webextension-polyfill; no separate dep needed |

**Production dependencies**: none (everything bundled at build time)  
**Dev dependencies**: `wxt`, `@wxt-dev/module-react`, `react`, `react-dom`, `typescript`, `@types/react`, `@types/react-dom`

---

## Project Structure

Follows [WXT](https://wxt.dev) conventions. WXT generates `manifest.json` from `wxt.config.ts`.

```
vine-reviewer/
├── entrypoints/                      # WXT entry points (auto-discovered)
│   ├── background.ts                 # Service worker: message routing, OpenAI calls, product fetching
│   ├── vine-orders.content.ts        # Injects [Write Review] buttons on Vine orders page
│   ├── review-form.content.ts        # Fills Amazon review form on user request
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── main.tsx                  # React entry point
│   │   ├── App.tsx                   # Panel UI: product info → feedback form → generated review
│   │   └── styles.css
│   └── options/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx                   # Settings: API key, model, editable prompts
│       └── styles.css
├── src/                              # Shared utilities
│   ├── types.ts                      # ProductInfo, Settings, AppMessage, etc.
│   ├── prompts.ts                    # Default system prompt and review prompt template
│   ├── storage.ts                    # Typed helpers around wxt/storage
│   ├── scraper.ts                    # Fetches and parses Amazon product page HTML
│   └── openai.ts                     # Calls OpenAI API, builds prompt from template
├── public/
│   └── icons/                        # 16, 32, 48, 128px PNG icons (add manually)
├── wxt.config.ts                     # WXT + manifest configuration
├── tsconfig.json
├── package.json
└── README.md
```

## Development

WXT provides HMR for UI pages (side panel, options) and auto-reloads the extension on content script or background changes.

```bash
npm install

# Start dev server (Chrome/Brave)
npm run dev

# Start dev server (Firefox)
npm run dev:firefox
```

**First-time setup in Brave/Chrome:**
1. Run `npm run dev`
2. Go to `brave://extensions` (or `chrome://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `.output/chrome-mv3/` directory
5. WXT will auto-reload the extension as you make changes

**Production build:**
```bash
npm run build          # Chrome/Brave
npm run build:firefox
npm run zip            # Creates a distributable .zip
```

---

## Message Protocol (Content ↔ Background)

All inter-component communication goes through `chrome.runtime.sendMessage`:

| Message type | Sender | Receiver | Payload |
|---|---|---|---|
| `OPEN_REVIEW` | `vine-orders.content.ts` | background | `{ asin, title, locale }` |
| `FETCH_PRODUCT` | sidepanel | background | `{ asin, locale }` |
| `GENERATE_REVIEW` | sidepanel | background | `{ product, userNotes, starRating }` |
| `FILL_REVIEW_FORM` | sidepanel | background | `{ asin, locale, title, body, starRating }` |

---

## TODO / Future Work

- **Review History**: Store past generated reviews locally (indexed by ASIN). When reviewing a similar product, surface prior reviews as additional AI context. Useful for the scenario where you order the same or similar product again.
- **Google Photos Integration**: Allow browsing and selecting photos from Google Photos to attach to the review.
- **Multi-locale expansion**: Groundwork is already locale-aware; just needs testing on non-CA storefronts.
- **Tone presets**: Casual, technical, family-friendly — selectable per review.
- **Draft auto-save**: Persist the in-progress review in storage so a panel reload doesn't lose work.

---

## Security Notes

- The OpenAI API key is never logged, never sent to any server other than `api.openai.com`, and never accessible from the page's JavaScript context
- Content scripts run in an isolated world and communicate only via the extension message bus
- No user data is persisted beyond what is explicitly saved by the user (future: review history)
- The extension requests only the minimum permissions required: `storage`, `sidePanel`, `activeTab`, `scripting`, and host permissions for `*://*.amazon.*/*` and `https://api.openai.com/*`
