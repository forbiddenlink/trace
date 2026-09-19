# Trace

Paste a screenshot, get a real, runnable React component. AI screenshot-to-component tool:
Gemini recreates a pasted/dropped/uploaded UI screenshot as a self-contained React +
TypeScript component, grounded in an in-prompt shadcn-style component catalog (no vector
DB, no extra credentials), renders it live in a Sandpack sandbox, scores it with axe-core,
and self-repairs on compile or runtime errors. Live at
https://trace-seven-ashen.vercel.app. Began as ComponentCompass (Algolia Agent Studio
Challenge), was reframed and renamed Trace for the DEV.to GitHub Finish-Up-A-Thon.

## Stack

- Vite + React 19 + TypeScript (strict), pnpm 10.34 (lockfile: `pnpm-lock.yaml`)
- `@ai-sdk/google` + `ai` v7, model `gemini-2.5-flash`, via serverless `api/generate.ts`
  (Vercel function), with a Vite dev middleware so `/api/generate` also works under `pnpm dev`
- Tailwind CSS v4 (`@tailwindcss/postcss`) for the "vellum, graphite, vermilion"
  precision-drafting theme
- `@codesandbox/sandpack-react` for the live editable preview (Tailwind via CDN inside
  the sandbox)
- `axe-core` (loaded from CDN) for the in-app accessibility score
- `@sentry/react` for error tracking, no-op until `VITE_SENTRY_DSN` is set
- Vitest + Testing Library for unit tests; Playwright for e2e; both Biome and ESLint run
  (Biome for lint/format, ESLint specifically for `eslint-plugin-react-hooks` /
  `react-refresh` rules)
- Node >=22

## Commands

```bash
pnpm dev              # vite dev server, localhost:5173
pnpm build            # tsc -b && vite build
pnpm preview          # preview the production build
pnpm lint             # eslint .
pnpm biome:check      # biome lint/format check
pnpm biome:fix        # biome check --write
pnpm test             # vitest
pnpm test:ui          # vitest --ui
pnpm test:coverage    # vitest --coverage
pnpm test:e2e         # playwright test (own dev server on port 5174)
pnpm test:e2e:ui      # playwright test --ui
pnpm gallery          # scripts/build-gallery.mjs: screenshots each mockup in
                      # scripts/gallery-mockups/, runs the real generation pipeline
                      # against it, writes public/examples/gallery.json
```

## Layout

- `src/components/` - UI, including `ScreenshotStudio.tsx` (main flow), `TraceLines.tsx`
  (the screenshot-to-inspector-to-preview link lines), `AmbientTrace.tsx`, `ErrorBoundary.tsx`
- `src/lib/` - `rate-limit.ts`, small utils
- `src/services/vision.ts` - vision/generation service glue
- `src/data/gallery.json` + `gallery.ts` - the no-key example gallery data
- `api/generate.ts` - the Vercel serverless generation endpoint
- `e2e/app.spec.ts` - Playwright suite; runs against cached gallery results, needs no
  Gemini key
- `docs/` - includes the demo gif referenced from the README
- `scripts/build-gallery.mjs` - offline gallery builder (see Commands)

## Env vars (names only)

Server-side (`api/generate.ts`, `vite.config.ts`): `GOOGLE_GENERATIVE_AI_API_KEY`
(required), `GEMINI_MODEL`, `BASE_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`,
`SKIP_FIX`, `TRACE_DISABLED`. Client-side (Vite, must be `VITE_`-prefixed):
`VITE_SENTRY_DSN`, `VITE_VERCEL_GIT_COMMIT_SHA` (set by Vercel).

## Conventions

- `pnpm.overrides` in `package.json` pins a long list of transitive deps (brace-expansion,
  cookie, flatted, js-yaml, minimatch, picomatch, protobufjs, rollup, shell-quote,
  systeminformation, undici, vite) for CVE fixes; check there before assuming a
  dependency version floor is unconstrained.
- E2E tests are designed to run with zero credentials: the gallery's cached results mean
  `pnpm test:e2e` never needs a live Gemini key.
- release-please (`release-please-config.json`) manages versioning/CHANGELOG; renovate
  (`renovate.json`) handles dependency PRs.
- Security headers (`X-Frame-Options`, CSP-adjacent headers) are set in `vercel.json`.

## Gotchas

- The accessibility score from axe-core catches roughly half of WCAG issues per the
  README; treat it as directional, not a certification.
- `componentcompass-docs.tar.gz` at repo root and `.specter/` are leftovers from the
  project's earlier ComponentCompass identity; not part of the current app.
