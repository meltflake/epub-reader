# NixBook — Architecture & Changelog

## Architecture Overview

### Files
| File | Purpose |
|------|---------|
| `index.html` | Homepage: book shelf, add books, translation trigger, settings, Dropbox sync |
| `reader.html` | EPUB reader: paginated reading, word lookup, highlights, translation display |
| `db.js` | IndexedDB wrapper (v4): stores books, vocabulary, highlights, translations |
| `sync.js` | Dropbox sync: merge logic, push/pull, book file sync, translation sync |
| `dropbox.js` | Dropbox API: OAuth PKCE, upload/download data/books/translations |
| `theme.js` | Theme state: light/dark/eink cycle, stored in localStorage |
| `theme.css` | Solarized color scheme + eink theme, JetBrains Mono font |
| `sw.js` | Service Worker: network-first (dev mode, no caching) |
| `flashcards.html` | Flashcard review (SM-2 spaced repetition) |
| `highlights.html` | Highlights feed view with export |
| `translate.js` | Unused (translation moved inline to index.html) |
| `translate-worker.js` | Unused (translation moved inline to index.html) |
| `manifest.json` | PWA manifest |

### Key Dependencies (CDN)
- **foliate-js**: EPUB parsing & rendering (`cdn.jsdelivr.net/gh/johnfactotum/foliate-js@main/`)
- **zip.js**: ZIP extraction for EPUB files (`cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm`)
- **Cloudflare Worker**: Translation proxy at `nixbook.wulujia.workers.dev`

### Data Storage
- **IndexedDB** (`epub-reader` v4): books, vocabulary, highlights, translations
- **localStorage keys**:
  - `epub-reader-theme`: light/dark/eink
  - `reader-font-size`: number (default 16)
  - `translation-queue`: JSON object of queued translation tasks per bookId
  - `translation-complete`: JSON object of completed books
  - `paragraph-counts`: JSON object of unique hash counts per bookId
  - `showTranslations_{bookId}`: boolean per book

### Translation
- Model: `claude-3-5-haiku-20241022` (via Cloudflare Worker proxy)
- Batch size: 10 paragraphs per API call
- Paragraph filtering: text.length >= 10, no Chinese characters
- Hash: simple string hash → base36 (shared between db.js and index.html)
- Completion: based on unique hash count (not total paragraph count, since duplicates exist)

---

## reader.html — Interaction Design

### Layout (top to bottom)
1. **Toolbar** (sticky top): back button, book title, chapter label, translate toggle, theme toggle, TOC
2. **Reader container** (flex: 1): contains `<foliate-view>` with paginated flow
3. **Bottom bar** (hidden by default): progress slider + percentage

### Viewport Height (CRITICAL)
- Problem: Mobile browsers have dynamic chrome (address bar, bottom nav) that `100vh` doesn't account for
- Solution: Inline `<script>` sets `document.body.style.height = window.innerHeight + 'px'`
- Updates on `resize` and `visualViewport.resize` events
- The EPUB content also has `padding: 20px 20px 60px 20px` as extra bottom safety margin
- **DO NOT use CSS-only solutions** (`100vh`, `100dvh`, `calc(100% - Npx)`) — they are unreliable across mobile browsers

### Touch Interactions (Mobile)
- **Quick tap** (<300ms, <10px movement): Toggle toolbar visibility
  - Handled in `touchend` event on EPUB doc
  - `click` event on EPUB doc is **skipped** for touch devices (`if (isTouchDevice()) return`) to prevent double-fire
- **Horizontal swipe** (>80px): Page turn (left=next, right=prev)
  - Also in `touchend`, checked after tap
  - Skipped if text is selected
- **Long press**: Browser native text selection (we do NOT override this)
- **Selection complete**: Detected via `selectionchange` event (600ms debounce)
  - Single word → dictionary popup + save to vocabulary
  - Sentence → auto-highlight + save to highlights
  - After handling, `sel.removeAllRanges()` clears selection to dismiss browser's native toolbar

### Mouse Interactions (PC)
- **Click**: Toggle toolbar (unless text selected or link clicked)
  - Handled in `click` event, only for non-touch devices
- **Mouse selection + mouseup**: Same word/sentence handling as mobile
- **Keyboard**: Arrow keys for navigation, VolumeUp/Down mapped to page turn
- **Toolbar**: Visible by default on PC (hidden by default on mobile only)

### Dictionary Popup Positioning
- **Mobile**: Fixed at top center (`left: center, top: 60px`) — never blocked by browser toolbar
- **PC**: Near the selection, above the text (fallback to below if no room)

### Progress Sync
- Every `relocate` event (page turn): `saveBook()` → then `pushToDropbox()`
- `isSyncing` lock prevents concurrent syncs
- No debounce, no interval — immediate on every page turn

---

## sync.js — Merge Logic

### Full sync (`syncWithDropbox`)
1. Download remote data
2. Export local data
3. Merge (local-first for books)
4. Apply merged data to IndexedDB (books, vocabulary, highlights)
5. Upload merged data to Dropbox
6. Sync book files (upload missing, download missing)
7. Sync translations per book

### Book merge rule
- **Local wins by default** (local books added to map first)
- Remote only overwrites if `remote.lastReadAt > local.lastReadAt`
- File blob always preserved from local

### `applyMergedData`
- Vocabulary: `put` (upsert)
- Highlights: `clear` + `add` (full replace to avoid duplicate auto-increment IDs)
- Books: read existing → merge metadata (progress, lastLocation, lastReadAt) but **preserve local file blob and coverBlob**

### Quick push (`pushToDropbox`)
- Upload-only, no merge — used after page turns in reader.html

---

## index.html — Translation Badge Logic

### Badge priority (top to bottom, first match wins)
1. Active translation running → show status message
2. `translationCount >= totalParas` → "已翻译 N/N 段 ✓"
3. Queued task (not error) → "继续 N%"
4. Has translations + has file → show count + "继续翻译" button
5. Has translations, no file → show count only (can't resume)
6. Has file, no translations → "翻译" button

### `totalParas` sources (first non-null wins)
1. `localStorage` paragraph-counts
2. Queued task totalCount
3. Completed book count

### Translation resume
- Always re-parses EPUB (never trusts cached paragraph list from queue)
- Saves unique hash count (not total paragraph count)

---

## Known Issues / Technical Debt
1. `translate.js` and `translate-worker.js` are unused — translation logic is inline in `index.html`
2. `hashText()` is duplicated in both `db.js` and `index.html`
3. `formatAuthor()` in `index.html` has object-safe handling; `reader.html` line ~670 still uses raw `String(meta.author)` for non-array objects
4. Bottom bar `.bottom-bar` has `display: none` but is toggled via `bar-hidden` class — the bar is never actually shown because `display: none` takes precedence. Need to set `display: flex` when toolbar is visible.
5. E-ink theme disables ALL transitions/animations globally — may affect foliate-js page animation

---

## Changelog

### 2026-02-15

#### Batch 1: Core fixes
- Fixed zip.js CDN: UMD → ESM (`+esm` URL)
- Created `makeZipLoader(file)` for foliate-js EPUB class
- Fixed Dropbox token refresh (auto-refresh via `getValidAccessToken()`)
- Fixed translation progress display (total book progress, not remaining)

#### Batch 2: Translation persistence
- Persistent translation queue in `localStorage`
- Auto-resume `resumeQueuedTranslations()` on page load
- Translation completion marker in `localStorage`

#### Batch 3: Reader UX
- Fixed mouse click vs text selection conflict (track `mouseDownPos`/`isSelecting`)
- PC: keyboard-only navigation (no click navigation)
- Mobile: swipe gestures (>80px horizontal) + edge tap
- Changed font to Noto Sans SC Regular (wght@400)
- Changed link color to Solarized green (#859900)

#### Batch 4: Homepage redesign
- Redesigned card layout, header icons, drag & drop
- Added periodic sync (60s interval) + debounced sync (3s)
- Smart tab behavior (translation running → new tab)

#### Batch 5: Naming & themes
- Renamed to NixBook
- Added e-ink theme (light → dark → eink cycle)
- Mobile: increased swipe threshold to 80px
- Added `selectionchange` listener for mobile word lookup
- Dictionary popup positioned above selection

#### Batch 6: Bottom cutoff saga
- Tried `padding-bottom`, `env(safe-area-inset-bottom)`, `100dvh`, `calc(100% - 48px)`, `@media (pointer: coarse)` — all unreliable
- **Final solution**: JS `window.innerHeight` sets body height + 60px bottom padding in EPUB content

#### Batch 7: Toolbar toggle
- Problem: `click` and `touchend` both fired on mobile, causing double toggle
- Fix: `click` handler skips touch devices; only `touchend` handles tap on mobile

#### Batch 8: Translation fixes
- Fixed model name: `claude-3-5-haiku-20241022` (not `claude-haiku-4-5-20250929`)
- Always re-parse EPUB on resume (don't trust cached paragraphs)
- Save unique hash count as total (not duplicate paragraph count)
- Fixed `[object Object]` author display

#### Batch 9: Progress sync
- Changed from debounced (3s) to immediate sync on every page turn
- Fixed merge: local-first (local added to map first, remote only wins if genuinely newer)
- Fixed `applyMergedData` to write book metadata back to IndexedDB

#### Batch 10: Settings & native selection
- Settings panel: theme picker + font size
- Reader respects font size from settings
- Restored native text selection (removed `user-select: none`)
- `sel.removeAllRanges()` after handling to dismiss browser toolbar
- Extract cover and metadata on book add (not just on first read)
