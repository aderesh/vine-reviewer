# Copilot Instructions

## Source of Truth

`README.md` is the single source of truth for this project — its purpose, user flow, and feature set. Keep it up to date whenever a feature changes or a user requirement is implemented. Copilot instructions intentionally contain no feature descriptions.

## General Rules

- **Only change what is explicitly asked for.** Do not refactor, add features, improve error handling, add comments, or make "while I'm here" changes to code that was not mentioned in the request.
- If a change looks useful but was not requested, note it but do not implement it.

## Stack

- **WXT 0.19.29** — browser extension framework. Build: `wxt build -b chrome`.
- **React 18 + TypeScript** — side panel and options UI.
- **`wxt/storage`** — all persistent state. Keys use `local:keyname` format.
- `runner: { disabled: true }` in `wxt.config.ts` — Brave snap blocks CDP, so the dev runner is disabled. Load the extension manually from `.output/chrome-mv3/`.
- `esbuild: { jsx: 'automatic' }` — required to avoid the broken `builtin:vite-react-refresh-wrapper`.

## Project Layout

```
entrypoints/
  background.ts          # Service worker — all chrome.runtime.onMessage handlers
  sidepanel/App.tsx      # Main side panel UI
  options/App.tsx        # Settings page
  vine-orders.content.ts # Injects buttons on the Vine orders page
src/
  types.ts               # Shared types and AppMessage union
  storage.ts             # Typed wrappers around wxt/storage; exports DEFAULT_SETTINGS
  prompts.ts             # DEFAULT_SYSTEM_PROMPT and DEFAULT_REVIEW_PROMPT
  openai.ts              # AI API call + buildPrompt + extractCharacteristics
  scraper.ts             # fetchProductHtml / parseProductHtml / fetchReviewsHtml / parseReviewTexts
```

## Key Conventions

- `AppMessage` in `types.ts` is the exhaustive discriminated union for all background messages. Add new message types there first.
- `DEFAULT_SETTINGS` is defined once in `src/storage.ts` and imported everywhere — do not re-declare it.
- The options page saves settings directly via `storage.setItem('local:settings', ...)` — `saveSettings()` does not exist.
- Form fill uses `chrome.scripting.executeScript` with `world: 'MAIN'` called directly from the side panel (not via a content script). The injected function `fillReviewFormInPage` must be completely self-contained — no imports, no closure over module scope.
- `response_format: { type: 'json_object' }` is sent on every AI request to enforce JSON-only output.

## Build

```bash
npm run build        # production build → .output/chrome-mv3/
```

Load unpacked from `.output/chrome-mv3/` in `brave://extensions`.
