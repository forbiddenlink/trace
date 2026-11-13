/**
 * Durable limit for the paid endpoint. When UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set, a shared Upstash sliding window applies per IP, plus a
 * global ceiling (GLOBAL_RATE_LIMIT_MAX per hour, default 300) so rotating IPs cannot multiply
 * spend. Without them the in-memory limiter above is used (one production warning). If the
 * store errors or times out it fails closed. Returns true when the request must be refused.
 */
const GLOBAL_RATE_LIMIT_MAX = Number(process.env.GLOBAL_RATE_LIMIT_MAX ?? 300);
let warnedNoRedis = false;
const durableLimiters = new Map<string, Promise<{ limit(k: string): Promise<{ success: boolean; reason?: string }> }>>();

function durableLimiter(name: string, max: number, window: `${number} s`) {
  let l = durableLimiters.get(name);
  if (!l) {
    l = (async () => {
      const [{ Ratelimit }, { Redis }] = await Promise.all([
        import('@upstash/ratelimit'),
        import('@upstash/redis'),
      ]);
      return new Ratelimit({
        redis: new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL as string,
          token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
        }),
        limiter: Ratelimit.slidingWindow(max, window),
        prefix: `trace:rl:${name}`,
        timeout: 2000,
      });
    })();
    durableLimiters.set(name, l);
  }
  return l;
}

export async function isRateLimitedDurable(ip: string): Promise<boolean> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    if (process.env.NODE_ENV === 'production' && !warnedNoRedis) {
      warnedNoRedis = true;
      console.warn(
        '[api/generate] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set: rate limit is per-instance and does not cap spend across serverless instances.',
      );
    }
    return isRateLimited(ip);
  }
  try {
    const perIp = await durableLimiter('ip', RATE_LIMIT_MAX, `${Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)} s`);
    const a = await perIp.limit(ip);
    if (a.reason === 'timeout') throw new Error('rate limit store timed out');
    if (!a.success) return true;
    const global = await durableLimiter('global', GLOBAL_RATE_LIMIT_MAX, '3600 s');
    const b = await global.limit('all');
    if (b.reason === 'timeout') throw new Error('rate limit store timed out');
    return !b.success;
  } catch (error) {
    console.error('[api/generate] rate limit store unavailable, failing closed:', error);
    return true;
  }
}

/**
 * POST /api/generate — screenshot -> React component generation (Vercel serverless).
 *
 * SELF-CONTAINED ON PURPOSE: the Vercel Node builder compiles only this entry file and
 * does NOT emit sibling `./_lib/*.ts` into the function bundle, so any relative import
 * into `_lib` crashes production at import with ERR_MODULE_NOT_FOUND. Everything the
 * function needs therefore lives here (or in node_modules, which Vercel bundles correctly).
 *
 * Uses the Vercel AI SDK (`generateObject`) with Google Gemini to:
 *  1. Detect UI elements in a screenshot and map each to the closest catalog component.
 *  2. Generate ONE self-contained TypeScript React file that recreates the screenshot.
 *
 * No secrets are read or logged here beyond passing the API key to the SDK via env.
 *
 * Also exports the framework-agnostic core `generateFromScreenshot` (plus its types) so
 * the Vite dev middleware and the gallery build script can call it directly.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';

/** A single catalog component entry (shape of components_index_enhanced.json). */
interface CatalogComponent {
  objectID: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  status: string;
  props: string;
  variants: string;
}

export interface Detection {
  label: string;
  componentName: string;
  variant?: string;
  confidence: number;
  /**
   * Bounding box of this element in the screenshot, normalized 0-1000 in
   * Gemini's native [ymin, xmin, ymax, xmax] order (y first). Optional so older
   * cached gallery results without boxes still type-check. Length 4 at runtime.
   */
  box?: number[];
  /**
   * Honest mapping confidence band: grounded = clean catalog match,
   * inferred = reasonable with some uncertainty, guessed = low confidence.
   */
  grounding?: 'grounded' | 'inferred' | 'guessed';
}

export interface GenResult {
  detections: Detection[];
  jsx: string;
  componentsUsed: string[];
  notes: string;
  /** How many repair iterations the server ran to make the jsx compile (0 = first attempt passed). */
  repairs: number;
}

/** Optional targeted-repair context passed from the client when generated code needs fixing. */
export interface RepairContext {
  /** The previously generated jsx that needs fixing. */
  previousJsx?: string;
  /** The issue(s) to fix: a compile/runtime error, or a formatted list of a11y violations. */
  errorMessage?: string;
  /**
   * What kind of fix this is. 'compile' (default) frames the issues as a compile/runtime
   * failure; 'a11y' frames them as accessibility issues to fix while preserving the design;
   * 'refine' frames the errorMessage as a USER CHANGE REQUEST to apply to the component.
   */
  repairReason?: 'compile' | 'a11y' | 'refine';
}

/* Inlined from data/components_index_enhanced.json. Defined here (not imported) so the
 * Vercel serverless function bundles it reliably (importing JSON/TS from outside this
 * file caused ERR_MODULE_NOT_FOUND in production). The gallery build script still treats
 * data/components_index_enhanced.json as the source of truth offline. */
const catalog: CatalogComponent[] = [
  {
    objectID: 'button-1',
    name: 'Button',
    category: 'Forms',
    description:
      'Clickable button with variants: default, destructive, outline, secondary, ghost, link. Sizes: default, sm, lg, icon.',
    tags: ['interactive', 'form', 'action', 'cta'],
    status: 'stable',
    props: 'variant, size, asChild, disabled',
    variants: 'default, destructive, outline, secondary, ghost, link',
  },
  {
    objectID: 'input-1',
    name: 'Input',
    category: 'Forms',
    description: 'Text input field. Types: text, email, password, number, tel, url, search.',
    tags: ['form', 'text', 'input', 'field'],
    status: 'stable',
    props: 'type, placeholder, disabled, value',
    variants: 'default, error',
  },
  {
    objectID: 'card-1',
    name: 'Card',
    category: 'Layout',
    description:
      'Container with header, content, footer. Sub: CardHeader, CardTitle, CardDescription, CardContent, CardFooter.',
    tags: ['container', 'layout', 'content'],
    status: 'stable',
    props: 'className',
    variants: 'default',
  },
  {
    objectID: 'dialog-1',
    name: 'Dialog',
    category: 'Overlay',
    description:
      'Modal with focus trapping, keyboard nav. Sub: DialogTrigger, DialogContent, DialogTitle, DialogFooter.',
    tags: ['modal', 'overlay', 'popup'],
    status: 'stable',
    props: 'open, onOpenChange',
    variants: 'default',
  },
  {
    objectID: 'select-1',
    name: 'Select',
    category: 'Forms',
    description: 'Dropdown picker. Sub: SelectTrigger, SelectValue, SelectContent, SelectItem.',
    tags: ['dropdown', 'picker', 'select'],
    status: 'stable',
    props: 'value, onValueChange, disabled',
    variants: 'default',
  },
  {
    objectID: 'checkbox-1',
    name: 'Checkbox',
    category: 'Forms',
    description: 'Toggle for checked/unchecked/indeterminate states. Built with Radix UI.',
    tags: ['form', 'toggle', 'boolean'],
    status: 'stable',
    props: 'checked, onCheckedChange, disabled',
    variants: 'default',
  },
  {
    objectID: 'badge-1',
    name: 'Badge',
    category: 'Data Display',
    description:
      'Small label for status, tags, counts. Variants: default, secondary, destructive, outline.',
    tags: ['label', 'tag', 'status'],
    status: 'stable',
    props: 'variant',
    variants: 'default, secondary, destructive, outline',
  },
];

const detectionSchema = z.object({
  label: z
    .string()
    .describe('A short human label for the detected UI element, e.g. "Submit button" or "Email field".'),
  componentName: z
    .string()
    .describe('The closest catalog component name this element maps to, e.g. "Button".'),
  variant: z
    .string()
    .optional()
    .describe('The catalog variant that best matches, e.g. "outline". Omit if not applicable.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence (0-1) that this mapping is correct.'),
  box: z
    .array(z.number().min(0).max(1000))
    .length(4)
    .describe(
      'Bounding box [ymin, xmin, ymax, xmax] of this element in the screenshot, normalized 0-1000 (y first).',
    ),
  grounding: z
    .enum(['grounded', 'inferred', 'guessed'])
    .describe(
      'grounded = maps cleanly to a catalog component; inferred = reasonable mapping with some uncertainty; guessed = low confidence / no good catalog match.',
    ),
});

const genSchema = z.object({
  detections: z
    .array(detectionSchema)
    .describe('Every distinct UI element detected in the screenshot, mapped to a catalog component.'),
  jsx: z
    .string()
    .describe(
      'A single self-contained TypeScript React file. Default-exports an `App` component recreating the screenshot. Only imports allowed: react, lucide-react. Tailwind utility classes only.',
    ),
  componentsUsed: z
    .array(z.string())
    .describe('Catalog component names that informed the generated UI.'),
  notes: z
    .string()
    .describe('Brief notes on layout/design decisions and any catalog gaps.'),
});

/** ~40-component cap to control prompt tokens. */
const MAX_CATALOG = 40;

/** Build a compact, token-efficient catalog grounding string. */
function buildCatalogPrompt(): string {
  return catalog
    .slice(0, MAX_CATALOG)
    .map((c) => `${c.name} — variants: ${c.variants} — props: ${c.props}`)
    .join('\n');
}

const PROMPT = `You are an expert front-end engineer and design-system analyst.

You will be given a screenshot of a user interface. Do TWO things:

1) DETECT every distinct UI element in the screenshot. For each, map it to the closest
   component from the CATALOG WHITELIST below (by name), pick the best-fitting variant
   when one applies, give it a short human label, and a confidence score (0-1).
   Also return for EACH detection:
   - "box": the element's bounding box in the screenshot as [ymin, xmin, ymax, xmax],
     normalized 0-1000 (y FIRST — Gemini's native box format). Be precise: the box
     should tightly enclose the visible element.
   - "grounding": an honest assessment of the catalog mapping —
     "grounded" if it maps cleanly to a catalog component,
     "inferred" if it is a reasonable mapping with some uncertainty,
     "guessed" if confidence is low or there is no good catalog match.
   Return these in "detections".

2) GENERATE one self-contained TypeScript React file (the "jsx" field) that visually
   RECREATES the screenshot as closely as possible. Prefer recreating the elements using
   the patterns and variants implied by the catalog whitelist.

STRICT RULES for the generated "jsx":
- It MUST be a single file that compiles and runs in a Sandpack "react-ts" template.
- It MUST default-export a component named \`App\` (i.e. \`export default function App() { ... }\`).
- Inline ALL sub-components in the same file. Do NOT split into multiple files.
- The ONLY allowed imports are: \`react\` (e.g. \`import { useState } from 'react'\`) and,
  optionally, \`lucide-react\` for icons.
- DO NOT import from "@/..." or any package other than react / lucide-react.
- DO NOT import shadcn, the catalog, CSS files, or any UI library.
- Style ONLY with Tailwind utility classes (Tailwind is provided via CDN at runtime).
- No external network calls, no fetch, no images from the internet (use colored
  placeholders / Tailwind backgrounds or lucide icons instead).
- Keep it accessible: real button/label/input elements, sensible aria where helpful.

If the image contains hand-drawn marks (arrows, scribbles, circles, or text) in
red/vermilion ink, treat those marks as INSTRUCTIONS from the user about what to
change or emphasize — NOT as UI to reproduce. Apply the instruction and do not
render the marks themselves.

Put the catalog names you leaned on in "componentsUsed", and a short rationale in "notes".

CATALOG WHITELIST (recreate using these patterns/variants where possible):
${buildCatalogPrompt()}`;

/**
 * Build the targeted-repair instruction appended to the base prompt on a repair pass.
 * Handles BOTH compile/runtime errors and accessibility/quality fixes.
 */
function buildRepairPrompt(
  previousJsx: string,
  errorMessage: string,
  reason: 'compile' | 'a11y' | 'refine' = 'compile',
): string {
  const framing =
    reason === 'a11y'
      ? `REPAIR PASS: The previous attempt below has these ACCESSIBILITY issues. Fix ALL of
them while KEEPING the same visual design, layout, and styling unchanged:
---ISSUES---
${errorMessage}
---END ISSUES---`
      : reason === 'refine'
        ? `REFINE PASS: Apply this requested change to the component while keeping
everything else intact and obeying all the original rules (only react +
lucide-react, Tailwind, default-export App):
---CHANGE REQUEST---
${errorMessage}
---END CHANGE REQUEST---`
        : `REPAIR PASS: The previous attempt below FAILED to compile with this error:
---ERROR---
${errorMessage}
---END ERROR---`;

  return `${PROMPT}

${framing}

Previous App.tsx:
---CODE---
${previousJsx}
---END CODE---

Return CORRECTED, self-contained App.tsx in the "jsx" field, obeying ALL the rules above
(only react + lucide-react imports, Tailwind classes, default-exported \`App\`). Fix the
issues above; do not reintroduce them.`;
}

/**
 * Try to compile-check jsx via esbuild's tsx loader.
 * @returns null on success, or the error message string on failure.
 */
async function parseCheck(jsx: string): Promise<string | null> {
  // esbuild ships a platform-specific native binary that is not reliably bundled
  // into the Vercel serverless function, so import it dynamically and skip the
  // check if it is unavailable. The client-side Sandpack error path still catches
  // anything that slips through.
  let transform: typeof import('esbuild').transform;
  try {
    ({ transform } = await import('esbuild'));
  } catch {
    return null;
  }
  try {
    await transform(jsx, { loader: 'tsx' });
    return null;
  } catch (err) {
    if (err && typeof err === 'object' && 'errors' in err) {
      const errors = (err as { errors?: Array<{ text?: string }> }).errors;
      if (Array.isArray(errors) && errors.length > 0) {
        return errors.map((e) => e.text ?? '').filter(Boolean).join('; ') || 'Unknown compile error';
      }
    }
    return err instanceof Error ? err.message : 'Unknown compile error';
  }
}

/** Parse a base64 data URL into mime type + raw base64 payload. */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/** Image MIME types the pipeline accepts. Anything else is rejected before calling Gemini. */
const ALLOWED_IMAGE_MIME = /^image\/(png|jpeg|jpg|webp|gif)$/i;

/**
 * Max accepted size of the decoded image (in bytes). Bounds request cost/latency.
 * ~4MB of raw image data; base64 is ~33% larger on the wire.
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Cap on model output tokens per generateObject call, to bound cost. Gemini 2.5
 * spends "thoughts" tokens against this budget before emitting the structured
 * object, so the cap must cover reasoning + the (sizeable) jsx field + the
 * per-detection box/grounding fields, or the JSON is truncated mid-string.
 *
 * Measured failure (2026-06): with an 8000 cap, Gemini 2.5 flash spent ~6800
 * tokens on reasoning and only ~1200 on output, truncating the JSON
 * (finishReason: 'length') so it never parsed. The fix is two-part: cap the
 * thinking budget (see THINKING_BUDGET) so reasoning cannot starve the output,
 * and raise this ceiling so a full component + detections always fit.
 */
const MAX_OUTPUT_TOKENS = 16000;

/**
 * Hard cap on Gemini 2.5 "thinking" tokens per call. Enough to reason about a
 * layout, but bounded so it cannot consume the whole output budget and truncate
 * the structured JSON. Output tokens then cover the component + detections.
 */
const THINKING_BUDGET = 2048;

/** Approximate decoded byte length of a base64 string without allocating a Buffer. */
function approxBase64Bytes(base64: string): number {
  // 4 base64 chars encode 3 bytes; subtract padding.
  const len = base64.length;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

/** Strip stray ```tsx / ```jsx / ``` fences a model may wrap code in. */
function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:tsx|jsx|ts|js|typescript|javascript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Max number of REPAIR iterations after the initial generation. */
const MAX_REPAIRS = 2;

/**
 * Generate a self-contained React component + detection report from a screenshot.
 *
 * After each generation the returned `jsx` is compile-checked with esbuild. If it fails,
 * up to {@link MAX_REPAIRS} repair passes are run, feeding the broken code + error back to
 * the model. Returns the first jsx that compiles; if all attempts fail, returns the last
 * attempt with a warning appended to `notes`.
 *
 * @param imageDataUrl A base64 data URL: `data:<mime>;base64,<payload>`.
 * @param repair Optional targeted-repair context (previous jsx + error) from a client runtime failure.
 * @throws if the API key is missing or the input is not a valid data URL.
 */
export async function generateFromScreenshot(
  imageDataUrl: string,
  repair?: RepairContext,
): Promise<GenResult> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not configured on the server');
  }

  const parsed = parseDataUrl(imageDataUrl);
  if (!parsed) {
    throw new Error('imageDataUrl must be a base64 data URL (data:<mime>;base64,...)');
  }

  // MIME guard: only accept supported raster image types before spending a Gemini call.
  if (!ALLOWED_IMAGE_MIME.test(parsed.mimeType)) {
    throw new Error('Unsupported image type. Please use a PNG, JPEG, WebP, or GIF.');
  }

  // Size guard: bound decoded image size before allocating a Buffer / calling Gemini.
  if (approxBase64Bytes(parsed.data) > MAX_IMAGE_BYTES) {
    throw new Error('That image is too large. Please try one under 4 MB.');
  }

  const modelId = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const image = Uint8Array.from(Buffer.from(parsed.data, 'base64'));
  const mediaType = parsed.mimeType;

  /** One generation call. `repairPrompt` is used for repair passes; otherwise the base PROMPT. */
  async function runGeneration(repairPrompt?: string): Promise<z.infer<typeof genSchema>> {
    const { object } = await generateObject({
      model: google(modelId),
      schema: genSchema,
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Bound Gemini 2.5 thinking so reasoning cannot eat the whole output
      // budget and truncate the JSON (finishReason: 'length').
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: THINKING_BUDGET } },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: repairPrompt ?? PROMPT },
            // Pass raw bytes + mediaType so the SDK does not try to fetch the data: URL.
            { type: 'image', image, mediaType },
          ],
        },
      ],
    });
    return object;
  }

  // Seed: if the client sent a targeted-repair context, start from a repair pass;
  // otherwise do a fresh generation.
  let result: z.infer<typeof genSchema>;
  let repairs = 0;
  if (repair?.previousJsx && repair.errorMessage) {
    result = await runGeneration(
      buildRepairPrompt(repair.previousJsx, repair.errorMessage, repair.repairReason ?? 'compile'),
    );
    repairs = 1;
  } else {
    result = await runGeneration();
  }

  let jsx = stripCodeFences(result.jsx);
  let lastError = await parseCheck(jsx);

  // Repair loop: keep going until it compiles or we hit the cap.
  while (lastError !== null && repairs < MAX_REPAIRS) {
    repairs += 1;
    const repaired = await runGeneration(buildRepairPrompt(jsx, lastError));
    result = repaired;
    jsx = stripCodeFences(repaired.jsx);
    lastError = await parseCheck(jsx);
  }

  const notes =
    lastError === null
      ? result.notes
      : `${result.notes}\n\n⚠️ Auto-repair could not produce compiling code after ${repairs} attempt(s). Last error: ${lastError}`;

  return {
    ...result,
    jsx,
    notes,
    repairs,
  };
}

/**
 * Best-effort per-IP rate limit for the public, paid endpoint. Vercel keeps a warm
 * serverless instance between invocations, so this in-memory window catches casual
 * abuse and runaway clients without extra infrastructure. It is NOT a distributed
 * guarantee (a cold start or a second instance resets the window); pair it with a
 * spend cap in the Google AI console and the TRACE_DISABLED kill switch for real
 * protection. Tunable via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS.
 */
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 10);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateHits = new Map<string, number[]>();

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown');
}

/** Returns true if this IP is over its window budget. Records the hit when allowed. */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(ip, hits);
  // Opportunistic cleanup so the map cannot grow without bound on a warm instance.
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) {
      const live = v.filter((t) => t > cutoff);
      if (live.length === 0) rateHits.delete(k);
      else rateHits.set(k, live);
    }
  }
  return false;
}

/**
 * POST /api/generate
 * Body: {
 *   imageDataUrl: string,          // a data:<mime>;base64,<payload> URL
 *   previousJsx?: string,          // optional: prior jsx to repair (targeted repair)
 *   errorMessage?: string,         // optional: compile/runtime error, a11y issues, OR a user change request for previousJsx
 *   repairReason?: 'compile' | 'a11y' | 'refine', // optional: how to frame the repair (default 'compile')
 * }
 * Returns: GenResult JSON ({ detections, jsx, componentsUsed, notes, repairs }).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Kill switch: lets an operator disable the public paid endpoint without a redeploy.
  if (process.env.TRACE_DISABLED === '1') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(503).json({ error: 'Trace is temporarily unavailable' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Best-effort per-IP throttle on the paid endpoint before any model work.
  if (await isRateLimitedDurable(clientIp(req))) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many requests. Please slow down and try again in a minute.' });
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return res.status(503).json({ error: 'Google Generative AI API key not configured on server' });
  }

  const { imageDataUrl, previousJsx, errorMessage, repairReason } = req.body ?? {};
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'imageDataUrl is required' });
  }

  // Body-size guard: reject oversized image payloads before any Gemini work. The
  // base64 string is ~33% larger than the decoded image, so allow headroom over
  // the 4MB decoded cap and let generateFromScreenshot do the exact decoded check.
  if (imageDataUrl.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(413).json({ error: 'That image is too large. Please try one under 4 MB.' });
  }

  const repair =
    typeof previousJsx === 'string' && typeof errorMessage === 'string'
      ? {
          previousJsx,
          errorMessage,
          repairReason:
            repairReason === 'a11y'
              ? ('a11y' as const)
              : repairReason === 'refine'
                ? ('refine' as const)
                : ('compile' as const),
        }
      : undefined;

  try {
    const result = await generateFromScreenshot(imageDataUrl, repair);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Generation failed';
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Input-validation errors are safe to return. Anything else may contain
    // provider internals (including secrets echoed in request headers), so log
    // it server-side only and return a generic message to the client.
    if (detail.includes('too large')) {
      return res.status(413).json({ error: detail });
    }
    if (detail.includes('data URL') || detail.includes('Unsupported image type')) {
      return res.status(400).json({ error: detail });
    }
    console.error('[api/generate] generation failed:', detail);
    return res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
}
