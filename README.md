# Trace

**Paste a screenshot. Get a real, runnable React component.**

![Trace turning a login-form screenshot into a live, grounded React component with an accessibility score](docs/demo.gif)

Live demo: **https://trace-seven-ashen.vercel.app**

## What it does

Trace turns a UI screenshot into a self-contained React + TypeScript component you can run, edit, and ship. Paste from your clipboard, drop a PNG, upload a file, or click a cached example that needs no key. Google Gemini recreates the layout as a real component, grounded in a shadcn-style component catalog, and renders it live in an editable sandbox so you can see the result and tweak it on the spot. It also shows you exactly what it detected, how confident it was, and which pixels became which component.

## Why it's different

1. **Design-system grounding.** Generation is constrained to a real component catalog (an in-prompt whitelist), so Trace reuses actual components and variants instead of inventing generic markup. No vector database, no credentials.
2. **Trace lines.** Animated draftsman construction lines wire each region of the screenshot to its inspector row to its place in the preview, with bidirectional hover-to-locate. The name is literal: you can see which part of the screenshot became which component.
3. **"What the AI sees" inspector with honest confidence.** Every detected element gets a numbered bounding box on the screenshot, a mapped component and variant, a confidence reading, and an honest grounding tag: grounded, inferred, or guessed. Low-confidence regions can be refined with one click.
4. **Live, editable preview.** The component renders in a Sandpack sandbox (Tailwind via CDN) you can edit in place, not a static screenshot of code.
5. **Self-repair loop.** Generated code is compile-checked and auto-fixed by re-prompting on failure. Runtime errors in the preview get a one-click "Ask Trace to fix it" that re-prompts with the error.
6. **Accessibility score, then fix.** axe-core runs against the rendered component for a 0-100 score plus a violations list, with a one-click "Fix accessibility" that re-prompts Gemini to resolve them.
7. **Refine in plain language, or draw on it.** Refine the current component with a text prompt, or scribble notes directly on the screenshot in vermilion and Trace treats the marks as instructions, not as UI to recreate.

A draftsman plotter loading sequence narrates the wait (detecting, grounding, drafting, checking accessibility), and the whole app wears a deliberate precision-drafting look: vellum, graphite, and vermilion, reticle frames, dimension annotations, Space Grotesk and Public Sans.

## How it works

```
Screenshot (paste / drop / upload / cached example)
        |
        v
Gemini grounded generation  (catalog whitelist in prompt)
        |
        +--> "What the AI sees" inspector  (bounding boxes + confidence + grounded/inferred/guessed)
        |          ^
        |          |  trace lines link screenshot <-> inspector <-> preview
        v          v
Sandpack live render  (editable React + TS, Tailwind via CDN)
        |
        +--> axe-core accessibility score -> one-click "Fix accessibility"
        |
        +--> compile check -> self-repair (auto re-prompt on failure)
        |
        +--> refine by prompt / draw-to-instruct / refine low-confidence regions
```

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Vite, React 19, TypeScript (strict) |
| Styling | Tailwind CSS (precision-drafting theme: vellum, graphite, vermilion) |
| AI | `@ai-sdk/google` + `ai` v7, model `gemini-2.5-flash` |
| Sandbox | `@codesandbox/sandpack-react` (Tailwind via CDN) |
| Accessibility | `axe-core` (loaded from CDN) |
| Validation | `zod` |
| API | Serverless `api/generate.ts` (Vercel function) + a Vite dev middleware so `/api/generate` works under `pnpm dev` |

## Getting started

```bash
git clone https://github.com/forbiddenlink/trace.git
cd trace
pnpm install
```

Set your Gemini key in `.env`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
```

This is the only required key. Grounding is done with an in-prompt catalog, so there is no search service to configure.

```bash
pnpm dev
```

Open http://localhost:5173.

## Try it with no key

Trace ships with an example gallery of preloaded UIs with cached generation results. Click any thumbnail on the empty state to load a full result (detection inspector, live preview, accessibility score) with no API key and no network call. It is the fastest way to see what Trace does.

## Accessibility

Every rendered component is scored with axe-core (0-100) and its violations are listed inline. "Fix accessibility" re-prompts Gemini to resolve the reported issues. The automated check catches roughly half of WCAG issues, so treat the score as a directional signal rather than a certification. The app's own UI ships a skip-to-studio link, labeled landmarks, keyboard navigation, and visible focus styles, and passes an axe-core audit clean.

## Background

Trace began as a component-search chatbot (ComponentCompass) for the Algolia Agent Studio Challenge in February 2026, was shelved, then revived and reframed around the screenshot-to-component idea for the DEV.to GitHub Finish-Up-A-Thon and renamed to Trace. The Algolia dependency was dropped along the way; in-prompt grounding is simpler and credential-free. Read the story: https://dev.to/liztacular/my-ai-tool-generated-garbage-jsx-so-i-grounded-it-in-shadcnui-and-finally-shipped-it-1i1n

## License

MIT - Liz Stein, 2026. See [LICENSE](LICENSE).
