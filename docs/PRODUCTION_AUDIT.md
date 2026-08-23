# Vocanb Production Readiness Audit

Audit date: 2026-08-24

## Scope verified

- SvelteKit routes, layouts, actions, JSON/image endpoints, SSR and direct navigation
- Vocabulary create/upload/OCR/normalization, CRUD, image lifecycle, tests, retests, stars, and continuous learning
- Sentence PDF import, passage normalization, summary/translation generation, memorization tests, and result persistence
- JSON indexes and entities, schema defaults, atomic writes, locks, authentication, proxy deployment, and error paths
- Mobile widths 320, 375, 390, 430, and 768px; drawer keyboard state, dialogs, touch targets, safe-area CSS, and reduced-motion/transparency/contrast rules
- Unit, route integration, Playwright E2E, GitHub Actions, and TeamCity configuration

## Fixed

### High

- Continuous-learning starts now derive and append the next session under the vocabulary lock. Concurrent tabs cannot create the same active range twice.
- Deleting and renumbering words now clears only continuous-learning metadata while preserving historical test snapshots and results. This prevents renumbering from skipping the next word.
- Sentence-test saves are serialized per passage and carry a backward-compatible revision. Stale full-map writes return `409` instead of overwriting newer results; network and conflict failures are visible and recoverable in the UI.
- Sentence import preserves whitespace-only runs when they separate visible text, while still dropping wholly blank paragraphs. `Hello` + ` ` + `world` no longer becomes `Helloworld`.
- Uploaded images are written through an fsynced temporary file and atomically linked into place. JSON rename operations now fsync their parent directory.
- Production deployment now sets `ADDRESS_HEADER=x-real-ip` only behind the documented trusted Nginx/firewall boundary, so login throttling is per client rather than globally keyed to the proxy.

### Medium/Low

- OCR word fields now apply NFKC Unicode normalization and collapse all whitespace, including single line breaks.
- Summary and translation retry buttons now actually retry after a failed request.
- Closed mobile navigation is `visibility: hidden`, preventing off-screen controls from receiving keyboard focus. Mobile sentence rating targets are at least 44px.

## Regression coverage added or expanded

- Concurrent continuous-learning start from two requests
- Word deletion during continuous-learning progress
- Stale sentence-result revision rejection and legacy revision default
- Sentence import whitespace boundary preservation
- Atomic image creation without overwriting an existing path
- OCR Unicode width and line-break normalization
- Direct navigation and horizontal containment at 320/375/390/430/768px
- Closed/open/Escape mobile drawer behavior

## Remaining risks

### High/Medium

- Index plus entity creation/deletion is atomic per file, not a cross-file transaction. A process or host crash can leave an unindexed entity or post-delete orphan. A durable journal/reconciler requires an explicit recovery policy and was not introduced speculatively.
- Create, PDF import, and image upload have client pending guards but no persistent idempotency key. Duplicate titles are explicitly allowed, so content-based deduplication would change product policy.
- Corrupt indexed JSON fails closed and is never overwritten, but one corrupt record can prevent list loading. Silent skipping could hide user data; an explicit backup/repair tool and migration policy are still needed.
- Locks are in-process and the documented deployment is intentionally single-instance. Horizontal scaling is unsafe until locks and storage move to a shared transactional system.
- Sentence summary/translation generation is cached after completion but not single-flight; two tabs can duplicate provider cost and persist whichever valid response finishes last.

### Uncertain/product policy

- Multi-image OCR is intentionally all-or-nothing. Keeping partial successes requires a user-visible per-image retry/confirmation policy.
- OCR results are validated and editable but saved without a separate confirmation stage. Adding mandatory confirmation changes the established workflow.
- Vocabulary reorder is not implemented. Sentence image import and passage correction are also absent; this audit did not invent them.
- Large vocabularies render and rewrite the complete JSON document. Correctness is bounded and test history is capped, but 1,000–5,000-word interactive latency needs production-like profiling before pagination or storage redesign.
- The current CSP permits inline script/style required by the existing SvelteKit output and component styles. Nonce-based CSP hardening remains a separate deployment-compatible change.

## Verification

The repository requires Node 24. Verification used the installed Node 24.19.0 runtime and the scripts defined in `package.json`. See the final task report for the exact command results.
